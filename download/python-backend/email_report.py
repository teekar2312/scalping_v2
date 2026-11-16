"""
email_report.py
===============
Automated HTML email reporting for the Forex scalping backend.

Features
--------
* :class:`EmailReporter` — async SMTP client that renders + sends:
    - Daily trading report (scheduled 23:00 WIB)
    - Weekly summary
    - Critical real-time alerts

The module degrades gracefully if ``aiosmtplib`` is not installed: every
``send_*`` method returns ``False`` and a warning is logged.  This keeps the
backend importable on minimal dev hosts (e.g. CI containers without SMTP).

Configuration (env vars):
    SMTP_HOST   — mail server hostname (e.g. smtp.gmail.com)
    SMTP_PORT   — TCP port (default 587 for STARTTLS)
    SMTP_USER   — auth username
    SMTP_PASS   — auth password (app-specific for Gmail)
    EMAIL_FROM  — From: address
    EMAIL_TO    — comma-separated recipient list

Endpoints exposed by main.py:
    POST /api/reports/send-test    — send a test email
    GET  /api/reports/daily        — return last daily report as HTML
"""

from __future__ import annotations

import asyncio
import html as _html
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import config as cfg

try:
    import aiosmtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    _AIOSMTPLIB_AVAILABLE = True
except ImportError:  # pragma: no cover
    aiosmtplib = None  # type: ignore
    MIMEMultipart = None  # type: ignore
    MIMEText = None  # type: ignore
    _AIOSMTPLIB_AVAILABLE = False

logger = logging.getLogger(__name__)


# WIB timezone (Asia/Jakarta, UTC+7).  Falls back to UTC if zoneinfo is
# unavailable (very old Python).  Imported lazily to avoid stdlib issues.
try:
    from zoneinfo import ZoneInfo
    WIB_TZ = ZoneInfo("Asia/Jakarta")
except Exception:  # pragma: no cover
    WIB_TZ = timezone(timedelta(hours=7))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _escape(s: Any) -> str:
    return _html.escape(str(s) if s is not None else "")


def _fmt_money(v: Any, ccy: str = "USD") -> str:
    return f"{_safe_float(v):+.2f} {ccy}"


def _fmt_pct(v: Any, digits: int = 2) -> str:
    return f"{_safe_float(v):.{digits}f}%"


# --------------------------------------------------------------------------- #
# EmailReporter
# --------------------------------------------------------------------------- #

class EmailReporter:
    """Async SMTP client for daily/weekly/alert emails.

    Parameters
    ----------
    smtp_host, smtp_port, smtp_user, smtp_pass : str / int
        SMTP server connection details.
    from_addr : str
        From: address.
    to_addr : str
        Comma-separated recipient list.
    """

    def __init__(self,
                 smtp_host: str | None = None,
                 smtp_port: int | None = None,
                 smtp_user: str | None = None,
                 smtp_pass: str | None = None,
                 from_addr: str | None = None,
                 to_addr: str | None = None) -> None:
        self.smtp_host = smtp_host or cfg.SMTP_HOST
        self.smtp_port = int(smtp_port or cfg.SMTP_PORT)
        self.smtp_user = smtp_user or cfg.SMTP_USER
        self.smtp_pass = smtp_pass or cfg.SMTP_PASS
        self.from_addr = from_addr or cfg.EMAIL_FROM
        self.to_addr = to_addr or cfg.EMAIL_TO
        self.enabled: bool = bool(
            self.smtp_host and self.smtp_user and self.smtp_pass
            and self.from_addr and self.to_addr
        )
        # Cache the last rendered daily report so GET /api/reports/daily
        # can return it without re-rendering.
        self._last_daily_html: str = ""
        self._last_daily_at: datetime | None = None
        if not _AIOSMTPLIB_AVAILABLE:
            logger.warning(
                "aiosmtplib not installed - EmailReporter.send_* will "
                "return False.  Run: pip install aiosmtplib",
            )
        if not self.enabled:
            logger.info("Email reporter disabled (missing SMTP config)")

    # ------------------------------------------------------------------ #
    # SMTP send helper
    # ------------------------------------------------------------------ #

    async def _send(self, subject: str, html_body: str,
                    to_addrs: list[str] | None = None) -> bool:
        """Send an HTML email via STARTTLS.  Returns ``True`` on success."""
        if not self.enabled or not _AIOSMTPLIB_AVAILABLE:
            return False
        recipients = to_addrs or [r.strip() for r in self.to_addr.split(",")
                                  if r.strip()]
        if not recipients:
            return False
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = self.from_addr
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        try:
            await aiosmtplib.send(
                msg,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_user,
                password=self.smtp_pass,
                start_tls=True,
                timeout=30.0,
            )
            logger.info("Email sent: '%s' to %s", subject, recipients)
            return True
        except Exception as exc:  # pragma: no cover
            logger.warning("Email send failed ('%s'): %s", subject, exc)
            return False

    # ------------------------------------------------------------------ #
    # HTML rendering helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _html_wrapper(title: str, body: str) -> str:
        """Wrap a body fragment in a styled HTML document."""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{_escape(title)}</title>
<style>
  body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 0;
         padding: 24px; background: #f7f9fc; color: #1f2937; }}
  .container {{ max-width: 720px; margin: 0 auto;
               background: white; padding: 28px 32px;
               border-radius: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); }}
  h1 {{ color: #0f172a; margin-top: 0; font-size: 22px; }}
  h2 {{ color: #1e40af; margin-top: 24px; font-size: 16px;
        border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0; }}
  th, td {{ text-align: left; padding: 8px 12px;
            border-bottom: 1px solid #e5e7eb; font-size: 13px; }}
  th {{ background: #f1f5f9; font-weight: 600; }}
  .metric {{ display: inline-block; min-width: 130px; margin: 4px 0; }}
  .positive {{ color: #059669; font-weight: 600; }}
  .negative {{ color: #dc2626; font-weight: 600; }}
  .muted {{ color: #6b7280; }}
  .footer {{ margin-top: 28px; font-size: 11px; color: #94a3b8;
             border-top: 1px solid #e5e7eb; padding-top: 12px; }}
</style>
</head>
<body><div class="container">
{body}
<div class="footer">Forex Scalping V2 backend • generated automatically</div>
</div></body></html>"""

    def _render_daily(self, trades: list[dict[str, Any]],
                      stats: dict[str, Any]) -> str:
        """Render the daily report HTML body."""
        now_wib = datetime.now(WIB_TZ)
        date_str = now_wib.strftime("%A, %d %B %Y")
        wins = int(stats.get("wins", 0))
        losses = int(stats.get("losses", 0))
        total = wins + losses
        win_rate = (wins / total * 100.0) if total else 0.0
        r_net = _safe_float(stats.get("r_net_total"))
        pnl = _safe_float(stats.get("pnl_total"))
        pnl_class = "positive" if pnl >= 0 else "negative"
        bot_status = _escape(str(stats.get("bot_status", "—")))
        open_positions = int(stats.get("open_positions", 0))
        starting_balance = _safe_float(stats.get("starting_balance"))
        ending_balance = _safe_float(stats.get("ending_balance",
                                               starting_balance))

        best_trade = stats.get("best_trade") or {}
        worst_trade = stats.get("worst_trade") or {}
        tomorrow_news = stats.get("tomorrow_news") or []

        rows = []
        for t in trades[:10]:
            profit = _safe_float(t.get("profit"))
            cls = "positive" if profit >= 0 else "negative"
            rows.append(
                f"<tr><td>{_escape(t.get('symbol'))}</td>"
                f"<td>{_escape(t.get('direction'))}</td>"
                f"<td class='{cls}'>{_fmt_money(profit)}</td>"
                f"<td>{_safe_float(t.get('rr_net')):.2f}</td>"
                f"<td>{_escape(t.get('exit_reason') or '—')}</td></tr>"
            )
        trades_table = (
            "<table><thead><tr><th>Symbol</th><th>Dir</th><th>P&amp;L</th>"
            "<th>R-net</th><th>Exit reason</th></tr></thead>"
            + "<tbody>" + (''.join(rows) if rows
                            else '<tr><td colspan=5 class=muted>'
                            'No trades today</td></tr>')
            + "</tbody></table>"
        )

        news_rows = []
        for ev in tomorrow_news[:5]:
            news_rows.append(
                f"<tr><td>{_escape(ev.get('event_time') or '')}</td>"
                f"<td>{_escape(ev.get('title'))}</td>"
                f"<td>{_escape(ev.get('impact'))}</td>"
                f"<td>{_escape(ev.get('country') or ev.get('symbol'))}</td></tr>"
            )
        news_table = (
            "<table><thead><tr><th>Time</th><th>Event</th><th>Impact</th>"
            "<th>Ccy</th></tr></thead>"
            + "<tbody>" + (''.join(news_rows) if news_rows
                            else '<tr><td colspan=4 class=muted>'
                            'No high-impact news tomorrow</td></tr>')
            + "</tbody></table>"
        )

        body = f"""
<h1>📅 Daily Report — {date_str}</h1>
<h2>Summary</h2>
<p>
  <span class="metric">Trades: <b>{total}</b></span>
  <span class="metric">Wins: <b class="positive">{wins}</b></span>
  <span class="metric">Losses: <b class="negative">{losses}</b></span>
  <span class="metric">Win rate: <b>{_fmt_pct(win_rate)}</b></span>
</p>
<p>
  <span class="metric">R-net total: <b>{r_net:+.2f}R</b></span>
  <span class="metric">P&L total: <b class="{pnl_class}">{_fmt_money(pnl)}</b></span>
</p>
<p>
  <span class="metric">Starting balance: <b>{starting_balance:,.2f}</b></span>
  <span class="metric">Ending balance: <b>{ending_balance:,.2f}</b></span>
</p>

<h2>Bot Status</h2>
<p>
  <span class="metric">Status: <b>{bot_status}</b></span>
  <span class="metric">Open positions: <b>{open_positions}</b></span>
</p>

<h2>Best / Worst Trade</h2>
<p>
  <span class="metric">Best: <b class="positive">
    {_escape(best_trade.get('symbol'))} {_fmt_money(best_trade.get('profit'))}
  </b></span>
  <span class="metric">Worst: <b class="negative">
    {_escape(worst_trade.get('symbol'))} {_fmt_money(worst_trade.get('profit'))}
  </b></span>
</p>

<h2>Trade History (last 10)</h2>
{trades_table}

<h2>Tomorrow's News Events</h2>
{news_table}
"""
        return self._html_wrapper(f"Daily Report — {date_str}", body)

    def _render_weekly(self, week_trades: list[dict[str, Any]],
                       stats: dict[str, Any]) -> str:
        """Render the weekly summary HTML body."""
        now_wib = datetime.now(WIB_TZ)
        week_start = (now_wib - timedelta(days=now_wib.weekday())).strftime(
            "%d %b %Y")
        wins = int(stats.get("wins", 0))
        losses = int(stats.get("losses", 0))
        total = wins + losses
        win_rate = (wins / total * 100.0) if total else 0.0
        r_net = _safe_float(stats.get("r_net_total"))
        pnl = _safe_float(stats.get("pnl_total"))
        pnl_class = "positive" if pnl >= 0 else "negative"
        body = f"""
<h1>📊 Weekly Summary — week of {week_start}</h1>
<h2>Totals</h2>
<p>
  <span class="metric">Trades: <b>{total}</b></span>
  <span class="metric">Wins: <b class="positive">{wins}</b></span>
  <span class="metric">Losses: <b class="negative">{losses}</b></span>
  <span class="metric">Win rate: <b>{_fmt_pct(win_rate)}</b></span>
</p>
<p>
  <span class="metric">R-net total: <b>{r_net:+.2f}R</b></span>
  <span class="metric">P&L total: <b class="{pnl_class}">{_fmt_money(pnl)}</b></span>
</p>
<p class="muted">Auto-generated by Forex Scalping V2 backend.</p>
"""
        return self._html_wrapper(f"Weekly Summary — {week_start}", body)

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    async def send_daily_report(self, trades: list[dict[str, Any]],
                                stats: dict[str, Any]) -> bool:
        """Render + send the daily report (HTML).  Returns ``True`` on success.

        Parameters
        ----------
        trades : list[dict]
            Today's closed trades (each as returned by :func:`database.list_trades`).
        stats : dict
            Aggregated stats dict with keys ``wins``, ``losses``, ``r_net_total``,
            ``pnl_total``, ``starting_balance``, ``ending_balance``,
            ``bot_status``, ``open_positions``, ``best_trade``, ``worst_trade``,
            ``tomorrow_news`` (list of news event dicts).
        """
        html_body = self._render_daily(trades, stats)
        self._last_daily_html = html_body
        self._last_daily_at = datetime.now(timezone.utc)
        now_wib = datetime.now(WIB_TZ)
        subject = (f"Daily Report — {now_wib.strftime('%Y-%m-%d')} — "
                   f"Forex Scalping V2")
        return await self._send(subject, html_body)

    async def send_weekly_report(self, week_trades: list[dict[str, Any]],
                                 stats: dict[str, Any]) -> bool:
        """Render + send the weekly summary."""
        html_body = self._render_weekly(week_trades, stats)
        now_wib = datetime.now(WIB_TZ)
        subject = (f"Weekly Summary — week of "
                   f"{(now_wib - timedelta(days=now_wib.weekday())).strftime('%Y-%m-%d')}")
        return await self._send(subject, html_body)

    async def send_alert(self, subject: str, message: str) -> bool:
        """Send a critical alert email (plain HTML)."""
        body = f"""
<h1>🚨 {_escape(subject)}</h1>
<p style="font-size:14px;white-space:pre-wrap">{_escape(message)}</p>
<p class="muted">Triggered at {datetime.now(WIB_TZ).strftime('%Y-%m-%d %H:%M:%S')} WIB</p>
"""
        html = self._html_wrapper(subject, body)
        return await self._send(f"[ALERT] {subject}", html)

    # ------------------------------------------------------------------ #
    # Accessors
    # ------------------------------------------------------------------ #

    def get_last_daily_html(self) -> str:
        """Return the last rendered daily report HTML (empty string if none)."""
        return self._last_daily_html

    def get_last_daily_at(self) -> datetime | None:
        """Return the UTC timestamp of the last daily report send (or None)."""
        return self._last_daily_at

    async def send_test(self) -> bool:
        """Send a test email — used by POST /api/reports/send-test."""
        body = """
<h1>✅ Email Test</h1>
<p>This is a test email from the Forex Scalping V2 backend.</p>
<p>If you received this, your SMTP settings are correct.</p>
"""
        html = self._html_wrapper("Email Test", body)
        return await self._send("Test Email — Forex Scalping V2", html)


# --------------------------------------------------------------------------- #
# Daily stats builder
# --------------------------------------------------------------------------- #

def build_daily_stats(trades: list[dict[str, Any]],
                      bot_status: str,
                      open_positions: int,
                      starting_balance: float,
                      ending_balance: float,
                      tomorrow_news: list[dict[str, Any]] | None = None
                      ) -> dict[str, Any]:
    """Aggregate raw trades into the stats dict expected by send_daily_report."""
    wins = sum(1 for t in trades if _safe_float(t.get("profit")) > 0)
    losses = sum(1 for t in trades if _safe_float(t.get("profit")) < 0)
    pnl_total = sum(_safe_float(t.get("profit")) for t in trades)
    r_net_total = sum(_safe_float(t.get("rr_net")) for t in trades)
    best = max(trades, key=lambda t: _safe_float(t.get("profit"))) \
        if trades else {}
    worst = min(trades, key=lambda t: _safe_float(t.get("profit"))) \
        if trades else {}
    return {
        "wins": wins,
        "losses": losses,
        "r_net_total": r_net_total,
        "pnl_total": pnl_total,
        "starting_balance": starting_balance,
        "ending_balance": ending_balance,
        "bot_status": bot_status,
        "open_positions": open_positions,
        "best_trade": best,
        "worst_trade": worst,
        "tomorrow_news": tomorrow_news or [],
    }


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_reporter: EmailReporter | None = None


def get_email_reporter() -> EmailReporter:
    """Return the module-level EmailReporter singleton."""
    global _default_reporter
    if _default_reporter is None:
        _default_reporter = EmailReporter()
    return _default_reporter


__all__ = [
    "EmailReporter",
    "get_email_reporter",
    "build_daily_stats",
]
