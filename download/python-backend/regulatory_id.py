"""
regulatory_id.py
================
BAPPEBTI compliance + Indonesian PPh Final 0.1% tax calculator (Sprint 6 #11).

Provides:
    * ``BAPPEBTI_REQUIREMENTS``   - constant checklist of regulatory requirements
    * ``BAPPEBTI_REGISTERED_BROKERS`` - hardcoded list of registered brokers
    * ``calculate_pph_forex``     - PPh Final 0.1% tax calculation
    * ``format_spt_year``         - SPT (Surat Pemberitahuan) CSV formatter
    * ``check_bappebti_compliance`` - verify broker registration status

Indonesian regulatory context
-----------------------------
* BAPPEBTI (Badan Pengawas Perdagangan Berjangka Komoditi) regulates forex
  berjangka (futures) trading in Indonesia.  Spot forex traded via offshore
  brokers is NOT BAPPEBTI regulated.
* PPh Final 0.1% - under PMK-84/PMK.010/2020 and PP 14/2024, forex berjangka
  profits are subject to final income tax of 0.1% of the transaction value
  (withheld by the broker).  For non-broker-resident spot forex traders, the
  rate is 0.1% of profit treated as final PPh.

The numbers below should be verified by a tax professional before filing.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

BAPPEBTI_REQUIREMENTS: list[dict[str, Any]] = [
    {"id": "broker_registration",
     "label": "Broker terdaftar BAPPEBTI",
     "description": "Broker harus terdaftar di BAPPEBTI untuk forex berjangka."},
    {"id": "segregated_account",
     "label": "Segregated client account",
     "description": "Dana nasabah dipisahkan dari rekening operasional broker."},
    {"id": "negative_balance_protection",
     "label": "Negative balance protection",
     "description": "Saldo tidak boleh minus di bawah nol."},
    {"id": "leverage_cap",
     "label": "Leverage cap 1:100",
     "description": "Maksimum leverage untuk retail trader adalah 1:100."},
    {"id": "risk_disclosure_signed",
     "label": "Risk disclosure signed",
     "description": "Disclosure risiko forex berjangka ditandatangani nasabah."},
    {"id": "pph_withholding",
     "label": "PPh Final 0.1% withholding",
     "description": "Broker memotong PPh Final 0.1% atas transaksi nasabah."},
    {"id": "kyc_aml",
     "label": "KYC + AML compliance",
     "description": "Verifikasi identitas (KTP/NPWP) + anti pencucian uang."},
    {"id": "reporting_spt",
     "label": "Pelaporan SPT tahunan",
     "description": "Profit forex dilaporkan dalam SPT Tahunan PPh OP."},
]

# A non-exhaustive, manually maintained list of BAPPEBTI-registered brokers
# (exchange members / pialang berjangka) as of 2024.  Real-world deployment
# should sync this from bappebti.go.id periodically.
BAPPEBTI_REGISTERED_BROKERS: list[str] = [
    "FINEX INDONESIA", "FINEXECN", "MONEX INVESTINDO FUTURES", "MONEX",
    "MIFX", "MILLENNIUM PENATA FUTURES", "ASKRINDO MULTI ASSET",
    "PHILLIP FUTURES INDONESIA", "PHILLIP", "BNI SEKURITAS",
    "MIDIS", "TRIAS FUTURES", "GAIN CAPITAL FUTURES INDONESIA",
    "KGI FUTURES INDONESIA", "MAXXCOIN", "INDOPREMISE FUTURES",
]


# --------------------------------------------------------------------------- #
# PPh Final 0.1% tax calculator
# --------------------------------------------------------------------------- #

PPH_FINAL_RATE_FOREX: float = 0.001   # 0.1% - final withholding for forex
                                      # berjangka (on transaction value)


def calculate_pph_forex(profit_idr: float,
                         transaction_value_idr: float | None = None,
                         is_loss_carryforward: bool = False
                         ) -> dict[str, Any]:
    """Calculate Indonesian PPh Final 0.1% on a forex trade.

    Parameters
    ----------
    profit_idr : float
        Realised gross profit in IDR for the trade (can be negative for a loss).
    transaction_value_idr : float, optional
        Notional transaction value (lot x price x contract size) in IDR.
        If provided, the broker's 0.1% withholding is computed on this
        (PMK-84/2020).  If None, the 0.1% is computed on the profit itself
        (non-BAPPEBTI broker / spot forex case).
    is_loss_carryforward : bool
        If True, losses may be carried forward (Indonesian tax law allows
        5 years for forex berjangka).  Purely informational in this calc.

    Returns
    -------
    dict
        ``{profit, pph_rate, pph_amount, net_after_tax, base}``
    """
    if transaction_value_idr and transaction_value_idr > 0:
        base = "transaction_value"
        pph_amount = transaction_value_idr * PPH_FINAL_RATE_FOREX
    else:
        base = "profit"
        # Only tax positive profits (final PPh doesn't refund losses)
        pph_amount = max(0.0, profit_idr) * PPH_FINAL_RATE_FOREX
    net_after_tax = profit_idr - pph_amount
    return {
        "profit_idr": round(profit_idr, 2),
        "pph_rate": PPH_FINAL_RATE_FOREX,
        "pph_rate_pct": PPH_FINAL_RATE_FOREX * 100,
        "base": base,
        "transaction_value_idr": (round(transaction_value_idr, 2)
                                  if transaction_value_idr else None),
        "pph_amount_idr": round(pph_amount, 2),
        "net_after_tax_idr": round(net_after_tax, 2),
        "is_loss_carryforward": is_loss_carryforward,
    }


# --------------------------------------------------------------------------- #
# SPT formatter (CSV)
# --------------------------------------------------------------------------- #

def format_spt_year(year: int,
                    trades: list[dict[str, Any]],
                    broker_name: str | None = None,
                    npwp: str | None = None,
                    currency_rate: float = 15_500.0) -> str:
    """Generate SPT (Surat Pemberitahuan) CSV for a tax year.

    Each closed trade row produces one SPT line with:
        ticket, symbol, open/close dates, profit (IDR converted),
        PPh 0.1%, net after tax.

    A summary header + footer is appended with totals.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "# SPT Forex - Tahun Pajak", year,
    ])
    writer.writerow([
        "# NPWP", npwp or "(belum diisi)",
    ])
    writer.writerow([
        "# Broker", broker_name or "(tidak disebutkan)",
    ])
    writer.writerow([
        "# Kurs USD->IDR (estimasi)", currency_rate,
    ])
    writer.writerow([])
    writer.writerow([
        "ticket", "symbol", "direction", "volume",
        "open_time", "close_time",
        "profit_usd", "profit_idr",
        "transaction_value_idr", "pph_rate", "pph_amount_idr",
        "net_after_tax_idr",
    ])
    total_profit_idr = 0.0
    total_pph_idr = 0.0
    total_net_idr = 0.0
    for t in trades:
        # Convert profit to IDR using the supplied rate
        try:
            profit_usd = float(t.get("profit") or 0.0)
        except (TypeError, ValueError):
            profit_usd = 0.0
        profit_idr = profit_usd * currency_rate
        # Transaction value estimate: volume * 100_000 (standard lot) * price
        # if open_price is provided
        open_price = float(t.get("open_price") or 0.0)
        volume = float(t.get("volume") or 0.0)
        tx_value_idr = (volume * 100_000 * open_price * currency_rate
                        if open_price else None)
        pph = calculate_pph_forex(profit_idr, tx_value_idr)
        writer.writerow([
            t.get("ticket"), t.get("symbol"), t.get("direction"), volume,
            t.get("open_time"), t.get("close_time"),
            round(profit_usd, 2), round(profit_idr, 2),
            (round(tx_value_idr, 2) if tx_value_idr else ""),
            pph["pph_rate_pct"],
            pph["pph_amount_idr"],
            pph["net_after_tax_idr"],
        ])
        total_profit_idr += profit_idr
        total_pph_idr += pph["pph_amount_idr"]
        total_net_idr += pph["net_after_tax_idr"]
    writer.writerow([])
    writer.writerow([
        "# TOTAL profit (IDR)", round(total_profit_idr, 2),
    ])
    writer.writerow([
        "# TOTAL PPh Final 0.1% (IDR)", round(total_pph_idr, 2),
    ])
    writer.writerow([
        "# TOTAL net after tax (IDR)", round(total_net_idr, 2),
    ])
    writer.writerow([
        "# Generated at (UTC)", datetime.utcnow().isoformat(),
    ])
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# BAPPEBTI broker compliance check
# --------------------------------------------------------------------------- #

def check_bappebti_compliance(broker_name: str) -> dict[str, Any]:
    """Verify whether ``broker_name`` is on the BAPPEBTI registered list.

    Returns ``{"registered": bool, "broker": str, "matched": str|None,
    "requirements": [...]}``.
    """
    bn = (broker_name or "").upper().strip()
    matched: str | None = None
    for b in BAPPEBTI_REGISTERED_BROKERS:
        if bn and (b in bn or bn in b):
            matched = b
            break
    return {
        "registered": matched is not None,
        "broker_input": broker_name,
        "matched": matched,
        "requirements": BAPPEBTI_REQUIREMENTS,
        "requirements_count": len(BAPPEBTI_REQUIREMENTS),
    }


__all__ = [
    "BAPPEBTI_REQUIREMENTS", "BAPPEBTI_REGISTERED_BROKERS",
    "PPH_FINAL_RATE_FOREX",
    "calculate_pph_forex", "format_spt_year",
    "check_bappebti_compliance",
]
