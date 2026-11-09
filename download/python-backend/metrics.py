"""
metrics.py
==========
Prometheus metrics registry + middleware for the FastAPI backend (Sprint 8 #20).

Exposes:
    * ``registry``                - the prometheus_client CollectorRegistry
    * ``http_requests_total``     - counter (labels: method, endpoint, status)
    * ``http_request_duration_seconds`` - histogram (labels: method, endpoint)
    * ``trading_bot_status``      - gauge (1=running, 0=stopped)
    * ``trading_open_positions``  - gauge
    * ``trading_daily_pnl_pct``   - gauge
    * ``trading_account_balance`` - gauge
    * ``trading_account_equity``  - gauge
    * ``trading_margin_level``    - gauge
    * ``trading_total_trades``    - counter
    * ``trading_signals_generated`` - counter
    * ``trading_kill_switch_triggered`` - counter
    * ``metrics_middleware``      - ASGI middleware that records request dur+count
    * ``update_trading_metrics``  - helper to refresh the trading gauges
    * ``REQUEST_ID_CTX``          - contextvar holding the per-request UUID

Use ``prometheus_client.generate_latest(registry)`` to render the ``/metrics``
endpoint body.
"""

import time
import uuid
from contextvars import ContextVar
from typing import Any

try:
    from prometheus_client import (
        CollectorRegistry, Counter, Gauge, Histogram, generate_latest,
        CONTENT_TYPE_LATEST,
    )
    _PROM_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PROM_AVAILABLE = False
    CollectorRegistry = None  # type: ignore
    Counter = None  # type: ignore
    Gauge = None  # type: ignore
    Histogram = None  # type: ignore
    generate_latest = None  # type: ignore
    CONTENT_TYPE_LATEST = "text/plain; charset=utf-8"

# Per-request correlation id (used by structured logging too).
REQUEST_ID_CTX: ContextVar[str] = ContextVar("request_id", default="")
TRACE_ID_CTX: ContextVar[str] = ContextVar("trace_id", default="")


if _PROM_AVAILABLE:
    registry = CollectorRegistry()
    http_requests_total = Counter(
        "http_requests_total", "Total HTTP requests",
        ["method", "endpoint", "status"], registry=registry,
    )
    http_request_duration_seconds = Histogram(
        "http_request_duration_seconds", "HTTP request duration",
        ["method", "endpoint"], registry=registry,
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
    )
    trading_bot_status = Gauge(
        "trading_bot_status", "1=running, 0=stopped", registry=registry,
    )
    trading_open_positions = Gauge(
        "trading_open_positions", "Open positions count", registry=registry,
    )
    trading_daily_pnl_pct = Gauge(
        "trading_daily_pnl_pct", "Daily PnL percent", registry=registry,
    )
    trading_account_balance = Gauge(
        "trading_account_balance", "Account balance", registry=registry,
    )
    trading_account_equity = Gauge(
        "trading_account_equity", "Account equity", registry=registry,
    )
    trading_margin_level = Gauge(
        "trading_margin_level", "Margin level percent", registry=registry,
    )
    trading_total_trades = Counter(
        "trading_total_trades", "Total trades executed", registry=registry,
    )
    trading_signals_generated = Counter(
        "trading_signals_generated", "Total signals generated", registry=registry,
    )
    trading_kill_switch_triggered = Counter(
        "trading_kill_switch_triggered",
        "Kill switch trigger count", registry=registry,
    )
    # ---- BACKEND-100 #17: extended process / DB metrics ---- #
    process_memory_bytes = Gauge(
        "process_memory_bytes", "Process RSS memory in bytes",
        registry=registry,
    )
    process_cpu_percent = Gauge(
        "process_cpu_percent", "Process CPU usage percent",
        registry=registry,
    )
    db_connections_active = Gauge(
        "db_connections_active", "Active SQLAlchemy connections",
        registry=registry,
    )
    db_query_duration_seconds = Histogram(
        "db_query_duration_seconds", "DB query duration",
        registry=registry,
        buckets=(0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0),
    )
else:
    # Stubs so the module is importable without prometheus_client
    registry = None  # type: ignore
    class _Stub:
        def labels(self, *a, **kw): return self
        def inc(self, *a, **kw): pass
        def set(self, *a, **kw): pass
        def observe(self, *a, **kw): pass
    http_requests_total = _Stub()  # type: ignore
    http_request_duration_seconds = _Stub()  # type: ignore
    trading_bot_status = _Stub()  # type: ignore
    trading_open_positions = _Stub()  # type: ignore
    trading_daily_pnl_pct = _Stub()  # type: ignore
    trading_account_balance = _Stub()  # type: ignore
    trading_account_equity = _Stub()  # type: ignore
    trading_margin_level = _Stub()  # type: ignore
    trading_total_trades = _Stub()  # type: ignore
    trading_signals_generated = _Stub()  # type: ignore
    trading_kill_switch_triggered = _Stub()  # type: ignore
    # BACKEND-100 #17
    process_memory_bytes = _Stub()  # type: ignore
    process_cpu_percent = _Stub()  # type: ignore
    db_connections_active = _Stub()  # type: ignore
    db_query_duration_seconds = _Stub()  # type: ignore


# --------------------------------------------------------------------------- #
# ASGI middleware
# --------------------------------------------------------------------------- #

class RequestIDMiddleware:
    """Starlette-style ASGI middleware that assigns a per-request UUID.

    Also stamps ``request_id`` on the prometheus context var so log records
    can include it.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        rid = uuid.uuid4().hex
        token = REQUEST_ID_CTX.set(rid)
        # also set trace_id (same value, but separate slot for future tracing)
        token2 = TRACE_ID_CTX.set(rid)
        # Stash rid in scope state so handlers / loggers can read it
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = rid
        try:
            await self.app(scope, receive, send)
        finally:
            REQUEST_ID_CTX.reset(token)
            TRACE_ID_CTX.reset(token2)


class MetricsMiddleware:
    """ASGI middleware that records request duration + status counter."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        method = scope.get("method", "")
        path = scope.get("path", "")
        # Normalise path so we don't explode cardinality (drop IDs)
        endpoint = path
        # Replace /api/trade/123 -> /api/trade/{id}
        parts = path.split("/")
        norm: list[str] = []
        for p in parts:
            if p.isdigit() or (p and p[0] == "-"):
                norm.append("{id}")
            else:
                norm.append(p)
        endpoint = "/".join(norm)

        status_code = [500]  # mutable holder

        async def send_wrapper(message: Any) -> None:
            if message.get("type") == "http.response.start":
                status_code[0] = int(message.get("status", 500))
            await send(message)

        t0 = time.perf_counter()
        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - t0
            try:
                http_request_duration_seconds.labels(  # type: ignore[union-attr]
                    method=method, endpoint=endpoint,
                ).observe(elapsed)
                http_requests_total.labels(  # type: ignore[union-attr]
                    method=method, endpoint=endpoint,
                    status=str(status_code[0]),
                ).inc()
            except Exception:
                pass


# --------------------------------------------------------------------------- #
# Helper to refresh trading gauges
# --------------------------------------------------------------------------- #

def update_trading_metrics(engine_snapshot: dict[str, Any],
                           account: dict[str, Any] | None = None) -> None:
    """Refresh the trading_* gauges from an engine.snapshot() dict."""
    try:
        trading_bot_status.set(  # type: ignore[union-attr]
            1 if engine_snapshot.get("is_running") else 0)
        trading_open_positions.set(  # type: ignore[union-attr]
            int(engine_snapshot.get("open_positions", 0) or 0))
        daily_pct = float(engine_snapshot.get("daily_pnl_pct", 0.0) or 0.0)
        trading_daily_pnl_pct.set(daily_pct)  # type: ignore[union-attr]
        if account:
            balance = float(account.get("balance", 0.0) or 0.0)
            equity = float(account.get("equity", 0.0) or 0.0)
            margin_level = float(account.get("margin_level", 0.0) or 0.0)
            trading_account_balance.set(balance)  # type: ignore[union-attr]
            trading_account_equity.set(equity)  # type: ignore[union-attr]
            trading_margin_level.set(margin_level)  # type: ignore[union-attr]
    except Exception:
        pass


def render_metrics() -> tuple[bytes, str]:
    """Return (body_bytes, content_type) for the ``/metrics`` endpoint."""
    if not _PROM_AVAILABLE:
        return b"# prometheus_client not installed\n", "text/plain; charset=utf-8"
    # Refresh process / DB gauges before rendering.
    try:
        update_process_metrics()
    except Exception:  # pragma: no cover
        pass
    return generate_latest(registry), CONTENT_TYPE_LATEST  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# BACKEND-100 #17: process / system info helpers
# --------------------------------------------------------------------------- #

# Module-level start time - used to compute uptime.
_PROCESS_START_TIME: float = time.time()


def get_uptime_seconds() -> float:
    """Return the backend process uptime in seconds."""
    return time.time() - _PROCESS_START_TIME


def update_process_metrics() -> None:
    """Refresh the ``process_*`` and ``db_*`` gauges."""
    if not _PROM_AVAILABLE:
        return
    try:
        import os
        import psutil  # type: ignore
        proc = psutil.Process(os.getpid())
        mem = proc.memory_info()
        process_memory_bytes.set(int(mem.rss))  # type: ignore[union-attr]
        try:
            cpu = proc.cpu_percent(interval=None)
            process_cpu_percent.set(float(cpu))  # type: ignore[union-attr]
        except Exception:  # pragma: no cover
            pass
    except ImportError:
        # psutil not installed - fall back to /proc/self/status (Linux).
        try:
            with open("/proc/self/status", "r") as fh:
                for line in fh:
                    if line.startswith("VmRSS:"):
                        kb = int(line.split()[1])
                        process_memory_bytes.set(kb * 1024)  # type: ignore[union-attr]
                        break
        except Exception:  # pragma: no cover
            pass
    except Exception:  # pragma: no cover
        pass
    try:
        from database import get_db
        eng = get_db().engine
        pool = eng.pool
        # SQLAlchemy QueuePool exposes checkedout() + size().
        checkedout = getattr(pool, "checkedout", None)
        if callable(checkedout):
            db_connections_active.set(int(checkedout()))  # type: ignore[union-attr]
    except Exception:  # pragma: no cover
        pass


def get_system_info() -> dict[str, Any]:
    """Return a system-info dict for ``GET /api/system/info``."""
    import os
    import platform
    import socket
    info: dict[str, Any] = {
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "os": platform.system(),
        "os_release": platform.release(),
        "os_version": platform.version(),
        "hostname": socket.gethostname(),
        "cpu_count": os.cpu_count() or 0,
        "uptime_seconds": round(get_uptime_seconds(), 1),
        "machine": platform.machine(),
        "processor": platform.processor() or "unknown",
    }
    # Memory info (best-effort).
    try:
        import psutil  # type: ignore
        vm = psutil.virtual_memory()
        info["memory_total_mb"] = int(vm.total // (1024 * 1024))
        info["memory_available_mb"] = int(vm.available // (1024 * 1024))
        info["memory_used_pct"] = round(vm.percent, 2)
        info["cpu_percent"] = psutil.cpu_percent(interval=None)
    except ImportError:
        # Linux fallback via /proc/meminfo.
        try:
            with open("/proc/meminfo", "r") as fh:
                meminfo: dict[str, int] = {}
                for line in fh:
                    parts = line.split(":")
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = int(parts[1].split()[0])
                        meminfo[key] = val
            if "MemTotal" in meminfo:
                info["memory_total_mb"] = meminfo["MemTotal"] // 1024
            if "MemAvailable" in meminfo:
                info["memory_available_mb"] = meminfo["MemAvailable"] // 1024
        except Exception:  # pragma: no cover
            pass
    # Disk usage of the backend dir.
    try:
        import shutil
        disk = shutil.disk_usage(os.getcwd())
        info["disk_total_gb"] = round(disk.total / (1024 ** 3), 2)
        info["disk_used_gb"] = round(disk.used / (1024 ** 3), 2)
        info["disk_free_gb"] = round(disk.free / (1024 ** 3), 2)
        info["disk_used_pct"] = round(disk.used / disk.total * 100.0, 2) \
            if disk.total else 0.0
    except Exception:  # pragma: no cover
        pass
    # Installed packages.
    try:
        from importlib.metadata import distributions
        pkgs = sorted({f"{d.metadata['Name']}=={d.version}"
                       for d in distributions()})
        info["packages_installed"] = pkgs
        info["packages_count"] = len(pkgs)
    except Exception:  # pragma: no cover
        info["packages_installed"] = []
        info["packages_count"] = 0
    return info


__all__ = [
    "registry", "REQUEST_ID_CTX", "TRACE_ID_CTX",
    "http_requests_total", "http_request_duration_seconds",
    "trading_bot_status", "trading_open_positions", "trading_daily_pnl_pct",
    "trading_account_balance", "trading_account_equity", "trading_margin_level",
    "trading_total_trades", "trading_signals_generated",
    "trading_kill_switch_triggered",
    # BACKEND-100 #17
    "process_memory_bytes", "process_cpu_percent",
    "db_connections_active", "db_query_duration_seconds",
    "get_uptime_seconds", "update_process_metrics", "get_system_info",
    "RequestIDMiddleware", "MetricsMiddleware",
    "update_trading_metrics", "render_metrics",
]
