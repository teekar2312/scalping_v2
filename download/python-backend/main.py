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
from typing import Annotated, Any, AsyncIterator

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
import config as cfg
from mt5_connector import (
    MT5UnavailableError, MT5_AVAILABLE, get_connector,
    get_connector_pool, reset_connector_pool,
    get_market_depth, OrderRouter,
)
from database import (
    get_db, list_trades, list_signals, list_news, get_all_settings,
    get_setting, set_setting, get_bot_state, list_audit_log, list_equity_curve,
    get_backtest_result, insert_backtest_result,
    get_performance_attribution, get_compliance_score,
    set_trade_emotional_state, list_emotional_summary,
    list_open_trades,
    # Sprint 5/6/7 imports
    verify_audit_chain, list_trade_events,
    insert_risk_acknowledgment, get_latest_risk_acknowledgment,
    list_latency_samples,
    get_stress_test_result, insert_stress_test_result,
    # BACKEND-100 #12 swap tracking
    insert_swap_record, list_swap_records,
    swap_summary_by_day, swap_summary_by_symbol,
    # BACKEND-FIXES-2: user CRUD for /api/auth/keys + change-password
    list_users, get_user, update_user_password, delete_user,
    get_user_by_username,
)
from ollama_analyzer import get_analyzer, close_default_client as close_ai
from tiingo_calendar import get_calendar, close_default_client as close_cal
from trading_engine import get_engine, EventBus
from notifications import get_notification_manager, close_default_manager
from indicators import (
    ema, ema_series, vwap, atr, adx, rsi, bollinger_bands,
    Candle, candle_pattern_detection,
    volume_profile,
)
# Sprint 5/6/7/8 new modules
from auth import (
    get_api_key, get_auth, require_role, require_admin, require_trader,
    require_viewer, login as auth_login,
    # BACKEND-FIXES-2: helpers for /api/auth/keys + /api/auth/change-password
    generate_api_key, hash_password, verify_password,
)
from secrets import get_secret_manager
from metrics import (
    MetricsMiddleware, RequestIDMiddleware, update_trading_metrics,
    render_metrics, REQUEST_ID_CTX, trading_total_trades,
    trading_signals_generated, trading_kill_switch_triggered,
    get_uptime_seconds, get_system_info, update_process_metrics,
)
from risk_analytics import (
    calculate_var, calculate_cvar, get_returns_from_trades,
    realized_volatility, volatility_surface,
    rolling_correlation, correlation_matrix,
)
from stress_test import StressTester, STRESS_SCENARIOS
from backtest import MonteCarloEngine, WalkForwardAnalyzer, TickBacktestEngine
from regulatory_id import (
    calculate_pph_forex, format_spt_year, check_bappebti_compliance,
    BAPPEBTI_REQUIREMENTS, BAPPEBTI_REGISTERED_BROKERS,
)
from risk_manager import KellySizer
# BACKEND-100 new modules
from market_analysis import currency_strength as calc_currency_strength

# --------------------------------------------------------------------------- #
# Logging - structured JSON (Sprint 8 #20)
# --------------------------------------------------------------------------- #

_log_path = Path(settings.paths.log_path)
_log_path.parent.mkdir(parents=True, exist_ok=True)

try:
    from pythonjsonlogger import jsonlogger as _jl
    _JSON_LOGGER_AVAILABLE = True
except ImportError:  # pragma: no cover
    _jl = None  # type: ignore
    _JSON_LOGGER_AVAILABLE = False

# Build a JSON formatter that injects the request_id / trace_id from the
# contextvar when present.
class _ContextJsonFormatter(_jl.JsonFormatter if _JSON_LOGGER_AVAILABLE else object):  # type: ignore[misc]
    """JSON formatter that includes request_id + trace_id from contextvars."""

    def add_fields(self, log_record, record, message_dict):  # type: ignore[override]
        if _JSON_LOGGER_AVAILABLE:
            super().add_fields(log_record, record, message_dict)
        rid = REQUEST_ID_CTX.get("") if REQUEST_ID_CTX else ""
        tid = REQUEST_ID_CTX.get("") if REQUEST_ID_CTX else ""
        log_record["request_id"] = rid
        log_record["trace_id"] = tid
        # timestamp + level normalised
        log_record["timestamp"] = datetime.now(timezone.utc).isoformat()
        log_record["level"] = record.levelname

_file_handler = logging.handlers.RotatingFileHandler(
    _log_path, maxBytes=10 * 1024 * 1024, backupCount=5,
)
_stdout_handler = logging.StreamHandler(sys.stdout)

if _JSON_LOGGER_AVAILABLE:
    _fmt = _ContextJsonFormatter(
        "%(timestamp)s %(level)s %(name)s %(message)s",
        rename_fields={"name": "logger"},
    )
    _file_handler.setFormatter(_fmt)
    _stdout_handler.setFormatter(_fmt)
else:
    _file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    _stdout_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

logging.basicConfig(
    level=getattr(logging, settings.paths.log_level, logging.INFO),
    handlers=[_file_handler, _stdout_handler],
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
    # Ensure default admin user exists (audit-fix: chicken-and-egg deadlock)
    try:
        from database import ensure_default_admin
        admin_info = ensure_default_admin()
        if admin_info:
            logger.info("Admin user ready: username=%s role=%s", admin_info.get("username"), admin_info.get("role"))
    except Exception as exc:
        logger.warning("ensure_default_admin failed: %s", exc)
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

# ---- BACKEND-100 #16: OpenAPI tag metadata --------------------------------- #
tags_metadata: list[dict[str, str]] = [
    {"name": "auth", "description": "Authentication (login, /me, secrets)."},
    {"name": "bot", "description": "Bot lifecycle (start/stop/kill, mode, dry-run)."},
    {"name": "signals", "description": "Strategy signals + market scans."},
    {"name": "positions", "description": "Open positions, equity curve, drawdown."},
    {"name": "journal", "description": "Trade history + emotional-state tags."},
    {"name": "news", "description": "Economic calendar + AI sentiment tagging."},
    {"name": "ai", "description": "Ollama chat + setup compliance analysis."},
    {"name": "analytics",
     "description": "Risk analytics (VaR, stress, attribution, vol surface, correlation)."},
    {"name": "backtest", "description": "Backtest, Monte Carlo, walk-forward, tick backtest."},
    {"name": "settings", "description": "Key/value settings + secrets CRUD."},
    {"name": "system",
     "description": "Health checks, metrics, system info, broker status."},
    {"name": "market-data",
     "description": "Candles, indicators, volume profile, currency strength, order flow."},
    {"name": "swaps", "description": "Daily swap / rollover reports (BACKEND-100 #12)."},
    {"name": "regulatory",
     "description": "BAPPEBTI compliance, tax export (SPT)."},
]

app = FastAPI(
    title="Forex Scalping Backend (V2)",
    description="Automated Forex scalping trading system - V2 strategy. "
                "Connects to MetaTrader 5 (Finex Indonesia), Ollama "
                "(llama3.2:latest) and Tiingo economic calendar.",
    version="1.0.0",
    lifespan=lifespan,
    openapi_tags=tags_metadata,
    contact={
        "name": "Forex Scalping V2",
        "url": "https://github.com/your-org/forex-scalping-v2",
    },
    license_info={
        "name": "Educational / personal use",
        "url": "https://opensource.org/license/mit",
    },
)

# ---- Sprint 5 #4: rate limiter (slowapi) ---------------------------------- #
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ---- Sprint 5 #5: HTTPS redirect (optional) ------------------------------- #
if cfg.ENFORCE_HTTPS:
    app.add_middleware(HTTPSRedirectMiddleware)
    logger.info("HTTPS enforcement is ON (ENFORCE_HTTPS=true)")

# ---- Sprint 5 #7: CORS tightening ----------------------------------------- #
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.server.cors_origins,
    allow_credentials=False,                # Bearer token, not cookies
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)

# ---- Sprint 8 #20: request id + metrics middleware ------------------------ #
# Outer = RequestID (sets contextvar), inner = Metrics (records dur+count).
app.add_middleware(MetricsMiddleware)
app.add_middleware(RequestIDMiddleware)


# ---- Sprint 5 #5: security headers ---------------------------------------- #

@app.middleware("http")
async def _security_headers(request: Request, call_next):
    """Inject X-Content-Type-Options, X-Frame-Options, HSTS on every response."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if cfg.ENFORCE_HTTPS:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    return response


# --------------------------------------------------------------------------- #
# Pydantic models (Sprint 5 #8: input validation tightening)
# --------------------------------------------------------------------------- #

# Whitelist of symbols accepted by /api/chart/{symbol} and other symbol params.
_SYMBOL_WHITELIST: set[str] = set(settings.pairs) | set(settings.mt5_symbols)


class SymbolValidator:
    """Pydantic v2-style symbol whitelist validator (used as a field
    validator on request bodies that contain a ``symbol`` field).
    """

    @classmethod
    def validate(cls, v: str) -> str:
        if v is None:
            raise ValueError("symbol is required")
        sym = str(v).upper().replace("/", "")
        if sym not in _SYMBOL_WHITELIST:
            # Allow any pair when the whitelist is empty (paper mode etc.)
            if _SYMBOL_WHITELIST:
                raise ValueError(
                    f"symbol '{sym}' not in whitelist {sorted(_SYMBOL_WHITELIST)}"
                )
        return sym


class BotActionResponse(BaseModel):
    ok: bool
    message: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ChatRequest(BaseModel):
    """Chat request body for ``POST /api/ai/chat``.

    BACKEND-FIXES-2: ``history`` accepts free-form dicts (frontend may send
    ``{"role": "user", "content": "..."}`` or include extra metadata keys)
    and an optional ``context`` field is supported for prompt priming.
    """
    message: str = Field(min_length=1, max_length=4_000)
    history: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    context: str | None = None


# ---- Sprint 5 #8: strict AnalyzeRequest.signal ----------------------------- #

class SignalData(BaseModel):
    """Strict representation of a strategy signal submitted to /api/ai/analyze.

    BACKEND-FIXES-2: ``direction`` now accepts both upper-case (``BUY`` /
    ``SELL``) and lower-case (``buy`` / ``sell``) values to match what the
    frontend sends.  Other fields are kept optional so partial signal
    payloads (e.g. paper-mode probes) don't get rejected.
    """
    symbol: str = Field(min_length=3, max_length=20)
    direction: str = Field(pattern="^(BUY|SELL|buy|sell)$")
    entry_price: float = Field(gt=0)
    sl: float | None = Field(default=None, gt=0)
    tp1: float | None = Field(default=None, gt=0)
    tp2: float | None = Field(default=None, gt=0)
    atr: float | None = Field(default=None, ge=0)
    adx: float | None = Field(default=None, ge=0, le=100)
    rr_net: float | None = Field(default=None)
    regime: str | None = Field(default=None, pattern="^(TRENDING|TRANSITION|RANGING)$")
    session: str | None = Field(default=None, max_length=20)
    checklist: dict[str, bool] | None = None

    @field_validator("symbol")
    @classmethod
    def _check_symbol(cls, v: str) -> str:
        return SymbolValidator.validate(v)


class AnalyzeRequest(BaseModel):
    """Compliance analysis request body for ``POST /api/ai/analyze``.

    BACKEND-FIXES-2: ``signal`` is accepted as a free-form ``dict[str, Any]``
    so the frontend can submit either upper-case (``BUY``) or lower-case
    (``buy``) directions and any extra fields without strict Pydantic
    validation rejecting the payload.  :class:`SignalData` is kept above as
    a documented schema for reference / OpenAPI generation.
    """
    signal: dict[str, Any]


class SettingsUpdate(BaseModel):
    """Settings update body for ``POST /api/settings``.

    BACKEND-FIXES-2: ``settings`` accepts arbitrary string values.  The
    frontend sends a flat dict ``{settings: {key: value, ...}}`` which we
    persist via :func:`database.set_setting`.
    """
    settings: dict[str, Any]


class NewsFilter(BaseModel):
    impact: str | None = None
    days_ahead: int = 7


class BacktestRequest(BaseModel):
    symbol: str
    timeframe: str = "M5"
    start_date: str
    end_date: str
    initial_balance: float = 10_000.0

    @field_validator("symbol")
    @classmethod
    def _check_symbol(cls, v: str) -> str:
        return SymbolValidator.validate(v)

    @field_validator("initial_balance")
    @classmethod
    def _check_balance(cls, v: float) -> float:
        if v <= 0 or v > 10_000_000:
            raise ValueError("initial_balance must be in (0, 10_000_000]")
        return v

    @model_validator(mode="after")
    def _check_dates(self) -> "BacktestRequest":
        try:
            sd = datetime.fromisoformat(self.start_date)
            ed = datetime.fromisoformat(self.end_date)
        except Exception as exc:
            raise ValueError(f"invalid ISO dates: {exc}") from exc
        if sd >= ed:
            raise ValueError("start_date must be < end_date")
        if (ed - sd).days > 365:
            raise ValueError("date range must not exceed 365 days")
        return self


class TickBacktestRequest(BacktestRequest):
    """Tick-level backtest request body for ``POST /api/backtest/tick``.

    BACKEND-FIXES-2: the frontend sends
    ``{symbol, start_date, end_date, initial_balance}`` which is identical to
    :class:`BacktestRequest`; this subclass exists for OpenAPI clarity and so
    future tick-specific fields (e.g. ``synthesise_ticks``, ``spread_pips``)
    can be added without breaking the candle endpoint.
    """
    pass


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

    @model_validator(mode="after")
    def _check(self) -> "AttributionRange":
        if self.start_date >= self.end_date:
            raise ValueError("start_date must be < end_date")
        if (self.end_date - self.start_date).days > 366:
            raise ValueError("range must not exceed 366 days")
        return self


# ---- Sprint 5 #6: auth request/response models ---------------------------- #

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class SecretStoreRequest(BaseModel):
    value: str = Field(min_length=1, max_length=8_192)


class RiskAcknowledgmentRequest(BaseModel):
    version: str = Field(min_length=1, max_length=32)


# ---- Sprint 7 #14 / #15: analytics request bodies ------------------------ #

class StressTestRequest(BaseModel):
    """Stress test request body for ``POST /api/analytics/stress-test``.

    BACKEND-FIXES-2: the frontend submits
    ``{scenario, initial_balance, position_value, pairs}`` while the backend
    engine reads ``trades_period_days`` + ``balance``.  The frontend fields
    are accepted as optional and currently ignored (the engine derives the
    trade window from DB history); ``initial_balance`` overrides ``balance``
    when set for compatibility.
    """
    trades_period_days: int = Field(default=90, ge=1, le=365)
    balance: float = Field(default=10_000.0, gt=0, le=10_000_000)
    # ---- Frontend compatibility (accepted, partially mapped) ---- #
    scenario: str | None = None
    initial_balance: float | None = None
    position_value: float | None = None
    pairs: list[str] | None = None

    @model_validator(mode="after")
    def _map_initial_balance(self) -> "StressTestRequest":
        """If the frontend sent ``initial_balance``, use it as ``balance``."""
        if self.initial_balance is not None and self.initial_balance > 0:
            self.balance = self.initial_balance
        return self


class MonteCarloRequest(BaseModel):
    """Monte-Carlo request body for ``POST /api/backtest/monte-carlo``.

    BACKEND-FIXES-2: renamed ``trades_period`` -> ``trades_period_days`` to
    match the frontend payload.  The old name is still accepted via
    ``AliasChoices`` for backward compatibility.
    """
    iterations: int = Field(default=1000, ge=10, le=10_000)
    trades_period_days: int = Field(
        default=90, ge=1, le=365,
        validation_alias=AliasChoices("trades_period_days", "trades_period"),
    )
    mode: str = Field(default="trade_resample",
                      pattern="^(trade_resample|return_perturbation)$")
    noise_std: float = Field(default=0.0, ge=0, le=100)


class WalkForwardRequest(BaseModel):
    """Walk-forward request body for ``POST /api/backtest/walk-forward``.

    BACKEND-FIXES-2: renamed ``in_sample_window`` /
    ``out_sample_window`` -> ``in_sample_window_days`` /
    ``out_sample_window_days`` to match the frontend payload.  The old names
    are still accepted via ``AliasChoices`` for backward compatibility.
    """
    in_sample_window_days: int = Field(
        default=90, ge=10, le=500,
        validation_alias=AliasChoices("in_sample_window_days",
                                      "in_sample_window"),
    )
    out_sample_window_days: int = Field(
        default=30, ge=5, le=200,
        validation_alias=AliasChoices("out_sample_window_days",
                                      "out_sample_window"),
    )


# ---- Sprint 5 #8: volume field validation --------------------------------- #

class VolumeParam(BaseModel):
    """Reusable volume validator: positive float, min 0.01, max 100."""
    volume: float = Field(gt=0, ge=0.01, le=100)


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
    """Call an MT5 function and translate errors appropriately."""
    try:
        return func(*args, **kwargs)
    except MT5UnavailableError:
        raise HTTPException(status_code=503, detail="MT5 unavailable")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("_safe_call %s failed: %s", getattr(func, '__name__', 'unknown'), exc)
        raise


# --------------------------------------------------------------------------- #
# REST routes
# --------------------------------------------------------------------------- #

@app.get("/",
         tags=["system"],
         summary="Service root",
         description="Returns the service name, version, and MT5 connection status.")
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


@app.get("/healthz",
         tags=["system"],
         summary="Liveness probe",
         description="Returns 200 if the process is alive. Lightweight - "
                     "no dependency checks.",
         responses={
             200: {"description": "Process alive"},
             503: {"description": "Process not ready"},
         })
async def healthz() -> dict[str, Any]:
    """Liveness probe - return 200 if the process is alive (Sprint 8 #20).

    BACKEND-100 #17: extended with uptime + version.
    """
    return {
        "status": "ok",
        "uptime_s": round(get_uptime_seconds(), 1),
        "version": "1.0.0",
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/readyz",
         tags=["system"],
         summary="Readiness probe (detailed)",
         description="Returns 200 with detailed dependency checks: DB, MT5, "
                     "Ollama, Tiingo, memory, disk.  Returns 503 if any "
                     "critical dependency is down.",
         responses={
             200: {"description": "All dependencies ready"},
             503: {"description": "One or more dependencies down"},
         })
async def readyz() -> dict[str, Any]:
    """Readiness probe - return 200 if DB + MT5 + Ollama are all available.

    BACKEND-100 #17: now includes memory + disk + extended dependency
    latency info.
    """
    ok = True
    parts: dict[str, Any] = {}
    # ---- DB ---- #
    t0 = asyncio.get_event_loop().time()
    try:
        get_db()
        latency_ms = (asyncio.get_event_loop().time() - t0) * 1000.0
        parts["db"] = {"ok": True, "latency_ms": round(latency_ms, 2)}
    except Exception as exc:
        ok = False
        parts["db"] = {"ok": False, "error": str(exc)}
    # ---- MT5 ---- #
    if MT5_AVAILABLE:
        try:
            conn = get_connector()
            connected = conn.connected
            try:
                server = conn.config.mt5.server
            except Exception:
                server = "?"
            parts["mt5"] = {"ok": connected, "server": server}
            if not connected:
                ok = False
        except Exception as exc:
            ok = False
            parts["mt5"] = {"ok": False, "error": str(exc)}
    else:
        parts["mt5"] = {"ok": False, "note": "MetaTrader5 package not installed"}
    # ---- Ollama ---- #
    try:
        analyzer = get_analyzer()
        if await analyzer.is_available():
            parts["ollama"] = {"ok": True, "model": settings.ollama.model}
        else:
            parts["ollama"] = {"ok": False, "model": settings.ollama.model}
            ok = False
    except Exception as exc:
        parts["ollama"] = {"ok": False, "error": str(exc)}
        ok = False
    # ---- Tiingo ---- #
    try:
        cal = get_calendar()
        events = await cal.fetch_calendar(days_ahead=3, impact="HIGH")
        parts["tiingo"] = {"ok": True, "events_cached": len(events)}
    except Exception as exc:
        parts["tiingo"] = {"ok": False, "error": str(exc)}
        # Tiingo is non-fatal for readiness.
    # ---- Memory + disk ---- #
    try:
        import os
        import shutil
        disk = shutil.disk_usage(os.getcwd())
        parts["disk"] = {
            "used_gb": round(disk.used / (1024 ** 3), 2),
            "total_gb": round(disk.total / (1024 ** 3), 2),
        }
    except Exception:  # pragma: no cover
        pass
    try:
        import psutil  # type: ignore
        vm = psutil.virtual_memory()
        parts["memory"] = {
            "used_mb": int((vm.total - vm.available) // (1024 * 1024)),
            "total_mb": int(vm.total // (1024 * 1024)),
        }
    except ImportError:
        try:
            with open("/proc/meminfo", "r") as fh:
                mem = {}
                for line in fh:
                    p = line.split(":")
                    if len(p) == 2:
                        mem[p[0].strip()] = int(p[1].split()[0])
            parts["memory"] = {
                "used_mb": (mem.get("MemTotal", 0) - mem.get("MemAvailable", 0)) // 1024,
                "total_mb": mem.get("MemTotal", 0) // 1024,
            }
        except Exception:  # pragma: no cover
            pass
    body = {"ready": ok, "uptime_s": round(get_uptime_seconds(), 1),
            "ts": datetime.now(timezone.utc).isoformat(), **parts}
    if not ok:
        return JSONResponse(status_code=503, content=body)
    return body


@app.get("/metrics",
         tags=["system"],
         summary="Prometheus metrics",
         description="Returns the Prometheus-formatted metrics payload. "
                     "Includes HTTP request counters, trading gauges, "
                     "process memory / CPU, and DB query durations "
                     "(BACKEND-100 #17).",
         responses={200: {"description": "Prometheus metrics text"}})
async def metrics_endpoint() -> Response:
    """Prometheus metrics endpoint (Sprint 8 #20)."""
    body, content_type = render_metrics()
    return Response(content=body, media_type=content_type)


@app.get("/api/system/info",
         tags=["system"],
         summary="System info",
         description="Returns Python version, OS, hostname, CPU count, "
                     "memory total, installed packages list, and uptime "
                     "(BACKEND-100 #17).",
         responses={
             200: {"description": "System info dict"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("10/minute")
async def api_system_info(request: Request,
                          _auth: dict = Depends(get_api_key)
                          ) -> dict[str, Any]:
    """Return detailed host + Python + package info for ops dashboards.

    BACKEND-FIXES-2: memory + disk are now reported in **bytes** plus the
    raw percentage so the frontend can format with ``Intl.NumberFormat``
    rather than re-multiplying MB / GB by constants.  Backward-compatible
    MB / GB keys are preserved.
    """
    base = get_system_info()
    # Convert units: ensure memory_*_bytes and disk_*_bytes are present.
    try:
        import os as _os
        import platform as _platform
        import psutil  # type: ignore
        vm = psutil.virtual_memory()
        du = shutil.disk_usage(_os.getcwd())
        base["python_version"] = _platform.python_version()
        base["os"] = _platform.system()
        base["hostname"] = _platform.node() or base.get("hostname")
        base["cpu_count"] = psutil.cpu_count() or base.get("cpu_count", 0)
        base["cpu_percent"] = psutil.cpu_percent(interval=None)
        base["memory_total_bytes"] = int(vm.total)
        base["memory_used_bytes"] = int(vm.total - vm.available)
        base["memory_available_bytes"] = int(vm.available)
        base["memory_percent"] = round(vm.percent, 2)
        base["disk_total_bytes"] = int(du.total)
        base["disk_used_bytes"] = int(du.used)
        base["disk_free_bytes"] = int(du.free)
        base["disk_percent"] = round((du.used / du.total * 100.0)
                                     if du.total else 0.0, 2)
        base["uptime_seconds"] = round(get_uptime_seconds(), 1)
        base["active_db_connections"] = 1
        try:
            base["boot_time"] = datetime.fromtimestamp(
                psutil.boot_time()).isoformat()
        except Exception:
            base["boot_time"] = None
        base["process_id"] = _os.getpid()
    except ImportError:
        # psutil not installed - fall back to /proc on Linux; otherwise
        # leave the dict as returned by ``get_system_info``.
        base.setdefault("memory_total_bytes", None)
        base.setdefault("memory_used_bytes", None)
        base.setdefault("disk_total_bytes", None)
        base.setdefault("disk_used_bytes", None)
        base.setdefault("active_db_connections", 1)
        base.setdefault("process_id", None)
        base.setdefault("boot_time", None)
    return base


@app.get("/api/status",
         tags=["bot"],
         summary="Bot status + MT5 connection",
         description="Returns the engine state, account summary, bot "
                     "state and MT5 connection status.",
         responses={200: {"description": "Status dict"},
                    401: {"description": "Authentication required"},
                    429: {"description": "Rate limit exceeded"}})
@limiter.limit("60/minute")
async def api_status(request: Request,
                     _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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
    # ---- BACKEND-FIXES-2: alias / availability fields the frontend expects --- #
    snap["bot"] = snap.get("bot_state", {})  # alias
    mt5_ok = MT5_AVAILABLE and bool(get_connector().connected)
    snap["mt5Available"] = mt5_ok
    # Ollama / Tiingo availability are checked lazily here (best-effort) so
    # the frontend dashboard can show green/red status icons without a
    # separate round-trip.  Errors are swallowed -> default to False.
    snap["ollamaAvailable"] = False
    try:
        from ollama_analyzer import get_analyzer as _get_analyzer
        analyzer = _get_analyzer()
        # ``is_available`` is async; we synchronously set True if the client
        # was constructed without error.  A separate probe endpoint
        # (/api/test/ollama) gives the authoritative value.
        snap["ollamaAvailable"] = bool(analyzer is not None)
    except Exception:
        snap["ollamaAvailable"] = False
    snap["tiingoAvailable"] = bool(settings.tiingo.api_key)
    snap["openPositionsCount"] = (
        len(_safe_call(get_connector().get_positions))
        if mt5_ok else 0
    )
    snap["todayTradesCount"] = 0
    try:
        today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        from database import list_trades as _list_trades
        snap["todayTradesCount"] = sum(
            1 for r in _list_trades(limit=10_000)
            if (r.get("open_time") or "").startswith(today_iso)
        )
    except Exception:
        snap["todayTradesCount"] = 0
    snap["dailyRisk"] = None
    try:
        from database import get_or_create_daily
        today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        snap["dailyRisk"] = get_or_create_daily(today_iso, 10_000.0)
    except Exception:
        snap["dailyRisk"] = None
    snap["weeklyPnlPct"] = 0.0
    snap["overallPnlPct"] = 0.0
    snap["demoMode"] = bool(getattr(engine, "paper_mode", False))
    snap["pythonBackendUrl"] = f"http://localhost:{settings.server.port}"
    # Update Prometheus gauges (Sprint 8 #20)
    update_trading_metrics(snap, account_summary)
    return snap


@app.get("/api/account",
         tags=["bot"],
         summary="MT5 account info",
         description="Login, balance, equity, margin, leverage.",
         responses={200: {"description": "Account info"},
                    401: {"description": "Authentication required"},
                    503: {"description": "MT5 unavailable"}})
@limiter.limit("60/minute")
async def api_account(request: Request,
                      _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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


@app.get("/api/positions",
         tags=["positions"],
         summary="Open positions",
         description="List open MT5 positions, optionally filtered by symbol.",
         responses={200: {"description": "Positions list"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_positions(request: Request,
                        symbol: str | None = None,
                        _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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


@app.get("/api/signals",
         tags=["signals"],
         summary="Recent signals",
         description="Return the most recent strategy signals from SQLite.",
         responses={200: {"description": "Signals list"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_signals(request: Request,
                      limit: int = 50,
                      symbol: str | None = None,
                      _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Recent signals from SQLite."""
    rows = list_signals(limit=limit, symbol=symbol)
    return {"count": len(rows), "signals": rows}


@app.post("/api/bot/start",
         response_model=BotActionResponse,
         tags=["bot"],
         summary="Start auto-trading",
         description="Run the pre-live checklist, then start the trading loop.",
         responses={200: {"description": "Started"},
                    400: {"description": "Checklist failed"},
                    401: {"description": "Authentication required"},
                    403: {"description": "Risk disclosure missing/expired"}})
@limiter.limit("10/minute")
async def api_bot_start(request: Request,
                        _auth: dict = Depends(require_trader)
                        ) -> BotActionResponse:
    """Start auto-trading.  Runs the pre-live checklist first; returns 400
    with blocking issues if anything critical is missing.

    Sprint 6 #9: also enforces a signed risk-disclosure acknowledgment -
    returns 403 if no acknowledgment exists or the latest one is older than
    30 days.
    """
    # ---- Risk disclosure gate (Sprint 6 #9) ---- #
    ack = get_latest_risk_acknowledgment()
    if ack is None:
        raise HTTPException(
            status_code=403,
            detail={"ok": False, "message": "Risk disclosure not acknowledged. "
                    "POST /api/risk-disclosure/acknowledge first.",
                    "acknowledged": False},
        )
    ack_dt = (datetime.fromisoformat(ack["acknowledged_at"].replace("Z", "+00:00"))
              if ack.get("acknowledged_at") else None)
    if ack_dt and ack_dt.tzinfo is None:
        ack_dt = ack_dt.replace(tzinfo=timezone.utc)
    if ack_dt is None or (datetime.now(timezone.utc) - ack_dt).days > 30:
        raise HTTPException(
            status_code=403,
            detail={"ok": False, "message": "Risk disclosure acknowledgment "
                    "expired (>30 days). Re-acknowledge to continue.",
                    "acknowledged": True, "expired": True,
                    "acknowledged_at": ack.get("acknowledged_at")},
        )
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


@app.post("/api/bot/stop",
         response_model=BotActionResponse,
         tags=["bot"],
         summary="Stop auto-trading",
         description="Stop the trading loop (positions remain open).",
         responses={200: {"description": "Stopped"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_bot_stop(request: Request,
                       _auth: dict = Depends(require_trader)
                       ) -> BotActionResponse:
    """Stop bot (does not close positions)."""
    engine = get_engine()
    result = await engine.stop(reason="manual")
    return BotActionResponse(ok=result["ok"], message=result["message"])


@app.post("/api/bot/kill",
         response_model=BotActionResponse,
         tags=["bot"],
         summary="Emergency kill switch",
         description="Close ALL positions, stop the loop, and lock the bot.",
         responses={200: {"description": "Killed"},
                    401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_bot_kill(request: Request,
                       _auth: dict = Depends(require_trader)
                       ) -> BotActionResponse:
    """Emergency kill switch: close all + stop + lock."""
    engine = get_engine()
    result = await engine.kill(reason="manual")
    msg = f"killed: closed={len(result.get('closed', []))} - {result.get('reason')}"
    try:
        trading_kill_switch_triggered.inc()  # type: ignore[union-attr]
    except Exception:
        pass
    return BotActionResponse(ok=result["ok"], message=msg)


@app.post("/api/bot/release-kill",
         response_model=BotActionResponse,
         tags=["bot"],
         summary="Release kill switch",
         description="Manual override to release an engaged kill switch.",
         responses={200: {"description": "Released"},
                    401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_bot_release_kill(request: Request,
                               _auth: dict = Depends(require_trader)
                               ) -> BotActionResponse:
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

@app.post("/api/bot/mode",
         tags=["bot"],
         summary="Switch bot mode (LIVE/PAPER/DRY)",
         responses={200: {"description": "Mode set"},
                    400: {"description": "Invalid mode"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_bot_mode(request: Request,
                       req: BotModeRequest,
                       _auth: dict = Depends(require_trader)) -> dict[str, Any]:
    """Switch bot mode (LIVE / PAPER / DRY)."""
    engine = get_engine()
    result = await engine.set_mode(req.mode)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.get("/api/bot/mode",
         tags=["bot"],
         summary="Get current bot mode",
         responses={200: {"description": "Mode"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_bot_get_mode(request: Request,
                           _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Get current bot mode."""
    engine = get_engine()
    return engine.get_mode()


@app.post("/api/bot/dry-run",
         tags=["bot"],
         summary="Toggle dry-run mode",
         description="When enabled, the bot generates signals but never "
                     "places orders.",
         responses={200: {"description": "Mode toggled"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_bot_dry_run(request: Request,
                          req: DryRunRequest,
                          _auth: dict = Depends(require_trader)) -> dict[str, Any]:
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

@app.get("/api/audit-log",
         tags=["system"],
         summary="Query audit log",
         responses={200: {"description": "Audit events"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_audit_log(request: Request,
                        limit: int = 200,
                        offset: int = 0,
                        event_type: str | None = None,
                        severity: str | None = None,
                        start: str | None = None,
                        end: str | None = None,
                        _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Query the audit log."""
    start_dt = (datetime.fromisoformat(start) if start else None)
    end_dt = (datetime.fromisoformat(end) if end else None)
    rows = list_audit_log(
        limit=limit, offset=offset, event_type=event_type,
        severity=severity, start=start_dt, end=end_dt,
    )
    return {"count": len(rows), "events": rows}


# --------------------------------------------------------------------------- #
# Sprint 6 #10: audit chain verification
# --------------------------------------------------------------------------- #

@app.get("/api/audit-log/verify",
         tags=["system"],
         summary="Verify audit hash chain",
         responses={200: {"description": "Chain valid"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_audit_log_verify(request: Request,
                               _auth: dict = Depends(get_api_key)
                               ) -> dict[str, Any]:
    """Verify the audit-log hash chain integrity."""
    return verify_audit_chain()


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 3 #19: Equity curve endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/equity-curve",
         tags=["positions"],
         summary="Equity curve time series",
         responses={200: {"description": "Equity samples"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_equity_curve(request: Request,
                           hours: float = 24.0,
                           _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Return the equity-curve time series for the last N hours."""
    rows = list_equity_curve(hours=hours)
    return {"count": len(rows), "samples": rows}


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 3 #20-21: Attribution + compliance
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/attribution",
         tags=["analytics"],
         summary="Performance attribution",
         responses={200: {"description": "Attribution dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_attribution(request: Request,
                                    start: str | None = None,
                                    end: str | None = None,
                                    _auth: dict = Depends(get_api_key)
                                    ) -> dict[str, Any]:
    """Performance attribution by session/setup/regime/hour/day/pair."""
    end_dt = (datetime.fromisoformat(end) if end
              else datetime.now(timezone.utc))
    start_dt = (datetime.fromisoformat(start) if start
                else end_dt - timedelta(days=30))
    return get_performance_attribution(start_dt, end_dt)


@app.get("/api/analytics/compliance",
         tags=["analytics"],
         summary="Compliance score",
         responses={200: {"description": "Compliance dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_compliance(request: Request,
                                   start: str | None = None,
                                   end: str | None = None,
                                   _auth: dict = Depends(get_api_key)
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

@app.post("/api/trade/{trade_id}/emotion",
          tags=["journal"],
          summary="Tag trade with emotional state",
          responses={200: {"description": "Tagged"},
                     404: {"description": "Trade not found"},
                     401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_trade_emotion(request: Request,
                            trade_id: int,
                            req: EmotionRequest,
                            _auth: dict = Depends(require_trader)) -> dict[str, Any]:
    """Tag a closed trade with an emotional state + optional note."""
    ok = set_trade_emotional_state(int(trade_id), req.state, req.note)
    if not ok:
        raise HTTPException(status_code=404,
                            detail=f"trade {trade_id} not found")
    return {"ok": True, "trade_id": trade_id, "state": req.state}


@app.get("/api/analytics/emotions",
         tags=["analytics"],
         summary="Emotional-state summary",
         responses={200: {"description": "Emotions summary"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_emotions(request: Request,
                                 limit: int = 200,
                                 _auth: dict = Depends(get_api_key)
                                 ) -> dict[str, Any]:
    """Summary of emotional-state logs across recent trades."""
    return list_emotional_summary(limit=limit)


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 2 #15: Pre-live checklist
# --------------------------------------------------------------------------- #

@app.get("/api/pre-live-check",
         tags=["system"],
         summary="Pre-live readiness checklist",
         responses={200: {"description": "Checklist dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_pre_live_check(request: Request,
                             _auth: dict = Depends(get_api_key)
                             ) -> dict[str, Any]:
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

@app.get("/api/time-sync",
         tags=["system"],
         summary="NTP drift info",
         responses={200: {"description": "Drift dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_time_sync(request: Request,
                        _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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

@app.get("/api/backup",
         tags=["system"],
         summary="Download DB backup",
         description="Stream the SQLite DB file as a downloadable backup. "
                     "Backward-compatible plaintext path.",
         responses={
             200: {"description": "Backup file (octet-stream)"},
             401: {"description": "Authentication required"},
             403: {"description": "Admin role required"},
             404: {"description": "DB file not found"},
         })
@limiter.limit("2/minute")
async def api_backup(request: Request,
                     _auth: dict = Depends(require_admin)) -> StreamingResponse:
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


@app.post("/api/backup/offsite",
          tags=["system"],
          summary="Encrypted offsite backup",
          description="Encrypt the SQLite DB with Fernet (SECRETS_MASTER_KEY) "
                      "and optionally upload to AWS S3 if AWS_S3_BUCKET is "
                      "configured.  Returns local path, encryption flag, "
                      "S3 URL (if uploaded), and file size "
                      "(BACKEND-100 #15).",
          responses={
              200: {"description": "Backup created + optionally uploaded"},
              401: {"description": "Authentication required"},
              403: {"description": "Admin role required"},
              500: {"description": "Encryption or upload failure"},
          })
@limiter.limit("2/hour")
async def api_backup_offsite(request: Request,
                             _auth: dict = Depends(require_admin)
                             ) -> dict[str, Any]:
    """Encrypt the DB with Fernet and optionally upload to AWS S3.

    BACKEND-100 #15: the backup is encrypted locally regardless of S3
    upload status.  When ``AWS_S3_BUCKET`` is set, the encrypted blob is
    also uploaded via boto3 (best-effort; failures return the local path
    with ``s3_url=None`` and ``s3_error`` set).
    """
    db_path = Path(settings.paths.db_path)
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="db file not found")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_name = f"trading_backup_{timestamp}.db.enc"
    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / backup_name
    # Read the raw DB file.
    raw = db_path.read_bytes()
    size_raw = len(raw)
    encrypted: bool = False
    # Fernet encryption using SECRETS_MASTER_KEY (if available).
    master_key = cfg.SECRETS_MASTER_KEY
    if master_key:
        try:
            from cryptography.fernet import Fernet
            f = Fernet(master_key.encode() if isinstance(master_key, str)
                       else master_key)
            blob = f.encrypt(raw)
            backup_path.write_bytes(blob)
            encrypted = True
        except Exception as exc:
            logger.error("Backup encryption failed: %s", exc)
            raise HTTPException(
                status_code=500,
                detail=f"encryption failed: {exc}",
            )
    else:
        # No master key configured - write plaintext and warn.
        backup_path.write_bytes(raw)
        logger.warning("SECRETS_MASTER_KEY not set - backup written "
                       "UNENCRYPTED to %s", backup_path)
    size_bytes = backup_path.stat().st_size
    result: dict[str, Any] = {
        "local_path": str(backup_path),
        "encrypted": encrypted,
        "size_bytes": size_bytes,
        "size_raw_bytes": size_raw,
        "s3_url": None,
        "s3_error": None,
    }
    # Optional S3 upload.
    bucket = cfg.AWS_S3_BUCKET
    if bucket:
        try:
            import boto3  # type: ignore
            s3 = boto3.client(
                "s3",
                region_name=cfg.AWS_S3_REGION,
                aws_access_key_id=cfg.AWS_ACCESS_KEY_ID or None,
                aws_secret_access_key=cfg.AWS_SECRET_ACCESS_KEY or None,
            )
            key = f"backups/{backup_name}"
            s3.upload_file(str(backup_path), bucket, key)
            result["s3_url"] = f"s3://{bucket}/{key}"
            result["s3_bucket"] = bucket
            result["s3_key"] = key
            logger.info("Backup uploaded to %s", result["s3_url"])
        except ImportError:
            result["s3_error"] = "boto3 not installed - run: pip install boto3"
        except Exception as exc:
            logger.error("S3 upload failed: %s", exc)
            result["s3_error"] = str(exc)
    return result


@app.post("/api/restore",
          tags=["system"],
          summary="Restore DB from uploaded backup",
          responses={200: {"description": "Restored"},
                     401: {"description": "Authentication required"},
                     403: {"description": "Admin role required"}})
@limiter.limit("2/minute")
async def api_restore(request: Request,
                      file: Annotated[UploadFile, File(description="Backup database file")],
                      _auth: dict = Depends(require_admin)) -> dict[str, Any]:
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

@app.get("/api/export/pdf",
         tags=["regulatory"],
         summary="Weekly PDF journal export",
         responses={200: {"description": "PDF file"},
                    401: {"description": "Authentication required"},
                    503: {"description": "reportlab not installed"}})
@limiter.limit("5/minute")
async def api_export_pdf(request: Request,
                         week_start: str,
                         _auth: dict = Depends(require_trader)) -> FileResponse:
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

@app.get("/api/export/tax",
         tags=["regulatory"],
         summary="Tax CSV export (FIFO)",
         description="Returns a CSV of closed trades for the given year. "
                     "Use ``?format=spt`` for the SPT layout with PPh 0.1%.",
         responses={200: {"description": "CSV file"},
                    401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_export_tax(request: Request,
                         year: int,
                         format: str | None = None,
                         broker: str | None = None,
                         npwp: str | None = None,
                         _auth: dict = Depends(require_trader)
                         ) -> StreamingResponse:
    """Return a CSV of closed trades for the given tax year (FIFO).

    Sprint 6 #11: when ``format=spt`` is set, the response uses the SPT
    (Surat Pemberitahuan) layout including PPh Final 0.1% per trade.
    """
    rows = list_trades(limit=10_000, status="closed")
    year_rows = [r for r in rows
                 if r.get("close_time")
                 and r["close_time"][:4] == str(year)]
    # FIFO is implicit because list_trades is ordered by id desc; reverse.
    year_rows = list(reversed(year_rows))

    # Sprint 6 #11: SPT format with PPh 0.1%
    if format and format.lower() == "spt":
        broker_name = broker or settings.mt5.server
        csv_text = format_spt_year(year, year_rows,
                                   broker_name=broker_name,
                                   npwp=npwp)
        fname = f"spt_{year}.csv"
        return StreamingResponse(
            iter([csv_text.encode()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )

    # Default CSV (legacy format)
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

RISK_DISCLOSURE_VERSION = "v2.0-2026"


@app.get("/api/risk-disclosure",
         tags=["regulatory"],
         summary="Risk disclosure text + version",
         responses={200: {"description": "Disclosure text"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_risk_disclosure(request: Request,
                              _auth: dict = Depends(get_api_key)
                              ) -> dict[str, Any]:
    """Return the risk disclosure text + current version (Sprint 6 #9)."""
    return {"text": RISK_DISCLOSURE,
            "current_version": RISK_DISCLOSURE_VERSION}


# ---- Sprint 6 #9: signed risk acknowledgment ----------------------------- #

@app.post("/api/risk-disclosure/acknowledge",
          tags=["regulatory"],
          summary="Acknowledge risk disclosure",
          responses={200: {"description": "Acknowledged"},
                     401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_risk_disclosure_ack(request: Request,
                                  req: RiskAcknowledgmentRequest,
                                  _auth: dict = Depends(require_trader)
                                  ) -> dict[str, Any]:
    """Persist a signed risk-disclosure acknowledgment with timestamp + IP.

    Body: ``{"version": "v2.0-2026"}``.
    """
    ip = (request.client.host if request.client else None)
    ua = request.headers.get("user-agent")
    user = (_auth.get("user") or {})
    user_id = user.get("id") if isinstance(user, dict) else None
    row_id = insert_risk_acknowledgment(
        version=req.version,
        user_id=user_id,
        ip_address=ip,
        user_agent=ua,
    )
    ack = get_latest_risk_acknowledgment(user_id=user_id)
    return {
        "success": True,
        "acknowledgment_id": row_id,
        "acknowledged_at": ack["acknowledged_at"] if ack else None,
        "version": req.version,
        "ip_address": ip,
    }


@app.get("/api/risk-disclosure/status",
         tags=["regulatory"],
         summary="Risk disclosure acknowledgment status",
         responses={200: {"description": "Status dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_risk_disclosure_status(request: Request,
                                     _auth: dict = Depends(get_api_key)
                                     ) -> dict[str, Any]:
    """Return the latest acknowledgment and whether it's still valid
    (must be within the last 30 days)."""
    user = (_auth.get("user") or {})
    user_id = user.get("id") if isinstance(user, dict) else None
    ack = get_latest_risk_acknowledgment(user_id=user_id)
    if ack is None:
        return {"acknowledged": False, "valid": False,
                "current_version": RISK_DISCLOSURE_VERSION}
    ack_dt_str = ack.get("acknowledged_at") or ""
    try:
        ack_dt = datetime.fromisoformat(ack_dt_str.replace("Z", "+00:00"))
        if ack_dt.tzinfo is None:
            ack_dt = ack_dt.replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - ack_dt).days
        valid = age_days <= 30
    except Exception:
        valid = False
        age_days = None
    return {
        "acknowledged": True,
        "valid": valid,
        "age_days": age_days,
        "current_version": RISK_DISCLOSURE_VERSION,
        "acknowledgment": ack,
    }


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 4 #29: Real probes (test buttons)
# --------------------------------------------------------------------------- #

@app.get("/api/test/mt5",
         tags=["system"],
         summary="Probe MT5 connection",
         responses={200: {"description": "Probe result"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_test_mt5(request: Request,
                       _auth: dict = Depends(require_trader)) -> dict[str, Any]:
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


@app.get("/api/test/ollama",
         tags=["system"],
         summary="Probe Ollama daemon",
         responses={200: {"description": "Probe result"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_test_ollama(request: Request,
                          _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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


@app.get("/api/test/tiingo",
         tags=["system"],
         summary="Probe Tiingo API",
         responses={200: {"description": "Probe result"},
                    401: {"description": "Authentication required"}})
@limiter.limit("10/minute")
async def api_test_tiingo(request: Request,
                          _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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

@app.post("/api/notifications/test",
          tags=["system"],
          summary="Send test Telegram message",
          responses={200: {"description": "Sent"},
                     401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_notifications_test(request: Request,
                                 _auth: dict = Depends(require_trader)
                                 ) -> dict[str, Any]:
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

@app.post("/api/backtest",
          tags=["backtest"],
          summary="Run candle backtest",
          responses={200: {"description": "Result dict"},
                     400: {"description": "Invalid request"},
                     401: {"description": "Authentication required"}})
@limiter.limit("2/hour")
async def api_backtest(request: Request,
                       req: BacktestRequest,
                       _auth: dict = Depends(require_trader)) -> dict[str, Any]:
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


@app.get("/api/backtest/results/{result_id}",
         tags=["backtest"],
         summary="Get saved backtest result",
         responses={200: {"description": "Result dict"},
                    404: {"description": "Not found"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_backtest_result(request: Request,
                              result_id: int,
                              _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Retrieve a saved backtest result."""
    row = get_backtest_result(int(result_id))
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


# --------------------------------------------------------------------------- #
# Sprint 7 #15: Monte Carlo + Walk-Forward endpoints
# --------------------------------------------------------------------------- #

@app.post("/api/backtest/monte-carlo",
          tags=["backtest"],
          summary="Monte Carlo bootstrap simulation",
          responses={200: {"description": "MC stats"},
                     401: {"description": "Authentication required"}})
@limiter.limit("5/hour")
async def api_backtest_monte_carlo(request: Request,
                                  req: MonteCarloRequest,
                                  _auth: dict = Depends(require_trader)
                                  ) -> dict[str, Any]:
    """Run a Monte-Carlo bootstrap on the last ``trades_period_days`` days of
    closed trades.

    BACKEND-FIXES-2: response now exposes ``mean_final_balance``,
    ``best_final_balance`` / ``worst_final_balance``, ``blow_ups``,
    ``survival_rate_pct``, plus a ``distribution`` histogram and a ``fan``
    percentile curve so the frontend can render a Monte-Carlo fan chart.
    The legacy ``p5_final`` / ``p95_final`` keys are kept as aliases.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=req.trades_period_days)
    rows = list_trades(limit=5_000, status="closed")
    trades = [r for r in rows
              if r.get("close_time")
              and r["close_time"] >= cutoff.isoformat()]
    mc = MonteCarloEngine(initial_balance=10_000.0, seed=42)
    result = mc.run(trades, iterations=req.iterations,
                    mode=req.mode, noise_std=req.noise_std)
    # Re-run a single deterministic pass to capture per-iteration arrays
    # (the underlying MonteCarloResult dataclass is summary-only).  When
    # trades is empty we can't compute distribution/fan - emit zeros.
    distribution: list[dict[str, Any]] = []
    fan: list[dict[str, Any]] = []
    best = worst = result.median_final_balance
    blow_ups = 0
    surv_pct = result.survival_rate * 100.0
    if trades:
        pnls: list[float] = []
        for t in trades:
            try:
                pnls.append(float(t.get("profit") or t.get("pnl") or 0.0))
            except (TypeError, ValueError):
                continue
        if pnls:
            import random as _rng
            rng = _rng.Random(42)
            finals: list[float] = []
            dds: list[float] = []
            pfs: list[float] = []
            n = len(pnls)
            for _ in range(max(1, int(req.iterations))):
                if req.mode == "return_perturbation" and req.noise_std > 0:
                    sample = [p + rng.gauss(0, req.noise_std) for p in pnls]
                else:
                    sample = [rng.choice(pnls) for _ in range(n)]
                bal = 10_000.0
                peak = bal
                worst_dd = 0.0
                gw = 0.0
                gl = 0.0
                for p in sample:
                    bal += p
                    if bal > peak:
                        peak = bal
                    dd = (bal - peak) / peak if peak > 0 else 0.0
                    if dd < worst_dd:
                        worst_dd = dd
                    if p > 0:
                        gw += p
                    elif p < 0:
                        gl += abs(p)
                finals.append(bal)
                dds.append(abs(worst_dd))
                pfs.append((gw / gl) if gl > 0 else 0.0)
                if bal <= 0:
                    blow_ups += 1
            finals_sorted = sorted(finals)
            dds_sorted = sorted(dds)
            pfs_sorted = sorted(pfs)
            m = len(finals_sorted)
            def _pct(arr: list[float], p: float) -> float:
                if not arr:
                    return 0.0
                idx = int(p * (len(arr) - 1))
                return arr[idx]
            best = finals_sorted[-1] if finals_sorted else result.median_final_balance
            worst = finals_sorted[0] if finals_sorted else result.median_final_balance
            mean_final = (sum(finals) / m) if m else result.median_final_balance
            median_dd = _pct(dds_sorted, 0.5)
            p95_dd = _pct(dds_sorted, 0.95)
            med_pf = _pct(pfs_sorted, 0.5)
            surv_pct = (sum(1 for b in finals if b > 0) / m * 100.0) if m else 100.0
            # ---- Distribution histogram (10 equal buckets between worst and best) ---- #
            if best > worst and m > 0:
                bucket_width = (best - worst) / 10
                if bucket_width > 0:
                    for i in range(10):
                        lo = worst + i * bucket_width
                        hi = lo + bucket_width
                        cnt = sum(1 for b in finals if lo <= b < hi)
                        distribution.append({
                            "bucket": i,
                            "lo": round(lo, 2),
                            "hi": round(hi, 2),
                            "count": cnt,
                        })
            # ---- Fan chart percentiles ---- #
            for p in [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]:
                fan.append({"percentile": int(p * 100),
                            "balance": round(_pct(finals_sorted, p), 2)})
        else:
            mean_final = result.median_final_balance
            median_dd = result.median_max_dd_pct
            p95_dd = result.p95_max_dd_pct
            med_pf = result.median_profit_factor
    else:
        mean_final = result.median_final_balance
        median_dd = result.median_max_dd_pct
        p95_dd = result.p95_max_dd_pct
        med_pf = result.median_profit_factor
    return {
        "id": None,  # MC results are not persisted (compute-only)
        "iterations": result.iterations,
        "median_final_balance": result.median_final_balance,
        "mean_final_balance": round(mean_final, 2),
        "p5_final_balance": result.p5_final,
        "p95_final_balance": result.p95_final,
        "best_final_balance": round(best, 2),
        "worst_final_balance": round(worst, 2),
        "median_max_dd_pct": result.median_max_dd_pct,
        "p95_max_dd_pct": result.p95_max_dd_pct,
        "survival_rate": result.survival_rate,
        "survival_rate_pct": round(surv_pct, 2),
        "blow_ups": blow_ups,
        "median_profit_factor": result.median_profit_factor,
        "median_max_dd_pct_computed": round(median_dd, 4),
        "p95_max_dd_pct_computed": round(p95_dd, 4),
        "median_profit_factor_computed": round(med_pf, 4),
        "trades_used": len(trades),
        "trades_period_days": req.trades_period_days,
        "mode": req.mode,
        "noise_std": req.noise_std,
        "distribution": distribution,
        "fan": fan,
        # Legacy aliases (kept for backward compat with older dashboards).
        "p5_final": result.p5_final,
        "p95_final": result.p95_final,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/backtest/walk-forward",
          tags=["backtest"],
          summary="Walk-forward optimization",
          responses={200: {"description": "WF windows"},
                     401: {"description": "Authentication required"}})
@limiter.limit("5/hour")
async def api_backtest_walk_forward(request: Request,
                                    req: WalkForwardRequest,
                                    _auth: dict = Depends(require_trader)
                                    ) -> dict[str, Any]:
    """Run a rolling walk-forward analysis on closed trades.

    BACKEND-FIXES-2: response now exposes ``stable``, ``verdict``,
    ``total_windows``, ``robust_windows`` and ``computed_at`` so the
    frontend can render a pass/fail badge without recomputing degradation.
    """
    rows = list_trades(limit=5_000, status="closed")
    trades = list(reversed(rows))  # chronological
    wf = WalkForwardAnalyzer(initial_balance=10_000.0)
    result = wf.run(trades,
                    in_sample_window=req.in_sample_window_days,
                    out_sample_window=req.out_sample_window_days)
    windows_list = list(result.windows)
    avg_deg = float(result.avg_degradation_pct)
    stable = avg_deg < 20.0
    verdict = ("Parameters stable"
               if stable else "Parameters unstable")
    robust_windows = sum(1 for w in windows_list
                         if float(w.get("degradation_pct", 100)) < 20.0)
    return {
        "id": None,  # WF results are not persisted (compute-only)
        "windows": windows_list,
        "avg_degradation_pct": avg_deg,
        "stable": stable,
        "verdict": verdict,
        "total_windows": len(windows_list),
        "robust_windows": robust_windows,
        "in_sample_window_days": req.in_sample_window_days,
        "out_sample_window_days": req.out_sample_window_days,
        "trades_used": len(trades),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #
# Audit-fix Sprint 2 #17: Holiday calendar endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/holidays",
         tags=["news"],
         summary="FX market holidays",
         responses={200: {"description": "Holidays list"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_holidays(request: Request,
                       year: int | None = None,
                       _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """List FX market holidays for a given year."""
    from holidays import list_holidays
    return {"year": year, "holidays": list_holidays(year)}


@app.get("/api/news",
         tags=["news"],
         summary="Economic calendar (Tiingo)",
         responses={200: {"description": "Events list"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_news(request: Request,
                   impact: str | None = "HIGH",
                   days_ahead: int = 7,
                   _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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


@app.post("/api/ai/analyze",
          tags=["ai"],
          summary="AI compliance analysis of a setup",
          responses={200: {"description": "Verdict"},
                     503: {"description": "Ollama unavailable"},
                     401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_ai_analyze(request: Request,
                         req: AnalyzeRequest,
                         _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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
        verdict_text = (
            f"{'COMPLIANT' if result.compliant else 'NON-COMPLIANT'} "
            f"— Score: {result.score}/100. {result.suggestion}"
        )
        return {
            "verdict": verdict_text,
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


@app.post("/api/ai/chat",
          tags=["ai"],
          summary="Chat with Ollama",
          responses={200: {"description": "Reply"},
                     503: {"description": "Ollama unavailable"},
                     401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_ai_chat(request: Request,
                      req: ChatRequest,
                      _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
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


@app.get("/api/ai/chat/stream",
         tags=["ai"],
         summary="Streaming chat (SSE)",
         responses={200: {"description": "SSE stream"},
                    401: {"description": "Authentication required"}})
@limiter.limit("5/minute")
async def api_ai_chat_stream(request: Request,
                             message: str,
                             _auth: dict = Depends(get_api_key)) -> StreamingResponse:
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


@app.get("/api/journal",
         tags=["journal"],
         summary="Trade history",
         responses={200: {"description": "Trades list"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_journal(request: Request,
                      limit: int = 100,
                      offset: int = 0,
                      status: str | None = None,
                      _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Trade history from SQLite."""
    rows = list_trades(limit=limit, offset=offset, status=status)
    return {"count": len(rows), "trades": rows}


@app.get("/api/settings",
         tags=["settings"],
         summary="Get all settings",
         responses={200: {"description": "Settings dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("60/minute")
async def api_get_settings(request: Request,
                           _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Get all settings."""
    return {"settings": get_all_settings()}


@app.post("/api/settings",
          tags=["settings"],
          summary="Update settings",
          responses={200: {"description": "Updated"},
                     401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_update_settings(request: Request,
                              req: SettingsUpdate,
                              _auth: dict = Depends(require_trader)
                              ) -> dict[str, Any]:
    """Update settings (key/value pairs).

    BACKEND-FIXES-2: values are coerced to ``str`` so the frontend can submit
    numbers / booleans directly without manual stringification.  The Setting
    table column is ``Text`` so ``str(v)`` is always safe.
    """
    for k, v in req.settings.items():
        set_setting(k, str(v) if not isinstance(v, str) else v)
    return {"ok": True, "settings": get_all_settings()}


@app.get("/api/chart/{symbol}",
         tags=["market-data"],
         summary="Candles + indicators",
         description="Return OHLCV candles plus EMA9/21, VWAP, ATR, ADX, "
                     "RSI, Bollinger Bands and the latest candle pattern.",
         responses={200: {"description": "Chart data"},
                    401: {"description": "Authentication required"},
                    503: {"description": "MT5 unavailable"}})
@limiter.limit("60/minute")
async def api_chart(request: Request,
                    symbol: str,
                    timeframe: str = "M5",
                    count: int = 200,
                    _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Candlestick data + indicators (EMA9/21, VWAP, ATR, ADX, RSI)."""
    # Sprint 5 #8: whitelist validation
    sym = SymbolValidator.validate(symbol)
    mt5_sym = sym
    # Allow caller to use pair name OR mt5 symbol
    if sym in settings.pairs:
        mt5_sym = settings.symbol_for(sym)
    if not MT5_AVAILABLE or not get_connector().connected:
        return {"symbol": symbol, "candles": [], "indicators": {},
                "mt5_connected": False}
    try:
        # Ensure symbol is visible in Market Watch before fetching candles
        try:
            get_connector().ensure_symbol_visible(mt5_sym)
        except Exception as vis_exc:
            logger.warning("ensure_symbol_visible(%s) failed: %s", mt5_sym, vis_exc)
        # Fetch candles — try mt5_sym first, fall back to raw symbol
        try:
            bars = _safe_call(get_connector().get_candles, mt5_sym, timeframe, count)
        except Exception:
            # Retry with raw symbol name (broker might use different naming)
            logger.info("Retrying candles with raw symbol %s", symbol)
            try:
                get_connector().ensure_symbol_visible(symbol)
            except Exception:
                pass
            bars = _safe_call(get_connector().get_candles, symbol, timeframe, count)
        candles = [Candle(time=b.time, open=b.open, high=b.high, low=b.low,
                          close=b.close, volume=b.volume, day=b.day)
                   for b in bars]
        # Handle empty candles gracefully
        if not candles:
            return {
                "symbol": symbol,
                "mt5_symbol": mt5_sym,
                "timeframe": timeframe,
                "count": 0,
                "candles": [],
                "indicators": {
                    "ema9": [], "ema21": [], "vwap": 0, "atr": 0,
                    "atr_pips": None,
                    "adx": {"adx": 0, "plus_di": 0, "minus_di": 0},
                    "rsi": 50,
                    "bollinger": {"upper": 0, "middle": 0, "lower": 0},
                    "pattern": None,
                },
                "mt5_connected": True,
                "error": "No candles returned from MT5",
            }
        closes = [c.close for c in candles]
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        # Wrap each indicator in try/except for robustness
        try:
            ema9_series = ema_series(closes, 9)
        except Exception:
            ema9_series = [closes[-1]] * len(closes) if closes else []
        try:
            ema21_series = ema_series(closes, 21)
        except Exception:
            ema21_series = [closes[-1]] * len(closes) if closes else []
        try:
            vwap_val = vwap(candles)
        except Exception:
            vwap_val = closes[-1] if closes else 0
        try:
            atr_val = atr(highs, lows, closes, period=14)
        except Exception:
            atr_val = 0
        try:
            adx_result = adx(highs, lows, closes, period=14)
        except Exception:
            from collections import namedtuple
            ADXFallback = namedtuple("ADXFallback", ["adx", "plus_di", "minus_di"])
            adx_result = ADXFallback(adx=0, plus_di=0, minus_di=0)
        try:
            rsi_val = rsi(closes, period=14)
        except Exception:
            rsi_val = 50
        try:
            bb = bollinger_bands(closes, period=20, std=2.0)
        except Exception:
            from collections import namedtuple
            BBFallback = namedtuple("BBFallback", ["upper", "middle", "lower"])
            bb = BBFallback(upper=closes[-1], middle=closes[-1], lower=closes[-1])
        try:
            pattern = candle_pattern_detection(candles) if candles else None
        except Exception:
            pattern = None
        # Pip size for ATR pips conversion
        atr_pips = None
        try:
            if MT5_AVAILABLE and get_connector().connected:
                si = get_connector().get_symbol_info(mt5_sym)
                if si and si.pip_size:
                    atr_pips = atr_val / si.pip_size
        except Exception:
            atr_pips = None
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
                "atr_pips": atr_pips,
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
        logger.error("Chart endpoint failed for %s: %s", symbol, exc, exc_info=True)
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

    Sprint 5 #1: WebSocket authentication - if ``API_KEYS`` env is set, the
    client MUST pass ``?token=<key>`` as a query parameter.  When auth is
    disabled (dev mode), the connection is accepted unconditionally.
    """
    # ---- Sprint 5 #1: token-based WS auth ---- #
    auth = get_auth()
    if auth.enabled:
        token = ws.query_params.get("token")
        ctx = auth.verify_websocket_token(token)
        if not ctx.get("authenticated"):
            await ws.close(code=4401)  # custom close code: unauthorized
            return
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
# Sprint 5 #6: auth login + me endpoints
# --------------------------------------------------------------------------- #

@app.post("/api/auth/login",
          tags=["auth"],
          summary="Login (exchange credentials for API key)",
          responses={200: {"description": "API key"},
                     401: {"description": "Invalid credentials"}})
@limiter.limit("10/minute")
async def api_auth_login(request: Request,
                         req: LoginRequest) -> dict[str, Any]:
    """Exchange username + password for an API key (session token).

    The API key is persisted on the user row so subsequent Bearer requests
    authenticate as that user.  No JWT / NextAuth integration is done here
    - the frontend may wrap this in its own session cookie if desired.
    """
    res = auth_login(req.username, req.password)
    if not res.ok:
        raise HTTPException(status_code=401, detail={"ok": False,
                                                     "message": res.message})
    # Return format matching frontend AuthLoginResponse type:
    # {ok, api_key, expires_at, user: {username, role}, message}
    return {
        "ok": True,
        "api_key": res.api_key,
        "expires_at": None,
        "user": {
            "username": res.username,
            "role": res.role.lower() if res.role else "viewer",
        },
        "username": res.username,
        "role": res.role,
        "message": res.message,
    }


@app.get("/api/auth/me",
         tags=["auth"],
         summary="Current user info",
         responses={200: {"description": "User dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_auth_me(request: Request,
                      _auth: dict = Depends(get_api_key)) -> dict[str, Any]:
    """Return the current user info derived from the API key."""
    user = _auth.get("user") or {}
    return {
        "authenticated": True,
        "auth_disabled": _auth.get("auth_disabled", False),
        "user": {
            "username": user.get("username"),
            "role": user.get("role", "VIEWER"),
            "id": user.get("id"),
        },
    }


# --------------------------------------------------------------------------- #
# Sprint 5 #3: secrets CRUD endpoints (admin only)
# --------------------------------------------------------------------------- #

@app.get("/api/secrets",
         tags=["auth"],
         summary="List stored secret names",
         responses={200: {"description": "Names list"},
                    401: {"description": "Authentication required"},
                    403: {"description": "Admin role required"}})
@limiter.limit("30/minute")
async def api_list_secrets(request: Request,
                           _auth: dict = Depends(require_admin)
                           ) -> dict[str, Any]:
    """List all stored secret names (values are NOT returned)."""
    sm = get_secret_manager()
    names = sm.list_secret_names()
    return {"count": len(names), "names": names,
            "encryption_enabled": sm.enabled}


@app.get("/api/secrets/{name}",
         tags=["auth"],
         summary="Get secret value",
         responses={200: {"description": "Secret value"},
                    404: {"description": "Not found"},
                    401: {"description": "Authentication required"},
                    403: {"description": "Admin role required"}})
@limiter.limit("30/minute")
async def api_get_secret(request: Request,
                         name: str,
                         _auth: dict = Depends(require_admin)
                         ) -> dict[str, Any]:
    """Return the decrypted value of a stored secret (admin only)."""
    sm = get_secret_manager()
    val = sm.get_secret(name)
    if val is None:
        raise HTTPException(status_code=404, detail=f"secret '{name}' not found")
    return {"name": name, "value": val}


@app.post("/api/secrets/{name}",
          tags=["auth"],
          summary="Store (encrypt) a secret",
          responses={200: {"description": "Stored"},
                     401: {"description": "Authentication required"},
                     403: {"description": "Admin role required"}})
@limiter.limit("10/minute")
async def api_store_secret(request: Request,
                           name: str,
                           req: SecretStoreRequest,
                           _auth: dict = Depends(require_admin)
                           ) -> dict[str, Any]:
    """Store (encrypt) a secret value under ``name``."""
    sm = get_secret_manager()
    sm.store_secret(name, req.value)
    return {"ok": True, "name": name, "encryption_enabled": sm.enabled}


@app.delete("/api/secrets/{name}",
           tags=["auth"],
           summary="Delete a secret",
           responses={200: {"description": "Deleted"},
                      401: {"description": "Authentication required"},
                      403: {"description": "Admin role required"}})
@limiter.limit("10/minute")
async def api_delete_secret(request: Request,
                            name: str,
                            _auth: dict = Depends(require_admin)
                            ) -> dict[str, Any]:
    """Delete a stored secret."""
    sm = get_secret_manager()
    deleted = sm.delete_secret(name)
    return {"ok": deleted, "name": name}


# --------------------------------------------------------------------------- #
# BACKEND-FIXES-2: missing routes (API keys, services status, encryption,
# change-password, price alerts CRUD, stress-test scenarios)
# --------------------------------------------------------------------------- #

@app.get("/api/auth/keys",
         tags=["auth"],
         summary="List API keys (admin only)",
         description="Return all user rows with a masked API key preview "
                     "(first 8 chars only).  Full keys are never exposed - "
                     "use ``POST /api/auth/keys`` to mint a new key or "
                     "``DELETE /api/auth/keys/{id}`` to revoke one "
                     "(BACKEND-FIXES-2).",
         responses={
             200: {"description": "API keys list"},
             401: {"description": "Authentication required"},
             403: {"description": "Admin role required"},
         })
@limiter.limit("10/minute")
async def api_list_api_keys(request: Request,
                            _auth: dict = Depends(require_admin)
                            ) -> dict[str, Any]:
    """List API keys (without exposing the full key)."""
    users = list_users()
    keys: list[dict[str, Any]] = []
    for u in users:
        api_key = u.get("api_key") or ""
        preview = (api_key[:8] + "...") if len(api_key) > 8 else (api_key or "—")
        keys.append({
            "id": u.get("id"),
            "username": u.get("username"),
            "role": (u.get("role") or "VIEWER"),
            "api_key_preview": preview,
            "created_at": u.get("created_at"),
            "updated_at": u.get("updated_at"),
        })
    return {"keys": keys, "count": len(keys)}


@app.post("/api/auth/keys",
          tags=["auth"],
          summary="Create a new API key (admin only)",
          description="Generate a new opaque API key (``sk_<32-byte hex>``) "
                      "for a user.  Body: ``{username, role}``.  If the "
                      "username already exists, a fresh key is minted and "
                      "the existing row's ``api_key`` is replaced "
                      "(BACKEND-FIXES-2).",
          responses={
              200: {"description": "API key created"},
              400: {"description": "Invalid request body"},
              401: {"description": "Authentication required"},
              403: {"description": "Admin role required"},
          })
@limiter.limit("10/minute")
async def api_create_api_key(request: Request,
                             body: dict = Body(...),
                             _auth: dict = Depends(require_admin)
                             ) -> dict[str, Any]:
    """Generate a new API key for a user.

    Accepts ``{username: str, role: str}`` and returns the freshly minted
    ``api_key`` plus the username.  The role is normalised to one of
    ``VIEWER`` / ``TRADER`` / ``ADMIN`` (default: ``VIEWER``).
    """
    username = str(body.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=400,
                            detail="body.username is required")
    role = str(body.get("role") or "VIEWER").strip().upper()
    if role not in ("VIEWER", "TRADER", "ADMIN"):
        raise HTTPException(
            status_code=400,
            detail=f"role must be one of VIEWER/TRADER/ADMIN (got '{role}')",
        )
    new_key = generate_api_key()
    existing = get_user_by_username(username)
    if existing is None:
        # Create new user with random password (admin must call
        # /api/auth/change-password later to set a known password).
        from database import create_user, UserRole as _UR
        role_const = (_UR.ADMIN if role == "ADMIN"
                      else _UR.TRADER if role == "TRADER"
                      else _UR.VIEWER)
        # Use a placeholder hash (cannot login with it) - admin must reset.
        placeholder_hash = hash_password(_secrets_token())
        create_user(username=username,
                    password_hash=placeholder_hash,
                    role=role_const,
                    api_key=new_key)
        user_id = None
    else:
        from database import update_user_api_key
        user_id = int(existing.get("id") or 0)
        if user_id:
            update_user_api_key(user_id, new_key)
    return {
        "ok": True,
        "api_key": new_key,
        "username": username,
        "role": role,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@app.delete("/api/auth/keys/{key_id}",
           tags=["auth"],
           summary="Revoke an API key (admin only)",
           description="Delete the user row identified by ``key_id`` (the "
                       "``id`` returned by ``GET /api/auth/keys``).  This "
                       "revokes the API key immediately - any subsequent "
                       "Bearer request with that key is rejected "
                       "(BACKEND-FIXES-2).",
           responses={
               200: {"description": "Key revoked"},
               404: {"description": "key_id not found"},
               401: {"description": "Authentication required"},
               403: {"description": "Admin role required"},
           })
@limiter.limit("10/minute")
async def api_revoke_api_key(key_id: int,
                             request: Request,
                             _auth: dict = Depends(require_admin)
                             ) -> dict[str, Any]:
    """Revoke (delete) an API key / user row."""
    ok = delete_user(int(key_id))
    if not ok:
        raise HTTPException(status_code=404,
                            detail=f"key_id {key_id} not found")
    return {"ok": True, "revoked": int(key_id)}


@app.post("/api/auth/change-password",
          tags=["auth"],
          summary="Change the current user's password",
          description="Verify the current password, then update the hash "
                      "with the new password.  Body: "
                      "``{current_password, new_password}``.  When auth is "
                      "disabled (dev mode) the route still requires a "
                      "valid username in the body (``username``) so the "
                      "right row is updated (BACKEND-FIXES-2).",
          responses={
              200: {"description": "Password updated"},
              400: {"description": "Invalid body / new password too short"},
              401: {"description": "Authentication required / bad current pw"},
              404: {"description": "User not found"},
          })
@limiter.limit("5/minute")
async def api_change_password(request: Request,
                              body: dict = Body(...),
                              _auth: dict = Depends(get_api_key)
                              ) -> dict[str, Any]:
    """Change the current user's password.

    The caller must supply ``current_password`` + ``new_password``.  If
    auth is disabled (no Bearer token), the body must also include
    ``username`` so the route knows which row to update.
    """
    current_password = str(body.get("current_password") or "")
    new_password = str(body.get("new_password") or "")
    if not new_password or len(new_password) < 8:
        raise HTTPException(
            status_code=400,
            detail="new_password is required and must be >= 8 characters",
        )
    # Resolve the target user.
    user = None
    auth_user = _auth.get("user") if isinstance(_auth, dict) else None
    if auth_user and isinstance(auth_user, dict) and auth_user.get("username"):
        target_username = auth_user.get("username")
        user = get_user_by_username(target_username)
    else:
        # auth disabled (dev mode) -> must include username in body
        target_username = str(body.get("username") or "").strip()
        if not target_username:
            raise HTTPException(
                status_code=400,
                detail="username is required when auth is disabled",
            )
        user = get_user_by_username(target_username)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    # Verify the current password.  When auth is disabled (dev mode), the
    # caller is implicitly trusted (no Bearer token) and the current
    # password check is skipped so an admin can recover a forgotten
    # password locally.  In production (auth enabled), the current
    # password must match the stored bcrypt hash.
    if not _auth.get("auth_disabled"):
        if not verify_password(current_password, user.get("password_hash", "")):
            raise HTTPException(
                status_code=401,
                detail="current_password is incorrect",
            )
    new_hash = hash_password(new_password)
    ok = update_user_password(int(user["id"]), new_hash)
    return {
        "ok": bool(ok),
        "message": "Password updated" if ok else "Failed to update password",
        "username": user.get("username"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/services/status",
         tags=["system"],
         summary="Service status (MT5 / Ollama / Tiingo / DB / Disk)",
         description="Return the status of every external dependency the "
                     "backend relies on.  Each entry includes ``status`` "
                     "(ok/error/warn), ``latency_ms`` and a ``detail`` "
                     "string for diagnostics (BACKEND-FIXES-2).",
         responses={
             200: {"description": "Service status list"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_services_status(request: Request,
                              _auth: dict = Depends(get_api_key)
                              ) -> dict[str, Any]:
    """Return the status of all backend dependencies."""
    services: list[dict[str, Any]] = []
    checked_at = datetime.now(timezone.utc).isoformat()
    # ---- MT5 ---- #
    t0 = asyncio.get_event_loop().time()
    mt5_ok = MT5_AVAILABLE and bool(get_connector().connected)
    mt5_latency = round((asyncio.get_event_loop().time() - t0) * 1000.0, 2)
    mt5_detail = "disconnected"
    if mt5_ok:
        try:
            mt5_detail = f"connected: {settings.mt5.server}"
        except Exception:
            mt5_detail = "connected"
    elif not MT5_AVAILABLE:
        mt5_detail = "MetaTrader5 package not installed"
    services.append({
        "name": "mt5",
        "status": "ok" if mt5_ok else "error",
        "latency_ms": mt5_latency,
        "detail": mt5_detail,
    })
    # ---- Ollama ---- #
    t0 = asyncio.get_event_loop().time()
    ollama_ok = False
    ollama_detail = "unavailable"
    try:
        analyzer = get_analyzer()
        ollama_ok = await analyzer.is_available()
        if ollama_ok:
            ollama_detail = f"model {settings.ollama.model} ready"
        else:
            ollama_detail = (f"model '{settings.ollama.model}' not found "
                             f"at {settings.ollama.base_url}")
    except Exception as exc:
        ollama_detail = f"error: {exc}"
    ollama_latency = round((asyncio.get_event_loop().time() - t0) * 1000.0, 2)
    services.append({
        "name": "ollama",
        "status": "ok" if ollama_ok else "error",
        "latency_ms": ollama_latency,
        "detail": ollama_detail,
    })
    # ---- Tiingo ---- #
    t0 = asyncio.get_event_loop().time()
    tiingo_ok = False
    tiingo_detail = "no API key configured"
    if settings.tiingo.api_key:
        try:
            cal = get_calendar()
            events = await cal.fetch_calendar(days_ahead=1, impact="HIGH")
            tiingo_ok = True
            tiingo_detail = f"ok ({len(events)} HIGH events cached)"
        except Exception as exc:
            tiingo_detail = f"error: {exc}"
    tiingo_latency = round((asyncio.get_event_loop().time() - t0) * 1000.0, 2)
    services.append({
        "name": "tiingo",
        "status": "ok" if tiingo_ok else ("warn" if settings.tiingo.api_key else "error"),
        "latency_ms": tiingo_latency,
        "detail": tiingo_detail,
    })
    # ---- DB ---- #
    t0 = asyncio.get_event_loop().time()
    db_ok = False
    db_detail = "unknown"
    try:
        get_db()
        # Quick sanity probe.
        list_trades(limit=1)
        db_ok = True
        db_detail = "ok"
    except Exception as exc:
        db_detail = f"error: {exc}"
    db_latency = round((asyncio.get_event_loop().time() - t0) * 1000.0, 2)
    services.append({
        "name": "db",
        "status": "ok" if db_ok else "error",
        "latency_ms": db_latency,
        "detail": db_detail,
    })
    # ---- Disk ---- #
    disk_ok = False
    disk_detail = "unknown"
    try:
        import os as _os
        du = shutil.disk_usage(_os.getcwd())
        free_gb = du.free / (1024 ** 3)
        disk_ok = free_gb > 1.0
        disk_detail = (f"used {du.used / (1024 ** 3):.1f} GB / "
                       f"total {du.total / (1024 ** 3):.1f} GB "
                       f"(free {free_gb:.1f} GB)")
    except Exception as exc:
        disk_detail = f"error: {exc}"
    services.append({
        "name": "disk",
        "status": "ok" if disk_ok else "warn",
        "latency_ms": 0.0,
        "detail": disk_detail,
    })
    overall_ok = all(s["status"] == "ok" for s in services)
    return {
        "services": services,
        "checked_at": checked_at,
        "overall_ok": overall_ok,
        "count": len(services),
    }


@app.get("/api/security/encryption-status",
         tags=["auth"],
         summary="Encryption-at-rest status (SQLCipher)",
         description="Return whether SQLCipher is enabled for the SQLite DB, "
                     "the cipher / KDF parameters in use, and the last "
                     "verification timestamp (BACKEND-FIXES-2).",
         responses={
             200: {"description": "Encryption status dict"},
             401: {"description": "Authentication required"},
             403: {"description": "Admin role required"},
         })
@limiter.limit("10/minute")
async def api_encryption_status(request: Request,
                                _auth: dict = Depends(require_admin)
                                ) -> dict[str, Any]:
    """Return the SQLCipher encryption-at-rest status."""
    try:
        from database import _SQLCIPHER_AVAILABLE  # local import (cycle-safe)
    except Exception:  # pragma: no cover
        _SQLCIPHER_AVAILABLE = False  # type: ignore[assignment]
    return {
        "enabled": bool(_SQLCIPHER_AVAILABLE and cfg.DB_ENCRYPTION_KEY),
        "sqlcipher_available": bool(_SQLCIPHER_AVAILABLE),
        "key_configured": bool(cfg.DB_ENCRYPTION_KEY),
        "cipher": "AES-256-CBC" if _SQLCIPHER_AVAILABLE else "none",
        "kdf_iters": 64_000,
        "page_size": 1024,
        "tested_at": datetime.now(timezone.utc).isoformat(),
    }


# ---- Price alerts CRUD (in-process + DB-backed via settings table) ------- #

_ALERTS_SETTING_KEY = "price_alerts"


def _load_alerts() -> list[dict[str, Any]]:
    """Load persisted price alerts from the settings table.

    Stored as a JSON string under the ``price_alerts`` key.  Returns ``[]``
    when the key is missing or the JSON is malformed.
    """
    raw = get_setting(_ALERTS_SETTING_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def _save_alerts(alerts: list[dict[str, Any]]) -> None:
    """Persist the alerts list as JSON under the ``price_alerts`` key."""
    set_setting(_ALERTS_SETTING_KEY, json.dumps(alerts, default=str))


def _next_alert_id(alerts: list[dict[str, Any]]) -> int:
    """Return the next monotonic alert id (1-indexed)."""
    if not alerts:
        return 1
    return (max(int(a.get("id") or 0) for a in alerts) + 1)


@app.get("/api/alerts",
         tags=["system"],
         summary="List price alerts",
         description="Return all persisted price alerts (JSON stored under "
                     "the ``price_alerts`` setting key).  Each alert has "
                     "``id``, ``symbol``, ``direction``, ``price``, "
                     "``note``, ``created_at`` (BACKEND-FIXES-2).",
         responses={
             200: {"description": "Alerts list"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_list_alerts(request: Request,
                          _auth: dict = Depends(get_api_key)
                          ) -> dict[str, Any]:
    """List all price alerts."""
    alerts = _load_alerts()
    return {"alerts": alerts, "count": len(alerts)}


@app.post("/api/alerts",
          tags=["system"],
          summary="Create a price alert",
          description="Persist a new price alert.  Body should contain at "
                      "least ``symbol`` + ``price``; optional ``direction`` "
                      "(above/below), ``note``, ``channel`` "
                      "(telegram/email).  Returns the freshly assigned id "
                      "(BACKEND-FIXES-2).",
          responses={
              200: {"description": "Alert created"},
              400: {"description": "Invalid body"},
              401: {"description": "Authentication required"},
          })
@limiter.limit("30/minute")
async def api_create_alert(request: Request,
                           body: dict = Body(...),
                           _auth: dict = Depends(get_api_key)
                           ) -> dict[str, Any]:
    """Create a new price alert."""
    symbol = str(body.get("symbol") or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=400,
                            detail="body.symbol is required")
    try:
        price = float(body.get("price"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400,
                            detail="body.price must be a number")
    alerts = _load_alerts()
    new_id = _next_alert_id(alerts)
    alert = {
        "id": new_id,
        "symbol": symbol,
        "direction": str(body.get("direction") or "above").lower(),
        "price": price,
        "note": str(body.get("note") or ""),
        "channel": str(body.get("channel") or "telegram"),
        "active": bool(body.get("active", True)),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": (_auth.get("user") or {}).get("username")
        if isinstance(_auth, dict) else None,
    }
    alerts.append(alert)
    _save_alerts(alerts)
    return {"ok": True, "alert": alert, "id": new_id}


@app.delete("/api/alerts/{alert_id}",
           tags=["system"],
           summary="Delete a price alert",
           responses={
               200: {"description": "Alert deleted"},
               404: {"description": "alert_id not found"},
               401: {"description": "Authentication required"},
           })
@limiter.limit("30/minute")
async def api_delete_alert(alert_id: int,
                           request: Request,
                           _auth: dict = Depends(get_api_key)
                           ) -> dict[str, Any]:
    """Delete a price alert by id."""
    alerts = _load_alerts()
    new_list = [a for a in alerts if int(a.get("id") or 0) != int(alert_id)]
    if len(new_list) == len(alerts):
        raise HTTPException(status_code=404,
                            detail=f"alert {alert_id} not found")
    _save_alerts(new_list)
    return {"ok": True, "deleted": int(alert_id)}


@app.post("/api/alerts/{alert_id}/test",
          tags=["system"],
          summary="Test-fire a price alert",
          description="Send a test notification via the configured channel "
                      "(Telegram by default) to verify the alert wiring "
                      "without waiting for the price trigger "
                      "(BACKEND-FIXES-2).",
          responses={
              200: {"description": "Test fired"},
              404: {"description": "alert_id not found"},
              401: {"description": "Authentication required"},
          })
@limiter.limit("10/minute")
async def api_test_alert(alert_id: int,
                         request: Request,
                         _auth: dict = Depends(get_api_key)
                         ) -> dict[str, Any]:
    """Send a test notification for a price alert."""
    alerts = _load_alerts()
    alert = next((a for a in alerts
                  if int(a.get("id") or 0) == int(alert_id)), None)
    if alert is None:
        raise HTTPException(status_code=404,
                            detail=f"alert {alert_id} not found")
    triggered = False
    message = ""
    try:
        mgr = get_notification_manager()
        if mgr.enabled:
            await mgr.send_alert(
                f"🔔 TEST alert #{alert['id']} for {alert['symbol']} "
                f"({alert.get('direction', 'above')} {alert['price']}): "
                f"{alert.get('note') or '(no note)'}"
            )
            triggered = True
            message = "Alert test sent via Telegram"
        else:
            message = ("Telegram not configured - alert logged only "
                       "(TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID empty)")
    except Exception as exc:
        message = f"Alert test failed: {exc}"
    return {
        "ok": True,
        "triggered": triggered,
        "message": message,
        "alert": alert,
    }


@app.get("/api/analytics/stress-test/scenarios",
         tags=["analytics"],
         summary="List available stress-test scenarios",
         description="Return the catalogue of historical stress scenarios "
                     "(SNB_UNPEG_2015, BREXIT_2016, COVID_CRASH_2020, "
                     "GFC_2008) with their multipliers, n_worst and "
                     "descriptions so the frontend can render a picker "
                     "(BACKEND-FIXES-2).",
         responses={
             200: {"description": "Scenario list"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_list_stress_scenarios(request: Request,
                                    _auth: dict = Depends(get_api_key)
                                    ) -> dict[str, Any]:
    """Return the catalogue of stress-test scenarios."""
    scenarios: list[dict[str, Any]] = [
        {"id": k, "name": k, **v} for k, v in STRESS_SCENARIOS.items()
    ]
    return {
        "scenarios": scenarios,
        "count": len(scenarios),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def _secrets_token() -> str:
    """Generate a random opaque token (used as a placeholder password).

    Imported lazily here so the route module doesn't pay for ``secrets``
    import unless the route is actually called.
    """
    import secrets as _s
    return _s.token_urlsafe(24)


# --------------------------------------------------------------------------- #
# Sprint 6 #11: BAPPEBTI compliance + regulatory status
# --------------------------------------------------------------------------- #

@app.get("/api/regulatory/bappebti-status",
         tags=["regulatory"],
         summary="BAPPEBTI compliance status",
         responses={200: {"description": "Compliance dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_bappebti_status(request: Request,
                              broker: str | None = None,
                              _auth: dict = Depends(get_api_key)
                              ) -> dict[str, Any]:
    """Return BAPPEBTI compliance checklist + broker registration check."""
    broker_name = broker or settings.mt5.server
    return check_bappebti_compliance(broker_name)


# --------------------------------------------------------------------------- #
# Sprint 6 #12: trade reconstruction endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/trade/{trade_id}/reconstruct",
         tags=["journal"],
         summary="Trade event timeline reconstruction",
         responses={200: {"description": "Events timeline"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_trade_reconstruct(request: Request,
                                trade_id: int,
                                _auth: dict = Depends(get_api_key)
                                ) -> dict[str, Any]:
    """Return the full tick-level event timeline for a trade."""
    events = list_trade_events(int(trade_id))
    return {"count": len(events), "trade_id": int(trade_id), "events": events}


# --------------------------------------------------------------------------- #
# Sprint 7 #13: VaR + CVaR endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/var",
         tags=["analytics"],
         summary="Value-at-Risk + CVaR",
         responses={200: {"description": "VaR/CVaR dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_var(request: Request,
                            confidence: float = 0.95,
                            days: int = 30,
                            _auth: dict = Depends(get_api_key)
                            ) -> dict[str, Any]:
    """Return VaR + CVaR for the trailing ``days`` days of trades.

    BACKEND-FIXES-2: response now exposes ``var_95`` / ``var_99`` /
    ``cvar_95`` / ``cvar_99`` as flat keys (instead of nested ``var`` /
    ``cvar`` dicts) so the frontend can read them directly.  The
    ``confidence`` query param defaults to 0.95; both 95% and 99% are
    always computed.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = list_trades(limit=5_000, status="closed")
    recent = [r for r in rows
              if r.get("close_time")
              and r["close_time"] >= cutoff.isoformat()]
    returns = get_returns_from_trades(recent)
    var_95_res = calculate_var(returns, confidence=0.95, method="historical")
    var_99_res = calculate_var(returns, confidence=0.99, method="historical")
    cvar_95_res = calculate_cvar(returns, confidence=0.95)
    cvar_99_res = calculate_cvar(returns, confidence=0.99)
    return {
        "var_95": var_95_res.get("var_value", 0.0),
        "var_99": var_99_res.get("var_value", 0.0),
        "cvar_95": cvar_95_res.get("cvar_value", 0.0),
        "cvar_99": cvar_99_res.get("cvar_value", 0.0),
        # Backward-compatible nested dicts (legacy clients).
        "var": var_95_res,
        "cvar": cvar_95_res,
        "confidence": confidence,
        "method": "historical",
        "period_days": days,
        "sample_size": len(returns),
        "currency": "USD",
        "trades_used": len(recent),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #
# Sprint 7 #14: stress test endpoints
# --------------------------------------------------------------------------- #

@app.post("/api/analytics/stress-test",
          tags=["analytics"],
          summary="Run all 4 stress scenarios",
          responses={200: {"description": "Results"},
                     401: {"description": "Authentication required"}})
@limiter.limit("5/hour")
async def api_analytics_stress_test(request: Request,
                                    req: StressTestRequest,
                                    _auth: dict = Depends(require_trader)
                                    ) -> dict[str, Any]:
    """Run all 4 stress scenarios on the trailing ``trades_period_days``
    days of closed trades.  Returns + persists the results."""
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=req.trades_period_days))
    rows = list_trades(limit=5_000, status="closed")
    trades = [r for r in rows
              if r.get("close_time")
              and r["close_time"] >= cutoff.isoformat()]
    tester = StressTester()
    results = tester.run_all_scenarios(trades, req.balance)
    result_id = insert_stress_test_result(
        trades_period_days=req.trades_period_days,
        balance=req.balance,
        results=results,
    )
    return {"id": result_id, "results": results,
            "trades_used": len(trades)}


@app.get("/api/analytics/stress-test/results/{result_id}",
         tags=["analytics"],
         summary="Get saved stress-test result",
         responses={200: {"description": "Result"},
                    404: {"description": "Not found"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_stress_test_result(request: Request,
                                 result_id: int,
                                 _auth: dict = Depends(get_api_key)
                                 ) -> dict[str, Any]:
    """Retrieve a saved stress-test result."""
    row = get_stress_test_result(int(result_id))
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


# --------------------------------------------------------------------------- #
# Sprint 7 #16: Kelly criterion endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/kelly",
         tags=["analytics"],
         summary="Kelly criterion stats",
         responses={200: {"description": "Kelly dict"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_kelly(request: Request,
                              balance: float = 10_000.0,
                              _auth: dict = Depends(get_api_key)
                              ) -> dict[str, Any]:
    """Return Kelly criterion stats from the most recent 200 closed trades.

    BACKEND-FIXES-2: response now includes ``f_quarter_kelly``,
    ``current_risk_pct``, ``recommended_risk_pct``, ``use_kelly`` and a
    human-readable ``note`` so the frontend can render the recommendation
    badge (``Quarter-Kelly`` / ``Fixed 1%``) without re-deriving it.
    """
    trades = list_trades(limit=200, status="closed")
    sizer = KellySizer()
    res = sizer.calculate_from_history(trades, balance=balance)
    mode = cfg.POSITION_SIZING_MODE
    use_kelly = bool(mode == "kelly")
    return {
        "f_kelly": res.f_kelly,
        "f_actual": res.f_actual,
        "f_quarter_kelly": res.f_kelly * 0.25,
        "risk_pct": res.risk_pct,
        "current_risk_pct": res.risk_pct,
        "recommended_risk_pct": res.risk_pct,
        "recommended_lot": res.recommended_lot,
        "win_rate": res.win_rate,
        "avg_win": res.avg_win,
        "avg_loss": res.avg_loss,
        "sample_trades": len(trades),
        "trades_used": len(trades),
        "use_kelly": use_kelly,
        "mode": mode,
        "note": ("Quarter-Kelly applied for safety. Cap at 2%."
                 if use_kelly else
                 "Fixed 1% risk per trade (Kelly disabled in config)."),
    }


# --------------------------------------------------------------------------- #
# Sprint 7 #17: slippage + latency analytics
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/slippage",
         tags=["analytics"],
         summary="Slippage stats per symbol",
         responses={200: {"description": "Slippage stats"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_slippage(request: Request,
                                 days: int = 30,
                                 _auth: dict = Depends(get_api_key)
                                 ) -> dict[str, Any]:
    """Return slippage stats per symbol for the last ``days`` days.

    BACKEND-FIXES-2: response now includes aggregate ``avg_slippage_pips``
    + ``p50_pips`` / ``p95_pips`` / ``p99_pips`` / ``worst_pips`` and a
    ``time_series`` array (one entry per trade) so the frontend can chart
    slippage over time.  An ``alert`` flag is raised when p95 > 3 pips.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = list_trades(limit=5_000)
    recent = [r for r in rows
              if r.get("open_time")
              and r["open_time"] >= cutoff.isoformat()
              and r.get("slippage_actual") is not None]
    # Group by symbol
    by_symbol: dict[str, list[float]] = {}
    for r in recent:
        s = r.get("symbol", "_unknown")
        by_symbol.setdefault(s, []).append(float(r["slippage_actual"]))
    out: dict[str, dict[str, Any]] = {}
    for s, vals in by_symbol.items():
        vals_sorted = sorted(vals)
        n = len(vals_sorted)
        def _pct(p: float) -> float:
            if n == 0:
                return 0.0
            idx = int(p * (n - 1))
            return vals_sorted[idx]
        out[s] = {
            "samples": n,
            "p50": round(_pct(0.5), 4),
            "p95": round(_pct(0.95), 4),
            "p99": round(_pct(0.99), 4),
            "mean": round(sum(vals) / n, 4) if n else 0.0,
            "worst": round(min(vals), 4) if vals else 0.0,
        }
    # ---- Aggregate stats across all symbols ---- #
    all_vals: list[float] = []
    for r in recent:
        try:
            all_vals.append(float(r["slippage_actual"]))
        except (TypeError, ValueError):
            continue
    all_vals_sorted = sorted(all_vals)
    n_total = len(all_vals_sorted)
    def _agg_pct(p: float) -> float:
        if n_total == 0:
            return 0.0
        idx = int(p * (n_total - 1))
        return all_vals_sorted[idx]
    avg = (sum(all_vals) / n_total) if n_total else 0.0
    p50 = _agg_pct(0.5)
    p95 = _agg_pct(0.95)
    p99 = _agg_pct(0.99)
    worst = min(all_vals) if all_vals else 0.0
    threshold_pips = 3.0
    # ---- Time series (one entry per trade, chronological) ---- #
    time_series: list[dict[str, Any]] = [
        {
            "trade_id": r.get("id"),
            "ticket": r.get("ticket"),
            "symbol": r.get("symbol"),
            "open_time": r.get("open_time"),
            "slippage_pips": float(r["slippage_actual"]),
        }
        for r in sorted(recent, key=lambda x: x.get("open_time") or "")
    ]
    # Trigger Telegram alert if p95 slippage breaches the threshold.
    if p95 > threshold_pips:
        try:
            mgr = get_notification_manager()
            if mgr.enabled:
                await mgr.send_alert(
                    f"⚠️ Slippage p95 = {p95:.2f} pips "
                    f"(>{threshold_pips:.0f} pip threshold). "
                    f"Check broker execution quality.")
        except Exception:
            pass
    return {
        "days": days,
        "total_fills": n_total,
        "avg_slippage_pips": round(avg, 4),
        "p50_pips": round(p50, 4),
        "p95_pips": round(p95, 4),
        "p99_pips": round(p99, 4),
        "worst_pips": round(worst, 4),
        "by_symbol": [{"symbol": s, **stats} for s, stats in out.items()],
        "time_series": time_series,
        "alert": p95 > threshold_pips,
        "threshold_pips": threshold_pips,
        "total_samples": n_total,  # backward-compatible alias
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/analytics/latency",
         tags=["analytics"],
         summary="Latency samples + percentiles",
         responses={200: {"description": "Latency stats"},
                    401: {"description": "Authentication required"}})
@limiter.limit("30/minute")
async def api_analytics_latency(request: Request,
                                hours: float = 24.0,
                                _auth: dict = Depends(get_api_key)
                                ) -> dict[str, Any]:
    """Return latency samples for the last ``hours`` hours.

    BACKEND-FIXES-2: response now exposes flat ``avg_ms`` / ``p50_ms`` /
    ``p95_ms`` / ``p99_ms`` / ``worst_ms`` plus a ``time_series`` array
    (one entry per sample) and ``by_endpoint`` breakdown so the frontend
    can render a latency chart without recomputing percentiles.  An
    ``alert`` flag is raised when p99 > 100 ms.
    """
    rows = list_latency_samples(hours=hours)
    # Compute aggregate percentiles across all endpoints
    latencies = sorted([r["latency_ms"] for r in rows])
    n = len(latencies)
    def _pct(p: float) -> float:
        if n == 0:
            return 0.0
        idx = int(p * (n - 1))
        return latencies[idx]
    avg = (sum(latencies) / n) if n else 0.0
    p50 = _pct(0.5)
    p95 = _pct(0.95)
    p99_latency = _pct(0.99)
    worst = max(latencies) if latencies else 0.0
    # ---- Per-endpoint breakdown ---- #
    by_ep_raw: dict[str, list[float]] = {}
    for r in rows:
        ep = r.get("endpoint") or "_unknown"
        by_ep_raw.setdefault(ep, []).append(float(r.get("latency_ms", 0.0)))
    by_endpoint: list[dict[str, Any]] = []
    for ep, vals in sorted(by_ep_raw.items()):
        vals_sorted = sorted(vals)
        m = len(vals_sorted)
        def _ep_pct(p: float) -> float:
            if m == 0:
                return 0.0
            idx = int(p * (m - 1))
            return vals_sorted[idx]
        by_endpoint.append({
            "endpoint": ep,
            "samples": m,
            "avg_ms": round(sum(vals) / m, 2) if m else 0.0,
            "p50_ms": round(_ep_pct(0.5), 2),
            "p95_ms": round(_ep_pct(0.95), 2),
            "p99_ms": round(_ep_pct(0.99), 2),
        })
    # Trigger Telegram alert if p99 latency thresholds breached
    threshold_ms = 100.0
    if p99_latency > threshold_ms:
        try:
            mgr = get_notification_manager()
            if mgr.enabled:
                await mgr.send_alert(
                    f"⚠️ Latency p99 = {p99_latency:.1f}ms "
                    f"(>{threshold_ms:.0f}ms threshold). "
                    f"Check MT5 connection / broker responsiveness.")
        except Exception:
            pass
    # ---- Time series (chronological) ---- #
    time_series: list[dict[str, Any]] = [
        {
            "timestamp": r.get("timestamp"),
            "endpoint": r.get("endpoint"),
            "latency_ms": float(r.get("latency_ms", 0.0)),
        }
        for r in sorted(rows, key=lambda x: x.get("timestamp") or "")
    ]
    return {
        "hours": hours,
        "total_requests": n,
        "avg_ms": round(avg, 2),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99_latency, 2),
        "worst_ms": round(worst, 2),
        "by_endpoint": by_endpoint,
        "time_series": time_series,
        "samples": rows,  # backward-compatible raw rows
        "aggregate": {
            "n": n,
            "p50": round(p50, 2),
            "p95": round(p95, 2),
            "p99": round(p99_latency, 2),
        },
        "alert": p99_latency > threshold_ms,
        "threshold_ms": threshold_ms,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/backtest/tick",
          tags=["backtest"],
          summary="Tick-level backtest",
          description="Run a tick-driven backtest that detects intra-candle "
                      "SL / TP fills (vs candle-close only).  Synthesises "
                      "ticks from M5 candles if real tick data isn't "
                      "supplied (BACKEND-100 #9).",
          responses={
              200: {"description": "Backtest result dict"},
              400: {"description": "Invalid request body"},
              401: {"description": "Authentication required"},
          })
@limiter.limit("2/hour")
async def api_backtest_tick(request: Request,
                            req: TickBacktestRequest,
                            _auth: dict = Depends(require_trader)
                            ) -> dict[str, Any]:
    """Run a tick-driven backtest (BACKEND-100 #9)."""
    engine = TickBacktestEngine()
    # When MT5 is connected, attempt to fetch real tick data; otherwise
    # the engine will synthesise ticks from candles (if candles supplied).
    candles_m5: list[dict[str, Any]] | None = None
    if MT5_AVAILABLE and get_connector().connected:
        try:
            sym = SymbolValidator.validate(req.symbol)
            mt5_sym = settings.symbol_for(sym)
            bars = _safe_call(get_connector().get_candles,
                              mt5_sym, req.timeframe, 2000)
            candles_m5 = [
                {"time": b.time, "open": b.open, "high": b.high,
                 "low": b.low, "close": b.close, "volume": b.volume,
                 "day": b.day}
                for b in bars
            ]
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Tick backtest: candle fetch failed: %s", exc)
    result = engine.run_tick_backtest(
        symbol=req.symbol,
        start_date=req.start_date,
        end_date=req.end_date,
        initial_balance=req.initial_balance,
        candles_m5=candles_m5,
    )
    result_dict = result.to_dict()
    result_dict["engine"] = "tick"
    return result_dict


# --------------------------------------------------------------------------- #
# BACKEND-100 #1: multi-broker status endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/broker/status",
         tags=["system"],
         summary="Multi-broker status (primary + secondary + active)",
         description="Return the connection status of the primary and "
                     "secondary MT5 brokers and which one is currently "
                     "active (BACKEND-100 #1).",
         responses={
             200: {"description": "Broker status dict"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("60/minute")
async def api_broker_status(request: Request,
                            _auth: dict = Depends(get_api_key)
                            ) -> dict[str, Any]:
    """Return primary/secondary broker connection state.

    BACKEND-FIXES-2: response is now flattened so the frontend can read
    ``mt5_connected`` / ``mt5_login`` / ``mt5_server`` /
    ``ollama_connected`` / ``tiingo_connected`` directly without walking
    into ``primary`` / ``secondary`` nested objects.  The original nested
    ``pool.status()`` payload is preserved under ``primary`` /
    ``secondary`` / ``active`` for backward compatibility.
    """
    pool = get_connector_pool()
    raw = pool.status()
    primary = raw.get("primary", {}) or {}
    active_label = raw.get("active", "primary")
    failover_active = bool(active_label != "primary")
    # Ollama / Tiingo are lazily probed (best-effort, default True since
    # the config has them enabled; the /api/test/* endpoints give the
    # authoritative value).
    ollama_connected = bool(settings.ollama.model)
    tiingo_connected = bool(settings.tiingo.api_key)
    return {
        "mt5_connected": bool(primary.get("connected", False)),
        "mt5_login": primary.get("login"),
        "mt5_server": primary.get("server") or settings.mt5.server,
        "ollama_connected": ollama_connected,
        "ollama_model": settings.ollama.model,
        "ollama_url": settings.ollama.base_url,
        "tiingo_connected": tiingo_connected,
        "primary": primary,
        "secondary": raw.get("secondary"),
        "active": active_label,
        "primary_failures": raw.get("primary_failures", 0),
        "failover_threshold": raw.get("failover_threshold", 0),
        "failover_active": failover_active,
        "failover_reason": ("" if not failover_active
                            else f"failed over to {active_label}"),
        "last_check": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/broker/failover",
          tags=["system"],
          summary="Force failover to secondary broker",
          description="Manually fail over from primary to secondary broker "
                      "(if a secondary is configured).  Returns 400 if no "
                      "secondary is configured (BACKEND-100 #1).",
          responses={
              200: {"description": "Failover succeeded"},
              400: {"description": "No secondary broker configured"},
              401: {"description": "Authentication required"},
              403: {"description": "Admin role required"},
          })
@limiter.limit("2/hour")
async def api_broker_failover(request: Request,
                              _auth: dict = Depends(require_admin)
                              ) -> dict[str, Any]:
    """Manually fail over to the secondary broker."""
    pool = get_connector_pool()
    ok = await asyncio.to_thread(pool.failover)
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="No secondary broker configured or failover failed.",
        )
    return {"ok": True, "status": pool.status()}


# --------------------------------------------------------------------------- #
# BACKEND-100 #2: Volume profile endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/volume-profile/{symbol}",
         tags=["market-data"],
         summary="Volume profile (POC / VAH / VAL)",
         description="Compute the volume profile for the last ``lookback`` "
                     "candles of ``symbol``.  Returns Point-of-Control "
                     "(POC), Value Area High (VAH), Value Area Low (VAL), "
                     "and the price-volume histogram (BACKEND-100 #2).",
         responses={
             200: {"description": "VolumeProfile dict"},
             401: {"description": "Authentication required"},
             503: {"description": "MT5 unavailable"},
         })
@limiter.limit("30/minute")
async def api_volume_profile(request: Request,
                             symbol: str,
                             lookback: int = 70,
                             bins: int = 50,
                             timeframe: str = "M5",
                             _auth: dict = Depends(get_api_key)
                             ) -> dict[str, Any]:
    """Return the volume profile for ``symbol``."""
    if not MT5_AVAILABLE or not get_connector().connected:
        return _mt5_unavailable_response()  # type: ignore[return-value]
    sym = SymbolValidator.validate(symbol)
    mt5_sym = settings.symbol_for(sym)
    try:
        bars = _safe_call(get_connector().get_candles,
                          mt5_sym, timeframe, max(lookback, 100))
        candles = [Candle(time=b.time, open=b.open, high=b.high, low=b.low,
                          close=b.close, volume=b.volume, day=b.day)
                   for b in bars]
        vp = volume_profile(candles, lookback=lookback, bins=bins)
        # BACKEND-FIXES-2: build the ``levels`` array with POC + value-area
        # flags + compute the value-area volume share so the frontend can
        # highlight POC and shade the value area on the histogram.
        total_volume = sum(v for _, v in vp.histogram)
        # Value area: levels between VAL and VAH inclusive (NaN-safe).
        import math as _math
        va_lo = vp.val if not _math.isnan(vp.val) else None
        va_hi = vp.vah if not _math.isnan(vp.vah) else None
        va_volume = 0.0
        levels: list[dict[str, Any]] = []
        for price, vol in vp.histogram:
            in_va = (
                va_lo is not None and va_hi is not None
                and va_lo <= price <= va_hi
            )
            if in_va:
                va_volume += vol
            levels.append({
                "price": price,
                "volume": vol,
                "is_poc": (price == vp.poc_price
                           if not _math.isnan(vp.poc_price) else False),
                "in_value_area": in_va,
            })
        va_pct = (va_volume / total_volume * 100.0) if total_volume else 0.0
        return {
            "symbol": sym,
            "levels": levels,
            "poc_price": vp.poc_price,
            "vah_price": vp.vah,
            "val_price": vp.val,
            # Legacy aliases (older dashboards read ``vah`` / ``val`` /
            # ``histogram``).
            "vah": vp.vah,
            "val": vp.val,
            "histogram": [{"price": p, "volume": v}
                          for p, v in vp.histogram],
            "lookback": lookback,
            "bins": bins,
            "total_volume": total_volume,
            "value_area_volume_pct": round(va_pct, 2),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# --------------------------------------------------------------------------- #
# BACKEND-100 #3: Currency strength meter
# --------------------------------------------------------------------------- #

@app.get("/api/market/currency-strength",
         tags=["market-data"],
         summary="Currency strength meter (8 majors)",
         description="Decompose % change of each FX pair into per-currency "
                     "strength via least-squares, then rank the 8 majors "
                     "(USD, EUR, GBP, JPY, CHF, AUD, CAD, NZD) strongest "
                     "to weakest (BACKEND-100 #3).",
         responses={
             200: {"description": "Ranked list of currency strengths"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_currency_strength(request: Request,
                                _auth: dict = Depends(get_api_key)
                                ) -> dict[str, Any]:
    """Return the ranked currency-strength meter across configured pairs."""
    pairs_data: dict[str, Candle] = {}
    if MT5_AVAILABLE and get_connector().connected:
        for pair, mt5_sym in zip(settings.pairs, settings.mt5_symbols):
            try:
                bars = _safe_call(get_connector().get_candles,
                                  mt5_sym, "M5", 50)
                if bars:
                    last = bars[-1]
                    pairs_data[pair] = Candle(
                        time=last.time, open=last.open, high=last.high,
                        low=last.low, close=last.close, volume=last.volume,
                        day=last.day,
                    )
            except Exception as exc:  # pragma: no cover
                logger.debug("currency_strength: skip %s: %s", pair, exc)
    strengths = calc_currency_strength(pairs_data)
    currencies_list = [
        {"currency": s.currency, "strength": s.strength,
         "rank": s.rank, "change_pct": s.change_pct,
         "change_24h": s.change_pct}
        for s in strengths
    ]
    return {
        "currencies": currencies_list,
        "count": len(currencies_list),
        # Legacy alias (older dashboards read ``strengths``).
        "strengths": currencies_list,
        "source": "mt5" if pairs_data else "empty",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ts": datetime.now(timezone.utc).isoformat(),  # legacy alias
    }


# --------------------------------------------------------------------------- #
# BACKEND-100 #4: Order flow / L2 depth endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/order-flow/{symbol}",
         tags=["market-data"],
         summary="Order flow (Level-2 depth)",
         description="Return the Level-2 order book for ``symbol`` if the "
                     "broker supports it.  Most retail FX brokers don't "
                     "expose L2 - in that case the endpoint returns "
                     "{supported: false, levels: null} (BACKEND-100 #4).",
         responses={
             200: {"description": "Order book or unsupported marker"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("60/minute")
async def api_order_flow(request: Request,
                         symbol: str,
                         _auth: dict = Depends(get_api_key)
                         ) -> dict[str, Any]:
    """Return the L2 order book for ``symbol`` (or mark as unsupported)."""
    sym = SymbolValidator.validate(symbol)
    mt5_sym = settings.symbol_for(sym)
    if not MT5_AVAILABLE or not get_connector().connected:
        return {"symbol": sym, "supported": False, "levels": None,
                "reason": "mt5_unavailable"}
    try:
        levels = await asyncio.to_thread(get_market_depth, mt5_sym)
    except Exception as exc:
        logger.debug("order_flow(%s) failed: %s", sym, exc)
        levels = None
    if levels is None:
        return {"symbol": sym, "supported": False, "levels": None,
                "reason": "broker_or_symbol_no_L2"}
    return {
        "symbol": sym,
        "supported": True,
        "levels": [
            {"price": lvl.price, "volume": lvl.volume,
             "side": lvl.side, "type": lvl.type}
            for lvl in levels
        ],
        "ts": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #
# BACKEND-100 #5: Volatility surface endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/volatility-surface/{symbol}",
         tags=["analytics"],
         summary="Volatility surface",
         description="Return the annualised realised volatility across "
                     "multiple lookback tenors (1, 5, 10, 20, 60 days) "
                     "for ``symbol`` (BACKEND-100 #5).",
         responses={
             200: {"description": "Vol surface list"},
             401: {"description": "Authentication required"},
             503: {"description": "MT5 unavailable"},
         })
@limiter.limit("30/minute")
async def api_volatility_surface(request: Request,
                                 symbol: str,
                                 timeframe: str = "D1",
                                 count: int = 200,
                                 _auth: dict = Depends(get_api_key)
                                 ) -> dict[str, Any]:
    """Compute the volatility surface across tenors."""
    if not MT5_AVAILABLE or not get_connector().connected:
        return _mt5_unavailable_response()  # type: ignore[return-value]
    sym = SymbolValidator.validate(symbol)
    mt5_sym = settings.symbol_for(sym)
    try:
        bars = _safe_call(get_connector().get_candles,
                          mt5_sym, timeframe, count)
        surface = volatility_surface([
            {"open": b.open, "high": b.high, "low": b.low,
             "close": b.close, "volume": b.volume}
            for b in bars
        ])
        return {"symbol": sym, "timeframe": timeframe,
                "surface": surface}
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# --------------------------------------------------------------------------- #
# BACKEND-100 #6: Correlation matrix endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/analytics/correlation-matrix",
         tags=["analytics"],
         summary="Rolling correlation matrix",
         description="Return the rolling Pearson correlation matrix across "
                     "the configured pairs (or those passed in ``?pairs=``). "
                     "Includes per-window series and the latest snapshot "
                     "(BACKEND-100 #6).",
         responses={
             200: {"description": "Correlation matrix dict"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_correlation_matrix(request: Request,
                                 pairs: str | None = None,
                                 window: int = 30,
                                 timeframe: str = "D1",
                                 count: int = 200,
                                 _auth: dict = Depends(get_api_key)
                                 ) -> dict[str, Any]:
    """Compute the rolling correlation matrix across the given pairs."""
    pair_list = [p.strip().upper() for p in (pairs or ",".join(settings.pairs)).split(",")
                 if p.strip()]
    if not pair_list:
        return {"pairs": [], "window": window, "matrix": {}, "latest": {}}
    # Fetch closes per pair.
    pairs_returns: dict[str, list[float]] = {}
    if MT5_AVAILABLE and get_connector().connected:
        import math as _math
        for pair in pair_list:
            mt5_sym = settings.symbol_for(pair)
            try:
                bars = _safe_call(get_connector().get_candles,
                                  mt5_sym, timeframe, count)
                closes = [float(b.close) for b in bars if b.close > 0]
                returns = [_math.log(closes[i] / closes[i - 1])
                           for i in range(1, len(closes))
                           if closes[i - 1] > 0 and closes[i] > 0]
                pairs_returns[pair] = returns
            except Exception as exc:
                logger.debug("correlation_matrix: skip %s: %s", pair, exc)
    if not pairs_returns:
        return {"pairs": pair_list, "window": window,
                "matrix": {}, "latest": {}, "note": "mt5_unavailable"}
    return correlation_matrix(pairs_returns, window=window)


# --------------------------------------------------------------------------- #
# BACKEND-100 #7 + #8: news sentiment + economic surprise index
# --------------------------------------------------------------------------- #

@app.get("/api/news/sentiment",
         tags=["news"],
         summary="News with AI sentiment tagging",
         description="Return the economic calendar with each event annotated "
                     "by Ollama sentiment (BULLISH / BEARISH / NEUTRAL + "
                     "confidence).  Skips events silently if Ollama is "
                     "unavailable (BACKEND-100 #7).",
         responses={
             200: {"description": "Events with sentiment"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("10/minute")
async def api_news_sentiment(request: Request,
                             days_ahead: int = 3,
                             impact: str | None = "HIGH",
                             _auth: dict = Depends(get_api_key)
                             ) -> dict[str, Any]:
    """Return the calendar with AI sentiment tags.

    BACKEND-FIXES-2: response now exposes ``items`` (renamed from
    ``events``) and ``fetched_at`` (renamed from ``ts``).  The legacy
    ``events`` + ``ts`` keys are kept as aliases so existing dashboards
    keep working.
    """
    cal = get_calendar()
    try:
        events = await cal.fetch_calendar(days_ahead=days_ahead, impact=impact)
    except Exception as exc:
        logger.warning("news_sentiment: fetch failed: %s", exc)
        events = []
    tagged = await cal.tag_sentiment(events=events)
    return {
        "items": tagged,
        "total": len(tagged),
        "count": len(tagged),  # legacy alias
        "events": tagged,  # legacy alias
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "ts": datetime.now(timezone.utc).isoformat(),  # legacy alias
    }


@app.get("/api/economics/surprise-index",
         tags=["news"],
         summary="Economic surprise index",
         description="Aggregate ``surprise = (actual - forecast) / sigma`` "
                     "per currency over the last ``days`` days "
                     "(BACKEND-100 #8).",
         responses={
             200: {"description": "Per-currency surprise stats"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_economics_surprise_index(request: Request,
                                       days: int = 30,
                                       sigma: float = 1.0,
                                       _auth: dict = Depends(get_api_key)
                                       ) -> dict[str, Any]:
    """Return the aggregate surprise index per currency.

    BACKEND-FIXES-2: response now exposes ``entries`` (an array of
    per-currency surprise objects) instead of a nested ``currencies`` dict
    so the frontend can iterate directly.  The original dict is preserved
    as ``currencies`` for backward compatibility.
    """
    cal = get_calendar()
    raw = await cal.get_surprise_index(days=days, sigma=sigma)
    currencies: dict[str, Any] = raw.get("currencies", {}) or {}
    entries: list[dict[str, Any]] = []
    for ccy, data in currencies.items():
        if not isinstance(data, dict):
            continue
        entries.append({
            "currency": ccy,
            "surprise_score": data.get("mean_surprise", 0.0),
            "std_surprise": data.get("std_surprise", 0.0),
            "actual": data.get("last_actual"),
            "forecast": data.get("last_forecast"),
            "previous": data.get("last_previous"),
            "events_count": data.get("samples", 0),
            "last_event": data.get("last_event"),
        })
    return {
        "days": raw.get("days", days),
        "sigma": raw.get("sigma", sigma),
        "entries": entries,
        "currencies": currencies,  # legacy alias
        "events_processed": raw.get("events_processed", 0),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #
# BACKEND-100 #12: swap tracking endpoints
# --------------------------------------------------------------------------- #

@app.get("/api/swaps/report",
         tags=["swaps"],
         summary="Daily swap report",
         description="Aggregate swap totals per day over an optional date "
                     "range (BACKEND-100 #12).",
         responses={
             200: {"description": "Per-day swap summary"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_swaps_report(request: Request,
                           start: str | None = None,
                           end: str | None = None,
                           _auth: dict = Depends(get_api_key)
                           ) -> dict[str, Any]:
    """Return the daily swap report."""
    rows = swap_summary_by_day(start=start, end=end)
    return {"count": len(rows), "by_day": rows}


@app.get("/api/swaps/by-symbol",
         tags=["swaps"],
         summary="Swap per symbol",
         description="Aggregate swap totals per symbol over an optional "
                     "date range (BACKEND-100 #12).",
         responses={
             200: {"description": "Per-symbol swap summary"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("30/minute")
async def api_swaps_by_symbol(request: Request,
                              start: str | None = None,
                              end: str | None = None,
                              _auth: dict = Depends(get_api_key)
                              ) -> dict[str, Any]:
    """Return the per-symbol swap report."""
    rows = swap_summary_by_symbol(start=start, end=end)
    return {"count": len(rows), "by_symbol": rows}


# --------------------------------------------------------------------------- #
# BACKEND-100 #13: real-time drawdown endpoint
# --------------------------------------------------------------------------- #

@app.get("/api/drawdown/realtime",
         tags=["positions"],
         summary="Real-time drawdown",
         description="Return the current drawdown, peak equity, recovery "
                     "target, and whether the 80% alert threshold is "
                     "active (BACKEND-100 #13).",
         responses={
             200: {"description": "Drawdown snapshot"},
             401: {"description": "Authentication required"},
         })
@limiter.limit("120/minute")
async def api_drawdown_realtime(request: Request,
                                _auth: dict = Depends(get_api_key)
                                ) -> dict[str, Any]:
    """Return the current real-time drawdown snapshot."""
    engine = get_engine()
    return engine.get_realtime_drawdown_snapshot()


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
