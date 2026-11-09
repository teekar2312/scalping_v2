"""
main.py
=======
FastAPI entry point for the Forex scalping backend.

Exposes:
    REST routes:
        GET  /api/status              - bot status + MT5 connection
        GET  /api/account              - MT5 account info
        GET  /api/positions            - open positions
        GET  /api/signals              - recent signals
        POST /api/bot/start            - start auto-trading
        POST /api/bot/stop             - stop bot
        POST /api/bot/kill             - emergency kill switch
        POST /api/bot/release-kill     - release kill switch (manual override)
        GET  /api/news                 - economic calendar from Tiingo
        POST /api/ai/analyze           - send setup to Ollama
        POST /api/ai/chat              - chat with Ollama
        GET  /api/journal              - trade history
        GET  /api/settings             - get settings
        POST /api/settings             - update settings
        GET  /api/chart/{symbol}       - candlestick data + indicators

    WebSocket:
        /ws                            - real-time price + bot status stream

CORS is enabled for the configured Next.js origins (default
http://localhost:3000).
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import logging.handlers
import shutil
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from config import settings
import config as cfg
from mt5_connector import (
    MT5UnavailableError, MT5_AVAILABLE, get_connector,
)
from database import (
    get_db, list_trades, list_signals, list_news, get_all_settings,
    set_setting, get_bot_state, list_audit_log, list_equity_curve,
    get_backtest_result, insert_backtest_result,
    get_performance_attribution, get_compliance_score,
    set_trade_emotional_state, list_emotional_summary,
    list_open_trades,
)
from ollama_analyzer import get_analyzer, close_default_client as close_ai
from tiingo_calendar import get_calendar, close_default_client as close_cal
from trading_engine import get_engine, EventBus
from notifications import get_notification_manager, close_default_manager
from indicators import (
    ema, ema_series, vwap, atr, adx, rsi, bollinger_bands,
    Candle, candle_pattern_detection,
)

# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #

_log_path = Path(settings.paths.log_path)
_log_path.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=getattr(logging, settings.paths.log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.handlers.RotatingFileHandler(
            _log_path, maxBytes=10 * 1024 * 1024, backupCount=5),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("forex_backend")


# --------------------------------------------------------------------------- #
# Lifespan
# --------------------------------------------------------------------------- #

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: init DB, warm MT5, close on shutdown."""
    logger.info("Starting Forex scalping backend (Python %s)", sys.version)
    # Initialise DB
    get_db()
    # Warm MT5 connection (non-fatal if it fails - routes will report)
    if MT5_AVAILABLE:
        try:
            connector = get_connector()
            await asyncio.to_thread(connector.initialize)
            # Crash recovery (audit-fix Sprint 1 #4) - reconcile DB vs MT5
            engine = get_engine()
            if not engine.paper_mode:
                await engine.recover_state()
        except Exception as exc:
            logger.warning("MT5 init failed at startup: %s", exc)
    else:
        logger.warning("MetaTrader5 package not available - MT5 routes "
                       "will return 503. Run on Windows with MT5 installed.")
    yield
    # Shutdown
    logger.info("Shutting down backend...")
    try:
        engine = get_engine()
        if engine.state.is_running:
            await engine.stop(reason="shutdown")
    except Exception as exc:  # pragma: no cover
        logger.warning("Engine stop on shutdown failed: %s", exc)
    await close_ai()
    await close_cal()
    await close_default_manager()
    if MT5_AVAILABLE:
        try:
            get_connector().shutdown()
        except Exception:
            pass
    logger.info("Backend shutdown complete.")


# --------------------------------------------------------------------------- #
# FastAPI app
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="Forex Scalping Backend (V2)",
    description="Automated Forex scalping trading system - V2 strategy. "
                "Connects to MetaTrader 5 (Finex Indonesia), Ollama "
                "(llama3.2:latest) and Tiingo economic calendar.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.server.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Pydantic models
# --------------------------------------------------------------------------- #

class BotActionResponse(BaseModel):
    ok: bool
    message: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ChatRequest(BaseModel):
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    signal: dict[str, Any]


class SettingsUpdate(BaseModel):
    settings: dict[str, str]


class NewsFilter(BaseModel):
    impact: str | None = None
    days_ahead: int = 7


class BacktestRequest(BaseModel):
    symbol: str
    timeframe: str = "M5"
    start_date: str
    end_date: str
    initial_balance: float = 10_000.0


class BotModeRequest(BaseModel):
    mode: str  # "PAPER" | "LIVE" | "DRY"


class DryRunRequest(BaseModel):
    enabled: bool


class EmotionRequest(BaseModel):
    state: str  # SABAR | FOMO | FRUSTRASI | OVERCONFIDENT
    note: str | None = None


class AttributionRange(BaseModel):
    start_date: datetime
    end_date: datetime


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _mt5_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "ok": False,
            "error": "MetaTrader5 is not available on this host. "
                     "The backend must run on Windows with the MT5 terminal "
                     "installed and logged in to Finex Indonesia.",
            "mt5_available": MT5_AVAILABLE,
        },
    )


def _safe_call(func: Any, *args: Any, **kwargs: Any) -> Any:
    """Call an MT5 function and translate MT5UnavailableError to HTTP 503."""
    try:
        return func(*args, **kwargs)
    except MT5UnavailableError:
        raise HTTPException(status_code=503, detail=str(MT5UnavailableError))


# --------------------------------------------------------------------------- #
# REST routes
# --------------------------------------------------------------------------- #

@app.get("/")
async def root() -> dict[str, Any]:
    """Health-check root."""
    return {
        "service": "forex-scalping-backend",
        "version": "1.0.0",
        "mt5_available": MT5_AVAILABLE,
        "mt5_connected": get_connector().connected if MT5_AVAILABLE else False,
        "pairs": settings.pairs,
        "ollama_model": settings.ollama.model,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    """Bot status, MT5 connection, account summary."""
    engine = get_engine()
    snap = engine.snapshot()
    # Add MT5 + account info
    account_summary: dict[str, Any] | None = None
    if MT5_AVAILABLE and get_connector().connected:
        try:
            acc = _safe_call(get_connector().get_account_info)
            account_summary = {
                "login": acc.login,
                "name": acc.name,
                "server": acc.server,
                "currency": acc.currency,
                "balance": acc.balance,
                "equity": acc.equity,
                "margin": acc.margin,
                "margin_free": acc.margin_free,
                "margin_level": acc.margin_level,
                "leverage": acc.leverage,
                "profit": acc.profit,
            }
        except HTTPException:
            account_summary = None
        except Exception as exc:
            account_summary = {"error": str(exc)}
    snap["account"] = account_summary
    snap["bot_state"] = get_bot_state()
    snap["mt5_available"] = MT5_AVAILABLE
    snap["time"] = datetime.now(timezone.utc).isoformat()
    return snap


@app.get("/api/account")
async def api_account() -> dict[str, Any]:
    """Account info from MT5."""
    if not MT5_AVAILABLE or not get_connector().connected:
        return _mt5_unavailable_response()  # type: ignore[return-value]
    try:
        acc = _safe_call(get_connector().get_account_info)
        return {
            "login": acc.login, "name": acc.name, "server": acc.server,
            "currency": acc.currency, "balance": acc.balance,
            "equity": acc.equity, "margin": acc.margin,
            "margin_free": acc.margin_free, "margin_level": acc.margin_level,
            "leverage": acc.leverage, "profit": acc.profit,
        }
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/positions")
async def api_positions(symbol: str | None = None) -> dict[str, Any]:
    """Open positions, optionally filtered by symbol."""
    if not MT5_AVAILABLE or not get_connector().connected:
        return {"positions": [], "mt5_connected": False}
    try:
        positions = _safe_call(get_connector().get_positions, symbol)
        return {
            "count": len(positions),
            "positions": [
                {
                    "ticket": p.ticket, "symbol": p.symbol, "type": p.type,
                    "volume": p.volume, "open_price": p.open_price,
                    "sl": p.sl, "tp": p.tp, "profit": p.profit,
                    "comment": p.comment,
                    "open_time": datetime.fromtimestamp(
                        p.open_time, tz=timezone.utc).isoformat(),
                } for p in positions
            ],
            "mt5_connected": True,
        }
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/signals")
async def api_signals(limit: int = 50,
                      symbol: str | None = None) -> dict[str, Any]:
    """Recent signals from SQLite."""
    rows = list_signals(limit=limit, symbol=symbol)
    return {"count": len(rows), "signals": rows}


@app.post("/api/bot/start", response_model=BotActionResponse)
async def api_bot_start() -> BotActionResponse:
    """Start auto-trading.  Runs the pre-live checklist first; returns 400
    with blocking issues if anything critical is missing.
    """
    checklist = await pre_live_check()
    if not checklist["overall_ready"]:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "message": "Pre-live checklist failed",
                "blocking_issues": checklist["blocking_issues"],
                "checklist": checklist,
            },
        )
    engine = get_engine()
    result = await engine.start()
    return BotActionResponse(
        ok=result["ok"],
        message=result["message"],
    )


@app.post("/api/bot/stop", response_model=BotActionResponse)
async def api_bot_stop() -> BotActionResponse:
    """Stop bot (does not close positions)."""
    engine = get_engine()
    result = await engine.stop(reason="manual")
    return BotActionResponse(ok=result["ok"], message=result["message"])


@app.post("/api/bot/kill", response_model=BotActionResponse)
async def api_bot_kill() -> BotActionResponse:
    """Emergency kill switch: close all + stop + lock."""
    engine = get_engine()
    result = await engine.kill(reason="manual")
    msg = f"killed: closed={len(result.get('closed', []))} - {result.get('reason')}"
    return BotActionResponse(ok=result["ok"], message=msg)


@app.post("/api/bot/release-kill", response_model=BotActionResponse)
async def api_bot_release_kill() -> BotActionResponse:
    """Release the kill switch (manual override)."""
    engine = get_engine()
    result = await engine.release_kill()
    return BotActionResponse(
        ok=result["ok"],
        message="kill switch released" if result["ok"] else "failed",
    )


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 2 #12: Bot mode (LIVE / PAPER / DRY)
# --------------------------------------------------------------------------- #

@app.post("/api/bot/mode")
async def api_bot_mode(req: BotModeRequest) -> dict[str, Any]:
    """Switch bot mode (LIVE / PAPER / DRY)."""
    engine = get_engine()
    result = await engine.set_mode(req.mode)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.get("/api/bot/mode")
async def api_bot_get_mode() -> dict[str, Any]:
    """Get current bot mode."""
    engine = get_engine()
    return engine.get_mode()


@app.post("/api/bot/dry-run")
async def api_bot_dry_run(req: DryRunRequest) -> dict[str, Any]:
    """Toggle dry-run mode (true = no orders placed, signals only)."""
    engine = get_engine()
    mode = "dry" if req.enabled else "live"
    # If disabling dry-run but paper was on, keep paper
    if not req.enabled and engine.paper_mode:
        mode = "paper"
    return await engine.set_mode(mode)


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 1 #10: Audit log endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/audit-log")
async def api_audit_log(limit: int = 200,
                        offset: int = 0,
                        event_type: str | None = None,
                        severity: str | None = None,
                        start: str | None = None,
                        end: str | None = None) -> dict[str, Any]:
    """Query the audit log."""
    start_dt = (datetime.fromisoformat(start) if start else None)
    end_dt = (datetime.fromisoformat(end) if end else None)
    rows = list_audit_log(
        limit=limit, offset=offset, event_type=event_type,
        severity=severity, start=start_dt, end=end_dt,
    )
    return {"count": len(rows), "events": rows}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 3 #19: Equity curve endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/equity-curve")
async def api_equity_curve(hours: float = 24.0) -> dict[str, Any]:
    """Return the equity-curve time series for the last N hours."""
    rows = list_equity_curve(hours=hours)
    return {"count": len(rows), "samples": rows}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 3 #20-21: Attribution + compliance
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/attribution")
async def api_analytics_attribution(start: str | None = None,
                                     end: str | None = None
                                     ) -> dict[str, Any]:
    """Performance attribution by session/setup/regime/hour/day/pair."""
    end_dt = (datetime.fromisoformat(end) if end
              else datetime.now(timezone.utc))
    start_dt = (datetime.fromisoformat(start) if start
                else end_dt - timedelta(days=30))
    return get_performance_attribution(start_dt, end_dt)


@app.get("/api/analytics/compliance")
async def api_analytics_compliance(start: str | None = None,
                                    end: str | None = None
                                    ) -> dict[str, Any]:
    """Compliance score (checklist pass-rate, RR compliance)."""
    end_dt = (datetime.fromisoformat(end) if end
              else datetime.now(timezone.utc))
    start_dt = (datetime.fromisoformat(start) if start
                else end_dt - timedelta(days=30))
    return get_compliance_score(start_dt, end_dt)


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 3 #22: Emotional-state logging
# --------------------------------------------------------------------------- #

@app.post("/api/trade/{trade_id}/emotion")
async def api_trade_emotion(trade_id: int,
                             req: EmotionRequest) -> dict[str, Any]:
    """Tag a closed trade with an emotional state + optional note."""
    ok = set_trade_emotional_state(int(trade_id), req.state, req.note)
    if not ok:
        raise HTTPException(status_code=404,
                            detail=f"trade {trade_id} not found")
    return {"ok": True, "trade_id": trade_id, "state": req.state}


@app.get("/api/analytics/emotions")
async def api_analytics_emotions(limit: int = 200) -> dict[str, Any]:
    """Summary of emotional-state logs across recent trades."""
    return list_emotional_summary(limit=limit)


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 2 #15: Pre-live checklist
# --------------------------------------------------------------------------- #

@app.get("/api/pre-live-check")
async def api_pre_live_check() -> dict[str, Any]:
    """Return the pre-live readiness checklist."""
    return await pre_live_check()


async def pre_live_check() -> dict[str, Any]:
    """Probe MT5 / Ollama / Tiingo / DB / time sync and return a verdict."""
    blocking: list[str] = []
    # MT5
    mt5_status: dict[str, Any] = {"ok": False}
    if MT5_AVAILABLE:
        try:
            conn = get_connector()
            if conn.connected:
                acc = await asyncio.to_thread(conn.get_account_info)
                mt5_status = {
                    "ok": True,
                    "login": acc.login,
                    "server": acc.server,
                    "balance": acc.balance,
                }
            else:
                blocking.append("mt5_not_connected")
        except Exception as exc:
            blocking.append(f"mt5_error: {exc}")
    else:
        blocking.append("mt5_package_missing")

    # Ollama
    ollama_status: dict[str, Any] = {"ok": False}
    try:
        analyzer = get_analyzer()
        if await analyzer.is_available():
            ollama_status = {
                "ok": True,
                "model": settings.ollama.model,
                "url": settings.ollama.base_url,
            }
        else:
            blocking.append("ollama_model_unavailable")
    except Exception as exc:
        blocking.append(f"ollama_error: {exc}")

    # Tiingo
    tiingo_status: dict[str, Any] = {"ok": False}
    try:
        cal = get_calendar()
        events = await cal.fetch_calendar(days_ahead=3, impact="HIGH")
        tiingo_status = {
            "ok": True,
            "events_cached": len(events),
        }
        if not events:
            tiingo_status["warning"] = "no events returned (check API key)"
    except Exception as exc:
        blocking.append(f"tiingo_error: {exc}")

    # Config warnings
    config_warnings: list[str] = []
    if not settings.mt5.password:
        config_warnings.append("mt5_password_empty")
    if not settings.tiingo.api_key:
        config_warnings.append("tiingo_api_key_empty")
    config_status = {"ok": len(config_warnings) == 0,
                     "warnings": config_warnings}

    # DB
    db_status: dict[str, Any] = {"ok": False}
    try:
        trades = list_trades(limit=1)
        db_status = {"ok": True, "trade_count": len(list_trades(limit=1000))}
    except Exception as exc:
        blocking.append(f"db_error: {exc}")

    # Time sync
    ts = await check_ntp_sync()
    time_status = {"ok": ts["ok"], "drift_seconds": ts["drift_seconds"]}
    if not ts["ok"]:
        blocking.append(f"time_drift_excessive: {ts['drift_seconds']:.1f}s")

    overall_ready = len(blocking) == 0
    return {
        "mt5": mt5_status,
        "ollama": ollama_status,
        "tiingo": tiingo_status,
        "config": config_status,
        "db": db_status,
        "time_sync": time_status,
        "overall_ready": overall_ready,
        "blocking_issues": blocking,
    }


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #27: NTP time-sync
# --------------------------------------------------------------------------- #

@app.get("/api/time-sync")
async def api_time_sync() -> dict[str, Any]:
    """Return NTP drift information."""
    return await check_ntp_sync()


async def check_ntp_sync() -> dict[str, Any]:
    """Probe an NTP server and return drift in seconds."""
    server_time = datetime.now(timezone.utc)
    drift_seconds = 0.0
    ntp_time_iso: str | None = None
    ok = True
    try:
        import ntplib  # type: ignore
        client = ntplib.NTPClient()
        resp = client.request("pool.ntp.org", version=3, timeout=3.0)
        ntp_time_iso = datetime.fromtimestamp(resp.tx_timestamp,
                                              tz=timezone.utc).isoformat()
        drift_seconds = abs(server_time.timestamp() - resp.tx_timestamp)
        if drift_seconds > cfg.NTP_DRIFT_TOLERANCE_S:
            ok = False
            logger.warning("NTP drift > %.1fs: %.2fs",
                           cfg.NTP_DRIFT_TOLERANCE_S, drift_seconds)
    except ImportError:
        # ntplib not installed - report unknown
        ok = True  # don't block on missing optional dep
        ntp_time_iso = None
        drift_seconds = 0.0
    except Exception as exc:
        logger.warning("NTP check failed: %s", exc)
        ok = True  # don't block on transient network errors
    return {
        "server_time": server_time.isoformat(),
        "ntp_time": ntp_time_iso,
        "drift_seconds": round(drift_seconds, 3),
        "ok": ok,
    }


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #24: DB backup / restore
# --------------------------------------------------------------------------- #

@app.get("/api/backup")
async def api_backup() -> StreamingResponse:
    """Dump the SQLite DB to a downloadable file."""
    db_path = Path(settings.paths.db_path)
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="db file not found")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_name = f"trading_backup_{timestamp}.db"
    # Stream a copy
    buf = io.BytesIO()
    shutil.copyfileobj(db_path.open("rb"), buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={backup_name}"},
    )


@app.post("/api/restore")
async def api_restore(file: UploadFile) -> dict[str, Any]:
    """Restore the SQLite DB from an uploaded backup file."""
    db_path = Path(settings.paths.db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # Stop the engine first to avoid write contention
    engine = get_engine()
    if engine.state.is_running:
        await engine.stop(reason="db_restore")
    # Write uploaded file to disk
    backup_path = db_path.with_suffix(".db.bak")
    with backup_path.open("wb") as out:
        out.write(await file.read())
    shutil.move(str(backup_path), str(db_path))
    return {"ok": True, "restored_to": str(db_path),
            "size_bytes": db_path.stat().st_size}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #25: PDF weekly journal export
# --------------------------------------------------------------------------- #

@app.get("/api/export/pdf")
async def api_export_pdf(week_start: str) -> FileResponse:
    """Generate and return the weekly PDF journal."""
    from pdf_export import JournalPDFExporter, REPORTLAB_AVAILABLE
    if not REPORTLAB_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="reportlab is not installed on this backend. "
                   "Run: pip install reportlab")
    try:
        exporter = JournalPDFExporter()
        path = exporter.export_week(week_start)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return FileResponse(str(path),
                        media_type="application/pdf",
                        filename=path.name)


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #26: Tax CSV export
# --------------------------------------------------------------------------- #

@app.get("/api/export/tax")
async def api_export_tax(year: int) -> StreamingResponse:
    """Return a CSV of closed trades for the given tax year (FIFO)."""
    rows = list_trades(limit=10_000, status="closed")
    year_rows = [r for r in rows
                 if r.get("close_time")
                 and r["close_time"][:4] == str(year)]
    # FIFO is implicit because list_trades is ordered by id desc; reverse.
    year_rows = list(reversed(year_rows))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "ticket", "symbol", "direction", "volume", "open_time",
        "close_time", "open_price", "close_price", "profit",
        "commission", "swap", "net_profit", "pnl_currency",
    ])
    for r in year_rows:
        gross = float(r.get("profit") or 0.0)
        comm = float(r.get("commission") or 0.0)
        swap = float(r.get("swap") or 0.0)
        net = gross - comm + swap
        writer.writerow([
            r.get("ticket"), r.get("symbol"), r.get("direction"),
            r.get("volume"), r.get("open_time"), r.get("close_time"),
            r.get("open_price"), r.get("close_price"),
            gross, comm, swap, net, settings.mt5.server,
        ])
    buf.seek(0)
    fname = f"tax_export_{year}.csv"
    return StreamingResponse(
        iter([buf.getvalue().encode()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #28: Risk disclosure
# --------------------------------------------------------------------------- #

RISK_DISCLOSURE = """\
RISK DISCLOSURE - Forex Scalping Backend (V2 Strategy)

Trading foreign exchange ("FX", "Forex") and CFDs on margin carries a high
level of risk, and may not be suitable for all investors.  Before deciding
to trade the instruments offered by this automated system you should
carefully consider your objectives, financial situation, needs and level
of experience.  The possibility exists that you could sustain a loss of
some or all of your initial investment and therefore you should not invest
money that you cannot afford to lose.

This backend automates entries and exits based on the V2 Scalping Strategy
which targets RR Net >= 2.0 with 1% risk per trade, max 3 simultaneous
positions and max 5 trades per day.  Past performance of the strategy on
historical data (backtests) is NOT indicative of future results.  Slippage,
spread widening around news, broker rejections and connectivity losses can
cause realised losses to exceed the theoretical 1% risk per trade.

By enabling auto-trading you acknowledge that:
  1. You are the account holder and are responsible for all activity.
  2. You have tested the bot in PAPER mode before going LIVE.
  3. You understand the kill-switch and tiered stop logic (-1% / -2% /
     -4% / -10%) and have configured alerts via Telegram.
  4. The software is provided "AS IS" without warranty of any kind.

If you do not understand these risks, do not enable auto-trading.
"""


@app.get("/api/risk-disclosure")
async def api_risk_disclosure() -> dict[str, Any]:
    """Return the risk disclosure text."""
    return {"text": RISK_DISCLOSURE}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #29: Real probes (test buttons)
# --------------------------------------------------------------------------- #

@app.get("/api/test/mt5")
async def api_test_mt5() -> dict[str, Any]:
    """Probe MT5 (initialize + get_account_info)."""
    if not MT5_AVAILABLE:
        return {"ok": False, "message": "MetaTrader5 package not installed",
                "latency_ms": 0.0}
    t0 = asyncio.get_event_loop().time()
    try:
        conn = get_connector()
        if not conn.connected:
            ok = await asyncio.to_thread(conn.initialize)
            if not ok:
                return {"ok": False,
                        "message": "initialize() failed",
                        "latency_ms": round(
                            (asyncio.get_event_loop().time() - t0) * 1000, 1)}
        acc = await asyncio.to_thread(conn.get_account_info)
        elapsed = (asyncio.get_event_loop().time() - t0) * 1000
        return {"ok": True, "message": f"connected as {acc.login}",
                "latency_ms": round(elapsed, 1),
                "balance": acc.balance}
    except Exception as exc:
        return {"ok": False, "message": str(exc), "latency_ms": 0.0}


@app.get("/api/test/ollama")
async def api_test_ollama() -> dict[str, Any]:
    """Probe Ollama (GET /api/tags)."""
    t0 = asyncio.get_event_loop().time()
    try:
        analyzer = get_analyzer()
        available = await analyzer.is_available()
        elapsed = (asyncio.get_event_loop().time() - t0) * 1000
        if available:
            return {"ok": True,
                    "message": f"model {settings.ollama.model} available",
                    "latency_ms": round(elapsed, 1)}
        return {"ok": False,
                "message": f"model {settings.ollama.model} not found",
                "latency_ms": round(elapsed, 1)}
    except Exception as exc:
        return {"ok": False, "message": str(exc), "latency_ms": 0.0}


@app.get("/api/test/tiingo")
async def api_test_tiingo() -> dict[str, Any]:
    """Probe Tiingo (fetch 1 HIGH event)."""
    t0 = asyncio.get_event_loop().time()
    try:
        cal = get_calendar()
        events = await cal.fetch_calendar(days_ahead=3, impact="HIGH")
        elapsed = (asyncio.get_event_loop().time() - t0) * 1000
        if events:
            return {"ok": True,
                    "message": f"got {len(events)} HIGH events",
                    "latency_ms": round(elapsed, 1)}
        return {"ok": False, "message": "no events returned",
                "latency_ms": round(elapsed, 1)}
    except Exception as exc:
        return {"ok": False, "message": str(exc), "latency_ms": 0.0}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #30: Telegram test
# --------------------------------------------------------------------------- #

@app.post("/api/notifications/test")
async def api_notifications_test() -> dict[str, Any]:
    """Send a test Telegram message."""
    mgr = get_notification_manager()
    if not mgr.enabled:
        return {"ok": False,
                "message": "Telegram not configured (TELEGRAM_BOT_TOKEN "
                           "or TELEGRAM_CHAT_ID empty)"}
    ok = await mgr.send_test()
    return {"ok": ok,
            "message": "sent" if ok else "failed (see logs)"}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 2 #11: Backtest endpoints
# --------------------------------------------------------------------------- #

@app.post("/api/backtest")
async def api_backtest(req: BacktestRequest) -> dict[str, Any]:
    """Run a backtest and persist the result."""
    from backtest import BacktestEngine
    engine = BacktestEngine()
    result = engine.run_backtest(
        symbol=req.symbol,
        timeframe=req.timeframe,
        start_date=req.start_date,
        end_date=req.end_date,
        initial_balance=req.initial_balance,
    )
    result_dict = result.to_dict()
    result_id = insert_backtest_result(
        symbol=result.symbol,
        timeframe=result.timeframe,
        start_date=result.start_date,
        end_date=result.end_date,
        initial_balance=result.initial_balance,
        final_balance=result.final_balance,
        total_trades=result.total_trades,
        wins=result.wins,
        losses=result.losses,
        win_rate_pct=result.win_rate_pct,
        r_net_avg=result.r_net_avg,
        profit_factor=result.profit_factor,
        max_drawdown_pct=result.max_drawdown_pct,
        compliance_score_pct=result.compliance_score_pct,
        trades_json=json.dumps(result_dict["trades"], default=str),
        metrics_json=json.dumps({
            "profit_factor": result.profit_factor,
            "max_drawdown_pct": result.max_drawdown_pct,
            "compliance_score_pct": result.compliance_score_pct,
        }),
    )
    return {"id": result_id, **result_dict}


@app.get("/api/backtest/results/{result_id}")
async def api_backtest_result(result_id: int) -> dict[str, Any]:
    """Retrieve a saved backtest result."""
    row = get_backtest_result(int(result_id))
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 2 #17: Holiday calendar endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/holidays")
async def api_holidays(year: int | None = None) -> dict[str, Any]:
    """List FX market holidays for a given year."""
    from holidays import list_holidays
    return {"year": year, "holidays": list_holidays(year)}


@app.get("/api/news")
async def api_news(impact: str | None = "HIGH",
                   days_ahead: int = 7) -> dict[str, Any]:
    """Economic calendar from Tiingo (with SQLite cache fallback)."""
    cal = get_calendar()
    try:
        events = await cal.fetch_calendar(days_ahead=days_ahead, impact=impact)
    except Exception as exc:
        logger.warning("Tiingo fetch failed: %s", exc)
        events = []
    # If empty, fall back to DB cache
    if not events:
        try:
            events = list_news(impact=impact)
        except Exception:
            events = []
    return {
        "count": len(events),
        "events": events,
        "source": "tiingo" if events else "cache_or_empty",
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/ai/analyze")
async def api_ai_analyze(req: AnalyzeRequest) -> dict[str, Any]:
    """Send a setup to Ollama for compliance analysis."""
    analyzer = get_analyzer()
    available = await analyzer.is_available()
    if not available:
        raise HTTPException(
            status_code=503,
            detail=f"Ollama is not running or model '{settings.ollama.model}' "
                   f"is not available at {settings.ollama.base_url}",
        )
    try:
        result = await analyzer.analyze_setup(req.signal)
        return {
            "compliant": result.compliant,
            "score": result.score,
            "checklist_passed": result.checklist_passed,
            "checklist_failed": result.checklist_failed,
            "risks": result.risks,
            "suggestion": result.suggestion,
            "confidence": result.confidence,
            "raw": result.raw,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/ai/chat")
async def api_ai_chat(req: ChatRequest) -> dict[str, Any]:
    """Chat with Ollama (non-streaming JSON response)."""
    analyzer = get_analyzer()
    available = await analyzer.is_available()
    if not available:
        raise HTTPException(
            status_code=503,
            detail=f"Ollama is not running or model '{settings.ollama.model}' "
                   f"is not available at {settings.ollama.base_url}",
        )
    messages = list(req.history) + [{"role": "user", "content": req.message}]
    try:
        reply = await analyzer.chat(messages, stream=False)
        return {"reply": reply, "model": settings.ollama.model}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/ai/chat/stream")
async def api_ai_chat_stream(message: str) -> StreamingResponse:
    """Streaming chat endpoint (Server-Sent Events)."""
    analyzer = get_analyzer()

    async def gen() -> AsyncIterator[bytes]:
        try:
            chunks = await analyzer.chat(
                [{"role": "user", "content": message}], stream=True)
            async for tok in chunks:  # type: ignore[union-attr]
                yield f"data: {json.dumps({'token': tok})}\n\n".encode()
            yield b"data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n".encode()

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/journal")
async def api_journal(limit: int = 100,
                      offset: int = 0,
                      status: str | None = None) -> dict[str, Any]:
    """Trade history from SQLite."""
    rows = list_trades(limit=limit, offset=offset, status=status)
    return {"count": len(rows), "trades": rows}


@app.get("/api/settings")
async def api_get_settings() -> dict[str, Any]:
    """Get all settings."""
    return {"settings": get_all_settings()}


@app.post("/api/settings")
async def api_update_settings(req: SettingsUpdate) -> dict[str, Any]:
    """Update settings (key/value pairs)."""
    for k, v in req.settings.items():
        set_setting(k, v)
    return {"ok": True, "settings": get_all_settings()}


@app.get("/api/chart/{symbol}")
async def api_chart(symbol: str,
                    timeframe: str = "M5",
                    count: int = 200) -> dict[str, Any]:
    """Candlestick data + indicators (EMA9/21, VWAP, ATR, ADX, RSI)."""
    mt5_sym = symbol.upper().replace("/", "")
    # Allow caller to use pair name OR mt5 symbol
    if mt5_sym in settings.pairs:
        mt5_sym = settings.symbol_for(mt5_sym)
    if not MT5_AVAILABLE or not get_connector().connected:
        return {"symbol": symbol, "candles": [], "indicators": {},
                "mt5_connected": False}
    try:
        bars = _safe_call(get_connector().get_candles, mt5_sym, timeframe, count)
        candles = [Candle(time=b.time, open=b.open, high=b.high, low=b.low,
                          close=b.close, volume=b.volume, day=b.day)
                   for b in bars]
        closes = [c.close for c in candles]
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        ema9_series = ema_series(closes, 9)
        ema21_series = ema_series(closes, 21)
        vwap_val = vwap(candles)
        atr_val = atr(highs, lows, closes, period=14)
        adx_result = adx(highs, lows, closes, period=14)
        rsi_val = rsi(closes, period=14)
        bb = bollinger_bands(closes, period=20, std=2.0)
        pattern = candle_pattern_detection(candles) if candles else None
        return {
            "symbol": symbol,
            "mt5_symbol": mt5_sym,
            "timeframe": timeframe,
            "count": len(candles),
            "candles": [c.__dict__ for c in candles],
            "indicators": {
                "ema9": ema9_series,
                "ema21": ema21_series,
                "vwap": vwap_val,
                "atr": atr_val,
                "atr_pips": (atr_val / (get_connector()
                            .get_symbol_info(mt5_sym).pip_size)
                            if MT5_AVAILABLE and get_connector().connected
                            else None),
                "adx": {"adx": adx_result.adx,
                        "plus_di": adx_result.plus_di,
                        "minus_di": adx_result.minus_di},
                "rsi": rsi_val,
                "bollinger": {"upper": bb.upper, "middle": bb.middle,
                              "lower": bb.lower},
                "pattern": {"name": pattern.name,
                            "confidence": pattern.confidence,
                            "index": pattern.index} if pattern else None,
            },
            "mt5_connected": True,
        }
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """Real-time price + bot status stream.

    The client may send JSON commands:
        {"action": "ping"}
        {"action": "subscribe"}
        {"action": "chart", "symbol": "EURUSD", "timeframe": "M5"}
    Server pushes:
        {"type": "signal", ...}
        {"type": "order_placed", ...}
        {"type": "position_closed", ...}
        {"type": "tick", "symbol": ..., "bid": ..., "ask": ...}
        {"type": "status", ...}
    """
    await ws.accept()
    engine = get_engine()
    queue = engine.bus.subscribe()
    # Send initial status
    try:
        await ws.send_json({"type": "status", "data": engine.snapshot()})
    except Exception:
        pass

    # Background task: emit ticks + periodic status
    async def emitter() -> None:
        last_status = 0.0
        while True:
            # Drain event queue
            try:
                while True:
                    event = queue.get_nowait()
                    await ws.send_json(event)
            except asyncio.QueueEmpty:
                pass
            # Periodic status (every 15s)
            now = asyncio.get_event_loop().time()
            if now - last_status > settings.server.ws_heartbeat_s:
                try:
                    await ws.send_json({"type": "status",
                                        "data": engine.snapshot()})
                    last_status = now
                except Exception:
                    return
            # Tick push (if MT5 connected)
            if MT5_AVAILABLE and get_connector().connected:
                try:
                    for pair, mt5_sym in zip(settings.pairs,
                                             settings.mt5_symbols):
                        info = get_connector().get_symbol_info(mt5_sym)
                        await ws.send_json({
                            "type": "tick",
                            "symbol": pair,
                            "bid": info.bid,
                            "ask": info.ask,
                            "spread": info.spread,
                            "ts": datetime.now(timezone.utc).isoformat(),
                        })
                except Exception:
                    pass
            await asyncio.sleep(1.0)

    emit_task = asyncio.create_task(emitter())
    try:
        while True:
            msg = await ws.receive_text()
            try:
                cmd = json.loads(msg)
            except json.JSONDecodeError:
                continue
            action = cmd.get("action")
            if action == "ping":
                await ws.send_json({"type": "pong",
                                    "ts": datetime.now(timezone.utc).isoformat()})
            elif action == "status":
                await ws.send_json({"type": "status",
                                    "data": engine.snapshot()})
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as exc:  # pragma: no cover
        logger.warning("WebSocket error: %s", exc)
    finally:
        emit_task.cancel()
        try:
            await emit_task
        except asyncio.CancelledError:
            pass
        engine.bus.unsubscribe(queue)


# --------------------------------------------------------------------------- #
# Run
# --------------------------------------------------------------------------- #

def main() -> None:
    """Run uvicorn with the configured host/port."""
    import uvicorn
    logger.info("Launching uvicorn on %s:%s", settings.server.host,
                settings.server.port)
    uvicorn.run(
        "main:app",
        host=settings.server.host,
        port=settings.server.port,
        log_level=settings.paths.log_level.lower(),
        reload=False,
    )


if __name__ == "__main__":
    main()
