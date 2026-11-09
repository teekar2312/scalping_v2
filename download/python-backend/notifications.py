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
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

import config as cfg

logger = logging.getLogger(__name__)


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
]
