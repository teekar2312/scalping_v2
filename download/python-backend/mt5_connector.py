"""
mt5_connector.py
================
Wrapper around the official ``MetaTrader5`` Python package.

The MT5 package is **Windows-only**.  On Linux (e.g. during development) the
import will fail; we catch the failure and expose stubbed behaviour so the
rest of the backend can still be imported and tested.  All real trading
calls raise :class:`MT5UnavailableError` when MT5 is not available.

Key responsibilities:
    * Connect to Finex Indonesia broker with retry logic
    * Read account info, open positions, symbol info
    * Stream candlestick data (M5 / M15 / H1 etc.)
    * Place market orders with SL / TP / comment
    * Modify & close individual positions
    * Close ALL positions (kill switch)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from config import AppConfig, settings

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Try to import MetaTrader5 - it is Windows-only
# --------------------------------------------------------------------------- #

try:
    import MetaTrader5 as mt5  # type: ignore
    MT5_AVAILABLE: bool = True
    MT5_IMPORT_ERROR: str | None = None
except Exception as exc:  # pragma: no cover - import-time only on Linux
    mt5 = None  # type: ignore
    MT5_AVAILABLE = False
    MT5_IMPORT_ERROR = str(exc)


class MT5UnavailableError(RuntimeError):
    """Raised when MT5 is not installed / not on Windows."""


# --------------------------------------------------------------------------- #
# Timeframe mapping
# --------------------------------------------------------------------------- #

_TIMEFRAMES: dict[str, int] = {}
if MT5_AVAILABLE:
    _TIMEFRAMES = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }
else:
    _TIMEFRAMES = {
        "M1": 1, "M5": 5, "M15": 15, "M30": 30,
        "H1": 60, "H4": 240, "D1": 1440,
    }


# --------------------------------------------------------------------------- #
# Data models
# --------------------------------------------------------------------------- #

@dataclass
class AccountInfo:
    login: int
    name: str
    server: str
    currency: str
    balance: float
    equity: float
    margin: float
    margin_free: float
    margin_level: float
    leverage: int
    profit: float
    connected: bool


@dataclass
class SymbolInfo:
    name: str
    digits: int
    point: float
    pip_size: float           # value of 1 pip in price units (e.g. 0.0001)
    pip_value_per_lot: float  # account currency per pip per 1.0 lot
    spread: float             # in points
    bid: float
    ask: float
    volume_min: float
    volume_max: float
    volume_step: float
    trade_mode: str


@dataclass
class CandleBar:
    """One OHLC bar plus metadata."""
    time: float           # epoch seconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    day: str              # YYYY-MM-DD (UTC) - used for VWAP reset

    def to_dict(self) -> dict[str, Any]:
        return {
            "time": self.time,
            "datetime": datetime.fromtimestamp(self.time, tz=timezone.utc).isoformat(),
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "day": self.day,
        }


@dataclass
class Position:
    ticket: int
    symbol: str
    type: str               # "buy" | "sell"
    volume: float
    open_price: float
    sl: float
    tp: float
    profit: float
    comment: str
    open_time: float


# --------------------------------------------------------------------------- #
# Connector
# --------------------------------------------------------------------------- #

class MT5Connector:
    """High-level wrapper around the MetaTrader5 Python bindings.

    All public methods raise :class:`MT5UnavailableError` if MT5 is not
    available on the host.
    """

    def __init__(self, config: AppConfig | None = None) -> None:
        self.config = config or settings
        self._connected: bool = False

    # ----- lifecycle -------------------------------------------------------- #

    def _check(self) -> None:
        if not MT5_AVAILABLE:
            raise MT5UnavailableError(
                "MetaTrader5 package is not available. This backend must run "
                "on Windows with the MT5 terminal installed. Import error: "
                f"{MT5_IMPORT_ERROR}"
            )

    def initialize(self) -> bool:
        """Initialize MT5 terminal and log in to Finex Indonesia.

        Retries up to ``self.config.mt5.retry_attempts`` times with
        ``retry_delay_s`` between attempts.

        Returns
        -------
        bool
            ``True`` on success.
        """
        self._check()
        cfg = self.config.mt5
        kwargs: dict[str, Any] = {
            "login": cfg.login,
            "password": cfg.password,
            "server": cfg.server,
            "timeout": cfg.timeout_ms,
            "portable": False,
        }
        if cfg.terminal_path:
            kwargs["path"] = cfg.terminal_path

        last_err: str = ""
        for attempt in range(1, cfg.retry_attempts + 1):
            try:
                ok = mt5.initialize(**kwargs)  # type: ignore[union-attr]
                if ok:
                    self._connected = True
                    info = mt5.account_info()  # type: ignore[union-attr]
                    logger.info(
                        "MT5 connected: login=%s server=%s balance=%s",
                        info.login if info else "?",
                        cfg.server,
                        info.balance if info else "?",
                    )
                    return True
                last_err = str(getattr(mt5, "last_error", lambda: "?")())  # type: ignore[union-attr]
                logger.warning(
                    "MT5 initialize attempt %d/%d failed: %s",
                    attempt, cfg.retry_attempts, last_err,
                )
            except Exception as exc:  # pragma: no cover
                last_err = str(exc)
                logger.warning(
                    "MT5 initialize attempt %d/%d raised: %s",
                    attempt, cfg.retry_attempts, last_err,
                )
            time.sleep(cfg.retry_delay_s)
        self._connected = False
        return False

    def shutdown(self) -> None:
        """Shut down the MT5 terminal connection."""
        if not MT5_AVAILABLE:
            return
        try:
            mt5.shutdown()  # type: ignore[union-attr]
        except Exception as exc:  # pragma: no cover
            logger.warning("MT5 shutdown error: %s", exc)
        finally:
            self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected and MT5_AVAILABLE

    # ----- account ---------------------------------------------------------- #

    def get_account_info(self) -> AccountInfo:
        """Return a snapshot of the current MT5 account."""
        self._check()
        info = mt5.account_info()  # type: ignore[union-attr]
        if info is None:
            raise MT5UnavailableError("mt5.account_info() returned None - "
                                      "is the terminal connected?")
        return AccountInfo(
            login=info.login,
            name=info.name,
            server=info.server,
            currency=info.currency,
            balance=float(info.balance),
            equity=float(info.equity),
            margin=float(info.margin),
            margin_free=float(info.margin_free),
            margin_level=float(info.margin_level),
            leverage=int(info.leverage),
            profit=float(info.profit),
            connected=True,
        )

    # ----- symbols ---------------------------------------------------------- #

    def get_symbol_info(self, symbol: str) -> SymbolInfo:
        """Return symbol info, computing pip size & pip value."""
        self._check()
        info = mt5.symbol_info(symbol)  # type: ignore[union-attr]
        if info is None:
            raise MT5UnavailableError(f"symbol_info({symbol}) returned None")
        tick = mt5.symbol_info_tick(symbol)  # type: ignore[union-attr]
        bid = float(tick.bid) if tick else 0.0
        ask = float(tick.ask) if tick else 0.0
        digits = int(info.digits)
        point = float(info.point)
        # Pip = 10 * point for 5/3-digit FX, 1 * point for 4/2-digit
        if digits == 5 or digits == 3:
            pip_size = point * 10.0
        else:
            pip_size = point
        # Pip value per 1.0 lot = trade_tick_value * (pip_size / tick_size)
        tick_value = float(getattr(info, "trade_tick_value", 0.0) or 0.0)
        tick_size = float(getattr(info, "trade_tick_size", point) or point)
        pip_value = (tick_value * (pip_size / tick_size)) if tick_size > 0 else 0.0
        spread_pts = float(info.spread) if hasattr(info, "spread") else round((ask - bid) / point)

        # Trade mode
        mode_int = int(getattr(info, "trade_mode", 0))
        mode_map = {0: "disabled", 1: "longonly", 2: "shortonly", 3: "full"}
        return SymbolInfo(
            name=info.name,
            digits=digits,
            point=point,
            pip_size=pip_size,
            pip_value_per_lot=pip_value,
            spread=spread_pts,
            bid=bid,
            ask=ask,
            volume_min=float(info.volume_min),
            volume_max=float(info.volume_max),
            volume_step=float(info.volume_step),
            trade_mode=mode_map.get(mode_int, "unknown"),
        )

    def ensure_symbol_visible(self, symbol: str) -> bool:
        """Make sure the symbol is in the Market Watch window."""
        self._check()
        if not mt5.symbol_select(symbol, True):  # type: ignore[union-attr]
            logger.warning("symbol_select(%s) failed", symbol)
            return False
        return True

    # ----- candles ---------------------------------------------------------- #

    def get_candles(self, symbol: str, timeframe: str,
                    count: int = 200) -> list[CandleBar]:
        """Fetch ``count`` most recent OHLCV bars for ``symbol``.

        Parameters
        ----------
        symbol : str
            MT5 symbol name (e.g. ``"EURUSD"``).
        timeframe : str
            One of M1, M5, M15, M30, H1, H4, D1.
        count : int
            Number of bars to fetch (oldest first).
        """
        self._check()
        tf = _TIMEFRAMES.get(timeframe.upper())
        if tf is None:
            raise ValueError(f"Unknown timeframe: {timeframe}")
        rates = mt5.copy_rates_from_pos(  # type: ignore[union-attr]
            symbol, tf, 0, count
        )
        if rates is None or len(rates) == 0:
            logger.warning("No candles returned for %s %s", symbol, timeframe)
            return []
        bars: list[CandleBar] = []
        for r in rates:
            ts = float(r["time"])
            day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            bars.append(CandleBar(
                time=ts,
                open=float(r["open"]),
                high=float(r["high"]),
                low=float(r["low"]),
                close=float(r["close"]),
                volume=float(r.get("tick_volume", r.get("real_volume", 0))),
                day=day,
            ))
        return bars

    # ----- positions -------------------------------------------------------- #

    def get_positions(self, symbol: str | None = None) -> list[Position]:
        """Return open positions, optionally filtered by symbol."""
        self._check()
        if symbol:
            raw = mt5.positions_get(symbol=symbol)  # type: ignore[union-attr]
        else:
            raw = mt5.positions_get()  # type: ignore[union-attr]
        if raw is None:
            return []
        out: list[Position] = []
        for p in raw:
            ptype = "buy" if p.type == 0 else "sell"
            out.append(Position(
                ticket=int(p.ticket),
                symbol=p.symbol,
                type=ptype,
                volume=float(p.volume),
                open_price=float(p.price_open),
                sl=float(p.sl),
                tp=float(p.tp),
                profit=float(p.profit),
                comment=str(p.comment),
                open_time=float(p.time),
            ))
        return out

    # ----- order placement -------------------------------------------------- #

    def place_order(self,
                    symbol: str,
                    direction: str,
                    volume: float,
                    sl: float,
                    tp: float,
                    comment: str = "",
                    deviation: int = 20) -> dict[str, Any]:
        """Place a market order (buy/sell) with SL & TP.

        Parameters
        ----------
        symbol : str
            MT5 symbol name.
        direction : str
            ``"buy"`` or ``"sell"``.
        volume : float
            Lot size.
        sl, tp : float
            Stop loss and take profit prices (0 to omit).
        comment : str
            Order comment.
        deviation : int
            Max slippage in points.

        Returns
        -------
        dict
            ``{"ok": bool, "ticket": int, "retcode": int, "comment": str}``
        """
        self._check()
        if direction.lower() not in ("buy", "sell"):
            raise ValueError("direction must be 'buy' or 'sell'")
        self.ensure_symbol_visible(symbol)

        tick = mt5.symbol_info_tick(symbol)  # type: ignore[union-attr]
        if tick is None:
            return {"ok": False, "ticket": 0, "retcode": -1,
                    "comment": "no tick"}
        price = tick.ask if direction.lower() == "buy" else tick.bid
        order_type = mt5.ORDER_TYPE_BUY if direction.lower() == "buy" \
            else mt5.ORDER_TYPE_SELL  # type: ignore[union-attr]

        request = {
            "action": mt5.TRADE_ACTION_DEAL,  # type: ignore[union-attr]
            "symbol": symbol,
            "volume": float(volume),
            "type": order_type,
            "price": float(price),
            "sl": float(sl),
            "tp": float(tp),
            "deviation": int(deviation),
            "magic": 20241101,        # magic number for this bot
            "comment": str(comment)[:31],
            "type_time": mt5.ORDER_TIME_GTC,  # type: ignore[union-attr]
            "type_filling": mt5.ORDER_FILLING_IOC,  # type: ignore[union-attr]
        }
        result = mt5.order_send(request)  # type: ignore[union-attr]
        if result is None:
            return {"ok": False, "ticket": 0, "retcode": -1,
                    "comment": "order_send returned None"}
        ok = result.retcode == mt5.TRADE_RETCODE_DONE  # type: ignore[union-attr]
        return {
            "ok": bool(ok),
            "ticket": int(result.order),
            "retcode": int(result.retcode),
            "comment": str(result.comment),
        }

    def modify_position(self, ticket: int,
                        sl: float | None = None,
                        tp: float | None = None) -> dict[str, Any]:
        """Modify the SL/TP of an open position."""
        self._check()
        positions = mt5.positions_get(ticket=ticket)  # type: ignore[union-attr]
        if not positions:
            return {"ok": False, "retcode": -1, "comment": "ticket not found"}
        pos = positions[0]
        request = {
            "action": mt5.TRADE_ACTION_SLTP,  # type: ignore[union-attr]
            "symbol": pos.symbol,
            "position": int(ticket),
            "sl": float(sl) if sl is not None else float(pos.sl),
            "tp": float(tp) if tp is not None else float(pos.tp),
        }
        result = mt5.order_send(request)  # type: ignore[union-attr]
        if result is None:
            return {"ok": False, "retcode": -1,
                    "comment": "order_send returned None"}
        ok = result.retcode == mt5.TRADE_RETCODE_DONE  # type: ignore[union-attr]
        return {
            "ok": bool(ok),
            "retcode": int(result.retcode),
            "comment": str(result.comment),
        }

    def close_position(self, ticket: int) -> dict[str, Any]:
        """Close a single position by ticket (market reverse)."""
        self._check()
        positions = mt5.positions_get(ticket=ticket)  # type: ignore[union-attr]
        if not positions:
            return {"ok": False, "retcode": -1, "comment": "ticket not found"}
        pos = positions[0]
        tick = mt5.symbol_info_tick(pos.symbol)  # type: ignore[union-attr]
        if tick is None:
            return {"ok": False, "retcode": -1, "comment": "no tick"}
        is_buy = pos.type == 0
        close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY  # type: ignore[union-attr]
        close_price = tick.bid if is_buy else tick.ask
        request = {
            "action": mt5.TRADE_ACTION_DEAL,  # type: ignore[union-attr]
            "symbol": pos.symbol,
            "volume": float(pos.volume),
            "type": close_type,
            "position": int(ticket),
            "price": float(close_price),
            "deviation": 50,
            "magic": 20241101,
            "comment": "bot_close",
            "type_time": mt5.ORDER_TIME_GTC,  # type: ignore[union-attr]
            "type_filling": mt5.ORDER_FILLING_IOC,  # type: ignore[union-attr]
        }
        result = mt5.order_send(request)  # type: ignore[union-attr]
        if result is None:
            return {"ok": False, "retcode": -1,
                    "comment": "order_send returned None"}
        ok = result.retcode == mt5.TRADE_RETCODE_DONE  # type: ignore[union-attr]
        return {
            "ok": bool(ok),
            "retcode": int(result.retcode),
            "comment": str(result.comment),
        }

    def close_all_positions(self) -> list[dict[str, Any]]:
        """Close every open position.  Used by the kill switch."""
        self._check()
        positions = self.get_positions()
        results: list[dict[str, Any]] = []
        for p in positions:
            try:
                res = self.close_position(p.ticket)
                results.append({"ticket": p.ticket, **res})
            except Exception as exc:  # pragma: no cover
                logger.exception("close_position(%s) failed", p.ticket)
                results.append({"ticket": p.ticket, "ok": False,
                                "comment": str(exc)})
        return results

    # ----- helpers ---------------------------------------------------------- #

    def get_pip_value(self, symbol: str) -> float:
        """Pip value per 1.0 lot, in account currency."""
        return self.get_symbol_info(symbol).pip_value_per_lot


# --------------------------------------------------------------------------- #
# Module-level singleton accessor
# --------------------------------------------------------------------------- #

_default_connector: MT5Connector | None = None


def get_connector() -> MT5Connector:
    """Return the lazily-initialised module-level MT5 connector."""
    global _default_connector
    if _default_connector is None:
        _default_connector = MT5Connector()
    return _default_connector


def reset_connector() -> None:
    """Reset the module-level singleton (used in tests / restarts)."""
    global _default_connector
    if _default_connector is not None:
        _default_connector.shutdown()
    _default_connector = None


__all__ = [
    "MT5Connector", "MT5UnavailableError",
    "AccountInfo", "SymbolInfo", "CandleBar", "Position",
    "MT5_AVAILABLE", "MT5_IMPORT_ERROR",
    "get_connector", "reset_connector",
]
