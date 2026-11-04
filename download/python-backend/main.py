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
import json
import logging
import logging.handlers
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from config import settings
from mt5_connector import (
    MT5UnavailableError, MT5_AVAILABLE, get_connector,
)
from database import (
    get_db, list_trades, list_signals, list_news, get_all_settings,
    set_setting, get_bot_state,
)
from ollama_analyzer import get_analyzer, close_default_client as close_ai
from tiingo_calendar import get_calendar, close_default_client as close_cal
from trading_engine import get_engine, EventBus
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
    """Start auto-trading."""
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
