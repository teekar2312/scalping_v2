"""
notifications.py
================
Telegram notifications for critical engine events.

Subscribes to the EventBus and forwards the following event types to a
Telegram chat via the Bot API:
    * kill_switch
    * hard_stop
    * connection_lost
    * margin_warning
    * margin_call_prevented
    * margin_emergency
    * weekend_close

Configuration (env vars, optional - if empty, notifications are disabled):
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID

Usage:
    mgr = NotificationManager()
    await mgr.send_alert("Hello from the bot", severity="INFO")
    await mgr.send_kill_switch(reason="manual")
"""


import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

import config as cfg

logger = logging.getLogger(__name__)


# Telegram long-polling configuration.
_TELEGRAM_POLL_TIMEOUT_S: int = 30
_TELEGRAM_POLL_RETRY_S: float = 5.0


# Events that should always trigger a Telegram push.
_SUBSCRIBED_EVENTS: set[str] = {
    "kill_switch_engaged",
    "kill_switch_released",
    "hard_stop",
    "connection_lost",
    "margin_warning",
    "margin_call_prevented",
    "margin_emergency",
    "weekend_close",
    "news_reduce",
    "engine_started",
    "engine_stopped",
}

# Telegram command descriptions for /api/telegram/commands endpoint.
TELEGRAM_COMMANDS: list[dict[str, str]] = [
    {"command": "/status", "description": "Bot status + open positions + today P&L"},
    {"command": "/start", "description": "Start auto-trading"},
    {"command": "/stop", "description": "Stop bot (does not close positions)"},
    {"command": "/kill", "description": "Emergency kill switch + close all"},
    {"command": "/report", "description": "Daily report summary"},
    {"command": "/chart", "description": "Chart screenshot (usage: /chart EURUSD)"},
    {"command": "/positions", "description": "List open positions"},
    {"command": "/signals", "description": "List recent signals"},
    {"command": "/help", "description": "List available commands"},
]


class NotificationManager:
    """Async Telegram bot notifier.

    Parameters
    ----------
    bot_token, chat_id : str
        Override the env-configured credentials (mostly for tests).
    """

    def __init__(self,
                 bot_token: str | None = None,
                 chat_id: str | None = None) -> None:
        self.bot_token = bot_token or cfg.TELEGRAM_BOT_TOKEN
        self.chat_id = chat_id or cfg.TELEGRAM_CHAT_ID
        self._client: httpx.AsyncClient | None = None
        self.enabled: bool = bool(self.bot_token and self.chat_id)
        if not self.enabled:
            logger.info("Telegram notifications disabled (missing config)")

    # ---- lifecycle -------------------------------------------------------- #

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(10.0),
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ---- public API ------------------------------------------------------- #

    async def send_alert(self, message: str,
                         severity: str = "INFO") -> bool:
        """Send a plain-text alert to the Telegram chat.

        Returns ``True`` on success, ``False`` if disabled or failed.
        """
        if not self.enabled:
            return False
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        text = f"[{severity}] {ts}\n{message}"
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {"chat_id": self.chat_id, "text": text,
                   "parse_mode": "HTML", "disable_web_page_preview": True}
        try:
            client = await self._get_client()
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                logger.warning("Telegram send_alert HTTP %s: %s",
                               resp.status_code, resp.text[:200])
                return False
            return True
        except Exception as exc:  # pragma: no cover
            logger.warning("Telegram send_alert failed: %s", exc)
            return False

    async def send_kill_switch(self, reason: str) -> bool:
        return await self.send_alert(
            f"KILL SWITCH engaged: {reason}", severity="CRITICAL")

    async def send_hard_stop(self, pnl_pct: float) -> bool:
        return await self.send_alert(
            f"HARD STOP triggered (daily PnL {pnl_pct:.2%}) - bot locked "
            f"for the rest of the day.", severity="CRITICAL")

    async def send_connection_lost(self, service: str) -> bool:
        return await self.send_alert(
            f"Connection lost: {service}", severity="ERROR")

    async def send_weekly_summary(self, summary: dict[str, Any]) -> bool:
        lines = ["Weekly summary:"]
        for k, v in summary.items():
            lines.append(f"  {k}: {v}")
        return await self.send_alert("\n".join(lines), severity="INFO")

    async def send_test(self) -> bool:
        """Send a test message - used by /api/notifications/test."""
        return await self.send_alert(
            "Test notification from forex-scalping-backend", severity="INFO")

    # ---- BACKEND-FEATURES #6: Telegram remote control --------------------- #

    async def send_photo(self, chat_id: str, photo_bytes: bytes,
                         caption: str = "") -> bool:
        """Send a photo (raw bytes) to a Telegram chat.

        Used by /chart command + screenshot endpoint to push chart images.
        """
        if not self.enabled or not photo_bytes:
            return False
        url = (f"https://api.telegram.org/bot{self.bot_token}/sendPhoto")
        try:
            client = await self._get_client()
            files = {"photo": ("chart.png", photo_bytes, "image/png")}
            data = {"chat_id": chat_id, "caption": caption[:1024]}
            resp = await client.post(url, data=data, files=files,
                                     timeout=30.0)
            if resp.status_code != 200:
                logger.warning("Telegram sendPhoto HTTP %s: %s",
                               resp.status_code, resp.text[:200])
                return False
            return True
        except Exception as exc:  # pragma: no cover
            logger.warning("Telegram send_photo failed: %s", exc)
            return False

    async def send_chart_screenshot(self, chat_id: str | None,
                                    symbol: str) -> bool:
        """Capture + send a chart screenshot for ``symbol``.

        Uses :mod:`screenshot` to render the chart and uploads the bytes
        to Telegram.
        """
        target_chat = chat_id or self.chat_id
        if not target_chat:
            return False
        try:
            from screenshot import get_screenshot_capture
            cap = get_screenshot_capture()
            path = cap.capture_chart(symbol)
            if path is None:
                await self.send_alert(f"No chart available for {symbol}")
                return False
            with open(path, "rb") as fh:
                photo_bytes = fh.read()
            return await self.send_photo(target_chat, photo_bytes,
                                         caption=f"{symbol} chart")
        except Exception as exc:  # pragma: no cover
            logger.warning("send_chart_screenshot failed: %s", exc)
            return False

    async def handle_command(self, text: str,
                             chat_id: str | None = None) -> str:
        """Parse and execute a Telegram command.

        Supported commands:
            /status    — bot status + open positions + today P&L
            /start     — start bot
            /stop      — stop bot
            /kill      — emergency kill switch
            /report    — send daily report summary
            /chart SYM — send chart screenshot for SYM
            /positions — list open positions
            /signals   — list recent signals
            /help      — list available commands

        Returns the reply text (also sent via send_alert).
        """
        text = (text or "").strip()
        if not text.startswith("/"):
            return "Unknown command. Send /help for the list."
        parts = text.split()
        cmd = parts[0].lower()
        args = parts[1:]
        target_chat = chat_id or self.chat_id

        # Lazily import engine + db to avoid circular imports at module load
        from trading_engine import get_engine
        import database as db_mod
        from config import settings as _settings

        try:
            engine = get_engine()
        except Exception as exc:  # pragma: no cover
            return f"Engine unavailable: {exc}"

        if cmd == "/help":
            reply = (
                "Available commands:\n"
                "  /status     — bot status + open positions + today P&L\n"
                "  /start      — start auto-trading\n"
                "  /stop       — stop bot\n"
                "  /kill       — emergency kill switch\n"
                "  /report     — send daily report summary\n"
                "  /chart SYM  — send chart screenshot for SYM\n"
                "  /positions  — list open positions\n"
                "  /signals    — list recent signals\n"
                "  /help       — this message"
            )
        elif cmd == "/status":
            snap = engine.snapshot()
            reply = (
                f"Bot: running={snap.get('is_running')} "
                f"locked={snap.get('is_locked')} "
                f"kill={snap.get('kill_switch')}\n"
                f"Balance: {snap.get('balance', 0):.2f} "
                f"Equity: {snap.get('equity', 0):.2f}\n"
                f"Open positions: {snap.get('open_positions', 0)}\n"
                f"Daily trades: {snap.get('daily_trades', 0)} "
                f"Daily P&L: {snap.get('daily_pnl', 0):.2f}\n"
                f"Paper: {snap.get('paper_mode')} Dry: {snap.get('dry_run')}"
            )
        elif cmd == "/start":
            result = await engine.start()
            reply = f"/start → {'OK' if result.get('ok') else 'FAILED'}: " \
                    f"{result.get('message', '')}"
        elif cmd == "/stop":
            result = await engine.stop(reason="telegram")
            reply = f"/stop → {'OK' if result.get('ok') else 'FAILED'}: " \
                    f"{result.get('message', '')}"
        elif cmd == "/kill":
            result = await engine.kill(reason="telegram")
            closed = result.get("closed", [])
            reply = (f"/kill → closed {len(closed)} positions "
                     f"(reason: {result.get('reason', '')})")
        elif cmd == "/report":
            from email_report import get_email_reporter, build_daily_stats
            today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            today_trades = [t for t in db_mod.list_trades(limit=500)
                            if (t.get("open_time") or "").startswith(today_iso)]
            snap = engine.snapshot()
            stats = build_daily_stats(
                trades=today_trades,
                bot_status=("running" if snap.get("is_running") else "stopped"),
                open_positions=int(snap.get("open_positions", 0)),
                starting_balance=float(snap.get("balance", 0)),
                ending_balance=float(snap.get("equity", snap.get("balance", 0))),
                tomorrow_news=[],
            )
            reply = (
                f"Daily report — {today_iso}\n"
                f"Trades: {stats['wins'] + stats['losses']} "
                f"(W{stats['wins']} L{stats['losses']})\n"
                f"P&L: {stats['pnl_total']:+.2f}\n"
                f"R-net: {stats['r_net_total']:+.2f}R"
            )
        elif cmd == "/chart":
            symbol = args[0].upper() if args else ""
            if not symbol:
                reply = "Usage: /chart EURUSD"
            else:
                ok = await self.send_chart_screenshot(target_chat, symbol)
                reply = ("Chart sent" if ok
                         else f"Could not capture chart for {symbol}")
                # Already sent via send_photo, so don't double-send below
                return reply
        elif cmd == "/positions":
            positions = []
            try:
                from mt5_connector import get_connector, MT5_AVAILABLE
                if MT5_AVAILABLE and get_connector().connected:
                    positions = get_connector().get_positions()
            except Exception as exc:  # pragma: no cover
                reply = f"positions error: {exc}"
            else:
                if not positions:
                    reply = "No open positions."
                else:
                    lines = [f"{p.symbol} {p.type} {p.volume:.2f} @ "
                             f"{p.open_price} profit={p.profit:+.2f}"
                             for p in positions[:10]]
                    reply = "Open positions:\n" + "\n".join(lines)
        elif cmd == "/signals":
            sigs = db_mod.list_signals(limit=5)
            if not sigs:
                reply = "No recent signals."
            else:
                lines = [f"{s.get('symbol')} {s.get('direction')} "
                         f"rr={s.get('rr_net')} executed={s.get('executed')}"
                         for s in sigs]
                reply = "Recent signals:\n" + "\n".join(lines)
        else:
            reply = (f"Unknown command: {cmd}. Send /help for the list.")

        # Echo the reply to Telegram as well
        if self.enabled and target_chat:
            await self.send_alert(reply, severity="INFO")
        return reply

    async def start_polling(self) -> None:
        """Long-poll Telegram getUpdates and dispatch commands.

        Designed to run as a background asyncio task in the FastAPI lifespan.
        Cancels gracefully on shutdown.
        """
        if not self.enabled:
            logger.info("Telegram polling disabled (not configured)")
            return
        if not cfg.TELEGRAM_COMMANDS_ENABLED:
            logger.info("Telegram commands disabled via config")
            return
        url = (f"https://api.telegram.org/bot{self.bot_token}/getUpdates")
        offset: int = 0
        logger.info("Telegram polling started")
        while True:
            try:
                client = await self._get_client()
                resp = await client.post(
                    url,
                    json={"offset": offset,
                          "timeout": _TELEGRAM_POLL_TIMEOUT_S},
                    timeout=float(_TELEGRAM_POLL_TIMEOUT_S + 10),
                )
                if resp.status_code != 200:
                    logger.warning("getUpdates HTTP %s", resp.status_code)
                    await asyncio.sleep(_TELEGRAM_POLL_RETRY_S)
                    continue
                data = resp.json()
                updates = data.get("result", []) or []
                for upd in updates:
                    offset = max(offset, int(upd.get("update_id", 0)) + 1)
                    msg = upd.get("message") or upd.get("channel_post")
                    if not msg:
                        continue
                    text = msg.get("text") or ""
                    chat = msg.get("chat") or {}
                    chat_id = str(chat.get("id", ""))
                    if text.startswith("/"):
                        try:
                            await self.handle_command(text, chat_id)
                        except Exception as exc:  # pragma: no cover
                            logger.warning("command handling failed: %s", exc)
            except asyncio.CancelledError:
                logger.info("Telegram polling cancelled")
                raise
            except Exception as exc:  # pragma: no cover
                logger.warning("Telegram poll error: %s", exc)
                await asyncio.sleep(_TELEGRAM_POLL_RETRY_S)

    # ---- EventBus integration -------------------------------------------- #

    async def handle_event(self, event: dict[str, Any]) -> None:
        """Forward an EventBus event to Telegram if it's in the subscribed set.

        This is meant to be called by the engine's bus subscriber loop.
        """
        event_type = event.get("type") or ""
        if event_type not in _SUBSCRIBED_EVENTS:
            return
        severity_map = {
            "kill_switch_engaged": "CRITICAL",
            "kill_switch_released": "INFO",
            "hard_stop": "CRITICAL",
            "connection_lost": "ERROR",
            "margin_warning": "WARN",
            "margin_call_prevented": "CRITICAL",
            "margin_emergency": "CRITICAL",
            "weekend_close": "WARN",
            "news_reduce": "WARN",
            "engine_started": "INFO",
            "engine_stopped": "INFO",
        }
        severity = severity_map.get(event_type, "INFO")
        # Strip the trailing ts to keep the message readable.
        payload = {k: v for k, v in event.items()
                   if k not in ("type", "ts")}
        text = f"{event_type}: {payload}"
        await self.send_alert(text, severity=severity)


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_manager: NotificationManager | None = None


def get_notification_manager() -> NotificationManager:
    """Return the module-level NotificationManager singleton."""
    global _default_manager
    if _default_manager is None:
        _default_manager = NotificationManager()
    return _default_manager


async def close_default_manager() -> None:
    global _default_manager
    if _default_manager is not None:
        await _default_manager.close()
        _default_manager = None


__all__ = [
    "NotificationManager",
    "get_notification_manager", "close_default_manager",
    "TELEGRAM_COMMANDS",
]
