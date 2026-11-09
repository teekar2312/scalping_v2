"""
ollama_analyzer.py
==================
Local LLM integration via Ollama (model: llama3.2:latest).

The system prompt embeds the full V2 strategy so the model always evaluates
trading setups against the same rules the deterministic engine uses.  The AI
is **advisory only** - the strategy engine makes the final go/no-go decision.

Endpoints used (Ollama native API):
    * POST /api/chat      - multi-turn chat (supports streaming)
    * POST /api/generate  - one-shot generation
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator

import httpx

from config import settings

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# V2 strategy system prompt
# --------------------------------------------------------------------------- #

V2_STRATEGY_SYSTEM_PROMPT = """\
You are the AI compliance analyst for an automated Forex scalping bot that
follows the **V2 Scalping Strategy** strictly.  You evaluate trade setups
against the rules below and return a JSON verdict.  You DO NOT place trades;
the deterministic engine does that.  Your job is to double-check compliance
and flag risks the engine may have missed.

=== V2 STRATEGY CORE RULES ===

1. Three core indicators:
   - EMA9 & EMA21 (trend direction / alignment)
   - VWAP harian (institutional level - price above VWAP = bullish bias)
   - ATR(14) (volatility - used for SL distance)

2. Regime filter: ADX(14) on the 15M timeframe.
   - ADX > 25  -> TRENDING  -> trade allowed
   - ADX < 20  -> RANGING   -> SKIP (no new entries)
   - ADX 20-25 -> TRANSITION -> WAIT (no new entries)

3. Stop loss (adaptive):
   - SL = 1.5 x ATR(14) + 2 pip buffer, placed OUTSIDE the recent swing.
   - Buy: SL below swing low minus buffer.
   - Sell: SL above swing high plus buffer.

4. Risk management:
   - Risk 1% of balance per trade.
   - Max 3 positions simultaneous.
   - Max 5 trades per day.
   - Tiered stops:
       Soft    -1% (pause new entries for the day)
       Hard    -2% (close all + stop bot for the day)
       Weekly  -4% (lock bot for the rest of the week)
       Overall -10% (lock bot indefinitely - manual restart)

5. Reward-to-Risk:
   - RR Net = (TP_brutto - biaya) / (SL_brutto + biaya)
   - biaya = spread + komisi (in pips)
   - Minimum RR Net >= 2.0 required to enter.
   - TP1 = 2 x SL distance (close 50% of position, move SL to BE+2)
   - TP2 = 4 x SL distance (close 30%, trail last 20% at 2 x ATR)

6. Trading sessions (WIB / UTC+7):
   - Tokyo    09:00-12:00  (active)
   - London   14:00-17:00  (active)
   - Overlap  20:00-22:00  (active, highest liquidity)
   - SKIP:    Sydney 05:00-14:00, London lunch 17:00-19:30
   - SKIP:    Monday early session (00:00-07:00) - weekend gap risk
   - SKIP:    Friday after 22:00 - weekend hold risk

7. News blackout:
   - +-30 minutes around HIGH impact news events for the relevant currency.
   - Skip both currencies of the pair (e.g. EURUSD during USD or EUR news).

8. Pre-trade 8-point checklist (ALL must pass):
   1. ADX > 25 (regime TRENDING on 15M)
   2. EMA alignment: for BUY, EMA9 > EMA21; for SELL, EMA9 < EMA21.
   3. VWAP on the same side: BUY -> price above VWAP; SELL -> price below VWAP.
   4. Pullback to EMA zone (price within ~1 ATR of EMA9 or EMA21).
   5. Valid candle pattern (bullish/bearish engulfing, pin bar). Inside bar OK
      only in trending regime.
   6. SL = 1.5 x ATR(14) + 2 pip buffer outside swing.
   7. RR Net >= 2.0 at TP1 (after spread + commission).
   8. No HIGH-impact news within +-30 min AND no soft stop currently hit.

9. Pairs (priority order):
   - EUR/USD (#1): spread ECN 0.6-0.8 pips, ADR 80-100, smooth trends.
   - GBP/USD (#2): more volatile, larger swings.
   - USD/JPY (#3): smooth trending behavior, low spread.

10. Costs:
    - Commission: assume broker ECN commission per side (configured externally).
    - Spread: read live from MT5 symbol info.

=== OUTPUT FORMAT ===

When asked to analyze a setup, respond with ONE JSON object only (no prose):

{
  "compliant": true|false,
  "score": 0-100,
  "checklist_passed": ["adx_trending", "ema_alignment", ...],
  "checklist_failed": ["vwap_side", ...],
  "risks": ["short list of any concerns not in the 8-pt checklist"],
  "suggestion": "short tactical note or 'proceed'",
  "confidence": 0.0-1.0
}

If `compliant` is false, ALWAYS include the failing reasons in `checklist_failed`
and a one-line `suggestion` for what to wait for.

When asked a free-form question (chat mode), answer concisely in the user's
language (default English, but mirror the user's language if they write in
Bahasa Indonesia).  Keep answers under 200 words unless asked for detail.

Never invent indicator values - only use the numbers in the user's message.
"""


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass
class AIAnalysis:
    """Result of :meth:`OllamaClient.analyze_setup`."""
    compliant: bool
    score: int
    checklist_passed: list[str]
    checklist_failed: list[str]
    risks: list[str]
    suggestion: str
    confidence: float
    raw: str


# --------------------------------------------------------------------------- #
# BACKEND-100 #7: news sentiment dataclass + system prompt
# --------------------------------------------------------------------------- #

NEWS_SENTIMENT_SYSTEM_PROMPT = """\
You are a forex news sentiment classifier.  Given a news headline and
optional body text, classify the sentiment for the affected currency as
BULLISH, BEARISH or NEUTRAL.

Return a single JSON object only (no prose):
{
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 0.0 - 1.0,
  "affected_currencies": ["USD", "EUR", ...]
}

Rules:
- BULLISH: news likely to strengthen the currency (rate hike, strong data,
  hawkish central bank, etc.).
- BEARISH: news likely to weaken the currency (rate cut, weak data, dovish
  central bank, political instability, etc.).
- NEUTRAL: news is mixed, expected, or low impact.
- Only list currencies directly mentioned or implied in the headline/body.
- Keep confidence <= 0.5 for NEUTRAL or ambiguous news.
"""


@dataclass
class NewsSentiment:
    """Result of :meth:`OllamaClient.analyze_news_sentiment`."""
    sentiment: str             # BULLISH | BEARISH | NEUTRAL
    confidence: float
    affected_currencies: list[str]
    raw: str


# --------------------------------------------------------------------------- #
# Client
# --------------------------------------------------------------------------- #

class OllamaClient:
    """Async client for the local Ollama daemon (llama3.2:latest)."""

    def __init__(self,
                 base_url: str | None = None,
                 model: str | None = None,
                 timeout_s: float | None = None,
                 temperature: float | None = None) -> None:
        self.base_url = (base_url or settings.ollama.base_url).rstrip("/")
        self.model = model or settings.ollama.model
        self.timeout_s = timeout_s or settings.ollama.timeout_s
        self.temperature = temperature if temperature is not None \
            else settings.ollama.temperature
        self._client: httpx.AsyncClient | None = None

    # ---- lifecycle --------------------------------------------------------- #

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout_s),
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ---- health ------------------------------------------------------------ #

    async def is_available(self) -> bool:
        """Ping the Ollama daemon and confirm the model is available."""
        try:
            client = await self._get_client()
            resp = await client.get("/api/tags", timeout=5.0)
            if resp.status_code != 200:
                return False
            tags = resp.json().get("models", [])
            names = [m.get("name", "") for m in tags]
            # Allow loose match (e.g. "llama3.2:latest" matches "llama3.2")
            target = self.model.split(":")[0]
            return any(target in n for n in names)
        except Exception as exc:  # pragma: no cover
            logger.warning("Ollama availability check failed: %s", exc)
            return False

    # ---- chat -------------------------------------------------------------- #

    async def chat(self,
                   messages: list[dict[str, str]],
                   stream: bool = False) -> str | AsyncIterator[str]:
        """Send a multi-turn chat request.

        Parameters
        ----------
        messages : list of {role, content}
            Conversation history (system message is prepended automatically
            if not present).
        stream : bool
            If True, returns an async iterator of token chunks.

        Returns
        -------
        str | AsyncIterator[str]
            Full response text, or an async iterator when streaming.
        """
        full_messages = self._with_system(messages)
        payload = {
            "model": self.model,
            "messages": full_messages,
            "stream": stream,
            "options": {"temperature": self.temperature},
        }
        client = await self._get_client()
        if stream:
            return self._stream_chat(payload, client)
        resp = await client.post("/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "")

    async def _stream_chat(self,
                           payload: dict[str, Any],
                           client: httpx.AsyncClient) -> AsyncIterator[str]:
        """Yield content chunks from a streaming /api/chat response."""
        async with client.stream("POST", "/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = obj.get("message", {})
                content = msg.get("content", "")
                if content:
                    yield content
                if obj.get("done"):
                    break

    def _with_system(self, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        """Prepend the V2 strategy system prompt if not present."""
        if messages and messages[0].get("role") == "system":
            return messages
        return [{"role": "system", "content": V2_STRATEGY_SYSTEM_PROMPT}] + messages

    # ---- setup analysis ---------------------------------------------------- #

    async def analyze_setup(self, signal_data: dict[str, Any]) -> AIAnalysis:
        """Ask the model to evaluate a trade setup against V2 rules.

        Parameters
        ----------
        signal_data : dict
            The :class:`SignalContext` payload (already computed by the
            strategy engine).

        Returns
        -------
        AIAnalysis
            Parsed verdict.  On any error returns a fail-closed
            ``compliant=False`` result.
        """
        user_msg = (
            "Analyze this V2 scalping setup and return JSON only.\n\n"
            f"{json.dumps(signal_data, indent=2, default=str)}"
        )
        messages = [{"role": "user", "content": user_msg}]
        try:
            raw = await self.chat(messages, stream=False)
        except Exception as exc:  # pragma: no cover
            logger.exception("Ollama analyze_setup failed: %s", exc)
            return AIAnalysis(
                compliant=False, score=0,
                checklist_passed=[], checklist_failed=["ai_unavailable"],
                risks=[f"Ollama error: {exc}"],
                suggestion="skip - AI unavailable",
                confidence=0.0,
                raw="",
            )
        return self._parse_analysis(raw)

    @staticmethod
    def _parse_analysis(raw: str) -> AIAnalysis:
        """Best-effort parse of the model's JSON response."""
        # Try to extract a JSON block
        text = raw.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [ln for ln in lines if not ln.startswith("```")]
            text = "\n".join(lines)
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            # Try to find first { ... } block
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    obj = json.loads(text[start:end + 1])
                except json.JSONDecodeError:
                    obj = None
            else:
                obj = None
        if not isinstance(obj, dict):
            return AIAnalysis(
                compliant=False, score=0,
                checklist_passed=[], checklist_failed=["ai_parse_error"],
                risks=["Model response was not valid JSON"],
                suggestion="skip - parse error",
                confidence=0.0,
                raw=raw,
            )
        return AIAnalysis(
            compliant=bool(obj.get("compliant", False)),
            score=int(obj.get("score", 0)),
            checklist_passed=list(obj.get("checklist_passed", []) or []),
            checklist_failed=list(obj.get("checklist_failed", []) or []),
            risks=list(obj.get("risks", []) or []),
            suggestion=str(obj.get("suggestion", "")),
            confidence=float(obj.get("confidence", 0.0)),
            raw=raw,
        )

    # ---- weekly review ----------------------------------------------------- #

    async def weekly_review(self, trades: list[dict[str, Any]]) -> str:
        """Generate a short weekly performance review."""
        summary_lines = []
        for t in trades[:50]:
            summary_lines.append(
                f"- {t.get('symbol')} {t.get('direction')} "
                f"vol={t.get('volume')} pips={t.get('pips')} "
                f"profit={t.get('profit')} rr_net={t.get('rr_net')} "
                f"exit={t.get('exit_reason')}"
            )
        body = "\n".join(summary_lines) or "(no trades this week)"
        user_msg = (
            "Summarise this week's V2 strategy trades.  Highlight what worked, "
            "what failed the 8-point checklist most often, and one concrete "
            "improvement for next week.  Keep under 250 words.\n\n"
            f"Trades:\n{body}"
        )
        return await self.chat([{"role": "user", "content": user_msg}],
                               stream=False)

    # ---- BACKEND-100 #7: news sentiment ----------------------------------- #

    async def analyze_news_sentiment(self, title: str,
                                     body: str = "",
                                     currency: str | None = None
                                     ) -> NewsSentiment:
        """Classify a forex news headline + body for sentiment.

        Parameters
        ----------
        title : str
            News headline text.
        body : str
            Optional body / summary text.  Default empty.
        currency : str | None
            Optional ISO currency code (e.g. "USD") that should be the focus
            of the sentiment.  When provided, included in the prompt so the
            model returns sentiment *for that currency*.

        Returns
        -------
        NewsSentiment
            Parsed sentiment.  On any error returns NEUTRAL with confidence 0.
        """
        focus = f" for {currency.upper()}" if currency else ""
        user_msg = (
            f"Classify the following forex news sentiment{focus} and return "
            f"JSON only.\n\nHeadline: {title}\nBody: {body or '(none)'}"
        )
        messages = [{"role": "system",
                     "content": NEWS_SENTIMENT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg}]
        try:
            raw = await self.chat(messages, stream=False)
        except Exception as exc:  # pragma: no cover
            logger.warning("analyze_news_sentiment chat failed: %s", exc)
            return NewsSentiment(
                sentiment="NEUTRAL", confidence=0.0,
                affected_currencies=[], raw="",
            )
        return self._parse_news_sentiment(raw, currency)

    @staticmethod
    def _parse_news_sentiment(raw: str,
                              currency: str | None = None) -> NewsSentiment:
        """Best-effort parse of the model's sentiment JSON response."""
        text = raw.strip()
        # Strip markdown code fences if present.
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [ln for ln in lines if not ln.startswith("```")]
            text = "\n".join(lines)
        obj: Any = None
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    obj = json.loads(text[start:end + 1])
                except json.JSONDecodeError:
                    obj = None
        if not isinstance(obj, dict):
            # Fall back: scan for keywords in the raw text.
            t_low = text.lower()
            if "bullish" in t_low:
                return NewsSentiment("BULLISH", 0.3,
                                     [currency] if currency else [], raw)
            if "bearish" in t_low:
                return NewsSentiment("BEARISH", 0.3,
                                     [currency] if currency else [], raw)
            return NewsSentiment("NEUTRAL", 0.0,
                                 [currency] if currency else [], raw)
        sent = str(obj.get("sentiment", "NEUTRAL")).upper()
        if sent not in ("BULLISH", "BEARISH", "NEUTRAL"):
            sent = "NEUTRAL"
        conf = float(obj.get("confidence", 0.0) or 0.0)
        affected = list(obj.get("affected_currencies", []) or [])
        if not isinstance(affected, list):
            affected = []
        affected = [str(c).upper() for c in affected if c]
        if currency and currency.upper() not in affected:
            affected.insert(0, currency.upper())
        return NewsSentiment(
            sentiment=sent, confidence=conf,
            affected_currencies=affected, raw=raw,
        )


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_client: OllamaClient | None = None


def get_analyzer() -> OllamaClient:
    """Return the module-level Ollama client."""
    global _default_client
    if _default_client is None:
        _default_client = OllamaClient()
    return _default_client


async def close_default_client() -> None:
    global _default_client
    if _default_client is not None:
        await _default_client.close()
        _default_client = None


__all__ = [
    "OllamaClient", "AIAnalysis",
    "V2_STRATEGY_SYSTEM_PROMPT",
    "NewsSentiment", "NEWS_SENTIMENT_SYSTEM_PROMPT",
    "get_analyzer", "close_default_client",
]
