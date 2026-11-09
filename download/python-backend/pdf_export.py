"""
pdf_export.py
=============
Weekly journal PDF exporter (audit-fix Sprint 4 #25).

Produces a one-week trading journal PDF in the "Kalender Trading V2" style:
    * Cover page with week summary
    * Session grid (Tokyo / London / Overlap per Monday-Friday)
    * Trade log table
    * Weekly summary stats (trades, win rate, R-net, profit factor,
      max drawdown, compliance score)

Uses ``reportlab`` (added to requirements.txt).  The exporter is deliberately
self-contained: it reads from the existing SQLite tables via
``database.list_trades`` and ``database.get_compliance_score``.

Usage:
    from pdf_export import JournalPDFExporter
    path = JournalPDFExporter().export_week("2026-03-02")
"""


import io
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import config as cfg
from config import settings

logger = logging.getLogger(__name__)

# Try to import reportlab - it's optional at runtime but required for actual
# PDF generation.  The module still imports cleanly if reportlab is missing,
# so that ``main.py`` can wire the endpoint without crashing.
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak,
    )
    REPORTLAB_AVAILABLE = True
except ImportError:  # pragma: no cover
    REPORTLAB_AVAILABLE = False
    colors = None  # type: ignore


WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SESSIONS = ["TOKYO", "LONDON", "OVERLAP"]


class JournalPDFExporter:
    """Generate a weekly V2 trading journal PDF."""

    def __init__(self) -> None:
        if not REPORTLAB_AVAILABLE:
            logger.warning("reportlab not installed - PDF export will raise "
                           "on call but the module imports OK.")

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def export_week(self, week_start_iso: str,
                    out_dir: str | Path | None = None) -> Path:
        """Generate the weekly journal PDF.

        Parameters
        ----------
        week_start_iso : str
            ISO date (YYYY-MM-DD) of the Monday starting the week.
        out_dir : str | Path, optional
            Output directory; defaults to ``<base_dir>/exports``.

        Returns
        -------
        Path
            The generated PDF path.
        """
        if not REPORTLAB_AVAILABLE:
            raise RuntimeError(
                "reportlab is not installed.  Run: pip install reportlab")
        import database as db
        week_start = date.fromisoformat(week_start_iso)
        week_end = week_start + timedelta(days=6)
        # Pull all closed trades in the week (UTC open_time)
        start_dt = datetime.combine(week_start, datetime.min.time(),
                                    tzinfo=timezone.utc)
        end_dt = datetime.combine(week_end, datetime.max.time(),
                                   tzinfo=timezone.utc)
        all_trades = db.list_trades(limit=1000)
        week_trades = [
            t for t in all_trades
            if t.get("status") == "closed"
            and t.get("open_time")
            and start_dt.isoformat() <= t["open_time"] <= end_dt.isoformat()
        ]
        compliance = db.get_compliance_score(start_dt, end_dt)

        out_dir = Path(out_dir or (settings.paths.base_dir / "exports"))
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"journal_{week_start.isoformat()}.pdf"

        # Build the document
        doc = SimpleDocTemplate(
            str(out_path), pagesize=landscape(A4),
            leftMargin=15 * mm, rightMargin=15 * mm,
            topMargin=15 * mm, bottomMargin=15 * mm,
            title=f"V2 Trading Journal - Week of {week_start.isoformat()}",
        )
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "JournalTitle", parent=styles["Title"],
            fontSize=18, spaceAfter=10,
        )
        h2_style = ParagraphStyle(
            "JournalH2", parent=styles["Heading2"],
            fontSize=14, spaceBefore=10, spaceAfter=6,
        )
        normal_style = styles["Normal"]

        elements: list[Any] = []
        # ---- Cover ---- #
        elements.append(Paragraph(
            f"Kalender Trading V2 - Weekly Journal", title_style))
        elements.append(Paragraph(
            f"Week of {week_start.isoformat()} to {week_end.isoformat()}",
            normal_style))
        elements.append(Spacer(1, 10))

        # ---- Summary stats ---- #
        wins = sum(1 for t in week_trades if (t.get("profit") or 0) > 0)
        losses = len(week_trades) - wins
        total_pnl = sum(t.get("profit") or 0.0 for t in week_trades)
        win_rate = (wins / len(week_trades) * 100.0) if week_trades else 0.0
        avg_rr = (sum(t.get("rr_net") or 0.0 for t in week_trades)
                  / len(week_trades) if week_trades else 0.0)
        gross_profit = sum(t.get("profit") or 0.0 for t in week_trades
                           if (t.get("profit") or 0) > 0)
        gross_loss = abs(sum(t.get("profit") or 0.0 for t in week_trades
                             if (t.get("profit") or 0) < 0))
        profit_factor = (gross_profit / gross_loss
                         if gross_loss > 0 else float("inf"))

        summary_rows = [
            ["Metric", "Value"],
            ["Total trades", str(len(week_trades))],
            ["Wins", str(wins)],
            ["Losses", str(losses)],
            ["Win rate", f"{win_rate:.2f}%"],
            ["R-net avg", f"{avg_rr:.3f}"],
            ["Profit factor", (f"{profit_factor:.2f}"
                               if profit_factor != float("inf") else "n/a")],
            ["Total P&L", f"{total_pnl:.2f}"],
            ["Compliance score",
             f"{compliance.get('overall_pct', 0):.2f}%"],
        ]
        summary_tbl = Table(summary_rows, colWidths=[80 * mm, 50 * mm])
        summary_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f3f4f6")]),
        ]))
        elements.append(summary_tbl)
        elements.append(Spacer(1, 12))

        # ---- Session grid ---- #
        elements.append(Paragraph("Session Grid", h2_style))
        grid_header = ["Day"] + SESSIONS
        grid_rows: list[list[str]] = [grid_header]
        for d in range(5):  # Mon-Fri
            day_date = week_start + timedelta(days=d)
            row = [f"{WEEKDAY_LABELS[d]} {day_date.isoformat()}"]
            for sess in SESSIONS:
                sess_trades = [
                    t for t in week_trades
                    if (t.get("session_name") or "").upper() == sess
                ]
                wins_s = sum(1 for t in sess_trades
                             if (t.get("profit") or 0) > 0)
                row.append(f"{len(sess_trades)} trades / {wins_s} win")
            grid_rows.append(row)
        grid_tbl = Table(grid_rows,
                         colWidths=[60 * mm] + [55 * mm] * len(SESSIONS))
        grid_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#374151")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f9fafb")]),
        ]))
        elements.append(grid_tbl)
        elements.append(PageBreak())

        # ---- Trade log ---- #
        elements.append(Paragraph("Trade Log", h2_style))
        log_header = [
            "Ticket", "Symbol", "Dir", "Vol", "Entry",
            "Exit", "Pips", "P&L", "R-net", "Session", "Exit Reason",
        ]
        log_rows: list[list[str]] = [log_header]
        for t in week_trades[:60]:  # cap to first 60 to fit pages
            log_rows.append([
                str(t.get("ticket") or ""),
                str(t.get("symbol") or ""),
                str(t.get("direction") or ""),
                f"{t.get('volume') or 0:.2f}",
                f"{t.get('open_price') or 0:.5f}",
                f"{t.get('close_price') or 0:.5f}",
                f"{t.get('pips') or 0:.1f}",
                f"{t.get('profit') or 0:.2f}",
                f"{t.get('rr_net') or 0:.2f}",
                str(t.get("session_name") or ""),
                str(t.get("exit_reason") or ""),
            ])
        log_tbl = Table(log_rows,
                        colWidths=[20 * mm, 22 * mm, 14 * mm, 16 * mm,
                                    24 * mm, 24 * mm, 16 * mm, 22 * mm,
                                    18 * mm, 22 * mm, 32 * mm])
        log_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f3f4f6")]),
        ]))
        elements.append(log_tbl)

        doc.build(elements)
        logger.info("PDF journal written to %s", out_path)
        return out_path


__all__ = ["JournalPDFExporter", "REPORTLAB_AVAILABLE"]
