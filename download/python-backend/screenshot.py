"""
screenshot.py
=============
Trade screenshot capture — renders MT5 candlestick charts with entry/exit
markers as PNG images for journal + Telegram delivery.

Uses ``matplotlib`` (Agg backend) for headless rendering.  Degrades
gracefully if matplotlib is not installed (capture_* returns None).

Endpoints exposed by main.py:
    GET /api/screenshot/{ticket}        — return screenshot image
    GET /api/screenshots/{ticket}/list  — list screenshots for a trade

Auto-capture at entry + exit is wired into trading_engine.py.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config as cfg

try:
    import matplotlib
    matplotlib.use("Agg")  # headless
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    _MPL_AVAILABLE = True
except ImportError:  # pragma: no cover
    plt = None  # type: ignore
    mdates = None  # type: ignore
    _MPL_AVAILABLE = False

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _screenshot_dir() -> Path:
    """Return the directory for storing screenshots (creates if missing)."""
    p = cfg.settings.paths.base_dir / "data" / "screenshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _filename(ticket: int | str, kind: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"{ticket}_{kind}_{ts}.png"


# --------------------------------------------------------------------------- #
# ScreenshotCapture
# --------------------------------------------------------------------------- #

class ScreenshotCapture:
    """Render candlestick charts as PNG files.

    Public methods:
        capture_chart(symbol, timeframe)              — base chart
        capture_entry(ticket, symbol, direction, ...) — chart + entry markers
        capture_exit(ticket, symbol, ...)             — chart + entry+exit markers
        get_screenshot_path(ticket)                   — path to most recent
        list_screenshots(ticket)                      — all PNGs for a ticket
    """

    def __init__(self,
                 screenshots_dir: Path | None = None) -> None:
        self.screenshots_dir = screenshots_dir or _screenshot_dir()
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    # Chart capture
    # ------------------------------------------------------------------ #

    def capture_chart(self,
                      symbol: str,
                      timeframe: str = "M5",
                      candle_count: int = 100) -> Path | None:
        """Render a candlestick chart for ``symbol``.

        Returns the saved PNG path or None on failure / missing data.
        """
        if not _MPL_AVAILABLE:
            logger.warning("matplotlib not installed - capture_chart disabled")
            return None
        candles = self._fetch_candles(symbol, timeframe, candle_count)
        if not candles:
            return None
        path = self.screenshots_dir / _filename(
            f"{symbol}_{timeframe}", "chart",
        )
        self._render_candlestick(
            candles=candles,
            title=f"{symbol} {timeframe}",
            path=path,
            overlays=self._compute_overlays(candles),
        )
        return path

    def capture_entry(self,
                      ticket: int,
                      symbol: str,
                      direction: str,
                      entry: float,
                      sl: float,
                      tp: float,
                      timeframe: str = "M5",
                      candle_count: int = 100) -> Path | None:
        """Render a chart with entry markers."""
        if not _MPL_AVAILABLE:
            return None
        candles = self._fetch_candles(symbol, timeframe, candle_count)
        if not candles:
            return None
        path = self.screenshots_dir / _filename(ticket, "entry")
        markers = [
            {"price": entry, "color": "blue", "label": f"Entry {direction}"},
            {"price": sl, "color": "red", "label": "SL"},
            {"price": tp, "color": "green", "label": "TP"},
        ]
        self._render_candlestick(
            candles=candles,
            title=f"{symbol} ENTRY #{ticket} ({direction})",
            path=path,
            overlays=self._compute_overlays(candles),
            hlines=markers,
        )
        return path

    def capture_exit(self,
                     ticket: int,
                     symbol: str,
                     entry: float,
                     exit_price: float,
                     sl: float,
                     tp: float,
                     result: str,
                     timeframe: str = "M5",
                     candle_count: int = 100) -> Path | None:
        """Render a chart with entry + exit markers."""
        if not _MPL_AVAILABLE:
            return None
        candles = self._fetch_candles(symbol, timeframe, candle_count)
        if not candles:
            return None
        path = self.screenshots_dir / _filename(ticket, "exit")
        markers = [
            {"price": entry, "color": "blue", "label": "Entry"},
            {"price": exit_price, "color": "orange", "label": f"Exit ({result})"},
            {"price": sl, "color": "red", "label": "SL"},
            {"price": tp, "color": "green", "label": "TP"},
        ]
        self._render_candlestick(
            candles=candles,
            title=f"{symbol} EXIT #{ticket} ({result})",
            path=path,
            overlays=self._compute_overlays(candles),
            hlines=markers,
        )
        return path

    # ------------------------------------------------------------------ #
    # Accessors
    # ------------------------------------------------------------------ #

    def get_screenshot_path(self, ticket: int | str) -> Path | None:
        """Return the most recent screenshot for ``ticket`` (or None)."""
        prefix = f"{ticket}_"
        candidates = sorted(
            self.screenshots_dir.glob(f"{prefix}*.png"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        return candidates[0] if candidates else None

    def list_screenshots(self, ticket: int | str) -> list[dict[str, Any]]:
        """Return all screenshot filenames + sizes for ``ticket``."""
        prefix = f"{ticket}_"
        out: list[dict[str, Any]] = []
        for p in sorted(self.screenshots_dir.glob(f"{prefix}*.png"),
                        key=lambda p: p.stat().st_mtime,
                        reverse=True):
            stat = p.stat()
            out.append({
                "filename": p.name,
                "path": str(p),
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc).isoformat(),
            })
        return out

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _fetch_candles(self,
                       symbol: str,
                       timeframe: str,
                       count: int) -> list[dict[str, Any]]:
        """Fetch candles from MT5 (returns list of dicts or [] on failure)."""
        try:
            from mt5_connector import get_connector, MT5_AVAILABLE
            if not MT5_AVAILABLE:
                return []
            conn = get_connector()
            if not conn.connected:
                return []
            bars = conn.get_candles(symbol, timeframe, int(count))
            return [b.to_dict() for b in bars] if bars else []
        except Exception as exc:  # pragma: no cover
            logger.warning("fetch_candles(%s) failed: %s", symbol, exc)
            return []

    def _compute_overlays(self,
                          candles: list[dict[str, Any]]
                          ) -> dict[str, list[float]]:
        """Compute EMA9, EMA21 and VWAP overlays for the chart."""
        try:
            from indicators import Candle as IndCandle, ema_series, vwap_series
            ind_candles = [
                IndCandle(
                    time=float(c.get("time", 0)),
                    open=float(c.get("open", 0)),
                    high=float(c.get("high", 0)),
                    low=float(c.get("low", 0)),
                    close=float(c.get("close", 0)),
                    volume=float(c.get("volume", 0)),
                    day=c.get("day"),
                ) for c in candles
            ]
            closes = [c.close for c in ind_candles]
            return {
                "ema9": ema_series(closes, 9) if len(closes) >= 9 else [],
                "ema21": ema_series(closes, 21) if len(closes) >= 21 else [],
                "vwap": vwap_series(ind_candles) if ind_candles else [],
            }
        except Exception as exc:  # pragma: no cover
            logger.debug("compute_overlays failed: %s", exc)
            return {}

    def _render_candlestick(self,
                            candles: list[dict[str, Any]],
                            title: str,
                            path: Path,
                            overlays: dict[str, list[float]] | None = None,
                            hlines: list[dict[str, Any]] | None = None
                            ) -> None:
        """Render candlesticks + overlays + horizontal price lines to ``path``."""
        if not _MPL_AVAILABLE:
            return
        fig, ax = plt.subplots(figsize=(12, 6))
        # Build x-axis (use index — datetime formatting can be added later)
        xs = list(range(len(candles)))
        opens = [c.get("open", 0) for c in candles]
        closes = [c.get("close", 0) for c in candles]
        highs = [c.get("high", 0) for c in candles]
        lows = [c.get("low", 0) for c in candles]

        # Plot candlesticks manually (vlines + hlines for OHLC)
        for i, (o, c, h, l) in enumerate(zip(opens, closes, highs, lows)):
            color = "#26a69a" if c >= o else "#ef5350"
            ax.vlines(i, l, h, color=color, linewidth=1)
            ax.hlines(o, i - 0.25, i + 0.25, color=color, linewidth=1)
            ax.hlines(c, i - 0.25, i + 0.25, color=color, linewidth=2)

        # Overlays (EMAs + VWAP)
        if overlays:
            for name, series in overlays.items():
                if series and len(series) == len(candles):
                    color_map = {"ema9": "#ffb74d", "ema21": "#42a5f5",
                                 "vwap": "#ab47bc"}
                    ax.plot(xs, series,
                            label=name.upper(),
                            color=color_map.get(name, "gray"),
                            linewidth=1.2, alpha=0.85)

        # Horizontal price lines (entry / SL / TP)
        if hlines:
            for hl in hlines:
                price = _safe_float(hl.get("price"))
                if price <= 0:
                    continue
                ax.axhline(y=price, color=hl.get("color", "gray"),
                           linestyle="--", linewidth=1, alpha=0.8,
                           label=hl.get("label"))

        ax.set_title(title)
        ax.set_xlabel("Candle index")
        ax.set_ylabel("Price")
        ax.legend(loc="best", fontsize=8)
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        fig.savefig(path, dpi=110, format="png")
        plt.close(fig)
        logger.info("Saved screenshot: %s", path)


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_capture: ScreenshotCapture | None = None


def get_screenshot_capture() -> ScreenshotCapture:
    """Return the module-level ScreenshotCapture singleton."""
    global _default_capture
    if _default_capture is None:
        _default_capture = ScreenshotCapture()
    return _default_capture


__all__ = [
    "ScreenshotCapture",
    "get_screenshot_capture",
]
