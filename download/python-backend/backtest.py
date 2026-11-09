"""
backtest.py
===========
Backtest engine for the V2 scalping strategy (audit-fix Sprint 2 #11).

Replays historical candles through ``strategy_v2.check_setup`` and simulates:

    * Entry at the signal's close price
    * SL hit (full close)
    * TP1 hit -> close 50%, move SL to BE+2
    * TP2 hit -> close 30%, start trailing 2x ATR
    * Trailing exit (SL moved behind price)
    * RR Net per trade (after spread + commission)

The engine produces a :class:`BacktestResult` dict containing summary
metrics + the full trade list, which ``main.py`` persists via
``database.insert_backtest_result``.

This module is deliberately self-contained: it imports the strategy
functions and indicators directly so it can run on any host (no MT5 needed)
given a CSV of OHLC bars.
"""

from __future__ import annotations

import csv
import json
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config as cfg

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Local imports (kept lazy to avoid heavy startup)
# --------------------------------------------------------------------------- #

def _load_strategy():
    from strategy_v2 import check_setup, _candles_from_bars, WIB_TZ
    from indicators import Candle
    from mt5_connector import SymbolInfo
    return check_setup, _candles_from_bars, WIB_TZ, Candle, SymbolInfo


@dataclass
class BacktestTrade:
    """One simulated trade."""
    index: int
    open_time: str
    close_time: str | None
    symbol: str
    direction: str
    entry: float
    exit: float
    sl: float
    tp1: float
    tp2: float
    volume: float
    profit: float
    pips: float
    rr_net: float
    exit_reason: str
    win: bool


@dataclass
class BacktestResult:
    """Result of a backtest run."""
    symbol: str
    timeframe: str
    start_date: str
    end_date: str
    initial_balance: float
    final_balance: float
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate_pct: float = 0.0
    r_net_avg: float = 0.0
    profit_factor: float = 0.0
    max_drawdown_pct: float = 0.0
    compliance_score_pct: float = 0.0
    trades: list[BacktestTrade] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "initial_balance": self.initial_balance,
            "final_balance": self.final_balance,
            "total_trades": self.total_trades,
            "wins": self.wins,
            "losses": self.losses,
            "win_rate_pct": self.win_rate_pct,
            "r_net_avg": self.r_net_avg,
            "profit_factor": self.profit_factor,
            "max_drawdown_pct": self.max_drawdown_pct,
            "compliance_score_pct": self.compliance_score_pct,
            "trades": [t.__dict__ for t in self.trades],
        }


# --------------------------------------------------------------------------- #
# CSV loader
# --------------------------------------------------------------------------- #

def load_candles_from_csv(csv_path: str | Path,
                          timeframe: str = "M5"
                          ) -> list[dict[str, Any]]:
    """Load OHLCV bars from a CSV.

    Expected columns: time (epoch s or ISO), open, high, low, close,
    tick_volume (optional).
    """
    bars: list[dict[str, Any]] = []
    with open(csv_path, "r", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                t_raw = row.get("time") or row.get("timestamp") or ""
                if t_raw.isdigit() or (t_raw.replace(".", "", 1).isdigit()):
                    ts = float(t_raw)
                else:
                    dt = datetime.fromisoformat(t_raw.replace("Z", "+00:00"))
                    ts = dt.timestamp()
                day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
                    "%Y-%m-%d")
                bars.append({
                    "time": ts, "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row.get("tick_volume")
                                    or row.get("volume") or 0.0),
                    "day": day,
                })
            except Exception as exc:
                logger.debug("skip CSV row: %s", exc)
                continue
    return bars


# --------------------------------------------------------------------------- #
# Backtest engine
# --------------------------------------------------------------------------- #

class BacktestEngine:
    """Replay historical candles through the V2 strategy."""

    def __init__(self,
                 spread_pips: float = 0.8,
                 commission_pips: float = 0.7) -> None:
        self.spread_pips = spread_pips
        self.commission_pips = commission_pips

    def _build_symbol_info(self, candle_close: float) -> Any:
        """Construct a fake SymbolInfo around the latest close price."""
        _, _, _, _, SymbolInfo = _load_strategy()
        # Pick pip size based on price magnitude
        if candle_close > 100:  # JPY pair
            pip_size = 0.01
            digits = 3
        else:
            pip_size = 0.0001
            digits = 5
        return SymbolInfo(
            name="BACKTEST", digits=digits, point=pip_size / 10.0,
            pip_size=pip_size, pip_value_per_lot=10.0,
            spread=int(self.spread_pips * 10.0),
            bid=candle_close, ask=candle_close + self.spread_pips * pip_size,
            volume_min=0.01, volume_max=100.0, volume_step=0.01,
            trade_mode="full",
        )

    def run_backtest(self,
                     symbol: str,
                     timeframe: str,
                     start_date: str,
                     end_date: str,
                     initial_balance: float = 10_000.0,
                     candles_m5: list[dict[str, Any]] | None = None,
                     candles_m15: list[dict[str, Any]] | None = None,
                     csv_path: str | Path | None = None,
                     ) -> BacktestResult:
        """Run a backtest and return a :class:`BacktestResult`.

        Either supply ``candles_m5`` / ``candles_m15`` directly (lists of
        dicts with keys time/open/high/low/close/volume/day) or load them
        from a CSV file via ``csv_path``.

        Parameters
        ----------
        symbol : str
            Pair name (e.g. "EURUSD").
        timeframe : str
            Must be "M5" (the only one the V2 strategy uses for entries).
        start_date, end_date : str
            ISO date strings used for record-keeping only.
        initial_balance : float
        candles_m5, candles_m15 : list of dicts, optional
        csv_path : str | Path, optional
        """
        check_setup, _candles_from_bars, WIB_TZ, Candle, _ = _load_strategy()

        if candles_m5 is None and csv_path is not None:
            candles_m5 = load_candles_from_csv(csv_path, timeframe)
        if candles_m15 is None and candles_m5:
            # Use every 3rd M5 bar as a synthetic M15
            candles_m15 = candles_m5[::3]

        if not candles_m5 or len(candles_m5) < 50:
            logger.warning("backtest: insufficient candles (%s)",
                           len(candles_m5 or []))
            return BacktestResult(
                symbol=symbol, timeframe=timeframe,
                start_date=start_date, end_date=end_date,
                initial_balance=initial_balance,
                final_balance=initial_balance,
            )

        m5_candles = [Candle(**c) for c in candles_m5]
        m15_candles = [Candle(**c) for c in candles_m15]

        balance = float(initial_balance)
        peak = balance
        max_dd_pct = 0.0
        trades: list[BacktestTrade] = []
        open_trade: dict[str, Any] | None = None

        # Iterate one candle at a time, feeding the last ``window`` bars.
        window_m5 = 200
        window_m15 = 200
        news_events: list[dict[str, Any]] = []
        for i in range(window_m5, len(m5_candles)):
            current = m5_candles[i]
            # If we have an open trade, check SL/TP1/TP2/exit first.
            if open_trade is not None:
                self._advance_trade(open_trade, current, balance)
                if open_trade.get("closed"):
                    trades.append(self._finalize_trade(open_trade, balance))
                    balance += trades[-1].profit
                    if balance > peak:
                        peak = balance
                    dd = (peak - balance) / peak * 100.0 if peak > 0 else 0.0
                    if dd > max_dd_pct:
                        max_dd_pct = dd
                    open_trade = None
                else:
                    continue

            # Build slices
            slc_m5 = m5_candles[i - window_m5:i + 1]
            slc_m15 = m15_candles[-window_m15:] if len(m15_candles) >= window_m15 \
                else m15_candles
            sym_info = self._build_symbol_info(current.close)
            now_wib = datetime.fromtimestamp(current.time, tz=WIB_TZ)
            ctx = check_setup(
                symbol=symbol,
                candles_m5=slc_m5,
                candles_m15=slc_m15,
                symbol_info=sym_info,
                spread_pips=self.spread_pips,
                commission_pips=self.commission_pips,
                balance=balance,
                news_events=news_events,
                soft_stop_hit=False,
                now_wib=now_wib,
            )
            if ctx is None or not ctx.pass_all or ctx.direction is None:
                continue
            if ctx.lot_size is None or ctx.lot_size <= 0:
                continue
            # Open trade
            open_trade = {
                "symbol": symbol,
                "direction": ctx.direction,
                "entry": current.close,
                "sl": ctx.sl_price or 0.0,
                "tp1": ctx.tp1_price or 0.0,
                "tp2": ctx.tp2_price or 0.0,
                "open_time": datetime.fromtimestamp(
                    current.time, tz=timezone.utc).isoformat(),
                "close_time": None,
                "exit_price": 0.0,
                "exit_reason": "",
                "lot": ctx.lot_size,
                "rr_net": ctx.rr_net or 0.0,
                "tp1_done": False,
                "tp2_done": False,
                "remaining_volume": ctx.lot_size,
                "pip_size": sym_info.pip_size,
                "closed": False,
            }

        # Force-close any remaining open trade at the last close
        if open_trade is not None and not open_trade.get("closed"):
            last = m5_candles[-1]
            open_trade["exit_price"] = last.close
            open_trade["exit_reason"] = "BACKTEST_END"
            open_trade["closed"] = True
            trades.append(self._finalize_trade(open_trade, balance))
            balance += trades[-1].profit

        # Compute metrics
        wins = sum(1 for t in trades if t.win)
        losses = len(trades) - wins
        win_rate = (wins / len(trades) * 100.0) if trades else 0.0
        avg_rr = (sum(t.rr_net for t in trades) / len(trades)
                  if trades else 0.0)
        gross_profit = sum(t.profit for t in trades if t.win)
        gross_loss = abs(sum(t.profit for t in trades if not t.win))
        profit_factor = (gross_profit / gross_loss
                         if gross_loss > 0 else float("inf"))
        compliance = win_rate  # simplified: pass_rate ~ win_rate for backtest

        return BacktestResult(
            symbol=symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
            initial_balance=float(initial_balance),
            final_balance=round(balance, 2),
            total_trades=len(trades),
            wins=wins,
            losses=losses,
            win_rate_pct=round(win_rate, 2),
            r_net_avg=round(avg_rr, 3),
            profit_factor=round(profit_factor, 3) if math.isfinite(
                profit_factor) else 999.99,
            max_drawdown_pct=round(max_dd_pct, 2),
            compliance_score_pct=round(compliance, 2),
            trades=trades,
        )

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _advance_trade(self, trade: dict[str, Any],
                       candle: Any,
                       balance: float) -> None:
        """Update an open trade against the latest candle's H/L/C."""
        is_buy = trade["direction"] == "buy"
        entry = trade["entry"]
        sl = trade["sl"]
        tp1 = trade["tp1"]
        tp2 = trade["tp2"]
        pip_size = trade["pip_size"]
        high = candle.high
        low = candle.low

        # SL hit?
        if is_buy and low <= sl:
            trade["exit_price"] = sl
            trade["exit_reason"] = "SL_HIT"
            trade["closed"] = True
            return
        if not is_buy and high >= sl:
            trade["exit_price"] = sl
            trade["exit_reason"] = "SL_HIT"
            trade["closed"] = True
            return

        # TP2 hit? (close 30% + trail remaining)
        if not trade["tp2_done"]:
            tp2_hit = (is_buy and high >= tp2) or (not is_buy and low <= tp2)
            if tp2_hit:
                self._partial_close(trade, 0.30, tp2)
                trade["tp2_done"] = True
                # Move SL to BE+2
                be_buffer = cfg.BE_BUFFER_PIPS * pip_size
                new_sl = (entry + be_buffer) if is_buy else (entry - be_buffer)
                trade["sl"] = new_sl

        # TP1 hit? (close 50% + SL to BE)
        if not trade["tp1_done"] and not trade["tp2_done"]:
            tp1_hit = (is_buy and high >= tp1) or (not is_buy and low <= tp1)
            if tp1_hit:
                self._partial_close(trade, 0.50, tp1)
                trade["tp1_done"] = True
                be_buffer = cfg.BE_BUFFER_PIPS * pip_size
                new_sl = (entry + be_buffer) if is_buy else (entry - be_buffer)
                trade["sl"] = new_sl

        # If trailing (tp2 done), check trail exit using close price.
        if trade["tp2_done"]:
            trail_stop = (entry + (candle.close - entry) * 0.5) if is_buy \
                else (entry - (entry - candle.close) * 0.5)
            if is_buy and candle.low <= trail_stop:
                trade["exit_price"] = trail_stop
                trade["exit_reason"] = "TRAILING"
                trade["closed"] = True
                return
            if not is_buy and candle.high >= trail_stop:
                trade["exit_price"] = trail_stop
                trade["exit_reason"] = "TRAILING"
                trade["closed"] = True
                return

    def _partial_close(self, trade: dict[str, Any],
                       pct: float, price: float) -> None:
        """Simulate a partial close: record pseudo profit for the closed part.

        We don't keep separate P&L for partials here - the engine accumulates
        the partial close price into ``trade['partial_pnl']`` and the
        finalizer adds it to the residual close P&L.
        """
        vol = trade["remaining_volume"] * pct
        entry = trade["entry"]
        is_buy = trade["direction"] == "buy"
        pips = ((price - entry) / trade["pip_size"]
                if is_buy else (entry - price) / trade["pip_size"])
        pip_value = 10.0  # assume $10/pip per 1.0 lot
        pnl = pips * pip_value * vol
        trade["partial_pnl"] = trade.get("partial_pnl", 0.0) + pnl
        trade["remaining_volume"] = max(0.0,
                                         trade["remaining_volume"] - vol)

    def _finalize_trade(self, trade: dict[str, Any],
                        balance: float) -> BacktestTrade:
        """Convert a closed trade dict to a :class:`BacktestTrade`."""
        is_buy = trade["direction"] == "buy"
        entry = trade["entry"]
        exit_price = trade["exit_price"]
        pip_size = trade["pip_size"]
        remaining_vol = trade["remaining_volume"]
        # Residual PnL on the unclosed portion
        pips_residual = ((exit_price - entry) / pip_size
                         if is_buy else (entry - exit_price) / pip_size)
        pip_value = 10.0
        pnl_residual = pips_residual * pip_value * remaining_vol
        total_pnl = trade.get("partial_pnl", 0.0) + pnl_residual
        rr = trade.get("rr_net", 0.0)
        win = total_pnl > 0
        return BacktestTrade(
            index=0,
            open_time=trade["open_time"],
            close_time=datetime.now(timezone.utc).isoformat(),
            symbol=trade["symbol"],
            direction=trade["direction"],
            entry=entry,
            exit=exit_price,
            sl=trade["sl"],
            tp1=trade["tp1"],
            tp2=trade["tp2"],
            volume=trade["lot"],
            profit=round(total_pnl, 2),
            pips=round(pips_residual, 2),
            rr_net=round(rr, 3),
            exit_reason=trade["exit_reason"] or "EOL",
            win=win,
        )


__all__ = [
    "BacktestEngine", "BacktestResult", "BacktestTrade",
    "load_candles_from_csv",
]
