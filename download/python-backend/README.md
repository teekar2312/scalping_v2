# Forex Scalping Backend (V2 Strategy)

A production-grade Python **FastAPI** backend for an automated Forex scalping
trading system.  It connects to **MetaTrader 5** (broker: Finex Indonesia),
analyzes the market with the **V2 Scalping Strategy**, optionally consults a
local LLM (**Ollama llama3.2:latest**) for compliance checks, and consumes
the **Tiingo** economic calendar for news-blackout logic.

The backend exposes a REST API and a WebSocket that a Next.js 16 frontend
dashboard connects to.

> **⚠️ Real-money auto-trading warning**
> This software can place real orders on a live brokerage account.  Read the
> **Safety** section below before running it on anything other than a demo
> account.  Start with the V2 roadmap (months 1-9 demo, 10-12 micro live).

---

## Table of contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Install Ollama + llama3.2](#install-ollama--llama32)
4. [Install Python requirements](#install-python-requirements)
5. [Configure `.env`](#configure-env)
6. [MetaTrader 5 setup (Finex Indonesia)](#metatrader-5-setup-finex-indonesia)
7. [Run the backend](#run-the-backend)
8. [Connect the Next.js frontend](#connect-the-nextjs-frontend)
9. [API reference](#api-reference)
10. [Safety](#safety)
11. [V2 strategy 9-month roadmap](#v2-strategy-9-month-roadmap)
12. [Troubleshooting](#troubleshooting)
13. [VPS deployment + watchdog](#vps-deployment--watchdog)
14. [Alembic database migrations](#alembic-database-migrations)
15. [Backup encryption + S3 offsite](#backup-encryption--s3-offsite)

---

## Architecture

```
Next.js 16 dashboard
        │  REST + WebSocket
        ▼
┌────────────────────────────────────────────────────────────────┐
│ FastAPI backend (main.py)                                      │
│   /api/status  /api/account  /api/positions  /api/signals      │
│   /api/bot/{start,stop,kill}  /api/news  /api/ai/{analyze,chat}│
│   /api/journal  /api/settings  /api/chart/{symbol}             │
│   /ws (real-time stream)                                       │
└────────────┬───────────────────────────────────┬───────────────┘
             │                                   │
             ▼                                   ▼
   ┌───────────────────┐              ┌──────────────────────┐
   │ trading_engine.py │ ◀── event ── │  EventBus (pub/sub)  │
   │  async scan loop  │              │   → WebSocket clients │
   └────────┬──────────┘              └──────────────────────┘
            │
   ┌────────┴─────────────────────────────────────────────────┐
   ▼                ▼                  ▼                  ▼
strategy_v2.py   risk_manager.py    mt5_connector.py   database.py
(EMA/VWAP/ATR/   (tiered stops,    (MetaTrader5       (SQLite via
 ADX/8-pt        max positions,     Windows-only)      SQLAlchemy)
 checklist)      daily cap)
            │
            ▼
   ┌────────────────────────────────────────────┐
   │ ollama_analyzer.py  +  tiingo_calendar.py  │
   │   (llama3.2:latest)    (news blackout)     │
   └────────────────────────────────────────────┘
```

### Files

| File | Purpose |
|---|---|
| `main.py` | FastAPI app, all routes + WebSocket |
| `config.py` | Loads + validates `.env`, exports `settings` |
| `mt5_connector.py` | MetaTrader 5 wrapper (Windows-only) |
| `indicators.py` | Pure-Python EMA / VWAP / ATR / ADX / RSI / patterns |
| `strategy_v2.py` | V2 strategy engine, 8-point checklist |
| `risk_manager.py` | Tiered stops, daily cap, position sizing |
| `trading_engine.py` | Async scan loop + position management |
| `ollama_analyzer.py` | Ollama client + V2 system prompt |
| `tiingo_calendar.py` | Tiingo economic calendar fetcher + cache |
| `database.py` | SQLite / SQLAlchemy models + CRUD |
| `requirements.txt` | Python dependencies |
| `.env.example` | Template env file |
| `run.sh` / `run.bat` | Convenience launchers |

---

## Prerequisites

* **Windows 11** (the MetaTrader5 Python package is Windows-only).
* **Python 3.11+** (3.14 supported; the code uses `from __future__ import
  annotations` so 3.10+ works too).
* **MetaTrader 5 terminal** installed and logged in to a Finex Indonesia
  account (demo or live).
* **Ollama** installed locally with the `llama3.2:latest` model pulled.
* **Tiingo API key** (free tier is fine) for the economic calendar.
* **Next.js 16 frontend** dashboard (separate project) - configure
  `NEXT_PUBLIC_PYTHON_API_URL=http://localhost:8000`.

---

## Install Ollama + llama3.2

1. Download the Windows installer from <https://ollama.com/download/windows>
   and run it.
2. Open a terminal (PowerShell or cmd) and pull the model:

   ```powershell
   ollama pull llama3.2:latest
   ```

   This downloads ~4 GB and may take 5-20 minutes depending on your
   connection.
3. Verify:

   ```powershell
   ollama list
   # should show: llama3.2:latest
   ollama run llama3.2:latest "say hi"
   ```

4. Ollama runs as a background service on `http://localhost:11434`.  No
   further action required.

---

## Install Python requirements

```powershell
cd C:\path\to\python-backend
python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

> **Linux note:** The `MetaTrader5` package will fail to install on Linux.
> If you want to develop/test on Linux, comment out the `MetaTrader5` line
> in `requirements.txt` first.  All MT5 routes will then return HTTP 503
> with `mt5_available=false`.

---

## Configure `.env`

Copy the template and fill in your values:

```powershell
copy .env.example .env
notepad .env
```

Minimum required fields:

| Variable | Example | Notes |
|---|---|---|
| `MT5_LOGIN` | `12345678` | Numeric Finex Indonesia account login |
| `MT5_PASSWORD` | `your_password` | Trader or investor password |
| `MT5_SERVER` | `FinexECN-MT5-Demo` | As shown in the MT5 login dialog |
| `MT5_TERMINAL_PATH` | `C:\Program Files\Finex Indonesia MetaTrader 5\terminal64.exe` | Optional but recommended |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Default is fine |
| `OLLAMA_MODEL` | `llama3.2:latest` | Default is fine |
| `TIINGO_API_KEY` | `abc...` | Free token from <https://api.tiingo.com/> |
| `PAIRS` | `EURUSD,GBPUSD,USDJPY` | V2 priority order |
| `TIMEZONE` | `Asia/Jakarta` | WIB / UTC+7 |

All other variables have sensible defaults.

---

## MetaTrader 5 setup (Finex Indonesia)

1. Open the MT5 terminal.
2. Log in with your Finex Indonesia credentials (the same `MT5_LOGIN` /
   `MT5_PASSWORD` / `MT5_SERVER` you put in `.env`).
3. In the **Market Watch** panel (Ctrl+M), make sure `EURUSD`, `GBPUSD`,
   `USDJPY` are visible.  If they aren't, right-click → "Show All".
4. Enable **Algo Trading** (the green ▶ button on the toolbar).  The bot
   cannot place orders otherwise.
5. In `Tools → Options → Expert Advisors`, tick:
   * ✅ **Allow Algorithmic Trading**
   * ✅ **Allow DLL imports** (optional, used by some MT5 Python calls)
6. Confirm your account type.  ECN accounts on Finex Indonesia typically
   have spreads of 0.6-0.8 pips on EUR/USD plus a round-turn commission.
   Set `commission_pips` in `/api/settings` (default `0.7`) to match.

> **Demo first.** Always start with `FinexECN-MT5-Demo` until you have
> observed at least 100 simulated or demo trades.

---

## Run the backend

### Option A: launcher scripts

```powershell
run.bat
```

or (on Linux / WSL for development only):

```bash
chmod +x run.sh
./run.sh
```

### Option B: direct uvicorn

```powershell
.venv\Scripts\activate
python main.py
```

The server starts on `http://0.0.0.0:8000`.  Open
<http://localhost:8000/docs> for the interactive Swagger UI.

---

## Connect the Next.js frontend

In your Next.js 16 dashboard project, create / edit `.env.local`:

```bash
NEXT_PUBLIC_PYTHON_API_URL=http://localhost:8000
NEXT_PUBLIC_PYTHON_WS_URL=ws://localhost:8000/ws
```

Restart the Next.js dev server.  All API calls (e.g. `GET /api/status`,
`POST /api/bot/start`) should now hit the Python backend, and the
WebSocket will stream ticks, signals and bot events in real time.

---

## API reference

### Status / account

| Method | Route | Description |
|---|---|---|
| GET | `/api/status` | Bot status, MT5 connection, account summary |
| GET | `/api/account` | MT5 account info |
| GET | `/api/positions` | Open positions (optional `?symbol=`) |
| GET | `/api/signals` | Recent strategy signals (`?limit=50&symbol=`) |

### Bot control

| Method | Route | Description |
|---|---|---|
| POST | `/api/bot/start` | Start the auto-trading loop |
| POST | `/api/bot/stop` | Stop the loop (keeps positions open) |
| POST | `/api/bot/kill` | **Emergency kill switch**: close all + stop + lock |
| POST | `/api/bot/release-kill` | Release the kill switch (manual override) |

### News / AI

| Method | Route | Description |
|---|---|---|
| GET | `/api/news` | Tiingo economic calendar (`?impact=HIGH&days_ahead=7`) |
| POST | `/api/ai/analyze` | Send a setup to Ollama for compliance verdict |
| POST | `/api/ai/chat` | Chat with Ollama (JSON reply) |
| GET | `/api/ai/chat/stream` | Streaming chat (Server-Sent Events) |

### Journal / settings / chart

| Method | Route | Description |
|---|---|---|
| GET | `/api/journal` | Trade history (`?limit=100&offset=0&status=`) |
| GET | `/api/settings` | All key/value settings |
| POST | `/api/settings` | Update settings (body: `{"settings": {"k": "v"}}`) |
| GET | `/api/chart/{symbol}` | Candles + EMA/VWAP/ATR/ADX/RSI/Bollinger/pattern |

### WebSocket

`ws://localhost:8000/ws`

Server pushes:
* `{"type": "status", "data": {...}}`  - periodic snapshot
* `{"type": "tick", "symbol": "EURUSD", "bid": ..., "ask": ...}`
* `{"type": "signal", ...}` - new strategy signal
* `{"type": "order_placed", ...}` / `{"type": "position_closed", ...}`
* `{"type": "tp1_hit", ...}` / `{"type": "tp2_hit", ...}`
* `{"type": "risk_gate_blocked", "reasons": [...]}`
* `{"type": "kill_switch_engaged", ...}`

Client commands: `{"action": "ping"}` or `{"action": "status"}`.

---

## Safety

The bot implements multiple layers of protection, but **you are
responsible** for monitoring it.  Never leave it unattended on a live
account during the first months.

### Built-in safety features

1. **Tiered stops** (auto-stop):
   * Soft `-1%` daily  → pause new entries for the day.
   * Hard `-2%` daily  → close all + stop bot + engage kill switch.
   * Weekly `-4%`     → lock bot for the week.
   * Overall `-10%`   → lock bot indefinitely (manual restart only).
2. **Kill switch** (`POST /api/bot/kill`) - close every open position
   immediately and lock the bot.
3. **News blackout** - no new entries within ±30 min of a HIGH impact
   event for either currency of the pair.
4. **Max positions** - 3 simultaneous (V2 default).
5. **Max daily trades** - 5 per day (V2 default).
6. **Session blacklist** - no entries during Sydney (05-14 WIB), London
   lunch (17-19:30 WIB), Monday early (00-07 WIB), Friday late (>22:00
   WIB), weekends.
7. **8-point checklist** - all checks must pass before order placement.
8. **AI advisory** (optional) - Ollama reviews each setup against the V2
   rules; non-compliant setups are rejected.

### Recommended operational safety

* **Start with a demo account** (Finex `FinexECN-MT5-Demo`) for at least 2
  months of forward testing.
* Set `commission_pips` accurately - underestimating commissions
  overstates your RR Net.
* Watch the WebSocket `kill_switch_engaged` event and configure your
  frontend to alert you (sound / push notification).
* Keep the MT5 terminal visible on the Windows host so you can hit the
  terminal's own "Close All" button if the bot misbehaves.
* Back up `data/trading.db` periodically.

---

## V2 strategy 9-month roadmap

| Months | Phase | Goal |
|---|---|---|
| 1-3 | **Belajar** (Learning) | Master the V2 rules manually on a demo account. Trade by hand using the same 8-point checklist. Goal: internalise ADX regime, EMA alignment, VWAP bias, SL placement. |
| 4-6 | **Backtest** | Replay historical M5/M15 data through `strategy_v2.py` (or TradingView) on EUR/USD, GBP/USD, USD/JPY. Goal: validate RR Net ≥ 2.0 in ≥ 70% of trades; record win rate per session. |
| 7-9 | **Forward demo** | Run this backend on `FinexECN-MT5-Demo` 24/5 with the AI advisory ON. Goal: ≥ 100 trades, drawdown < 4%, weekly PnL positive. |
| 10-12 | **Mikro live** | Switch to a live Finex account with the **smallest lot size** (0.01). Same V2 rules. Goal: confirm slippage/commission assumptions hold, no surprises. |
| 13+ | **Scale up** | Increase lot size proportional to balance, keep risk at 1%. Add pairs (USD/JPY #3 first, then AUD/USD, USD/CHF). Goal: 3-6 months of consistent profit before any leverage increase. |

> Do **not** skip phases.  The most common failure mode is jumping to live
> trading in months 4-6 with insufficient forward-test data.

---

## Troubleshooting

### `MetaTrader5` package fails to install
You are not on Windows.  Run on Windows 11 where the MT5 terminal is
installed.

### `/api/status` returns `mt5_connected: false`
1. Confirm the MT5 terminal is open and logged in to Finex Indonesia.
2. Confirm `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER` match the terminal.
3. Check `logs/backend.log` for `MT5 initialize attempt ... failed`.
4. If the terminal path has spaces, ensure it's quoted in `.env`.

### `/api/ai/analyze` returns 503
Ollama isn't running or the model isn't pulled.  Run:

```powershell
ollama serve            # if not auto-started
ollama pull llama3.2:latest
ollama list             # verify
```

### `/api/news` returns an empty list
* Confirm `TIINGO_API_KEY` is set in `.env`.
* Check <https://api.tiingo.com/account> to ensure your token has the
  fundamentals/news-calendar entitlement.
* The cache TTL is 1 hour; restart the backend to force a refresh.

### `zoneinfo` errors on Windows
Install the `tzdata` package (already in `requirements.txt`) and restart.

### Orders never execute
* Make sure **Algo Trading** is enabled in the MT5 toolbar (green ▶).
* Make sure the symbol is in Market Watch.
* Check `data/trading.db` `trades` table and `logs/backend.log` for
  `retcode` details.

---

## License

Provided as-is for educational and personal use.  No warranty.  Trading
Forex carries substantial risk of loss.

---

## VPS deployment + watchdog

For 24/5 unattended operation we recommend running the backend as a
managed service on a Windows VPS (for MT5) or Linux VPS (paper mode,
analytics, backtests).  A `watchdog.py` companion process can monitor
the backend PID and restart it on crash or memory exhaustion.

### Linux (systemd)

1. Copy `deploy/systemd/scalping-v2.service` to `/etc/systemd/system/`.
2. Edit the file:
   - Set `User=` / `Group=` to your service account.
   - Set `WorkingDirectory=` to the backend install path.
   - Set `EnvironmentFile=` to your `.env` file path.
   - Adjust `MemoryMax=` if needed (default 2GB).
3. Reload systemd and start:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable scalping-v2
   sudo systemctl start scalping-v2
   sudo systemctl status scalping-v2
   sudo journalctl -u scalping-v2 -f   # live logs
   ```

4. The unit includes `Restart=on-failure` (10s delay, 5 bursts per 5min),
   memory capping, and systemd hardening (no new privileges, private tmp,
   restricted syscalls).

### Windows (NSSM service)

1. Install [NSSM](https://nssm.cc/) and copy `nssm.exe` to
   `C:\Windows\System32\`.
2. Open an Administrator `cmd`, `cd` to the backend folder, run:

   ```powershell
   deploy\windows\install-service.bat
   ```

   This installs + starts the `ForexScalpingV2` Windows service with
   auto-restart, log rotation, and the venv Python interpreter.

3. Manage via `services.msc` or `nssm start/stop/restart ForexScalpingV2`.
4. Logs are written to `logs\service.out.log` and `logs\service.err.log`.
5. To uninstall:

   ```powershell
   deploy\windows\uninstall-service.bat
   ```

### Watchdog (optional, for crash recovery)

`watchdog.py` is a standalone process that monitors the backend PID file
and restarts it on crash or excessive memory use (>1GB RSS by default).

```bash
# Linux - run as a separate systemd unit (recommended)
python watchdog.py --pid-file /tmp/forex-backend.pid \
    --interval 30 --mem-limit 1024 \
    -- /opt/forex-scalping-v2/python-backend/.venv/bin/python main.py

# Or from Python
from watchdog import start_watchdog
start_watchdog(
    pid_file="/tmp/forex-backend.pid",
    restart_cmd=["systemctl", "restart", "scalping-v2"],
    check_interval_s=30,
    memory_limit_mb=1024,
)
```

The watchdog respects a 5-restart-per-5min cap to avoid crash loops.

---

## Alembic database migrations

The schema is created automatically on first run via SQLAlchemy's
`create_all`.  For incremental schema changes going forward we use
[Alembic](https://alembic.sqlalchemy.org/).  Configuration lives in
`alembic.ini` + `alembic/env.py` (reads the DB URL from
`ALEMBIC_DATABASE_URL` env var or falls back to `DB_PATH`).

```bash
# Apply all migrations to head
alembic upgrade head

# Show current revision
alembic current

# Create a new auto-generated migration after editing models in database.py
alembic revision --autogenerate -m "add_swap_record_table"

# Roll back one revision
alembic downgrade -1
```

> **Note:** the additive ALTER TABLE migrations (new columns on existing
> tables) are still applied automatically by `Database.__init__` on
> startup, so Alembic is not required for existing deployments - it's
> the recommended tool for new ones.

---

## Backup encryption + S3 offsite

### Encrypted local backup

```bash
curl -X POST http://localhost:8000/api/backup/offsite \
     -H "Authorization: Bearer $API_KEY"
```

Encrypts `data/trading.db` with Fernet using `SECRETS_MASTER_KEY`
(generate with `python generate_key.py secrets`).  Writes
`data/backups/trading_backup_YYYYMMDD_HHMMSS.db.enc` and returns:

```json
{
  "local_path": ".../trading_backup_20260101_120000.db.enc",
  "encrypted": true,
  "size_bytes": 12345,
  "s3_url": null,
  "s3_error": null
}
```

### AWS S3 offsite upload

Set the AWS env vars in `.env`:

```ini
AWS_S3_BUCKET=my-forex-backups
AWS_S3_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

The same `POST /api/backup/offsite` call will then upload the encrypted
blob to `s3://my-forex-backups/backups/trading_backup_*.db.enc` and
return `s3_url` in the response.  Failures return `s3_error` (e.g.
boto3 not installed) - the local encrypted file is still written.

For scheduled daily offsite backups, wrap the call in a cron job:

```cron
0 2 * * * curl -sX POST http://localhost:8000/api/backup/offsite \
    -H "Authorization: Bearer $API_KEY" >> /var/log/forex-backup.log 2>&1
```
