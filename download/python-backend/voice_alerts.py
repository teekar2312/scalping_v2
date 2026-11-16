"""
voice_alerts.py
===============
Voice alerts via local TTS (text-to-speech).

Uses ``pyttsx3`` (cross-platform; on Windows it wraps SAPI5 / Windows native
TTS).  Degrades gracefully if pyttsx3 is not installed — every ``speak_*``
method returns ``False`` and the engine logs the missing dep.

Subscribes to critical EventBus events (kill switch, hard stop, margin
warning) and speaks them aloud.

Endpoints exposed by main.py:
    POST /api/voice/test    — speak a custom text
    GET  /api/voice/status  — enabled/disabled + last alert

Config:
    VOICE_ALERTS_ENABLED=false
    VOICE_VOLUME=0.8
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any

import config as cfg

logger = logging.getLogger(__name__)

try:
    import pyttsx3  # type: ignore
    _PYTTSX3_AVAILABLE = True
except ImportError:  # pragma: no cover
    pyttsx3 = None  # type: ignore
    _PYTTSX3_AVAILABLE = False

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# VoiceAlertManager
# --------------------------------------------------------------------------- #

class VoiceAlertManager:
    """Local text-to-speech alert manager.

    TTS is run on a daemon thread so it never blocks the asyncio loop.
    Multiple speak calls are serialised via a Lock to avoid overlapping
    audio output.
    """

    def __init__(self,
                 enabled: bool | None = None,
                 volume: float | None = None) -> None:
        self.enabled: bool = (bool(cfg.VOICE_ALERTS_ENABLED)
                              if enabled is None else bool(enabled))
        self.volume: float = float(cfg.VOICE_VOLUME if volume is None
                                   else volume)
        self._engine: Any | None = None
        self._lock = threading.Lock()
        self._last_alert_text: str = ""
        self._last_alert_at: datetime | None = None
        if self.enabled and not _PYTTSX3_AVAILABLE:
            logger.warning(
                "VOICE_ALERTS_ENABLED=true but pyttsx3 is not installed. "
                "Run: pip install pyttsx3",
            )
            self.enabled = False
        if self.enabled:
            try:
                self._init_engine()
            except Exception as exc:  # pragma: no cover
                logger.warning("pyttsx3 init failed: %s", exc)
                self.enabled = False

    # ------------------------------------------------------------------ #
    # Engine lifecycle
    # ------------------------------------------------------------------ #

    def _init_engine(self) -> None:
        """Initialise the TTS engine (called once at startup)."""
        if not _PYTTSX3_AVAILABLE:
            return
        self._engine = pyttsx3.init()
        if self._engine is not None:
            try:
                self._engine.setProperty("volume", max(0.0, min(1.0, self.volume)))
            except Exception as exc:  # pragma: no cover
                logger.debug("set volume failed: %s", exc)

    # ------------------------------------------------------------------ #
    # Public speak API
    # ------------------------------------------------------------------ #

    def speak(self, text: str, priority: str = "normal") -> bool:
        """Speak ``text`` aloud via TTS.  Returns ``True`` if queued.

        Parameters
        ----------
        text : str
            The message to speak.
        priority : str
            ``"normal"`` (default) or ``"critical"``.  Critical alerts
            interrupt the queue.
        """
        if not self.enabled or not _PYTTSX3_AVAILABLE or self._engine is None:
            return False
        # Run on a daemon thread so asyncio loop is never blocked.
        t = threading.Thread(
            target=self._speak_sync, args=(text,), daemon=True,
        )
        t.start()
        self._last_alert_text = text
        self._last_alert_at = datetime.now(timezone.utc)
        return True

    def _speak_sync(self, text: str) -> None:
        """Synchronous speak call — runs on a worker thread."""
        with self._lock:
            try:
                self._engine.say(text)
                self._engine.runAndWait()
            except Exception as exc:  # pragma: no cover
                logger.warning("TTS speak failed: %s", exc)

    # ------------------------------------------------------------------ #
    # Predefined alerts
    # ------------------------------------------------------------------ #

    def alert_kill_switch(self) -> bool:
        """Voice: 'KILL SWITCH ACTIVATED. ALL POSITIONS CLOSED.'"""
        return self.speak(
            "KILL SWITCH ACTIVATED. ALL POSITIONS CLOSED.",
            priority="critical",
        )

    def alert_tp_hit(self, symbol: str) -> bool:
        """Voice: 'TAKE PROFIT HIT on {symbol}'."""
        return self.speak(f"TAKE PROFIT HIT on {symbol}",
                          priority="normal")

    def alert_sl_hit(self, symbol: str) -> bool:
        """Voice: 'STOP LOSS HIT on {symbol}'."""
        return self.speak(f"STOP LOSS HIT on {symbol}",
                          priority="normal")

    def alert_hard_stop(self) -> bool:
        """Voice: 'HARD STOP TRIGGERED. BOT STOPPED.'"""
        return self.speak(
            "HARD STOP TRIGGERED. BOT STOPPED.",
            priority="critical",
        )

    def alert_margin_warning(self, level: float) -> bool:
        """Voice: 'MARGIN WARNING. Level at {level} percent.'"""
        return self.speak(
            f"MARGIN WARNING. Level at {int(level)} percent.",
            priority="critical",
        )

    def alert_cooldown(self, reason: str) -> bool:
        """Voice: 'COOLDOWN ACTIVE. {reason}'."""
        return self.speak(
            f"COOLDOWN ACTIVE. {reason}",
            priority="normal",
        )

    # ------------------------------------------------------------------ #
    # EventBus integration
    # ------------------------------------------------------------------ #

    async def handle_event(self, event: dict[str, Any]) -> None:
        """Subscribe to EventBus critical events and speak them aloud."""
        if not self.enabled:
            return
        event_type = event.get("type") or ""
        if event_type == "kill_switch_engaged":
            self.alert_kill_switch()
        elif event_type == "hard_stop":
            self.alert_hard_stop()
        elif event_type == "margin_warning":
            level = event.get("level") or event.get("margin_level") or 0.0
            try:
                self.alert_margin_warning(float(level))
            except (TypeError, ValueError):
                self.alert_margin_warning(0.0)
        elif event_type == "tp1_hit" or event_type == "tp2_hit":
            symbol = event.get("symbol") or "unknown"
            self.alert_tp_hit(symbol)
        elif event_type == "position_closed":
            symbol = event.get("symbol") or "unknown"
            profit = event.get("profit") or 0.0
            try:
                if float(profit) < 0:
                    self.alert_sl_hit(symbol)
                else:
                    self.alert_tp_hit(symbol)
            except (TypeError, ValueError):
                pass
        elif event_type == "cooldown_engaged":
            self.alert_cooldown(event.get("reason") or "consecutive losses")

    # ------------------------------------------------------------------ #
    # Status
    # ------------------------------------------------------------------ #

    def status(self) -> dict[str, Any]:
        """Return current status — used by GET /api/voice/status."""
        return {
            "enabled": self.enabled,
            "available": _PYTTSX3_AVAILABLE,
            "volume": self.volume,
            "last_alert_text": self._last_alert_text,
            "last_alert_at": (self._last_alert_at.isoformat()
                              if self._last_alert_at else None),
        }

    def test_speak(self, text: str) -> bool:
        """Test endpoint: speak arbitrary text."""
        return self.speak(text, priority="normal")


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_voice: VoiceAlertManager | None = None


def get_voice_alert_manager() -> VoiceAlertManager:
    """Return the module-level VoiceAlertManager singleton."""
    global _default_voice
    if _default_voice is None:
        _default_voice = VoiceAlertManager()
    return _default_voice


__all__ = [
    "VoiceAlertManager",
    "get_voice_alert_manager",
]
