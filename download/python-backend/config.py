"""
config.py
=========
Central configuration loader for the Forex scalping backend.

All runtime settings are read from environment variables (with a `.env` file
fallback via python-dotenv).  Values are validated eagerly on import so that
the process fails fast if a required setting is missing.

Configuration groups:
    * MT5      - MetaTrader 5 connection (Finex Indonesia broker)
    * Ollama   - Local LLM endpoint
    * Tiingo   - Economic calendar API
    * Risk     - V2 strategy risk parameters
    * Pairs    - Symbols to monitor
    * Paths    - Database + log file locations
    * Server   - FastAPI / uvicorn settings
"""


import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # pragma: no cover - dotenv is optional at import time
    pass


# --------------------------------------------------------------------------- #
# Env var helpers (defined early so module-level constants can use them)
# --------------------------------------------------------------------------- #

def _require(name: str) -> str:
    """Fetch a required environment variable or raise a clear error."""
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Required environment variable '{name}' is not set. "
                           f"Copy .env.example to .env and fill in the values.")
    return val


def _get(name: str, default: str) -> str:
    """Return env var ``name`` or ``default`` if unset."""
    return os.environ.get(name, default)


# --------------------------------------------------------------------------- #
# Constants baked from the V2 strategy specification
# --------------------------------------------------------------------------- #

# Trading sessions in WIB (Asia/Jakarta, UTC+7) as (start_hour, end_hour).
SESSIONS_WIB: Final[dict[str, tuple[int, int]]] = {
    "tokyo": (9, 12),
    "london": (14, 17),
    "overlap": (20, 22),
}

# Blacklisted / skip sessions (no new entries).
SKIP_SESSIONS_WIB: Final[list[tuple[int, int]]] = [
    (5, 14),     # Sydney window
    (17, 19),    # London lunch (19:30 rounded to 19 for hour granularity)
]

# V2 strategy risk thresholds.
RISK_PCT_PER_TRADE: Final[float] = 0.01          # 1% of balance
MAX_POSITIONS: Final[int] = 3
MAX_DAILY_TRADES: Final[int] = 5

# Tiered stops (fraction of starting balance for the period).
TIERED_STOPS: Final[dict[str, float]] = {
    "soft": -0.01,        # -1%   -> pause new entries
    "hard": -0.02,        # -2%   -> hard stop + close all
    "weekly": -0.04,      # -4%   -> weekly stop
    "overall": -0.10,     # -10%  -> overall stop, lock bot
}

# RR / exit plan.
RR_NET_MIN: Final[float] = 2.0
SL_ATR_MULT: Final[float] = 1.5
SL_PIP_BUFFER: Final[float] = 2.0           # 2 pip buffer outside swing
TP1_MULT: Final[float] = 2.0                # TP1 = 2x SL
TP2_MULT: Final[float] = 4.0                # TP2 = 4x SL
TP1_CLOSE_PCT: Final[float] = 0.50          # close 50% at TP1
TP2_CLOSE_PCT: Final[float] = 0.30          # close 30% at TP2
TRAIL_ATR_MULT: Final[float] = 2.0          # trailing 2x ATR for last 20%
BE_BUFFER_PIPS: Final[float] = 2.0          # move SL to BE+2 at TP1

# ADX regime thresholds.
ADX_TRENDING: Final[float] = 25.0
ADX_RANGING: Final[float] = 20.0

# News blackout window around HIGH impact events (±30 min).
NEWS_BLACKOUT_MINUTES: Final[int] = 30

# Default trading loop interval (seconds).
TRADING_LOOP_INTERVAL: Final[float] = 15.0

# Order placement timeout (seconds).  Wraps place_order / modify_position /
# close_position calls in ``asyncio.wait_for`` so a stuck MT5 order never
# blocks the loop indefinitely.
ORDER_TIMEOUT_SECONDS: Final[float] = float(_get("ORDER_TIMEOUT_SECONDS", "30"))

# Maximum slippage (deviation in points) accepted when placing / closing
# orders.  Two separate values are exposed:
#   * ENTRY  - tighter, used on new entries (default 20)
#   * CLOSE  - looser, used on partial / full closes (default 50)
MAX_SLIPPAGE_POINTS_ENTRY: Final[int] = int(_get("MAX_SLIPPAGE_POINTS", "20"))
MAX_SLIPPAGE_POINTS_CLOSE: Final[int] = 50
# Number of retry attempts if the broker rejects an order due to slippage
# (each retry increases the deviation by 50%).
SLIPPAGE_RETRY_ATTEMPTS: Final[int] = int(_get("SLIPPAGE_RETRY_ATTEMPTS", "2"))

# Candle cache TTL (seconds) - avoids hammering MT5 copy_rates_* per tick.
CANDLE_CACHE_TTL_S: Final[int] = int(_get("CANDLE_CACHE_TTL_S", "60"))

# Paper trading mode - simulate trades in DB without calling place_order.
PAPER_MODE: Final[bool] = _get("PAPER_MODE", "false").lower() in ("1", "true", "yes")

# Dry run mode - generate signals + publish events but NEVER place orders
# (and don't simulate P&L either - just log).
DRY_RUN: Final[bool] = _get("DRY_RUN", "false").lower() in ("1", "true", "yes")

# Friday weekend position closer - all open positions are force-closed at
# this WIB time (HH:MM).  Default 21:30 (30 min before the 22:00 cutoff).
WEEKEND_CLOSE_TIME: Final[str] = _get("WEEKEND_CLOSE_TIME", "21:30")

# Telegram notifications (optional - empty values disable alerts).
TELEGRAM_BOT_TOKEN: Final[str] = _get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID: Final[str] = _get("TELEGRAM_CHAT_ID", "")

# Margin call prevention thresholds (margin level %).
MARGIN_WARNING_PCT: Final[float] = 150.0   # log + alert
MARGIN_CALL_PCT: Final[float] = 120.0      # auto close worst position
MARGIN_EMERGENCY_PCT: Final[float] = 100.0  # close ALL + kill switch

# NTP time-sync drift tolerance (seconds).  Drift above this triggers WARN.
NTP_DRIFT_TOLERANCE_S: Final[float] = 5.0


# --------------------------------------------------------------------------- #
# Sprint 5: Security + compliance env vars
# --------------------------------------------------------------------------- #

# Comma-separated list of valid API keys for Bearer auth.  Empty = DISABLED.
API_KEYS: Final[str] = _get("API_KEYS", "")

# SQLCipher 32-byte hex key for at-rest DB encryption.  Empty = plaintext.
DB_ENCRYPTION_KEY: Final[str] = _get("DB_ENCRYPTION_KEY", "")

# Fernet master key for the secrets.SecretManager.  Empty = plaintext fallback.
SECRETS_MASTER_KEY: Final[str] = _get("SECRETS_MASTER_KEY", "")

# Default admin password for the users table (auto-created on first run).
ADMIN_PASSWORD: Final[str] = _get("ADMIN_PASSWORD", "")

# HTTPS enforcement (redirect HTTP -> HTTPS).  Default False for dev.
ENFORCE_HTTPS: Final[bool] = _get("ENFORCE_HTTPS", "false").lower() in (
    "1", "true", "yes",
)

# Position sizing mode: "fixed" (default, 1% per trade) or "kelly" (quarter-Kelly).
POSITION_SIZING_MODE: Final[str] = _get("POSITION_SIZING_MODE", "fixed").lower()


# --------------------------------------------------------------------------- #
# BACKEND-100 (Sprint 9): multi-broker + AWS S3 + Alembic
# --------------------------------------------------------------------------- #

# Secondary MT5 broker credentials (for failover).  Optional - empty values
# disable the secondary connector and the pool degrades to primary-only.
MT5_LOGIN_2: Final[str] = _get("MT5_LOGIN_2", "")
MT5_PASSWORD_2: Final[str] = _get("MT5_PASSWORD_2", "")
MT5_SERVER_2: Final[str] = _get("MT5_SERVER_2", "")

# Number of reconnect attempts before the connector pool fails over to the
# secondary broker.  Default 3.
MT5_FAILOVER_RETRY_THRESHOLD: Final[int] = int(
    _get("MT5_FAILOVER_RETRY_THRESHOLD", "3"))

# AWS S3 offsite backup upload (all optional - empty AWS_S3_BUCKET disables).
AWS_S3_BUCKET: Final[str] = _get("AWS_S3_BUCKET", "")
AWS_S3_REGION: Final[str] = _get("AWS_S3_REGION", "ap-southeast-1")
AWS_ACCESS_KEY_ID: Final[str] = _get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY: Final[str] = _get("AWS_SECRET_ACCESS_KEY", "")

# Alembic migration database URL.  Defaults to the SQLAlchemy URL derived
# from DB_PATH (SQLite) - override only for non-SQLite backends.
ALEMBIC_DATABASE_URL: Final[str] = _get(
    "ALEMBIC_DATABASE_URL",
    f"sqlite:///{_get('DB_PATH', str(Path(_get('APP_BASE_DIR', Path(__file__).resolve().parent)) / 'data' / 'trading.db'))}",
)


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class MT5Config:
    """MetaTrader 5 connection settings (Finex Indonesia broker)."""
    login: int
    password: str
    server: str
    terminal_path: str | None = None
    timeout_ms: int = 60_000
    retry_attempts: int = 5
    retry_delay_s: float = 2.0


@dataclass(frozen=True)
class OllamaConfig:
    """Local Ollama LLM endpoint configuration."""
    base_url: str
    model: str
    timeout_s: float = 120.0
    temperature: float = 0.3


@dataclass(frozen=True)
class TiingoConfig:
    """Tiingo economic calendar / market data configuration."""
    api_key: str
    base_url: str = "https://api.tiingo.com"
    calendar_endpoint: str = "/tiingo/fundamentals/news-calendar"
    cache_ttl_s: int = 3_600           # 1 hour cache


@dataclass(frozen=True)
class RiskConfig:
    """V2 strategy risk parameters."""
    risk_pct_per_trade: float = RISK_PCT_PER_TRADE
    max_positions: int = MAX_POSITIONS
    max_daily_trades: int = MAX_DAILY_TRADES
    tiered_stops: dict[str, float] = field(default_factory=lambda: dict(TIERED_STOPS))
    rr_net_min: float = RR_NET_MIN
    sl_atr_mult: float = SL_ATR_MULT
    sl_pip_buffer: float = SL_PIP_BUFFER
    tp1_mult: float = TP1_MULT
    tp2_mult: float = TP2_MULT
    tp1_close_pct: float = TP1_CLOSE_PCT
    tp2_close_pct: float = TP2_CLOSE_PCT
    trail_atr_mult: float = TRAIL_ATR_MULT
    be_buffer_pips: float = BE_BUFFER_PIPS
    adx_trending: float = ADX_TRENDING
    adx_ranging: float = ADX_RANGING
    news_blackout_minutes: int = NEWS_BLACKOUT_MINUTES


@dataclass(frozen=True)
class PathsConfig:
    """Filesystem paths."""
    base_dir: Path
    db_path: Path
    log_path: Path
    log_level: str


@dataclass(frozen=True)
class ServerConfig:
    """FastAPI / uvicorn server settings."""
    host: str
    port: int
    cors_origins: list[str]
    ws_heartbeat_s: float


@dataclass(frozen=True)
class AppConfig:
    """Top-level application configuration."""
    mt5: MT5Config
    mt5_secondary: MT5Config | None        # BACKEND-100 #1: failover broker
    ollama: OllamaConfig
    tiingo: TiingoConfig
    risk: RiskConfig
    paths: PathsConfig
    server: ServerConfig
    pairs: list[str]                # e.g. ["EURUSD", "GBPUSD", "USDJPY"]
    mt5_symbols: list[str]          # MT5 symbol names (may differ from pair names)
    timezone: str                   # IANA tz, e.g. Asia/Jakarta

    # Convenience accessor for symbol -> mt5 symbol mapping
    def symbol_for(self, pair: str) -> str:
        """Return the MT5 symbol name for a given pair identifier."""
        idx = self.pairs.index(pair) if pair in self.pairs else -1
        if idx == -1 or idx >= len(self.mt5_symbols):
            return pair
        return self.mt5_symbols[idx]


# --------------------------------------------------------------------------- #
# Loader
# --------------------------------------------------------------------------- #

def load_config() -> AppConfig:
    """Load and validate the application configuration from the environment.

    Raises
    ------
    RuntimeError
        If any required environment variable is missing or invalid.
    """
    # ---- MT5 ----
    mt5_login_raw = _get("MT5_LOGIN", "")
    if not mt5_login_raw.isdigit():
        raise RuntimeError(
            "MT5_LOGIN must be a numeric MetaTrader 5 account login "
            "(Finex Indonesia). Check your .env file."
        )
    mt5_cfg = MT5Config(
        login=int(mt5_login_raw),
        password=_get("MT5_PASSWORD", ""),
        server=_get("MT5_SERVER", "FinexECN-MT5-Demo"),  # Finex Indonesia default
        terminal_path=_get("MT5_TERMINAL_PATH", "") or None,
        timeout_ms=int(_get("MT5_TIMEOUT_MS", "60000")),
        retry_attempts=int(_get("MT5_RETRY_ATTEMPTS", "5")),
        retry_delay_s=float(_get("MT5_RETRY_DELAY_S", "2.0")),
    )
    if not mt5_cfg.password:
        raise RuntimeError("MT5_PASSWORD is required.")

    # ---- BACKEND-100 #1: secondary (failover) broker ----
    mt5_secondary: MT5Config | None = None
    sec_login_raw = _get("MT5_LOGIN_2", "")
    sec_password = _get("MT5_PASSWORD_2", "")
    sec_server = _get("MT5_SERVER_2", "")
    if sec_login_raw and sec_login_raw.isdigit() and sec_password and sec_server:
        mt5_secondary = MT5Config(
            login=int(sec_login_raw),
            password=sec_password,
            server=sec_server,
            terminal_path=_get("MT5_TERMINAL_PATH_2", "") or None,
            timeout_ms=int(_get("MT5_TIMEOUT_MS", "60000")),
            retry_attempts=int(_get("MT5_RETRY_ATTEMPTS", "5")),
            retry_delay_s=float(_get("MT5_RETRY_DELAY_S", "2.0")),
        )

    # ---- Ollama ----
    ollama_cfg = OllamaConfig(
        base_url=_get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        model=_get("OLLAMA_MODEL", "llama3.2:latest"),
        timeout_s=float(_get("OLLAMA_TIMEOUT_S", "120.0")),
        temperature=float(_get("OLLAMA_TEMPERATURE", "0.3")),
    )

    # ---- Tiingo ----
    tiingo_key = _get("TIINGO_API_KEY", "")
    if not tiingo_key:
        # Tiingo is optional - the calendar endpoint will degrade gracefully.
        tiingo_key = ""
    tiingo_cfg = TiingoConfig(
        api_key=tiingo_key,
        base_url=_get("TIINGO_BASE_URL", "https://api.tiingo.com").rstrip("/"),
        cache_ttl_s=int(_get("TIINGO_CACHE_TTL_S", "3600")),
    )

    # ---- Risk ----
    risk_cfg = RiskConfig()  # defaults match V2 strategy

    # ---- Paths ----
    base_dir = Path(_get("APP_BASE_DIR", Path(__file__).resolve().parent))
    db_path = Path(_get("DB_PATH", base_dir / "data" / "trading.db"))
    log_path = Path(_get("LOG_PATH", base_dir / "logs" / "backend.log"))
    paths_cfg = PathsConfig(
        base_dir=base_dir,
        db_path=db_path,
        log_path=log_path,
        log_level=_get("LOG_LEVEL", "INFO").upper(),
    )

    # ---- Server ----
    cors_raw = _get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    server_cfg = ServerConfig(
        host=_get("SERVER_HOST", "0.0.0.0"),
        port=int(_get("SERVER_PORT", "8000")),
        cors_origins=[o.strip() for o in cors_raw.split(",") if o.strip()],
        ws_heartbeat_s=float(_get("WS_HEARTBEAT_S", "15.0")),
    )

    # ---- Pairs (V2 strategy: EUR/USD #1, GBP/USD #2, USD/JPY #3) ----
    pairs = [p.strip().upper().replace("/", "")
             for p in _get("PAIRS", "EURUSD,GBPUSD,USDJPY").split(",")
             if p.strip()]
    mt5_symbols = [s.strip() for s in
                   _get("MT5_SYMBOLS", ",".join(pairs)).split(",") if s.strip()]
    if len(mt5_symbols) != len(pairs):
        # Default 1:1 mapping
        mt5_symbols = list(pairs)

    tz = _get("TIMEZONE", "Asia/Jakarta")

    return AppConfig(
        mt5=mt5_cfg,
        mt5_secondary=mt5_secondary,
        ollama=ollama_cfg,
        tiingo=tiingo_cfg,
        risk=risk_cfg,
        paths=paths_cfg,
        server=server_cfg,
        pairs=pairs,
        mt5_symbols=mt5_symbols,
        timezone=tz,
    )


# Eager singleton - import once and reuse.
settings: AppConfig = load_config()


__all__ = [
    "AppConfig", "MT5Config", "OllamaConfig", "TiingoConfig",
    "RiskConfig", "PathsConfig", "ServerConfig",
    "SESSIONS_WIB", "SKIP_SESSIONS_WIB", "TIERED_STOPS",
    "RISK_PCT_PER_TRADE", "MAX_POSITIONS", "MAX_DAILY_TRADES",
    "RR_NET_MIN", "SL_ATR_MULT", "SL_PIP_BUFFER",
    "TP1_MULT", "TP2_MULT", "TP1_CLOSE_PCT", "TP2_CLOSE_PCT",
    "TRAIL_ATR_MULT", "BE_BUFFER_PIPS",
    "ADX_TRENDING", "ADX_RANGING", "NEWS_BLACKOUT_MINUTES",
    "TRADING_LOOP_INTERVAL",
    "ORDER_TIMEOUT_SECONDS",
    "MAX_SLIPPAGE_POINTS_ENTRY", "MAX_SLIPPAGE_POINTS_CLOSE",
    "SLIPPAGE_RETRY_ATTEMPTS", "CANDLE_CACHE_TTL_S",
    "PAPER_MODE", "DRY_RUN", "WEEKEND_CLOSE_TIME",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "MARGIN_WARNING_PCT", "MARGIN_CALL_PCT", "MARGIN_EMERGENCY_PCT",
    "NTP_DRIFT_TOLERANCE_S",
    "API_KEYS", "DB_ENCRYPTION_KEY", "SECRETS_MASTER_KEY",
    "ADMIN_PASSWORD", "ENFORCE_HTTPS", "POSITION_SIZING_MODE",
    # BACKEND-100 Sprint 9
    "MT5_LOGIN_2", "MT5_PASSWORD_2", "MT5_SERVER_2",
    "MT5_FAILOVER_RETRY_THRESHOLD",
    "AWS_S3_BUCKET", "AWS_S3_REGION",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "ALEMBIC_DATABASE_URL",
    "load_config", "settings",
]
