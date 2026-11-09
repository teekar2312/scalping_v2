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
from typing import Any, AsyncIterator, Awaitable, Callable

import config as cfg
from config import settings
from mt5_connector import (
    MT5Connector, MT5UnavailableError, OrderTimeoutError,
    get_connector,
    place_order_async, modify_position_async,
    close_position_async, partial_close_async,
)
from strategy_v2 import (
    SignalContext, check_setup, _candles_from_bars, WIB_TZ,
    is_session_active, is_news_blackout,
)
from risk_manager import (
    DailyRiskTracker, PositionSizer, evaluate_risk_gate,
    engage_kill_switch, lock_bot, release_kill_switch, unlock_bot,
    check_kill_switch, check_correlation,
)
from ollama_analyzer import get_analyzer
from tiingo_calendar import get_calendar
import database as db

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Audit-log persistence for every published event (Sprint 1 #10)
# --------------------------------------------------------------------------- #

# Map of EventBus event_type -> (AuditLog.event_type, severity)
_EVENT_AUDIT_MAP: dict[str, tuple[str, str]] = {
    "signal": ("SIGNAL", "INFO"),
    "order_placed": ("ORDER_PLACED", "INFO"),
    "tp1_hit": ("TP1_HIT", "INFO"),
    "tp2_hit": ("TP2_HIT", "INFO"),
    "position_closed": ("SL_HIT", "INFO"),
    "kill_switch_engaged": ("KILL_SWITCH", "CRITICAL"),
    "risk_gate_blocked": ("RISK_GATE_BLOCKED", "WARN"),
    "ai_rejected": ("AI_REJECTED", "INFO"),
    "connection_lost": ("CONNECTION_LOST", "ERROR"),
    "recovery": ("RECOVERY", "INFO"),
    "cooldown_engaged": ("COOLDOWN_ENGAGED", "WARN"),
    "margin_warning": ("MARGIN_WARNING", "WARN"),
    "margin_call_prevented": ("MARGIN_CALL_PREVENTED", "CRITICAL"),
    "margin_emergency": ("MARGIN_EMERGENCY", "CRITICAL"),
    "weekend_close": ("WEEKEND_CLOSE", "WARN"),
    "news_reduce": ("NEWS_REDUCE", "WARN"),
}


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
        # Persist to AuditLog (best-effort, fire-and-forget)
        try:
            self._persist_audit(event)
        except Exception as exc:  # pragma: no cover
            logger.debug("audit persist failed: %s", exc)
        # Forward to Telegram (best-effort)
        try:
            from notifications import get_notification_manager
            mgr = get_notification_manager()
            if mgr.enabled:
                asyncio.create_task(mgr.handle_event(event))
        except Exception as exc:  # pragma: no cover
            logger.debug("telegram forward failed: %s", exc)

    @staticmethod
    def _persist_audit(event: dict[str, Any]) -> None:
        """Write the event to the AuditLog table (if mapped)."""
        event_type = event.get("type") or ""
        mapped = _EVENT_AUDIT_MAP.get(event_type)
        if mapped is None:
            return
        audit_type, severity = mapped
        symbol = event.get("symbol")
        ticket = event.get("ticket")
        if ticket is None:
            ticket_val: int | None = None
        else:
            try:
                ticket_val = int(ticket)
            except (TypeError, ValueError):
                ticket_val = None
        detail = {k: v for k, v in event.items()
                  if k not in ("type", "ts", "symbol", "ticket")}
        db.insert_audit_log(
            event_type=audit_type,
            symbol=symbol,
            ticket=ticket_val,
            detail=detail,
            severity=severity,
        )


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
    paper_mode: bool = False
    dry_run: bool = False
    peak_equity: float = 0.0
    last_equity_sample_at: float = 0.0

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
            "paper_mode": self.paper_mode,
            "dry_run": self.dry_run,
            "peak_equity": self.peak_equity,
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
        # Audit-fix: paper / dry-run mode
        self.paper_mode: bool = bool(cfg.PAPER_MODE)
        self.dry_run: bool = bool(cfg.DRY_RUN)
        self.state.paper_mode = self.paper_mode
        self.state.dry_run = self.dry_run

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

        # Ensure MT5 is connected (skip in paper mode)
        if not self.paper_mode and not self.connector.connected:
            ok = await asyncio.to_thread(self.connector.initialize)
            if not ok:
                return {"ok": False,
                        "message": "MT5 connection failed - check terminal & credentials"}

        # Crash recovery (audit-fix Sprint 1 #4)
        try:
            await self.recover_state()
        except Exception as exc:  # pragma: no cover
            logger.warning("Crash recovery failed (continuing): %s", exc)

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="trading_loop")
        self.state.is_running = True
        db.update_bot_state(is_running=True,
                            is_paper=self.paper_mode,
                            is_dry_run=self.dry_run)
        await self.bus.publish({"type": "engine_started",
                                "ts": datetime.now(timezone.utc).isoformat()})
        logger.info("Trading engine started (interval=%.1fs, paper=%s, dry=%s)",
                    self.loop_interval, self.paper_mode, self.dry_run)
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
        # Update account snapshot (skip in pure paper mode)
        account: Any | None = None
        if not self.paper_mode:
            try:
                account = await asyncio.to_thread(self.connector.get_account_info)
                self.state.balance = account.balance
                self.state.equity = account.equity
            except Exception as exc:
                logger.warning("get_account_info failed: %s", exc)
                await self.bus.publish({
                    "type": "connection_lost",
                    "service": "mt5_account_info",
                    "error": str(exc),
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
                return
        else:
            # Paper mode - use stored balance/equity or daily start
            daily = self.daily_tracker.get_state(balance=self.state.balance or 10000.0)
            self.state.balance = daily.current_balance
            self.state.equity = daily.current_balance
            account = _PaperAccount(self.state.balance)

        # Daily risk
        daily = self.daily_tracker.get_state(balance=account.balance)
        self.state.daily_trades = daily.trade_count
        self.state.daily_pnl = daily.realized_pnl

        # Margin-call prevention (audit-fix Sprint 1 #7)
        if not self.paper_mode and account is not None:
            await self._check_margin_safety(account)

        # Equity-curve sample (audit-fix Sprint 3 #19) - every ~60s
        await self._sample_equity_curve(account)

        # Weekend closer (audit-fix Sprint 2 #13)
        await self._maybe_weekend_close()

        # News pre/post management (audit-fix Sprint 2 #14)
        await self._maybe_news_reduce()

        # Manage open positions first
        await self.manage_open_positions(account.balance)

        # Risk gate
        positions = []
        if not self.paper_mode:
            positions = await asyncio.to_thread(self.connector.get_positions)
        else:
            # Paper mode - synthesise positions from open DB trades
            positions = [
                _PaperPosition(t) for t in db.list_open_trades()
                if t.get("is_paper")
            ]
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

        # Execute order (or skip in dry-run / paper mode)
        if self.dry_run:
            logger.info("[DRY-RUN] signal %s %s would enter @ %s (lot=%s) "
                        "SL=%s TP1=%s - no order placed",
                        sig.symbol, sig.direction, sig.entry_price,
                        sig.lot_size, sig.sl_price, sig.tp1_price)
            await self.bus.publish({
                "type": "order_placed",
                "symbol": sig.symbol,
                "direction": sig.direction,
                "lot": sig.lot_size,
                "sl": sig.sl_price,
                "tp": sig.tp1_price,
                "ok": True,
                "retcode": 0,
                "comment": "dry_run_no_order",
                "dry_run": True,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            return

        if self.paper_mode:
            # Paper: persist a trade row with is_paper=True and a fake ticket
            fake_ticket = -int(datetime.now(timezone.utc).timestamp() % 1_000_000)
            trade_id = db.insert_trade(
                ticket=fake_ticket,
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
                comment=f"v2_paper:{sig.regime[:3]}",
                stage="OPEN",
                original_volume=sig.lot_size,
                remaining_volume=sig.lot_size,
                strategy_version="v2.0",
                is_paper=True,
            )
            logger.info("[PAPER] trade_id=%s ticket=%s %s %s %.2f lot @ %s",
                        trade_id, fake_ticket,
                        sig.symbol, sig.direction, sig.lot_size, sig.entry_price)
            # Sprint 6 #12: persist ENTRY trade event
            try:
                db.insert_trade_event(
                    trade_id=trade_id, event_type="ENTRY",
                    ticket=fake_ticket, price=sig.entry_price,
                    volume=sig.lot_size, sl=sig.sl_price, tp=sig.tp1_price,
                    detail={"paper": True, "regime": sig.regime,
                            "session": sig.session},
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("insert_trade_event ENTRY failed: %s", exc)
            await self.bus.publish({
                "type": "order_placed",
                "symbol": sig.symbol,
                "direction": sig.direction,
                "lot": sig.lot_size,
                "sl": sig.sl_price,
                "tp": sig.tp1_price,
                "ok": True,
                "ticket": fake_ticket,
                "retcode": 0,
                "comment": "paper_mode",
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            return

        try:
            order = await place_order_async(
                self.connector,
                mt5_sym, sig.direction, sig.lot_size,
                sig.sl_price or 0.0,
                sig.tp1_price or 0.0,
                comment=f"v2:{sig.regime[:3]}",
            )
        except OrderTimeoutError as exc:
            logger.error("Order timeout for %s: %s", sig.symbol, exc)
            order = {"ok": False, "ticket": 0, "retcode": -1,
                     "comment": f"timeout: {exc}"}
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
                stage="OPEN",
                original_volume=sig.lot_size,
                remaining_volume=sig.lot_size,
                strategy_version="v2.0",
                # Sprint 7 #17: persist slippage + execution latency
                slippage_actual=order.get("slippage_actual_pips"),
                execution_latency_ms=order.get("execution_latency_ms"),
            )
            logger.info("Order placed: %s %s %.2f lot ticket=%s trade_id=%s",
                        sig.symbol, sig.direction, sig.lot_size,
                        order.get("ticket"), trade_id)
            # Sprint 6 #12: persist ENTRY trade event
            try:
                db.insert_trade_event(
                    trade_id=trade_id, event_type="ENTRY",
                    ticket=order.get("ticket"), price=sig.entry_price,
                    volume=sig.lot_size, sl=sig.sl_price, tp=sig.tp1_price,
                    detail={
                        "regime": sig.regime, "session": sig.session,
                        "slippage_pips": order.get("slippage_actual_pips"),
                        "latency_ms": order.get("execution_latency_ms"),
                    },
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("insert_trade_event ENTRY failed: %s", exc)
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
        try:
            sym_info = await asyncio.to_thread(
                self.connector.get_symbol_info, pos.symbol)
        except Exception as exc:
            logger.warning("get_symbol_info(%s) failed: %s", pos.symbol, exc)
            return
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
            try:
                await modify_position_async(self.connector, pos.ticket,
                                            sl=new_sl, tp=pos.tp)
            except OrderTimeoutError as exc:
                logger.warning("modify SL timeout (tp1) for %s: %s",
                               pos.ticket, exc)
            # Partial close 50%
            partial_vol = round(pos.volume * cfg.TP1_CLOSE_PCT, 2)
            await self._partial_close(pos, partial_vol, reason="tp1")
            # Mark DB stage
            self._mark_trade_stage(pos.ticket, "TP1_HIT", tp1_hit=True)
            # Sprint 6 #12: persist trade events for TP1 + SL_MOVE + PARTIAL_CLOSE
            await self._persist_trade_events(pos, [
                {"event_type": "TP1_HIT", "price": current_price,
                 "volume": pos.volume, "sl": new_sl, "tp": pos.tp,
                 "detail": {"moved_pips": moved_pips,
                            "tp1_distance_pips": tp1_distance}},
                {"event_type": "SL_MOVE", "price": current_price,
                 "volume": pos.volume, "sl": new_sl, "tp": pos.tp,
                 "detail": {"reason": "to_be_plus_buffer",
                            "be_buffer_pips": cfg.BE_BUFFER_PIPS}},
                {"event_type": "PARTIAL_CLOSE", "price": current_price,
                 "volume": partial_vol, "sl": new_sl, "tp": pos.tp,
                 "detail": {"pct": cfg.TP1_CLOSE_PCT,
                            "reason": "tp1"}},
            ])
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
            self._mark_trade_stage(pos.ticket, "TP2_HIT", tp2_hit=True,
                                   trailing_active=True)
            # Sprint 6 #12: persist TP2_HIT + PARTIAL_CLOSE + TRAILING_UPDATE
            await self._persist_trade_events(pos, [
                {"event_type": "TP2_HIT", "price": current_price,
                 "volume": pos.volume, "sl": pos.sl, "tp": pos.tp,
                 "detail": {"moved_pips": moved_pips,
                            "tp2_distance_pips": tp2_distance}},
                {"event_type": "PARTIAL_CLOSE", "price": current_price,
                 "volume": partial_vol, "sl": pos.sl, "tp": pos.tp,
                 "detail": {"pct": cfg.TP2_CLOSE_PCT, "reason": "tp2"}},
                {"event_type": "TRAILING_UPDATE", "price": current_price,
                 "volume": pos.volume, "sl": pos.sl, "tp": pos.tp,
                 "detail": {"started": True}},
            ])
            await self.bus.publish({
                "type": "tp2_hit",
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "closed_volume": partial_vol,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            # Start trailing immediately on this tick
            await self._trail_position(pos, sym_info, is_buy, entry, pip_size)

        # ---- Trailing 2x ATR for remaining 20% ----
        elif moved_pips >= tp2_distance and self._tp2_done(pos):
            await self._trail_position(pos, sym_info, is_buy, entry, pip_size)
            # Sprint 6 #12: persist TRAILING_UPDATE (only every few ticks via
            # a slug to avoid spamming the table - logged at DEBUG)
            try:
                row = db.get_trade_by_ticket(pos.ticket)
                if row:
                    db.insert_trade_event(
                        trade_id=int(row["id"]),
                        event_type="TRAILING_UPDATE",
                        ticket=pos.ticket, price=current_price,
                        volume=pos.volume, sl=pos.sl, tp=pos.tp,
                        detail={"moved_pips": moved_pips},
                    )
            except Exception:  # pragma: no cover
                pass

    def _tp1_done(self, pos: Any) -> bool:
        """Return True if TP1 has already been hit for this position.

        First consulted the DB ``stage`` column; falls back to the old
        heuristic (SL moved to/beyond break-even) if no DB row exists.
        """
        stage = self._lookup_trade_stage(pos.ticket)
        if stage in ("TP1_HIT", "TP2_HIT", "TRAILING", "CLOSED"):
            return True
        # Heuristic fallback
        if pos.sl == 0 or pos.open_price == 0:
            return False
        if pos.type == "buy":
            return pos.sl >= pos.open_price
        return pos.sl <= pos.open_price

    def _tp2_done(self, pos: Any) -> bool:
        """Return True if TP2 has already been hit (or trailing is active).

        Sprint 1 #2 fix: previously a hardcoded ``return False`` which meant
        trailing stops never fired.  Now reads from the DB ``stage`` column.
        """
        stage = self._lookup_trade_stage(pos.ticket)
        if stage in ("TP2_HIT", "TRAILING", "CLOSED"):
            return True
        return False

    def _lookup_trade_stage(self, ticket: int) -> str | None:
        """Read the DB stage for ``ticket`` (cached for ~5s)."""
        try:
            row = db.get_trade_by_ticket(int(ticket))
            if row is None:
                return None
            return row.get("stage")
        except Exception:
            return None

    def _mark_trade_stage(self, ticket: int, stage: str,
                          tp1_hit: bool | None = None,
                          tp2_hit: bool | None = None,
                          trailing_active: bool | None = None,
                          remaining_volume: float | None = None) -> None:
        """Update a trade row's V2 stage flags."""
        try:
            row = db.get_trade_by_ticket(int(ticket))
            if row is None:
                return
            fields: dict[str, Any] = {"stage": stage}
            if tp1_hit is not None:
                fields["tp1_hit"] = tp1_hit
            if tp2_hit is not None:
                fields["tp2_hit"] = tp2_hit
            if trailing_active is not None:
                fields["trailing_active"] = trailing_active
            if remaining_volume is not None:
                fields["remaining_volume"] = remaining_volume
            db.update_trade(int(row["id"]), **fields)
        except Exception as exc:  # pragma: no cover
            logger.warning("_mark_trade_stage(%s) failed: %s", ticket, exc)

    async def _persist_trade_events(self, pos: Any,
                                    events: list[dict[str, Any]]) -> None:
        """Persist a list of trade-event dicts for ``pos`` (Sprint 6 #12).

        Each event dict has the keys: ``event_type``, ``price``, ``volume``,
        ``sl``, ``tp``, ``detail``.
        """
        try:
            row = db.get_trade_by_ticket(int(pos.ticket))
            if row is None:
                return
            trade_id = int(row["id"])
        except Exception:  # pragma: no cover
            return
        for ev in events:
            try:
                db.insert_trade_event(
                    trade_id=trade_id,
                    event_type=ev["event_type"],
                    ticket=int(pos.ticket),
                    price=ev.get("price"),
                    volume=ev.get("volume"),
                    sl=ev.get("sl"),
                    tp=ev.get("tp"),
                    detail=ev.get("detail"),
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("insert_trade_event %s failed: %s",
                               ev.get("event_type"), exc)

    async def _partial_close(self, pos: Any, volume: float, reason: str) -> None:
        """Partial-close via MT5 opposite order (audit-fix Sprint 1 #1).

        Previously this was a stub that just ``exit_position`` (full close),
        which violated the V2 strategy (TP1 50%, TP2 30%).  Now uses
        ``MT5Connector.partial_close`` which sends an opposite-direction
        market order with reduced volume.
        """
        if volume <= 0:
            return
        if self.paper_mode or self.dry_run:
            logger.info("[PAPER] partial close (%s) ticket=%s vol=%.2f - skip",
                        reason, pos.ticket, volume)
            return
        try:
            result = await partial_close_async(self.connector,
                                              int(pos.ticket), float(volume))
        except OrderTimeoutError as exc:
            logger.error("partial_close timeout (%s) ticket=%s: %s",
                         reason, pos.ticket, exc)
            return
        if not result.get("ok"):
            logger.warning("partial_close failed (%s) ticket=%s: %s",
                           reason, pos.ticket, result)
            return
        # Update remaining_volume in DB
        self._mark_trade_stage(
            pos.ticket,
            stage=("TRAILING" if reason == "tp2"
                   else ("TP1_HIT" if reason == "tp1" else "OPEN")),
            remaining_volume=result.get("remaining_volume"),
        )
        logger.info("Partial close (%s) ticket=%s closed=%.2f remaining=%.2f",
                    reason, pos.ticket,
                    result.get("closed_volume", 0.0),
                    result.get("remaining_volume", 0.0))

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
                    await modify_position_async(self.connector, pos.ticket,
                                                sl=new_sl, tp=pos.tp)
                    self._mark_trade_stage(pos.ticket, "TRAILING",
                                           trailing_active=True)
            else:
                new_sl = (sym_info.ask + trail)
                if pos.sl == 0 or new_sl < pos.sl:
                    await modify_position_async(self.connector, pos.ticket,
                                                sl=new_sl, tp=pos.tp)
                    self._mark_trade_stage(pos.ticket, "TRAILING",
                                           trailing_active=True)
        except OrderTimeoutError as exc:
            logger.warning("Trail modify timeout for %s: %s", pos.ticket, exc)
        except Exception as exc:  # pragma: no cover
            logger.warning("Trail failed for %s: %s", pos.ticket, exc)

    async def exit_position(self, ticket: int, reason: str) -> dict[str, Any]:
        """Close a position by ticket."""
        if self.paper_mode or self.dry_run:
            logger.info("[PAPER] exit_position ticket=%s reason=%s - skip",
                        ticket, reason)
            return {"ok": True, "retcode": 0, "comment": "paper_skip"}
        try:
            result = await close_position_async(self.connector, int(ticket))
        except OrderTimeoutError as exc:
            logger.error("exit_position timeout ticket=%s: %s", ticket, exc)
            result = {"ok": False, "retcode": -1,
                      "comment": f"timeout: {exc}"}
        # Sprint 6 #12: persist MANUAL_CLOSE or SL_HIT event
        try:
            row = db.get_trade_by_ticket(int(ticket))
            if row:
                event_type = ("MANUAL_CLOSE" if reason in ("manual", "weekend_close",
                                                           "db_restore")
                              else "SL_HIT")
                db.insert_trade_event(
                    trade_id=int(row["id"]),
                    event_type=event_type,
                    ticket=int(ticket),
                    price=row.get("close_price") or row.get("open_price"),
                    volume=row.get("remaining_volume") or row.get("volume"),
                    sl=row.get("sl"), tp=row.get("tp"),
                    detail={"reason": reason, "ok": result.get("ok")},
                )
        except Exception:  # pragma: no cover
            pass
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
    # Audit-fix Sprint 1 #4: Crash recovery
    # ------------------------------------------------------------------ #

    async def recover_state(self) -> dict[str, Any]:
        """Reconcile DB trades with MT5 positions after a crash.

        For each DB trade with ``status='open'``:
            * if it still exists in MT5 -> restore stage from DB
            * if it has vanished        -> mark CLOSED, compute PnL from last
              known price (best-effort), record close_reason=CLOSED_OFFLINE

        For each MT5 position with no matching DB row -> log a warning
        (an orphan from manual trading or another EA).

        Publishes a ``recovery`` event with the summary.
        """
        if self.paper_mode:
            logger.info("[PAPER] recover_state: skipping (no MT5 positions)")
            return {"recovered": 0, "closed_offline": 0, "orphans": 0,
                    "paper": True}

        try:
            positions = await asyncio.to_thread(self.connector.get_positions)
        except Exception as exc:  # pragma: no cover
            logger.warning("recover_state: get_positions failed: %s", exc)
            await self.bus.publish({
                "type": "connection_lost",
                "service": "mt5_positions",
                "error": str(exc),
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            return {"recovered": 0, "closed_offline": 0, "orphans": 0,
                    "error": str(exc)}

        mt5_tickets: set[int] = {int(p.ticket) for p in positions}
        open_db_trades = db.list_open_trades()

        recovered = 0
        closed_offline = 0
        for t in open_db_trades:
            ticket = t.get("ticket")
            if ticket is None:
                continue
            try:
                ticket_int = int(ticket)
            except (TypeError, ValueError):
                continue
            if ticket_int in mt5_tickets:
                # Still alive - restore stage (already in DB but make sure
                # the in-memory state matches).
                recovered += 1
                logger.info("Recovery: ticket=%s stage=%s alive",
                            ticket_int, t.get("stage"))
            else:
                # Vanished while bot was down -> mark closed.
                closed_offline += 1
                self._mark_offline_closed(t)
                logger.warning("Recovery: ticket=%s closed while bot was down",
                                ticket_int)

        orphans = []
        db_tickets = {int(t["ticket"]) for t in open_db_trades
                      if t.get("ticket") is not None}
        for p in positions:
            if int(p.ticket) not in db_tickets:
                orphans.append({"ticket": p.ticket, "symbol": p.symbol,
                                "volume": p.volume, "type": p.type})
                logger.warning(
                    "Recovery: orphan MT5 position ticket=%s symbol=%s "
                    "(no DB row) - leaving untouched", p.ticket, p.symbol)

        summary = {
            "recovered": recovered,
            "closed_offline": closed_offline,
            "orphans": orphans,
            "total_open_db": len(open_db_trades),
            "total_mt5": len(positions),
        }
        await self.bus.publish({
            "type": "recovery",
            "ts": datetime.now(timezone.utc).isoformat(),
            **summary,
        })
        logger.info("Recovery complete: %s", summary)
        return summary

    def _mark_offline_closed(self, trade: dict[str, Any]) -> None:
        """Mark a vanished trade as closed; compute approximate PnL."""
        try:
            ticket = int(trade.get("ticket") or 0)
            sym = trade.get("symbol") or ""
            direction = (trade.get("direction") or "").lower()
            entry = float(trade.get("open_price") or 0.0)
            volume = float(trade.get("volume") or 0.0)
            # Best-effort last known price via symbol info
            try:
                info = self.connector.get_symbol_info(
                    settings.symbol_for(sym))
                last_price = info.bid if direction == "buy" else info.ask
            except Exception:
                last_price = entry
            # PnL in account currency - approx using pip value if available
            try:
                pip_value = self.connector.get_pip_value(
                    settings.symbol_for(sym))
                pip_size = self.connector.get_symbol_info(
                    settings.symbol_for(sym)).pip_size
                if direction == "buy":
                    pips = (last_price - entry) / pip_size if pip_size else 0
                else:
                    pips = (entry - last_price) / pip_size if pip_size else 0
                profit = pips * pip_value * volume
            except Exception:
                pips = 0.0
                profit = 0.0
            trade_id = int(trade.get("id") or 0)
            if trade_id:
                db.update_trade(
                    trade_id,
                    status="closed",
                    stage="CLOSED",
                    close_price=last_price,
                    close_time=datetime.now(timezone.utc),
                    exit_reason="CLOSED_OFFLINE",
                    profit=round(profit, 2),
                    pips=round(pips, 2),
                )
            # Record PnL in daily tracker
            self.daily_tracker.record_trade(profit, win=profit > 0)
        except Exception as exc:  # pragma: no cover
            logger.warning("_mark_offline_closed(%s) failed: %s",
                           trade.get("ticket"), exc)

    # ------------------------------------------------------------------ #
    # Audit-fix Sprint 1 #7: Margin-call prevention
    # ------------------------------------------------------------------ #

    async def _check_margin_safety(self, account: Any) -> None:
        """Auto-protect against margin calls.

        Thresholds (% of margin level):
            < 150 -> WARN + Telegram alert
            < 120 -> auto-close worst performer
            < 100 -> close ALL + engage kill switch
        """
        ml = float(getattr(account, "margin_level", 0.0) or 0.0)
        if ml <= 0:
            return
        if ml < cfg.MARGIN_EMERGENCY_PCT:
            logger.critical("MARGIN EMERGENCY: margin_level=%.2f%% - "
                            "closing ALL positions", ml)
            await self.bus.publish({
                "type": "margin_emergency",
                "margin_level": ml,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            try:
                await asyncio.to_thread(self.connector.close_all_positions)
            except Exception as exc:  # pragma: no cover
                logger.error("close_all_positions failed: %s", exc)
            await self.kill(reason=f"margin_emergency:{ml:.1f}%")
        elif ml < cfg.MARGIN_CALL_PCT:
            logger.critical("MARGIN CALL risk: margin_level=%.2f%% - "
                            "auto-closing worst performer", ml)
            await self.bus.publish({
                "type": "margin_call_prevented",
                "margin_level": ml,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            await self._close_worst_performer()
        elif ml < cfg.MARGIN_WARNING_PCT:
            logger.warning("Margin warning: margin_level=%.2f%%", ml)
            await self.bus.publish({
                "type": "margin_warning",
                "margin_level": ml,
                "ts": datetime.now(timezone.utc).isoformat(),
            })

    async def _close_worst_performer(self) -> None:
        """Close the open position with the largest floating loss."""
        try:
            positions = await asyncio.to_thread(self.connector.get_positions)
        except Exception as exc:  # pragma: no cover
            logger.warning("_close_worst_performer: get_positions failed: %s",
                           exc)
            return
        if not positions:
            return
        worst = min(positions, key=lambda p: float(p.profit))
        if float(worst.profit) >= 0:
            return  # nothing in loss
        logger.warning("Auto-closing worst performer ticket=%s pnl=%.2f",
                       worst.ticket, worst.profit)
        await self.exit_position(int(worst.ticket),
                                 reason="margin_call_worst_performer")

    # ------------------------------------------------------------------ #
    # Audit-fix Sprint 3 #19: Equity-curve sampling
    # ------------------------------------------------------------------ #

    async def _sample_equity_curve(self, account: Any) -> None:
        """Insert an EquityCurve row every ~60 seconds."""
        now_mono = asyncio.get_event_loop().time()
        if (now_mono - self.state.last_equity_sample_at) < 60.0:
            return
        self.state.last_equity_sample_at = now_mono
        try:
            balance = float(getattr(account, "balance", 0.0) or 0.0)
            equity = float(getattr(account, "equity", 0.0) or 0.0)
            floating = float(getattr(account, "profit", 0.0) or 0.0)
            # Peak equity tracking for drawdown
            if equity > self.state.peak_equity:
                self.state.peak_equity = equity
            peak = self.state.peak_equity or equity
            dd = ((peak - equity) / peak * 100.0) if peak > 0 else 0.0
            daily = self.daily_tracker.get_state(balance=balance)
            daily_pnl_pct = ((balance - daily.starting_balance)
                             / daily.starting_balance * 100.0) \
                if daily.starting_balance > 0 else 0.0
            db.insert_equity_sample(
                balance=balance, equity=equity,
                floating_pnl=floating,
                daily_pnl_pct=round(daily_pnl_pct, 4),
                drawdown_pct=round(dd, 4),
                peak_equity=peak,
            )
        except Exception as exc:  # pragma: no cover
            logger.debug("equity sample failed: %s", exc)

    # ------------------------------------------------------------------ #
    # Audit-fix Sprint 2 #13: Weekend position closer
    # ------------------------------------------------------------------ #

    async def _maybe_weekend_close(self) -> None:
        """Force-close all positions on Friday at WEEKEND_CLOSE_TIME (WIB)."""
        try:
            hh, mm = cfg.WEEKEND_CLOSE_TIME.split(":")
            target_h = int(hh)
            target_m = int(mm)
        except (ValueError, AttributeError):
            target_h, target_m = 21, 30
        now_wib = datetime.now(WIB_TZ)
        # Friday (weekday 4) and after target time
        if now_wib.weekday() != 4:
            return
        if now_wib.hour < target_h or (now_wib.hour == target_h
                                        and now_wib.minute < target_m):
            return
        # Have we already closed today?
        flag = f"weekend_closed_{now_wib.date().isoformat()}"
        if db.get_setting(flag) == "1":
            return
        logger.warning("Weekend close @ %s WIB - closing all positions",
                       now_wib.isoformat())
        await self.bus.publish({
            "type": "weekend_close",
            "ts": datetime.now(timezone.utc).isoformat(),
            "wib_time": now_wib.isoformat(),
        })
        if not self.paper_mode and not self.dry_run:
            try:
                results = await asyncio.to_thread(
                    self.connector.close_all_positions)
                logger.info("Weekend close: %d positions closed",
                            len(results))
            except Exception as exc:  # pragma: no cover
                logger.error("Weekend close_all_positions failed: %s", exc)
        db.set_setting(flag, "1")

    # ------------------------------------------------------------------ #
    # Audit-fix Sprint 2 #14: News pre/post management
    # ------------------------------------------------------------------ #

    async def _maybe_news_reduce(self) -> None:
        """Reduce by 50% any open position whose currency has HIGH news < 30min."""
        if self.paper_mode or self.dry_run:
            return
        try:
            cal = get_calendar()
            upcoming = await cal.get_upcoming_high_news(minutes_ahead=30)
        except Exception as exc:
            logger.debug("news reduce: get_upcoming failed: %s", exc)
            return
        if not upcoming:
            return
        blackout_ccys = {ev.get("symbol", "").upper() for ev in upcoming
                         if ev.get("symbol")}
        if not blackout_ccys:
            return
        try:
            positions = await asyncio.to_thread(self.connector.get_positions)
        except Exception:
            return
        for pos in positions:
            sym = (pos.symbol or "").upper().replace("/", "")
            if len(sym) != 6:
                continue
            base, quote = sym[:3], sym[3:]
            if base in blackout_ccys or quote in blackout_ccys:
                # Reduce 50%
                reduce_vol = round(pos.volume * 0.5, 2)
                if reduce_vol <= 0:
                    continue
                logger.info("NEWS_REDUCE: ticket=%s reduce %.2f lot (news in %s)",
                            pos.ticket, reduce_vol, blackout_ccys)
                await self.bus.publish({
                    "type": "news_reduce",
                    "ticket": pos.ticket,
                    "symbol": pos.symbol,
                    "reduce_volume": reduce_vol,
                    "currencies": list(blackout_ccys),
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
                try:
                    await partial_close_async(self.connector,
                                              int(pos.ticket), float(reduce_vol))
                except OrderTimeoutError as exc:
                    logger.warning("news_reduce partial_close timeout: %s",
                                   exc)
                except Exception as exc:  # pragma: no cover
                    logger.warning("news_reduce partial_close failed: %s", exc)

    # ------------------------------------------------------------------ #
    # Audit-fix Sprint 2 #12: paper / dry-run toggles
    # ------------------------------------------------------------------ #

    async def set_mode(self, mode: str) -> dict[str, Any]:
        """Switch between LIVE / PAPER / DRY modes at runtime.

        ``mode`` is one of ``"live"``, ``"paper"``, ``"dry"``.
        """
        mode = mode.lower()
        if mode not in ("live", "paper", "dry"):
            return {"ok": False, "message": f"unknown mode: {mode}"}
        self.paper_mode = (mode == "paper")
        self.dry_run = (mode == "dry")
        self.state.paper_mode = self.paper_mode
        self.state.dry_run = self.dry_run
        db.update_bot_state(is_paper=self.paper_mode,
                            is_dry_run=self.dry_run)
        logger.warning("Mode switched to %s (paper=%s dry=%s)",
                       mode, self.paper_mode, self.dry_run)
        return {"ok": True, "mode": mode,
                "paper_mode": self.paper_mode,
                "dry_run": self.dry_run}

    def get_mode(self) -> dict[str, Any]:
        """Return the current bot mode."""
        if self.dry_run:
            mode = "dry"
        elif self.paper_mode:
            mode = "paper"
        else:
            mode = "live"
        return {"mode": mode, "paper_mode": self.paper_mode,
                "dry_run": self.dry_run}

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


# --------------------------------------------------------------------------- #
# Paper-mode helpers (Sprint 2 #12)
# --------------------------------------------------------------------------- #

class _PaperAccount:
    """Minimal stand-in for ``AccountInfo`` used by paper-mode ticks.

    Only exposes the attributes the engine actually reads:
    ``balance``, ``equity``, ``profit``, ``margin_level``.
    """

    def __init__(self, balance: float) -> None:
        self.balance = float(balance)
        self.equity = float(balance)
        self.profit = 0.0
        self.margin_level = 1_000.0   # always "safe" in paper mode


class _PaperPosition:
    """Stand-in for ``mt5_connector.Position`` used by paper-mode ticks.

    Wraps a Trade DB row so the same ``_manage_one`` path can run against
    paper trades.
    """

    def __init__(self, trade: dict[str, Any]) -> None:
        self.ticket = int(trade.get("ticket") or 0)
        self.symbol = trade.get("symbol") or ""
        self.type = (trade.get("direction") or "buy").lower()
        self.volume = float(trade.get("remaining_volume")
                            or trade.get("volume") or 0.0)
        self.open_price = float(trade.get("open_price") or 0.0)
        self.sl = float(trade.get("sl") or 0.0)
        self.tp = float(trade.get("tp") or 0.0)
        self.profit = 0.0
        self.comment = trade.get("comment") or ""
        self.open_time = 0.0


__all__ = [
    "TradingEngine", "EngineState", "EventBus",
    "get_engine", "reset_engine",
    "_PaperAccount", "_PaperPosition",
]
