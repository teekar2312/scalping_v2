"""
test_news_sentiment.py
======================
Unit tests for ``ollama_analyzer.OllamaClient.analyze_news_sentiment``
and the ``_parse_news_sentiment`` helper (BACKEND-100 #7).

The tests stub out the network call (``chat``) so they don't require a
running Ollama daemon.
"""
from __future__ import annotations

import pytest

from ollama_analyzer import (
    NewsSentiment, OllamaClient, NEWS_SENTIMENT_SYSTEM_PROMPT,
)


def test_news_sentiment_dataclass_fields():
    ns = NewsSentiment(sentiment="BULLISH", confidence=0.8,
                       affected_currencies=["USD"], raw="{}")
    assert ns.sentiment == "BULLISH"
    assert ns.confidence == 0.8
    assert ns.affected_currencies == ["USD"]
    assert ns.raw == "{}"


def test_news_sentiment_system_prompt_mentions_bullish_bearish():
    """The system prompt should mention all three sentiment classes."""
    assert "BULLISH" in NEWS_SENTIMENT_SYSTEM_PROMPT
    assert "BEARISH" in NEWS_SENTIMENT_SYSTEM_PROMPT
    assert "NEUTRAL" in NEWS_SENTIMENT_SYSTEM_PROMPT


def test_parse_news_sentiment_valid_json():
    raw = '{"sentiment": "BULLISH", "confidence": 0.9, "affected_currencies": ["USD"]}'
    ns = OllamaClient._parse_news_sentiment(raw, currency="USD")
    assert ns.sentiment == "BULLISH"
    assert ns.confidence == 0.9
    assert "USD" in ns.affected_currencies


def test_parse_news_sentiment_invalid_json_falls_back_to_keyword():
    raw = "The news looks BULLISH for the dollar."
    ns = OllamaClient._parse_news_sentiment(raw, currency="USD")
    assert ns.sentiment == "BULLISH"
    assert ns.confidence == 0.3
    assert "USD" in ns.affected_currencies


def test_parse_news_sentiment_invalid_json_no_keyword_returns_neutral():
    raw = "Some random text with no sentiment word."
    ns = OllamaClient._parse_news_sentiment(raw, currency=None)
    assert ns.sentiment == "NEUTRAL"
    assert ns.confidence == 0.0


def test_parse_news_sentiment_handles_markdown_fences():
    raw = '```json\n{"sentiment": "BEARISH", "confidence": 0.7}\n```'
    ns = OllamaClient._parse_news_sentiment(raw, currency="EUR")
    assert ns.sentiment == "BEARISH"
    assert ns.confidence == 0.7
    assert "EUR" in ns.affected_currencies


def test_parse_news_sentiment_unknown_sentiment_normalised_to_neutral():
    raw = '{"sentiment": "WHATEVER", "confidence": 0.5}'
    ns = OllamaClient._parse_news_sentiment(raw, currency=None)
    assert ns.sentiment == "NEUTRAL"


@pytest.mark.asyncio
async def test_analyze_news_sentiment_chat_failure_returns_neutral(monkeypatch):
    """When the chat call raises, the function should return NEUTRAL."""
    client = OllamaClient(base_url="http://localhost:99999")

    async def _raise(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(client, "chat", _raise)
    ns = await client.analyze_news_sentiment(
        title="Fed cuts rates", body="", currency="USD")
    assert ns.sentiment == "NEUTRAL"
    assert ns.confidence == 0.0


@pytest.mark.asyncio
async def test_analyze_news_sentiment_parses_chat_reply(monkeypatch):
    """A successful chat reply should be parsed into a NewsSentiment."""
    client = OllamaClient()

    async def _chat(messages, stream=False):
        return ('{"sentiment": "BULLISH", "confidence": 0.85, '
                '"affected_currencies": ["USD"]}')

    monkeypatch.setattr(client, "chat", _chat)
    ns = await client.analyze_news_sentiment(
        title="USD jobs beat", body="", currency="USD")
    assert ns.sentiment == "BULLISH"
    assert ns.confidence == 0.85
    assert "USD" in ns.affected_currencies
