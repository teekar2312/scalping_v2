# Scalping V2 — User Manual

Operational manual for the **Scalping V2 Trading System** — fullstack automated forex scalping platform with MT5 + Ollama llama3.2 AI + Tiingo economic calendar.

> **Audience:** Trader-operator yang sudah selesai install (lihat `README.md` Quick Start). Manual ini menjelaskan operasi harian, safety features, dan interpretasi analitik.

---

## 1. Getting Started (5 menit)

1. **Login** — buka `http://localhost:3000`. Login dengan username `admin` + password dari `.env` (`ADMIN_PASSWORD`). Atau klik **"Masuk Demo Mode"** untuk eksplorasi tanpa backend.
2. **Acknowledge Risk Disclosure** — bila muncul modal risk disclosure, baca lalu centang "Saya menerima risiko" → Submit. Wajib sebelum bot bisa start.
3. **Verify Health** — pill `ALL HEALTHY` di header kanan atas harus hijau. Klik untuk tooltip detail readiness.
4. **Pre-Live Check** — Settings → Pre-Live Checklist → klik "Run Check". Semua harus PASS sebelum mode LIVE.
5. **Start Bot** — klik tombol "Start" di header (atau shortcut `?` → "Start Bot"). Default mode: PAPER (virtual money).

---

## 2. First Time Setup

### MT5 (Windows)

1. Install MetaTrader 5 terminal dari broker (Finex Indonesia: https://finex.co.id)
2. File → Open Account → cari Finex Indonesia → login demo
3. Options → Expert Advisors → centang "Allow automated trading" + "Allow DLL imports"
4. Enable Algo Trading (Ctrl+E)
5. Set `.env`: `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER=FinexIC-Markets`

### Ollama AI

```bash
# Install dari https://ollama.com
ollama pull llama3.2:latest   # ~4 GB download
ollama serve                  # auto-starts as service
ollama list                   # verify
```

Set `.env`: `OLLAMA_URL=http://localhost:11434`, `OLLAMA_MODEL=llama3.2:latest`

### Tiingo Calendar

1. Daftar gratis di https://api.tiingo.com
2. Get API key (free tier: 1000 requests/hour)
3. Set `.env`: `TIINGO_API_KEY=your_key`

### Telegram (optional)

1. Buka https://t.me/BotFather → `/newbot` → ikuti wizard
2. Copy bot token
3. Chat dengan bot baru kamu → kirim `/start`
4. Buka https://t.me/userinfobot untuk dapat Chat ID
5. Set `.env`: `TELEGRAM_BOT_TOKEN=...`, `TELEGRAM_CHAT_ID=...`
6. Settings → Telegram Notifications → Test

### Browser Push (PWA)

1. Settings → Browser Push Notifications → toggle "Enable Browser Push"
2. Allow browser permission dialog
3. Klik "Send Test Notification"
4. Install ke desktop: Chrome menu → Install Scalping V2 → standalone window

---

## 3. Dashboard Overview

| View | Deskripsi |
|------|-----------|
| **Dashboard** | Overview real-time: account stats, equity curve, tiered stop tracker, streak & cooldown, pair monitor, open positions, active signals, session timeline, news calendar. Customizable (drag-drop widget reorder). |
| **Chart & Indikator** | Candlestick + EMA9/21 + VWAP + Bollinger Bands + ADX/RSI/ATR panels. Sesi WIB markers, signal entry points. |
| **Sinyal V2** | Active signals dengan 8-point checklist + AI compliance verdict (COMPLIANT / NON-COMPLIANT). |
| **Posisi & Trade** | Open positions table + history + tick-level trade reconstruction (ENTRY → SL_MOVE → TP1_HIT → BE_MOVE → TRAILING → EXIT). |
| **Trade Journal** | 30-trade history dengan R-net, attribution (by session/setup/regime/hour/day/pair), compliance score, emotional summary. |
| **Backtest · MC · WF** | 300-trade backtest engine + Monte Carlo (500-1000 iter) + Walk-Forward analysis. |
| **Stress Test** | 4 black-swan scenario replay: SNB Unpeg 2015, Brexit 2016, COVID Crash 2020, GFC 2008. |
| **Slippage · Latency · Kelly** | Execution quality analytics + Kelly criterion position sizing. |
| **Market Analysis** | Currency strength meter, volume profile (POC/VAH/VAL), correlation matrix heatmap, volatility surface, order flow L2 ladder, news sentiment, economic surprise index. |
| **Price Alerts** | Threshold alerts (price/ADX/RSI/spread) with browser + Telegram notification. |
| **Audit Log** | Immutable hash-chained event trail + chain integrity verifier. |
| **System Health** | System info (CPU/memory/disk/uptime), service status table, broker failover, realtime drawdown, Prometheus metrics raw. |
| **AI Analisa** | Chat dengan Ollama llama3.2 dengan context strategi V2. 8 quick prompts. |
| **Kalender Ekonomi** | Tiingo events dengan blackout windows (±30 min HIGH impact). |
| **Strategi V2 Ref** | 8 tabs konten lengkap dari 3 PDF strategi. |
| **Settings** | MT5/Ollama/Tiingo/risk params/pair monitor/auth/secrets/regulatory/encryption/backup/PWA push. |

### Display Modes

- **Theme**: Dark (default) / Light — toggle di header atau `?` → "Toggle Theme"
- **Density**: Minimal (lega) / Compact (sebalik) / Dense (maksimal data) — toggle di header

### Customize Dashboard

1. Klik tombol **Customize** di atas dashboard
2. Drag widget dengan grip handle untuk reorder
3. Toggle visibility per widget (eye icon)
4. Pilih preset: **Default** / **Trader Pro** / **Risk Focus** / **Minimal**
5. Klik **Done** untuk keluar edit mode
6. Layout di-persist ke localStorage (`dashboard-layout`)

---

## 4. Trading Modes

| Mode | Eksekusi | Modal | Use Case |
|------|----------|-------|----------|
| **LIVE** | Real MT5 order | Real money | Hanya setelah 9-bulan roadmap selesai (F4+) |
| **PAPER** | Virtual MT5 order | Virtual | Forward demo F3 (3 bulan) — recommended default |
| **DRY** | No order, audit log only | — | Strategy validation tanpa exposure |

Switch via Settings → Bot Mode, atau via command palette (`⌘K` → "Toggle Mode").

**LIVE mode warning**: eksekusi real di MT5 aktif. Pastikan:
- Pre-Live Check PASS
- Forward demo profit konsisten 3 bulan
- Tiered stop sudah diuji manual (close semua saat -2%)
- Risk disclosure acknowledged (≤ 30 hari)

---

## 5. Safety Features

### 🔴 Kill Switch

- **Trigger**: tombol Kill Switch di header, atau `⌘K` → "Kill Switch", atau WS event `kill_switch_engaged`
- **Action**: tutup SEMUA posisi via market order + stop bot + lock sampai manual reset
- **Notification**: Browser push + Telegram (bila aktif)
- **Audit**: entry `KILL_SWITCH` severity CRITICAL di audit log

### 🛡️ Tiered Stop (auto)

| Tier | Threshold | Action |
|------|-----------|--------|
| Soft Daily | -1% | Journal entry + 30 menit cooldown |
| Hard Daily | -2% | Tutup platform hari itu (bot auto-stop) |
| Weekly | -4% | Skip 1 hari, re-evaluasi |
| Overall | -10% | Stop trading 1 minggu, review sistem |

Tracker real-time di Dashboard → Tiered Stop Tracker.

### 🧊 Cooldown

- **Trigger**: 2 loss beruntun → 30 menit cooldown
- **Indicator**: Streak & Cooldown panel di dashboard
- **WS event**: `cooldown_engaged` (until, reason)
- **Notification**: Browser push + Telegram

### ⚠️ Margin Protection

- **Warning level**: margin level &lt; 200% → WS event `margin_warning`
- **Action**: reduce exposure (close some positions)
- **Indicator**: Streak & Cooldown panel + Dashboard red banner

### 📰 News Blackout

- ±30 menit dari HIGH impact news = no entry
- Indicator: News Calendar view + Chart markers (red shaded bands)
- Source: Tiingo economic calendar

### 📊 Position Limits

- Max 3 open positions simultan (hindari korelasi pair)
- Max 5 trades per hari
- Auto-skip bila cap tercapai

---

## 6. Backtest Engine

### Run a Backtest

1. **Backtest** view → pilih symbol (EURUSD / GBPUSD / USDJPY) + timeframe (M5/M15/M30/H1)
2. Pilih date range (min 6 bulan historical)
3. Initial balance (default $10,000)
4. Click **Run Backtest**
5. Result: total trades, win rate, profit factor, max drawdown, compliance score, R-net avg, full trade list

### V2 Mandatory Targets (Roadmap F2)

| Metric | Target | V2 standard |
|--------|--------|-------------|
| Min trades | 300 | 300+ |
| Win rate | ≥ 45% | 45-50% |
| Profit factor | ≥ 1.3 | 1.3-1.6 |
| Max drawdown | &lt; 8% | 5-8% |
| Compliance score | ≥ 90% | 90%+ |

### Monte Carlo Simulation

1. Set iterations: 100 / 500 / 1000
2. Click **Run Monte Carlo**
3. Result:
   - **Survival rate %** — % of runs tidak blow up (target &gt; 95%)
   - **Median final balance** — expected outcome
   - **P5 / P95 final balance** — tail risk range
   - **Median / P95 max drawdown** — DD distribution
   - **Distribution histogram** — 12 buckets
   - **Fan chart** — median + P5/P95 band per step

### Walk-Forward Analysis

- 6 windows: 60 days in-sample + 30 days out-of-sample
- Per window: in-sample PF, out-sample PF, degradation %
- **Stable** if avg degradation &lt; 20%
- Verdict: "Parameters stable" or "Re-fit needed"

---

## 7. Monte Carlo + Walk-Forward Interpretation

### Monte Carlo: survival rate

- **&gt; 95%**: Strategy robust — safe to deploy
- **80-95%**: Acceptable but monitor closely
- **&lt; 80%**: Strategy fragile — do not deploy, re-fit

### Monte Carlo: P95 max drawdown

- Compare ke V2 hard stop tier (-2% daily, -4% weekly)
- Bila P95 DD &gt; 8% → position size too aggressive → reduce risk per trade

### Walk-Forward: degradation

- **&lt; 10%**: Excellent generalization
- **10-20%**: Acceptable drift
- **&gt; 20%**: Overfit — re-fit parameters
- **&gt; 40%**: Severe overfit — strategy broken

---

## 8. Stress Test

### Scenarios

| Scenario | Date | Multiplier | Pip Jump | Asset |
|----------|------|------------|----------|-------|
| SNB Unpeg 2015 | 15 Jan 2015 | ×8.5 | 2000 pip | EURCHF |
| Brexit 2016 | 23 Jun 2016 | ×4.2 | 800 pip | GBPUSD |
| COVID Crash 2020 | 16 Mar 2020 | ×3.5 | 400 pip | USDJPY |
| GFC 2008 | 15 Sep 2008 | ×5.0 | 600 pip | EURUSD |

### Run a Stress Test

1. **Stress Test** view → pilih scenario
2. Set initial balance + position value (optional)
3. Click **Run Stress Test**
4. Result:
   - **Survival**: PASS / FAIL
   - **Original vs stressed max DD**
   - **Original vs stressed final balance**
   - **Triggered hard stop?** (Boolean)
   - **Triggered kill switch?**
   - **Margin call?**
   - **Worst pip move**

### Interpretation

- **PASS**: Strategy survives the black-swan regime
- **FAIL**: Reduce position size or add stricter stop rules
- Bila triggered hard stop → acceptable (tiered stop working as designed)
- Bila triggered kill switch → strategy should not deploy live

---

## 9. VaR / CVaR Interpretation

Value at Risk (VaR) = maximum expected loss at given confidence level over time horizon.
Conditional VaR (CVaR) = expected loss given that VaR is breached (tail average).

### Dashboard VaR Panel

- **VaR 95%** = max loss with 95% confidence (1-in-20 day loss)
- **VaR 99%** = max loss with 99% confidence (1-in-100 day loss)
- **CVaR 95%** = average loss in worst 5% of cases
- **CVaR 99%** = average loss in worst 1% of cases

### Interpretation vs Hard Stop

Hard stop tier = 2% of balance. Compare:

- **VaR 95 &lt; hard stop**: ✓ acceptable risk
- **VaR 95 &gt; hard stop**: ⚠️ reduce position size
- **VaR 99 &gt; 1.5× hard stop**: 🔴 stop trading, volatility too high

### Method

- **Historical**: uses actual past returns (default, no distribution assumption)
- **Parametric**: assumes normal distribution (faster but underestimates tails)

---

## 10. Audit Log — Chain Verification

### What is Hash Chaining?

Setiap audit log entry di-hash dengan `SHA256(prev_hash + event_data)`. Ini menciptakan chain yang tidak bisa di-tamper tanpa terdeteksi — bila 1 row diubah, semua hash setelahnya invalid.

### Verify Chain

1. **Audit Log** view → klik tombol **Verify Chain**
2. Result:
   - **Valid**: true / false
   - **Total rows** vs **verified rows**
   - **Broken at row N** (jika invalid)
   - **Expected vs actual hash** (jika invalid)

### Recommended Cadence

- Daily: quick verify (1 click)
- Monthly: full verify + PDF export of audit log

---

## 11. Trade Reconstruction

Tick-level timeline of a single trade — dari ENTRY hingga EXIT.

### How to Use

1. **Posisi & Trade** view → click trade ticket → "Reconstruct"
2. Timeline menampilkan:
   - ENTRY (initial price, volume, reason)
   - SL_MOVE (initial SL placement)
   - TP1_HIT (partial close 50% + SL → break-even)
   - BE_MOVE (SL moved to break-even)
   - TRAILING (SL trails 2×ATR behind swing)
   - EXIT (final close, P&L, R-multiple)

### Use Case

- Post-trade review: kenapa trade ini menang/kalah?
- Audit verification: cross-check dengan audit log entries
- Compliance check: apakah SL dipindah ke BE setelah TP1? Apakah trailing stop bekerja?

---

## 12. Keyboard Shortcuts

Press `?` anywhere to open the shortcuts help dialog. Press `⌘K` / `Ctrl+K` to open the command palette.

### Global

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Open command palette |
| `?` | Show shortcuts help |
| `Esc` | Close dialog / palette |
| `⌘B` / `Ctrl+B` | Toggle sidebar (when implemented) |

### Navigation (sequence — press `g` then letter)

| Combo | Action |
|-------|--------|
| `g d` | Dashboard |
| `g c` | Chart |
| `g s` | Signals |
| `g p` | Positions |
| `g j` | Journal |
| `g a` | AI Chat |
| `g n` | News |

### From Command Palette

- "Start Bot" — start trading engine
- "Stop Bot" — stop trading engine
- "Kill Switch" — emergency close all + lock
- "Toggle Theme" — switch dark/light
- "Cycle Density" — minimal → compact → dense → minimal
- "Show all keyboard shortcuts" — open help dialog

---

## 13. Troubleshooting

### Common Issues

**Bot won't start**
- Pre-Live Check belum PASS → Settings → Pre-Live Checklist → Run Check
- Risk disclosure belum acknowledged → Settings → Regulatory → Acknowledge
- MT5 tidak connected → Settings → MT5 → Test connection

**WebSocket disconnected**
- Backend Python tidak running → start service
- Firewall block port 8000 → allow
- WebSocket URL salah → check `NEXT_PUBLIC_PYTHON_WS_URL`

**No signals generated**
- ADX(14) di 15M &lt; 20 → regime ranging, no trade (expected behavior)
- Outside jam emas (14:00-17:00 / 19:30-22:00 WIB) → wait
- News blackout active → check News Calendar

**Push notifications not arriving**
- Browser permission denied → Site Settings → Notifications → Allow
- Service worker not registered → check DevTools → Application → Service Workers
- Toggle in Settings → Browser Push Notifications

**Demo mode stuck (can't connect to backend)**
- Set `NEXT_PUBLIC_PYTHON_API_URL=http://localhost:8000` di `.env`
- Restart dev server: `bun run dev`

### More Help

- Backend README: `download/python-backend/README.md`
- Deployment guide: `docs/DEPLOYMENT.md`
- API docs (production): `http://localhost:8000/docs` (Swagger UI)

---

## 14. FAQ

**Q: Bisa dipakai untuk trading real money langsung?**
A: TIDAK. WAJIB ikuti roadmap 9 bulan: 1-3 belajar, 4-6 backtest 300 trade, 7-9 forward demo 3 bulan, baru LIVE dengan modal mikro $100-500.

**Q: Berapa minimal modal untuk mulai?**
A: $100-500 untuk F4 (mikro live). $5,000+ untuk F5 (scale up). Demo mode gratis tanpa modal.

**Q: Apakah strategi V2 menjamin profit?**
A: TIDAK. Tidak ada strategi yang menjamin profit. V2 menawarkan edge matematis (RR net ≥ 2.0, biaya terhitung, filter regime), bukan jaminan.

**Q: Bisa pakai broker selain Finex Indonesia?**
A: Ya, selama broker mendukung MT5 + spread ECN ≤ 1 pip. Update `MT5_SERVER` di `.env`.

**Q: Apakah data saya aman?**
A: Database SQLite di-encrypt dengan SQLCipher (AES-256) bila `ENCRYPTION_KEY` di-set. Backups dapat di-upload ke S3/offsite. Audit log hash-chained untuk tamper-evidence.

**Q: Bisa jalankan tanpa internet?**
A: Sebagian besar fitur ya (MT5 + Ollama lokal). Tiingo calendar + Telegram butuh internet.

**Q: Apakah PWA support mobile?**
A: Ya. Install ke home screen Android/iOS dari browser Chrome/Safari. Notifikasi push bekerja di background.

**Q: Bagaimana cara export data untuk pajak?**
A: Settings → Tax Export → "Export SPT {year}" → CSV format SPT Indonesia DJP.

**Q: Bagaimana cara backup?**
A: Settings → Database Backup → Download .sqlite. Atau automated: System Health → "Upload Now" untuk offsite backup ke S3.

**Q: Berapa lama audit log disimpan?**
A: Selamanya (SQLite, tidak ada auto-purge). Recommended: monthly export ke PDF untuk archive.

**Q: Bisakah saya customize indikator?**
A: Tidak di V2 — 3 indikator core (EMA/VWAP/ATR) dipilih dengan sengaja untuk menghindari overfit. Bila ingin experiment, fork repo + modify `strategy_v2.py`.

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **ATR** | Average True Range — volatilitas per candle |
| **ADX** | Average Directional Index — regime trending/ranging filter |
| **POC** | Point of Control — price level dengan volume tertinggi |
| **VAH/VAL** | Value Area High/Low — 70% volume around POC |
| **VaR** | Value at Risk — max loss at confidence level |
| **CVaR** | Conditional VaR — tail loss average |
| **RR Net** | Risk:Reward setelah biaya transaksi |
| **R-Multiple** | Profit/loss dalam unit risiko (R = initial risk) |
| **PF** | Profit Factor — gross profit / gross loss |
| **DD** | Drawdown — peak-to-trough decline % |
| **MC** | Monte Carlo — randomised simulation |
| **WF** | Walk-Forward — out-of-sample stability test |
| **VWAP** | Volume Weighted Average Price |
| **BE** | Break-Even — SL dipindah ke entry price |
| **TP1/TP2** | Take Profit 1 / 2 — staged exit levels |

---

*Last updated: Scalping V2 v2.0.0 · Frontend-100 · Edisi Scalping · Z.ai 2026*
