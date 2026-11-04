# Scalping V2 — Fullstack Automated Forex Trading System

Aplikasi fullstack trading forex otomatis dengan strategi **Scalping V2** (RR net ≥ 2.0, ATR-based SL, ADX regime filter). Dashboard Next.js 16 terhubung ke Python FastAPI backend yang menjalankan MT5, Ollama, dan Tiingo di Windows 11.

![Status](https://img.shields.io/badge/status-production--ready-green)
![Strategy](https://img.shields.io/badge/strategy-V2-blue)
![Broker](https://img.shields.io/badge/broker-Finex%20Indonesia-orange)
![AI](https://img.shields.io/badge/AI-Ollama%20llama3.2-purple)

## Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│                Next.js 16 Dashboard (Port 3000)              │
│  TypeScript · Tailwind CSS 4 · shadcn/ui · Recharts · Zustand │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API + WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Python FastAPI Backend (Port 8000)                │
│  Async trading engine · Risk manager · Strategy V2 engine    │
└──────┬──────────────────┬──────────────────┬────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  MT5 (Win)  │   │   Ollama    │   │   Tiingo    │
│  Finex IDN  │   │ llama3.2    │   │  Calendar   │
└─────────────┘   └─────────────┘   └─────────────┘
```

## Strategi V2 (7 Perbaikan Major dari V1)

1. **Biaya transaksi dihitung net** — Target RR net ≥ 2.0 setelah spread + komisi
2. **3 indikator core** — EMA9/21 + VWAP + ATR (bukan 6 indikator V1)
3. **SL adaptif ATR** — SL = 1.5×ATR(14) + 2 pip buffer (bukan fixed 8 pip)
4. **Win rate target realistis** — 45% (bukan 50-55%)
5. **Backtest 300 trade** + 3 bulan forward demo sebelum live
6. **ADX regime filter** — >25 trade, <20 skip, 20-25 wait
7. **Tiered stop** — Soft -1%, Hard -2%, Weekly -4%, Overall -10%

## Quick Start

### Prerequisites

- **Windows 11** dengan MetaTrader 5 terminal terinstall
- **Python 3.14** (atau 3.11+)
- **Node.js 20+** dan **Bun** (atau npm/yarn)
- **Ollama** — download dari [ollama.com](https://ollama.com)
- **Tiingo API Key** — daftar gratis di [api.tiingo.com](https://api.tiingo.com)
- **Akun Finex Indonesia** (demo atau live)

### 1. Clone & Install Frontend

```bash
git clone https://github.com/teekar2312/scalping_v2.git
cd scalping_v2
bun install   # atau npm install
```

### 2. Setup Python Backend

```bash
cd download/python-backend
python -m venv venv
venv\Scripts\activate     # Windows
pip install -r requirements.txt
copy .env.example .env    # lalu edit .env dengan kredensial Anda
```

Edit `.env`:
```env
MT5_LOGIN=50384721
MT5_PASSWORD=your_password
MT5_SERVER=FinexIC-Markets
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest
TIINGO_API_KEY=your_tiingo_key
```

### 3. Setup Ollama

```bash
ollama pull llama3.2:latest
ollama serve   # auto-start as service
ollama list    # verify model installed
```

### 4. Setup MT5

1. Buka MT5 terminal di Windows
2. File → Open Account → cari **Finex Indonesia**
3. Login dengan kredensial dari `.env`
4. **Enable Algo Trading** (Ctrl+E atau tombol di toolbar)
5. Pastikan "Allow automated trading" dicentang di Options → Expert Advisors

### 5. Run Backend

```bash
cd download/python-backend
run.bat   # Windows (auto-setup venv + dependencies)
# atau manual: python main.py
```

Verifikasi di `http://localhost:8000/docs` (Swagger UI).

### 6. Run Frontend

```bash
# Di root project
cp .env.example .env   # set NEXT_PUBLIC_PYTHON_API_URL=http://localhost:8000
bun run dev
```

Buka `http://localhost:3000`.

## Dashboard Features

### 9 Views

1. **Dashboard** — Overview real-time: account, system status, tiered stop tracker, pair monitor, sesi WIB timeline
2. **Chart & Indikator** — Candlestick + EMA9/21 + VWAP + Bollinger + ADX/RSI/ATR panels dengan regime zones
3. **Sinyal V2** — Signal cards dengan 8-point checklist + AI compliance analysis
4. **Posisi & Trade** — Open positions + recent history
5. **Trade Journal** — 30-trade history dengan R-net, profit factor, win rate
6. **AI Analisa** — Chat dengan Ollama llama3.2 + 8 quick prompts
7. **Kalender Ekonomi** — Tiingo events dengan blackout status
8. **Strategi V2 Ref** — 8 tabs konten lengkap dari 3 PDF strategi
9. **Settings** — MT5/Ollama/Tiingo/risk params/pair monitor

### Display Modes

- **Tema**: Dark (default) / Light
- **Density**: Minimal (lega) / Compact (seimbang) / Dense (maksimal data)

### Safety Features (Full Auto Mode)

- 🔴 **Kill Switch** — emergency close all + stop bot
- 🛡️ **Tiered Stop** — Soft -1% / Hard -2% / Weekly -4% / Overall -10% auto-stop
- 📰 **News Blackout** — ±30 menit dari HIGH impact news
- 📊 **Max Position** — 3 simultan + 5 trade/hari
- 🔒 **Daily Loss Cap** — auto-lock bot saat cap tercapai

## Pair yang Didukung

| Rank | Pair      | Spread ECN   | ADR       | Karakteristik        |
|------|-----------|--------------|-----------|----------------------|
| #1   | EUR/USD   | 0.6-0.8 pip  | 80-100 pip| Likuiditas tertinggi |
| #2   | GBP/USD   | 0.8-1.2 pip  | 80-120 pip| Volatilitas tinggi   |
| #3   | USD/JPY   | 0.7-0.9 pip  | 70-90 pip | Tren halus           |

## Roadmap 9 Bulan V2

| Fase      | Bulan  | Aktivitas                          | Target                          |
|-----------|--------|------------------------------------|---------------------------------|
| Belajar   | 1-3    | Baca V2, demo, kenali setup A+     | Identifikasi setup < 30 detik   |
| Backtest  | 4-6    | 300 trade di data historis         | Win ≥ 45%, PF ≥ 1.3, DD < 8%    |
| Forward   | 7-9    | Trading real-time di demo          | Kepatuhan checklist > 90%       |
| Mikro Live| 10-12  | Modal $100-500, lot terkecil       | Profit konsisten 3 bulan        |
| Scale Up  | 13+    | Tambah lot 10-20% per bulan        | DD tidak melebihi weekly tier   |

## Project Structure

```
scalping_v2/
├── src/                          # Next.js frontend
│   ├── app/                      # App router (page.tsx, layout.tsx)
│   ├── components/
│   │   ├── app/                  # Dashboard components
│   │   │   ├── views/            # 9 view components
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   ├── bot-control.tsx
│   │   │   ├── kill-switch.tsx
│   │   │   └── shared.tsx
│   │   └── ui/                   # shadcn/ui components
│   └── lib/
│       ├── types.ts              # TypeScript types
│       ├── store.ts              # Zustand store
│       ├── constants.ts          # V2 strategy constants
│       ├── strategy-content.ts   # Parsed PDF content
│       ├── mock-data.ts          # Demo mode data generator
│       └── api.ts                # API client (auto-detect Python backend)
├── prisma/
│   └── schema.prisma             # SQLite schema (Trade, Signal, NewsEvent, etc.)
├── download/
│   └── python-backend/           # Python FastAPI backend (15 files)
│       ├── main.py               # FastAPI app + 14 REST routes + WebSocket
│       ├── mt5_connector.py      # MetaTrader5 integration
│       ├── ollama_analyzer.py    # Ollama llama3.2 AI client
│       ├── tiingo_calendar.py    # Tiingo economic calendar
│       ├── strategy_v2.py        # V2 strategy rules engine
│       ├── indicators.py         # EMA/VWAP/ATR/ADX/RSI/Bollinger
│       ├── risk_manager.py       # Tiered stop + position sizing
│       ├── trading_engine.py     # Async auto-trading loop
│       ├── database.py           # SQLAlchemy models
│       ├── config.py             # Configuration
│       ├── .env.example
│       ├── requirements.txt
│       ├── README.md
│       ├── run.bat               # Windows launcher
│       └── run.sh                # Linux/WSL launcher
└── package.json
```

## Tech Stack

**Frontend**:
- Next.js 16 (App Router)
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui (New York)
- Recharts (charts)
- Zustand (state management)
- next-themes (dark/light)
- Prisma ORM + SQLite

**Backend**:
- Python 3.14 (3.11+ compatible)
- FastAPI (async web framework)
- MetaTrader5 Python package (Windows-only)
- httpx (Ollama + Tiingo HTTP client)
- SQLAlchemy + SQLite
- Pydantic (data validation)
- pytz (WIB timezone)

## ⚠️ Disclaimer

**TRADING FOREX MELIBATKAN RISIKO KERUGIAN SIGNIFIKAN.** Strategi V2 bukan jaminan profit. Tidak ada strategi yang demikian. Yang ditawarkan V2 adalah kerangka yang secara matematis layak — biaya sudah dihitung, risk terkontrol, filter regime mengeliminasi kondisi merugikan. Selebihnya adalah eksekusi, kesabaran, dan jujur pada diri sendiri.

- **Mulai dengan akun DEMO** minimal 3 bulan sebelum live
- Ikuti roadmap 9 bulan V2 sebelum trading dengan ukuran lot normal
- Patuhi tiered stop — bila tidak bisa mematuhi hard stop 2%, scalping bukan untuk Anda
- Backtest 300 trade + forward demo 3 bulan WAJIB sebelum akun mikro live
- Pastikan compliance dengan regulasi BAPPEBTI Indonesia untuk trading forex

## License

Personal use. Strategy V2 © 2026 Z.ai · Edisi Scalping.
