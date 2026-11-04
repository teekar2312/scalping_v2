"""
strategy_v2.py
==============
V2 Scalping Strategy engine.

Implements the V2 strategy exactly as specified:

    * 3 core indicators: EMA9, EMA21, VWAP daily, ATR(14)
    * ADX(14) on 15M as regime filter
        > 25  -> TRENDING  (trade)
        < 20  -> RANGING   (skip)
        20-25 -> TRANSITION (wait)
    * SL adaptif: 1.5x ATR(14) + 2 pip buffer di luar swing
    * Risk 1% / trade, max 3 simultan, max 5 / hari
    * RR Net = (TP_brutto - biaya) / (SL_brutto + biaya), biaya = spread + komisi
    * Target RR Net >= 2.0
    * TP1 = 2x SL (close 50%, SL to BE+2), TP2 = 4x SL (close 30%, 20% trailing 2xATR)
    * Sessions WIB: Tokyo 09-12, London 14-17, Overlap 20-22
    * Blacklist: Sydney 05-14, London lunch 17-19:30, news +-30min, Senin awal, Jumat akhir
    * Pre-trade 8-point checklist

All thresholds are imported from :mod:`config` to guarantee a single source
of truth.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

import config as cfg
from config import settings
from indicators import (
    Candle, ADXResult, CandlePattern, SwingLevels,
    adx, atr, ema, ema_series, swing_high_low,
    vwap, candle_pattern_detection,
)

logger = logging.getLogger(__name__)

Regime = Literal["TRENDING", "TRANSITION", "RANGING"]
Direction = Literal["buy", "sell"]

WIB_TZ = ZoneInfo(settings.timezone)


# --------------------------------------------------------------------------- #
# Data structures
# --------------------------------------------------------------------------- #

@dataclass
class SignalContext:
    """Full context produced by ``check_setup``."""
    symbol: str
    direction: Direction | None
    regime: Regime
    session: str | None
    entry_price: float
    ema9: float
    ema21: float
    vwap: float
    atr_pips: float
    adx_value: float
    plus_di: float
    minus_di: float
    swing_high: float
    swing_low: float
    sl_price: float | None
    tp1_price: float | None
    tp2_price: float | None
    sl_pips: float | None
    tp1_pips: float | None
    tp2_pips: float | None
    rr_net: float | None
    spread_pips: float
    commission_pips: float
    pip_size: float
    pip_value_per_lot: float
    lot_size: float | None
    checklist: dict[str, bool]
    pattern: str
    pattern_confidence: float
    pass_all: bool
    fail_reasons: list[str]
    timestamp: str

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


@dataclass
class SLTPCalc:
    """Output of :func:`calculate_sl_tp`."""
    sl_price: float
    tp1_price: float
    tp2_price: float
    sl_pips: float
    tp1_pips: float
    tp2_pips: float


# --------------------------------------------------------------------------- #
# Regime detection
# --------------------------------------------------------------------------- #

def check_regime(adx_value: float) -> Regime:
    """Classify the market regime from a 15M ADX reading.

    Parameters
    ----------
    adx_value : float
        Latest ADX(14) from 15M timeframe.

    Returns
    -------
    Regime
        ``"TRENDING"`` if ADX > 25, ``"RANGING"`` if ADX < 20,
        ``"TRANSITION"`` otherwise.
    """
    if math.isnan(adx_value):
        return "RANGING"
    if adx_value > cfg.ADX_TRENDING:
        return "TRENDING"
    if adx_value < cfg.ADX_RANGING:
        return "RANGING"
    return "TRANSITION"


# --------------------------------------------------------------------------- #
# Sessions & news
# --------------------------------------------------------------------------- #

def is_session_active(now_wib: datetime | None = None) -> tuple[str | None, bool]:
    """Return ``(session_name, is_blacklisted)`` for a given WIB time.

    Blacklist rules:
        * Sydney 05-14 (no trading)
        * London lunch 17-19:30 (no trading)
        * Monday early session (after weekend gap) - 00:00-07:00 WIB
        * Friday late session - after 22:00 WIB
    """
    if now_wib is None:
        now_wib = datetime.now(WIB_TZ)
    h = now_wib.hour
    m = now_wib.minute
    weekday = now_wib.weekday()   # Mon=0 ... Sun=6

    # Blacklist: Monday early (gap risk) - first 7 hours
    if weekday == 0 and h < 7:
        return None, True
    # Blacklist: Friday late (after 22:00 WIB) - weekend hold risk
    if weekday == 4 and h >= 22:
        return None, True
    # Saturday/Sunday - markets closed
    if weekday >= 5:
        return None, True

    # Sydney 05-14 skip
    for s, e in cfg.SKIP_SESSIONS_WIB:
        if s == 17 and h == 17:           # London lunch 17:00-19:30
            return None, True
        if s == 17 and h == 18:
            return None, True
        if s == 17 and h == 19 and m <= 30:
            return None, True
        if s == 5 and 5 <= h < 14 and s != 17:
            return None, True

    # Active sessions
    for name, (s, e) in cfg.SESSIONS_WIB.items():
        if s <= h < e:
            return name, False
        # Overlap 20-22 special: 20 <= h < 22
    if 20 <= h < 22:
        return "overlap", False
    return None, False


def is_news_blackout(symbol: str, news_events: list[dict[str, Any]],
                     now: datetime | None = None,
                     blackout_minutes: int = cfg.NEWS_BLACKOUT_MINUTES) -> bool:
    """Check if ``symbol`` is within a +-``blackout_minutes`` window
    around a HIGH impact news event.

    ``symbol`` may be a pair like ``EURUSD``; we check both currencies.
    """
    if not news_events:
        return False
    if now is None:
        now = datetime.now(timezone.utc)
    currencies: list[str] = []
    sym = symbol.upper().replace("/", "")
    if len(sym) == 6:
        currencies = [sym[:3], sym[3:]]

    window = timedelta(minutes=blackout_minutes)
    for ev in news_events:
        if ev.get("impact", "").upper() != "HIGH":
            continue
        ev_ccy = (ev.get("symbol") or ev.get("currency") or "").upper()
        if currencies and ev_ccy and ev_ccy not in currencies:
            continue
        ev_time = ev.get("event_time")
        if isinstance(ev_time, str):
            try:
                ev_time = datetime.fromisoformat(ev_time)
            except ValueError:
                continue
        if ev_time is None:
            continue
        if ev_time.tzinfo is None:
            ev_time = ev_time.replace(tzinfo=timezone.utc)
        if abs(now - ev_time) <= window:
            return True
    return False


# --------------------------------------------------------------------------- #
# Risk helpers
# --------------------------------------------------------------------------- #

def calculate_sl_tp(entry: float, atr_value: float, swing: SwingLevels,
                    direction: Direction, pip_size: float,
                    digits: int) -> SLTPCalc | None:
    """Calculate SL/TP prices following the V2 strategy.

    SL = 1.5 x ATR(14) + 2 pip buffer outside swing.
    TP1 = 2 x SL distance, TP2 = 4 x SL distance.

    Returns ``None`` if ATR is invalid.
    """
    if math.isnan(atr_value) or atr_value <= 0:
        return None
    sl_atr = atr_value * cfg.SL_ATR_MULT
    buffer = cfg.SL_PIP_BUFFER * pip_size
    direction = direction.lower()   # type: ignore[assignment]

    if direction == "buy":
        # SL below swing low - (1.5 ATR + buffer)
        sl_distance = sl_atr + buffer
        swing_ref = swing.low if not math.isnan(swing.low) else entry - sl_distance
        sl_price = min(swing_ref - buffer, entry - sl_distance)
        sl_pips = abs(entry - sl_price) / pip_size
        tp1_pips = sl_pips * cfg.TP1_MULT
        tp2_pips = sl_pips * cfg.TP2_MULT
        tp1_price = entry + tp1_pips * pip_size
        tp2_price = entry + tp2_pips * pip_size
    else:  # sell
        sl_distance = sl_atr + buffer
        swing_ref = swing.high if not math.isnan(swing.high) else entry + sl_distance
        sl_price = max(swing_ref + buffer, entry + sl_distance)
        sl_pips = abs(sl_price - entry) / pip_size
        tp1_pips = sl_pips * cfg.TP1_MULT
        tp2_pips = sl_pips * cfg.TP2_MULT
        tp1_price = entry - tp1_pips * pip_size
        tp2_price = entry - tp2_pips * pip_size

    return SLTPCalc(
        sl_price=round(sl_price, digits),
        tp1_price=round(tp1_price, digits),
        tp2_price=round(tp2_price, digits),
        sl_pips=round(sl_pips, 2),
        tp1_pips=round(tp1_pips, 2),
        tp2_pips=round(tp2_pips, 2),
    )


def calculate_rr_net(sl_pips: float, tp_pips: float,
                     spread_pips: float, commission_pips: float) -> float:
    """RR Net = (TP_brutto - biaya) / (SL_brutto + biaya).

    ``biaya`` = spread + komisi (in pips).
    """
    if sl_pips <= 0:
        return 0.0
    cost = spread_pips + commission_pips
    rr = (tp_pips - cost) / (sl_pips + cost)
    return round(rr, 3)


def calculate_lot_size(balance: float, risk_pct: float,
                       sl_pips: float, pip_value_per_lot: float,
                       volume_step: float = 0.01,
                       volume_min: float = 0.01,
                       volume_max: float = 100.0) -> float:
    """Lot size for 1% risk given SL distance and pip value per lot.

    lot = (balance * risk_pct) / (sl_pips * pip_value_per_lot)
    """
    if sl_pips <= 0 or pip_value_per_lot <= 0:
        return volume_min
    raw = (balance * risk_pct) / (sl_pips * pip_value_per_lot)
    # Snap to volume_step
    if volume_step > 0:
        raw = math.floor(raw / volume_step) * volume_step
    raw = max(raw, volume_min)
    raw = min(raw, volume_max)
    return round(raw, 2)


# --------------------------------------------------------------------------- #
# Core setup evaluation
# --------------------------------------------------------------------------- #

def _candles_from_bars(bars: list) -> list[Candle]:
    """Convert CandleBar objects to indicator-friendly Candle objects."""
    out: list[Candle] = []
    for b in bars:
        out.append(Candle(
            time=b.time,
            open=b.open,
            high=b.high,
            low=b.low,
            close=b.close,
            volume=b.volume,
            day=b.day,
        ))
    return out


def apply_8_point_checklist(
    regime: Regime,
    ema9: float,
    ema21: float,
    vwap_val: float,
    close: float,
    pattern: CandlePattern,
    sl_pips: float | None,
    rr_net: float | None,
    rr_at_tp1: float | None,
    news_blackout: bool,
    soft_stop_hit: bool,
    direction: Direction,
) -> dict[str, bool]:
    """Run the V2 pre-trade 8-point checklist.

    The 8 points (per V2 strategy PDF):
        1. ADX > 25 (regime TRENDING)
        2. EMA alignment (9 above 21 for buy, below for sell)
        3. VWAP on the same side as trade (below price for buy, above for sell)
        4. Pullback to EMA zone (close within 1 ATR of EMA9/21)
        5. Valid candle pattern (engulfing / pin bar)
        6. SL = 1.5 ATR + 2 pip buffer (sl_pips is not None)
        7. RR Net >= 2.0 at TP1
        8. No news blackout AND no soft stop hit
    """
    buy = direction == "buy"
    checks: dict[str, bool] = {}

    # 1. ADX regime
    checks["adx_trending"] = regime == "TRENDING"

    # 2. EMA alignment
    if buy:
        checks["ema_alignment"] = ema9 > ema21
    else:
        checks["ema_alignment"] = ema9 < ema21

    # 3. VWAP same side
    if not math.isnan(vwap_val):
        if buy:
            checks["vwap_side"] = close > vwap_val
        else:
            checks["vwap_side"] = close < vwap_val
    else:
        checks["vwap_side"] = False

    # 4. Pullback to EMA zone - within 0.10% of EMA9 or EMA21 (proxy)
    ema_zone = abs(close - ema9) / close if close else 1.0
    ema_zone2 = abs(close - ema21) / close if close else 1.0
    checks["pullback_to_ema_zone"] = (ema_zone < 0.003) or (ema_zone2 < 0.003)

    # 5. Candle pattern valid
    checks["candle_pattern_valid"] = pattern.name != "none" and pattern.confidence >= 0.4

    # 6. SL = 1.5 ATR + 2 buffer (sl_pips computed)
    checks["sl_calc_valid"] = sl_pips is not None and sl_pips > 0

    # 7. RR Net >= 2.0 at TP1
    checks["rr_net_ok"] = (rr_at_tp1 is not None) and (rr_at_tp1 >= cfg.RR_NET_MIN)

    # 8. No news + no soft stop
    checks["no_news_no_soft_stop"] = (not news_blackout) and (not soft_stop_hit)

    return checks


def _build_pattern(candles: list[Candle]) -> CandlePattern:
    return candle_pattern_detection(candles)


def evaluate_buy_setup(symbol: str,
                       candles_m5: list[Candle],
                       candles_m15: list[Candle],
                       adx_result: ADXResult,
                       atr_value: float,
                       symbol_info: Any,
                       spread_pips: float,
                       commission_pips: float,
                       balance: float,
                       news_events: list[dict[str, Any]],
                       soft_stop_hit: bool,
                       now_wib: datetime | None = None) -> SignalContext:
    """Evaluate a long (BUY) setup."""
    return _evaluate_setup(
        symbol=symbol, direction="buy",
        candles_m5=candles_m5, candles_m15=candles_m15,
        adx_result=adx_result, atr_value=atr_value,
        symbol_info=symbol_info, spread_pips=spread_pips,
        commission_pips=commission_pips, balance=balance,
        news_events=news_events, soft_stop_hit=soft_stop_hit,
        now_wib=now_wib,
    )


def evaluate_sell_setup(symbol: str,
                        candles_m5: list[Candle],
                        candles_m15: list[Candle],
                        adx_result: ADXResult,
                        atr_value: float,
                        symbol_info: Any,
                        spread_pips: float,
                        commission_pips: float,
                        balance: float,
                        news_events: list[dict[str, Any]],
                        soft_stop_hit: bool,
                        now_wib: datetime | None = None) -> SignalContext:
    """Evaluate a short (SELL) setup."""
    return _evaluate_setup(
        symbol=symbol, direction="sell",
        candles_m5=candles_m5, candles_m15=candles_m15,
        adx_result=adx_result, atr_value=atr_value,
        symbol_info=symbol_info, spread_pips=spread_pips,
        commission_pips=commission_pips, balance=balance,
        news_events=news_events, soft_stop_hit=soft_stop_hit,
        now_wib=now_wib,
    )


def _evaluate_setup(symbol: str, direction: Direction,
                    candles_m5: list[Candle],
                    candles_m15: list[Candle],
                    adx_result: ADXResult,
                    atr_value: float,
                    symbol_info: Any,
                    spread_pips: float,
                    commission_pips: float,
                    balance: float,
                    news_events: list[dict[str, Any]],
                    soft_stop_hit: bool,
                    now_wib: datetime | None) -> SignalContext:
    """Shared logic for buy/sell evaluation."""
    closes = [c.close for c in candles_m5]
    highs = [c.high for c in candles_m5]
    lows = [c.low for c in candles_m5]

    ema9 = ema(closes, 9)
    ema21 = ema(closes, 21)
    vwap_val = vwap(candles_m5)
    close_last = closes[-1] if closes else float("nan")
    regime = check_regime(adx_result.adx)

    pattern = _build_pattern(candles_m5)
    swing = swing_high_low(candles_m5, lookback=20)

    pip_size = symbol_info.pip_size
    digits = symbol_info.digits
    pip_value_per_lot = symbol_info.pip_value_per_lot

    # SL/TP
    calc = calculate_sl_tp(
        entry=close_last, atr_value=atr_value, swing=swing,
        direction=direction, pip_size=pip_size, digits=digits,
    )
    sl_pips = calc.sl_pips if calc else None
    tp1_pips = calc.tp1_pips if calc else None
    tp2_pips = calc.tp2_pips if calc else None

    rr_at_tp1 = (calculate_rr_net(sl_pips, tp1_pips, spread_pips, commission_pips)
                 if sl_pips and tp1_pips else None)
    rr_at_tp2 = (calculate_rr_net(sl_pips, tp2_pips, spread_pips, commission_pips)
                 if sl_pips and tp2_pips else None)

    # Lot size
    lot = None
    if sl_pips:
        lot = calculate_lot_size(
            balance=balance,
            risk_pct=cfg.RISK_PCT_PER_TRADE,
            sl_pips=sl_pips,
            pip_value_per_lot=pip_value_per_lot,
            volume_step=symbol_info.volume_step,
            volume_min=symbol_info.volume_min,
            volume_max=symbol_info.volume_max,
        )

    # Session + news blackout
    session, _bl = is_session_active(now_wib)
    news_block = is_news_blackout(symbol, news_events)

    checklist = apply_8_point_checklist(
        regime=regime, ema9=ema9, ema21=ema21, vwap_val=vwap_val,
        close=close_last, pattern=pattern,
        sl_pips=sl_pips, rr_net=rr_at_tp1, rr_at_tp1=rr_at_tp1,
        news_blackout=news_block, soft_stop_hit=soft_stop_hit,
        direction=direction,
    )
    fail_reasons: list[str] = [k for k, v in checklist.items() if not v]
    pass_all = len(fail_reasons) == 0

    return SignalContext(
        symbol=symbol,
        direction=direction if pass_all else None,
        regime=regime,
        session=session,
        entry_price=close_last,
        ema9=ema9,
        ema21=ema21,
        vwap=vwap_val,
        atr_pips=round(atr_value / pip_size, 2) if pip_size else 0.0,
        adx_value=adx_result.adx,
        plus_di=adx_result.plus_di,
        minus_di=adx_result.minus_di,
        swing_high=swing.high,
        swing_low=swing.low,
        sl_price=calc.sl_price if calc else None,
        tp1_price=calc.tp1_price if calc else None,
        tp2_price=calc.tp2_price if calc else None,
        sl_pips=sl_pips,
        tp1_pips=tp1_pips,
        tp2_pips=tp2_pips,
        rr_net=rr_at_tp1,
        spread_pips=spread_pips,
        commission_pips=commission_pips,
        pip_size=pip_size,
        pip_value_per_lot=pip_value_per_lot,
        lot_size=lot,
        checklist=checklist,
        pattern=pattern.name,
        pattern_confidence=pattern.confidence,
        pass_all=pass_all,
        fail_reasons=fail_reasons,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def check_setup(symbol: str,
                candles_m5: list[Candle],
                candles_m15: list[Candle],
                symbol_info: Any,
                spread_pips: float,
                commission_pips: float,
                balance: float,
                news_events: list[dict[str, Any]],
                soft_stop_hit: bool,
                now_wib: datetime | None = None) -> SignalContext | None:
    """Top-level setup check for a single symbol.

    Returns a :class:`SignalContext` if the regime is TRENDING (otherwise
    returns a context tagged with ``pass_all=False``).  If the latest close
    is above EMA9, evaluates a BUY; otherwise a SELL.  ``direction`` is set
    to ``None`` if the checklist fails.
    """
    if len(candles_m15) < 30 or len(candles_m5) < 30:
        logger.warning("Insufficient candle data for %s", symbol)
        return None

    h15 = [c.high for c in candles_m15]
    l15 = [c.low for c in candles_m15]
    c15 = [c.close for c in candles_m15]
    adx_result = adx(h15, l15, c15, period=14)

    h5 = [c.high for c in candles_m5]
    l5 = [c.low for c in candles_m5]
    c5 = [c.close for c in candles_m5]
    atr_value = atr(h5, l5, c5, period=14)

    # Determine direction bias from EMA alignment on M5
    ema9 = ema(c5, 9)
    ema21 = ema(c5, 21)
    last_close = c5[-1]
    direction: Direction = "buy" if (ema9 > ema21 and last_close > ema21) else "sell"

    ctx = _evaluate_setup(
        symbol=symbol, direction=direction,
        candles_m5=candles_m5, candles_m15=candles_m15,
        adx_result=adx_result, atr_value=atr_value,
        symbol_info=symbol_info, spread_pips=spread_pips,
        commission_pips=commission_pips, balance=balance,
        news_events=news_events, soft_stop_hit=soft_stop_hit,
        now_wib=now_wib,
    )
    return ctx


__all__ = [
    "SignalContext", "SLTPCalc", "Regime", "Direction",
    "WIB_TZ",
    "check_regime",
    "is_session_active", "is_news_blackout",
    "calculate_sl_tp", "calculate_rr_net", "calculate_lot_size",
    "apply_8_point_checklist",
    "evaluate_buy_setup", "evaluate_sell_setup",
    "check_setup",
]
