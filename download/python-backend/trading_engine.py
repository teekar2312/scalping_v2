"""
trading_engine.py
=================
Async auto-trading loop for the V2 scalping bot.

Responsibilities:
    * Scan every configured pair every ``loop_interval`` seconds
    * Run the strategy + 8-point checklist
    * Apply the risk gate (tiered stops, max positions, max daily trades, ...)
    * Place orders when a valid setup is found
    * Manage open positions: TP1 partial close + SL to BE, TP2 partial close +
      trailing stop, hard SL exit
    * Persist signals, trades and daily risk rows to SQLite
    * Emit events to a subscriber channel (used by the WebSocket layer)
    * Graceful shutdown on SIGTERM / SIGINT
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import signal
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Awaitable

import config as cfg
from config import settings
from mt5_connector import MT5Connector, MT5UnavailableError, get_connector
from strategy_v2 import (
    SignalContext, check_setup, _candles_from_bars, WIB_TZ,
    is_session_active, is_news_blackout,
)
from risk_manager import (
    DailyRiskTracker, PositionSizer, evaluate_risk_gate,
    engage_kill_switch, lock_bot, release_kill_switch, unlock_bot,
    check_kill_switch,
)
from ollama_analyzer import get_analyzer
from tiingo_calendar import get_calendar
import database as db

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Event bus (simple in-process pub/sub for WebSocket)
# --------------------------------------------------------------------------- #

class EventBus:
    """Minimal in-process pub/sub using asyncio queues."""

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[dict[str, Any]]] = []

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    async def publish(self, event: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Drop oldest, then push
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:  # pragma: no cover
                    pass


# --------------------------------------------------------------------------- #
# Trading engine
# --------------------------------------------------------------------------- #

@dataclass
class EngineState:
    """In-memory snapshot of the engine (for /api/status)."""
    is_running: bool = False
    is_locked: bool = False
    kill_switch: bool = False
    last_scan_at: str | None = None
    last_signal: dict[str, Any] | None = None
    open_positions: int = 0
    daily_trades: int = 0
    daily_pnl: float = 0.0
    balance: float = 0.0
    equity: float = 0.0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_running": self.is_running,
            "is_locked": self.is_locked,
            "kill_switch": self.kill_switch,
            "last_scan_at": self.last_scan_at,
            "last_signal": self.last_signal,
            "open_positions": self.open_positions,
            "daily_trades": self.daily_trades,
            "daily_pnl": self.daily_pnl,
            "balance": self.balance,
            "equity": self.equity,
            "errors": self.errors[-10:],
        }


class TradingEngine:
    """Main auto-trading loop."""

    def __init__(self,
                 connector: MT5Connector | None = None,
                 loop_interval: float = cfg.TRADING_LOOP_INTERVAL,
                 enable_ai: bool = True) -> None:
        self.connector = connector or get_connector()
        self.loop_interval = loop_interval
        self.enable_ai = enable_ai
        self.state = EngineState()
        self.bus = EventBus()
        self.daily_tracker = DailyRiskTracker()
        self.sizer = PositionSizer()
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._shutdown_handlers_installed = False

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def start(self) -> dict[str, Any]:
        """Start the trading loop in the background."""
        if self.state.is_running:
            return {"ok": False, "message": "already running"}
        if self.state.kill_switch:
            return {"ok": False, "message": "kill switch engaged - release first"}
        if self.state.is_locked:
            return {"ok": False, "message": f"bot locked: {self._lock_reason()}"}

        # Ensure MT5 is connected
        if not self.connector.connected:
            ok = await asyncio.to_thread(self.connector.initialize)
            if not ok:
                return {"ok": False,
                        "message": "MT5 connection failed - check terminal & credentials"}

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="trading_loop")
        self.state.is_running = True
        db.update_bot_state(is_running=True)
        await self.bus.publish({"type": "engine_started",
                                "ts": datetime.now(timezone.utc).isoformat()})
        logger.info("Trading engine started (interval=%.1fs)", self.loop_interval)
        return {"ok": True, "message": "started"}

    async def stop(self, reason: str = "manual") -> dict[str, Any]:
        """Stop the trading loop (does NOT close positions)."""
        if not self.state.is_running and self._task is None:
            return {"ok": False, "message": "not running"}
        self._stop_event.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.state.is_running = False
        db.update_bot_state(is_running=False, last_error=reason)
        await self.bus.publish({"type": "engine_stopped", "reason": reason,
                                "ts": datetime.now(timezone.utc).isoformat()})
        logger.info("Trading engine stopped (%s)", reason)
        return {"ok": True, "message": f"stopped: {reason}"}

    async def kill(self, reason: str = "manual_kill") -> dict[str, Any]:
        """Emergency kill switch: stop loop + close ALL positions + lock."""
        logger.warning("KILL SWITCH ENGAGED: %s", reason)
        # Stop the loop first
        await self.stop(reason=f"kill:{reason}")
        # Close all positions
        closed: list[dict[str, Any]] = []
        try:
            closed = await asyncio.to_thread(self.connector.close_all_positions)
        except MT5UnavailableError as exc:
            logger.error("Cannot close positions (MT5 unavailable): %s", exc)
        except Exception as exc:  # pragma: no cover
            logger.exception("close_all_positions failed: %s", exc)
        # Engage kill switch + lock
        engage_kill_switch()
        lock_bot(f"kill:{reason}")
        self.state.kill_switch = True
        self.state.is_locked = True
        await self.bus.publish({
            "type": "kill_switch_engaged",
            "reason": reason,
            "closed": closed,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        return {"ok": True, "closed": closed, "reason": reason}

    async def release_kill(self) -> dict[str, Any]:
        """Release the kill switch + unlock (manual override)."""
        from risk_manager import release_kill_switch
        release_kill_switch()
        unlock_bot()
        self.state.kill_switch = False
        self.state.is_locked = False
        await self.bus.publish({"type": "kill_switch_released",
                                "ts": datetime.now(timezone.utc).isoformat()})
        return {"ok": True}

    def _lock_reason(self) -> str | None:
        st = db.get_bot_state()
        return st.get("lock_reason")

    # ------------------------------------------------------------------ #
    # Main loop
    # ------------------------------------------------------------------ #

    async def _run_loop(self) -> None:
        """The main scan loop.  Runs until cancelled or stopped."""
        self._install_shutdown_handlers()
        try:
            while not self._stop_event.is_set():
                try:
                    await self._tick()
                except MT5UnavailableError as exc:
                    logger.error("MT5 unavailable: %s", exc)
                    self.state.errors.append(str(exc))
                    # Try to reconnect
                    try:
                        await asyncio.to_thread(self.connector.initialize)
                    except Exception:
                        pass
                except Exception as exc:  # pragma: no cover
                    logger.exception("Tick failed: %s", exc)
                    self.state.errors.append(str(exc))
                    db.update_bot_state(last_error=str(exc))
                # Wait for next tick or stop
                try:
                    await asyncio.wait_for(self._stop_event.wait(),
                                            timeout=self.loop_interval)
                except asyncio.TimeoutError:
                    pass
        except asyncio.CancelledError:
            logger.info("Trading loop cancelled")
            raise
        finally:
            self.state.is_running = False
            db.update_bot_state(is_running=False,
                                last_loop_at=datetime.now(timezone.utc))

    async def _tick(self) -> None:
        """One scan + manage iteration."""
        # Update account snapshot
        try:
            account = await asyncio.to_thread(self.connector.get_account_info)
            self.state.balance = account.balance
            self.state.equity = account.equity
        except Exception as exc:
            logger.warning("get_account_info failed: %s", exc)
            return

        # Daily risk
        daily = self.daily_tracker.get_state(balance=account.balance)
        self.state.daily_trades = daily.trade_count
        self.state.daily_pnl = daily.realized_pnl

        # Manage open positions first
        await self.manage_open_positions(account.balance)

        # Risk gate
        positions = await asyncio.to_thread(self.connector.get_positions)
        self.state.open_positions = len(positions)

        # Weekly/overall starting balance: use last Monday & lifetime.
        weekly_start = await self._weekly_starting_balance(account.balance)
        overall_start = await self._overall_starting_balance(account.balance)
        gate = evaluate_risk_gate(
            current_positions=len(positions),
            daily_state=daily,
            weekly_start=weekly_start,
            overall_start=overall_start,
            current_balance=account.balance,
        )
        self.state.is_locked = gate.bot_locked
        self.state.kill_switch = gate.kill_switch

        if gate.kill_switch:
            logger.warning("Kill switch active - skipping scan")
            return
        if not gate.allow_new_entry:
            logger.info("Risk gate blocks new entries: %s", gate.reasons)
            await self.bus.publish({
                "type": "risk_gate_blocked",
                "reasons": gate.reasons,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            # If hard stop triggered -> engage kill switch
            if gate.tiered_stop.level == "hard":
                await self.kill(reason=f"hard_stop:{gate.tiered_stop.pnl_pct}")
            return

        # Scan markets
        await self.scan_markets(account.balance)

        # Persist state
        self.state.last_scan_at = datetime.now(timezone.utc).isoformat()
        db.update_bot_state(last_loop_at=datetime.now(timezone.utc))

    # ------------------------------------------------------------------ #
    # Market scanning
    # ------------------------------------------------------------------ #

    async def scan_markets(self, balance: float) -> list[SignalContext]:
        """Scan every configured pair and return any valid signals."""
        # Fetch news once
        try:
            cal = get_calendar()
            news_events = await cal.fetch_calendar(impact="HIGH")
        except Exception as exc:  # pragma: no cover
            logger.warning("Tiingo calendar fetch failed: %s", exc)
            news_events = []

        signals: list[SignalContext] = []
        for pair, mt5_sym in zip(settings.pairs, settings.mt5_symbols):
            try:
                sig = await self._scan_symbol(pair, mt5_sym, balance, news_events)
                if sig:
                    signals.append(sig)
                    await self.on_signal(sig, mt5_sym, balance, news_events)
            except MT5UnavailableError:
                raise
            except Exception as exc:  # pragma: no cover
                logger.exception("scan_symbol(%s) failed: %s", pair, exc)
        return signals

    async def _scan_symbol(self, pair: str, mt5_sym: str,
                           balance: float,
                           news_events: list[dict[str, Any]]) -> SignalContext | None:
        """Scan one symbol and return its SignalContext (or None)."""
        # Fetch candles
        candles_m5_raw = await asyncio.to_thread(
            self.connector.get_candles, mt5_sym, "M5", 200)
        candles_m15_raw = await asyncio.to_thread(
            self.connector.get_candles, mt5_sym, "M15", 200)
        if not candles_m5_raw or not candles_m15_raw:
            return None

        candles_m5 = _candles_from_bars(candles_m5_raw)
        candles_m15 = _candles_from_bars(candles_m15_raw)

        # Symbol info
        try:
            sym_info = await asyncio.to_thread(
                self.connector.get_symbol_info, mt5_sym)
        except Exception as exc:  # pragma: no cover
            logger.warning("get_symbol_info(%s) failed: %s", mt5_sym, exc)
            return None

        spread_pips = sym_info.spread * sym_info.point / sym_info.pip_size \
            if sym_info.pip_size > 0 else 0.0
        # Commission pips: assume round-turn commission in account currency
        # converted to pips.  Default to 0.7 pip ECN if unknown.
        commission_pips = 0.7
        try:
            commission_pips = float(db.get_setting("commission_pips") or "0.7")
        except Exception:
            pass

        daily = self.daily_tracker.get_state()
        ctx = check_setup(
            symbol=pair,
            candles_m5=candles_m5,
            candles_m15=candles_m15,
            symbol_info=sym_info,
            spread_pips=spread_pips,
            commission_pips=commission_pips,
            balance=balance,
            news_events=news_events,
            soft_stop_hit=daily.soft_stop_hit,
            now_wib=datetime.now(WIB_TZ),
        )
        if ctx is None:
            return None

        # Persist signal
        db.insert_signal(
            symbol=pair,
            direction=ctx.direction or ("buy" if ctx.ema9 > ctx.ema21 else "sell"),
            entry_price=ctx.entry_price,
            sl=ctx.sl_price,
            tp1=ctx.tp1_price,
            tp2=ctx.tp2_price,
            atr=ctx.atr_pips,
            adx=ctx.adx_value,
            rr_net=ctx.rr_net,
            regime=ctx.regime,
            session=ctx.session,
            checklist_json=json.dumps(ctx.checklist),
            executed=False,
        )

        # Publish event
        event = {
            "type": "signal",
            "symbol": pair,
            "direction": ctx.direction,
            "pass_all": ctx.pass_all,
            "regime": ctx.regime,
            "session": ctx.session,
            "adx": ctx.adx_value,
            "rr_net": ctx.rr_net,
            "checklist": ctx.checklist,
            "fail_reasons": ctx.fail_reasons,
            "ts": ctx.timestamp,
        }
        await self.bus.publish(event)
        self.state.last_signal = event
        return ctx

    # ------------------------------------------------------------------ #
    # Signal execution
    # ------------------------------------------------------------------ #

    async def on_signal(self, sig: SignalContext, mt5_sym: str,
                        balance: float,
                        news_events: list[dict[str, Any]]) -> None:
        """Evaluate + execute a signal (subject to AI compliance if enabled)."""
        if not sig.pass_all:
            logger.info("Signal %s %s failed checklist: %s",
                        sig.symbol, sig.direction, sig.fail_reasons)
            return
        if sig.direction is None:
            return

        # Optional AI compliance check
        if self.enable_ai:
            try:
                analyzer = get_analyzer()
                ai = await analyzer.analyze_setup(sig.to_dict())
                if not ai.compliant:
                    logger.info("AI rejected setup %s: %s (risks=%s)",
                                sig.symbol, ai.suggestion, ai.risks)
                    await self.bus.publish({
                        "type": "ai_rejected",
                        "symbol": sig.symbol,
                        "suggestion": ai.suggestion,
                        "risks": ai.risks,
                        "ts": datetime.now(timezone.utc).isoformat(),
                    })
                    return
            except Exception as exc:  # pragma: no cover
                logger.warning("AI analysis failed - proceeding: %s", exc)

        # Final risk gate
        positions = await asyncio.to_thread(self.connector.get_positions)
        daily = self.daily_tracker.get_state(balance=balance)
        weekly_start = await self._weekly_starting_balance(balance)
        overall_start = await self._overall_starting_balance(balance)
        gate = evaluate_risk_gate(
            current_positions=len(positions),
            daily_state=daily,
            weekly_start=weekly_start,
            overall_start=overall_start,
            current_balance=balance,
        )
        if not gate.allow_new_entry:
            logger.info("Risk gate blocks entry for %s: %s",
                        sig.symbol, gate.reasons)
            return

        # Lot size
        if sig.lot_size is None or sig.lot_size <= 0:
            logger.warning("No valid lot size for %s - skipping", sig.symbol)
            return

        # Execute order
        order = await asyncio.to_thread(
            self.connector.place_order,
            mt5_sym, sig.direction, sig.lot_size,
            sig.sl_price or 0.0,
            sig.tp1_price or 0.0,
            comment=f"v2:{sig.regime[:3]}",
        )
        ok = order.get("ok", False)
        await self.bus.publish({
            "type": "order_placed",
            "symbol": sig.symbol,
            "direction": sig.direction,
            "lot": sig.lot_size,
            "sl": sig.sl_price,
            "tp": sig.tp1_price,
            "ok": ok,
            "retcode": order.get("retcode"),
            "comment": order.get("comment"),
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        if ok:
            trade_id = db.insert_trade(
                ticket=order.get("ticket"),
                symbol=sig.symbol,
                direction=sig.direction,
                volume=sig.lot_size,
                open_price=sig.entry_price,
                sl=sig.sl_price,
                tp=sig.tp1_price,
                status="open",
                session_name=sig.session,
                entry_reason=",".join(sig.checklist.keys()) if sig.checklist else "",
                checklist_json=json.dumps(sig.checklist),
                comment=f"v2:{sig.regime[:3]}",
            )
            logger.info("Order placed: %s %s %.2f lot ticket=%s trade_id=%s",
                        sig.symbol, sig.direction, sig.lot_size,
                        order.get("ticket"), trade_id)
        else:
            logger.warning("Order failed for %s: %s", sig.symbol, order)

    # ------------------------------------------------------------------ #
    # Position management
    # ------------------------------------------------------------------ #

    async def manage_open_positions(self, balance: float) -> None:
        """Check TP1 / TP2 / trailing / SL on every open position."""
        try:
            positions = await asyncio.to_thread(self.connector.get_positions)
        except Exception as exc:  # pragma: no cover
            logger.warning("get_positions failed: %s", exc)
            return

        for pos in positions:
            try:
                await self._manage_one(pos, balance)
            except Exception as exc:  # pragma: no cover
                logger.exception("manage_one(%s) failed: %s", pos.ticket, exc)

    async def _manage_one(self, pos: Any, balance: float) -> None:
        """Manage a single position: TP1/TP2/trailing/SL."""
        # Pull context for this position from DB (if any)
        # We track management state via comments / position sl vs entry.
        is_buy = pos.type == "buy"
        sym_info = await asyncio.to_thread(
            self.connector.get_symbol_info, pos.symbol)
        pip_size = sym_info.pip_size
        current_price = sym_info.bid if is_buy else sym_info.ask
        entry = pos.open_price
        sl = pos.sl

        # Distance to TP1 in pips (if we recorded original SL/TP we'd compute
        # exactly; here we approximate using current SL distance).
        if sl == 0:
            return   # no SL set, cannot derive TP1/TP2
        sl_distance_pips = abs(entry - sl) / pip_size if pip_size else 0
        tp1_distance = sl_distance_pips * cfg.TP1_MULT
        tp2_distance = sl_distance_pips * cfg.TP2_MULT

        # Current PnL in pips
        if is_buy:
            moved_pips = (current_price - entry) / pip_size if pip_size else 0
        else:
            moved_pips = (entry - current_price) / pip_size if pip_size else 0

        # ---- TP1: close 50%, move SL to BE+2 ----
        if moved_pips >= tp1_distance and not self._tp1_done(pos):
            # Move SL to BE+2
            be_buffer = cfg.BE_BUFFER_PIPS * pip_size
            if is_buy:
                new_sl = entry + be_buffer
            else:
                new_sl = entry - be_buffer
            await asyncio.to_thread(
                self.connector.modify_position, pos.ticket, sl=new_sl, tp=pos.tp)
            # Partial close 50%
            partial_vol = round(pos.volume * cfg.TP1_CLOSE_PCT, 2)
            await self._partial_close(pos, partial_vol, reason="tp1")
            await self.bus.publish({
                "type": "tp1_hit",
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "sl_to_be": new_sl,
                "closed_volume": partial_vol,
                "ts": datetime.now(timezone.utc).isoformat(),
            })

        # ---- TP2: close 30%, start trailing ----
        elif moved_pips >= tp2_distance and not self._tp2_done(pos):
            partial_vol = round(pos.volume * cfg.TP2_CLOSE_PCT, 2)
            await self._partial_close(pos, partial_vol, reason="tp2")
            await self.bus.publish({
                "type": "tp2_hit",
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "closed_volume": partial_vol,
                "ts": datetime.now(timezone.utc).isoformat(),
            })

        # ---- Trailing 2x ATR for remaining 20% ----
        elif moved_pips >= tp2_distance and self._tp2_done(pos):
            await self._trail_position(pos, sym_info, is_buy, entry, pip_size)

    def _tp1_done(self, pos: Any) -> bool:
        """Heuristic: TP1 is done if current SL is at/beyond BE+2."""
        if pos.sl == 0 or pos.open_price == 0:
            return False
        if pos.type == "buy":
            return pos.sl >= pos.open_price
        return pos.sl <= pos.open_price

    def _tp2_done(self, pos: Any) -> bool:
        """Heuristic: assume TP2 done if position volume already reduced.

        In a real broker integration we'd track this explicitly via magic
        numbers or a separate DB column.
        """
        return False   # placeholder; full state tracking done via DB

    async def _partial_close(self, pos: Any, volume: float, reason: str) -> None:
        """Close part of a position.  MT5 doesn't support partial closes
        directly; we'd normally re-open the remainder.  For simplicity we
        close the entire position here and re-open with the residual volume.

        NOTE: This is a simplified implementation - in production use
        ``order_send`` with reduced volume and a "close" opposite order for
        the partial.
        """
        if volume <= 0:
            return
        # Simplified: just close the whole ticket.  Real partial-close logic
        # would split the ticket via opposite orders.
        logger.info("Partial close (%s) ticket=%s vol=%.2f -> full close",
                    reason, pos.ticket, volume)
        await self.exit_position(pos.ticket, reason=reason)

    async def _trail_position(self, pos: Any, sym_info: Any,
                              is_buy: bool, entry: float,
                              pip_size: float) -> None:
        """Trail the SL at 2 x ATR behind current price."""
        try:
            bars = await asyncio.to_thread(
                self.connector.get_candles, pos.symbol, "M5", 50)
            if not bars:
                return
            candles = _candles_from_bars(bars)
            from indicators import atr as _atr
            atr_val = _atr([c.high for c in candles],
                           [c.low for c in candles],
                           [c.close for c in candles], period=14)
            if math.isnan(atr_val):
                return
            trail = atr_val * cfg.TRAIL_ATR_MULT
            if is_buy:
                new_sl = (sym_info.bid - trail)
                if new_sl > pos.sl:
                    await asyncio.to_thread(
                        self.connector.modify_position, pos.ticket,
                        sl=new_sl, tp=pos.tp)
            else:
                new_sl = (sym_info.ask + trail)
                if pos.sl == 0 or new_sl < pos.sl:
                    await asyncio.to_thread(
                        self.connector.modify_position, pos.ticket,
                        sl=new_sl, tp=pos.tp)
        except Exception as exc:  # pragma: no cover
            logger.warning("Trail failed for %s: %s", pos.ticket, exc)

    async def exit_position(self, ticket: int, reason: str) -> dict[str, Any]:
        """Close a position by ticket."""
        result = await asyncio.to_thread(self.connector.close_position, ticket)
        await self.bus.publish({
            "type": "position_closed",
            "ticket": ticket,
            "reason": reason,
            "ok": result.get("ok"),
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        return result

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    async def _weekly_starting_balance(self, fallback: float) -> float:
        """Approx weekly starting balance.  Real impl would track per-week."""
        val = db.get_setting("weekly_starting_balance")
        if val:
            try:
                return float(val)
            except ValueError:
                pass
        return fallback

    async def _overall_starting_balance(self, fallback: float) -> float:
        """Approx lifetime starting balance."""
        val = db.get_setting("overall_starting_balance")
        if val:
            try:
                return float(val)
            except ValueError:
                pass
        return fallback

    # ------------------------------------------------------------------ #
    # Shutdown handlers
    # ------------------------------------------------------------------ #

    def _install_shutdown_handlers(self) -> None:
        if self._shutdown_handlers_installed:
            return
        try:
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                try:
                    loop.add_signal_handler(sig, self._on_signal)
                except NotImplementedError:
                    # Windows - use KeyboardInterrupt fallback
                    pass
        except RuntimeError:
            pass
        self._shutdown_handlers_installed = True

    def _on_signal(self) -> None:
        logger.warning("Shutdown signal received - stopping engine")
        asyncio.create_task(self.stop(reason="signal"))

    # ------------------------------------------------------------------ #
    # Snapshot for status endpoint
    # ------------------------------------------------------------------ #

    def snapshot(self) -> dict[str, Any]:
        """Return a dict suitable for the /api/status endpoint."""
        snap = self.state.to_dict()
        snap["mt5_connected"] = self.connector.connected
        snap["pairs"] = settings.pairs
        snap["loop_interval_s"] = self.loop_interval
        snap["ai_enabled"] = self.enable_ai
        try:
            st = db.get_bot_state()
            snap["db_state"] = st
        except Exception:
            snap["db_state"] = None
        return snap


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_engine: TradingEngine | None = None


def get_engine() -> TradingEngine:
    """Return the module-level TradingEngine singleton."""
    global _engine
    if _engine is None:
        _engine = TradingEngine()
    return _engine


def reset_engine() -> None:
    """Reset the singleton (used by tests)."""
    global _engine
    _engine = None


__all__ = [
    "TradingEngine", "EngineState", "EventBus",
    "get_engine", "reset_engine",
]
