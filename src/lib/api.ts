// API client - automatically uses Python backend if available, falls back to mock
'use client';

import type {
  Account,
  BotState,
  ChartData,
  ChatMessage,
  DailyRisk,
  NewsEvent,
  Signal,
  Settings,
  SystemStatus,
  Trade,
} from './types';
import {
  getDemoAccount,
  getDemoBotState,
  getDemoChartData,
  getDemoDailyRisk,
  getDemoNews,
  getDemoOpenTrades,
  getDemoSignals,
  getDemoSystemStatus,
  getDemoTradeHistory,
} from './mock-data';

// In demo mode (sandbox), use Next.js API routes that return mock data
// In production (Windows with Python backend), set NEXT_PUBLIC_PYTHON_API_URL
const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API_URL || '';
const IS_DEMO = !PYTHON_API;

export const DEMO_MODE = IS_DEMO;

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  if (IS_DEMO) {
    // Use Next.js internal API routes (mock)
    const res = await fetch(path, options);
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json();
  } else {
    // Use Python FastAPI backend
    const url = `${PYTHON_API}${path}`;
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`Python API ${path} failed: ${res.status}`);
    return res.json();
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  if (IS_DEMO) return getDemoSystemStatus();
  return fetchAPI<SystemStatus>('/api/status');
}

export async function getAccount(): Promise<Account> {
  if (IS_DEMO) return getDemoAccount();
  return fetchAPI<Account>('/api/account');
}

export async function getBotState(): Promise<BotState> {
  if (IS_DEMO) return getDemoBotState();
  return fetchAPI<BotState>('/api/status').then((s) => s.bot);
}

export async function getOpenTrades(): Promise<Trade[]> {
  if (IS_DEMO) return getDemoOpenTrades();
  return fetchAPI<Trade[]>('/api/positions');
}

export async function getTradeHistory(): Promise<Trade[]> {
  if (IS_DEMO) return getDemoTradeHistory(30);
  return fetchAPI<Trade[]>('/api/journal?status=CLOSED');
}

export async function getSignals(): Promise<Signal[]> {
  if (IS_DEMO) return getDemoSignals();
  return fetchAPI<Signal[]>('/api/signals');
}

export async function getNews(): Promise<NewsEvent[]> {
  if (IS_DEMO) return getDemoNews();
  return fetchAPI<NewsEvent[]>('/api/news');
}

export async function getChartData(symbol: string): Promise<ChartData> {
  if (IS_DEMO) return getDemoChartData(symbol);
  return fetchAPI<ChartData>(`/api/chart/${symbol}`);
}

export async function controlBot(action: 'start' | 'stop' | 'kill'): Promise<{ success: boolean; message: string }> {
  if (IS_DEMO) {
    return { success: true, message: `Bot ${action} berhasil (demo mode)` };
  }
  return fetchAPI(`/api/bot/${action}`, { method: 'POST' });
}

export async function aiChat(messages: ChatMessage[], context?: string): Promise<string> {
  if (IS_DEMO) {
    // Simulate AI response
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const userText = lastUser?.content || '';
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
    return generateDemoAIResponse(userText, context);
  }
  const res = await fetchAPI<{ response: string }>('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context }),
  });
  return res.response;
}

export async function analyzeSetup(signal: Signal): Promise<string> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 1200));
    const compliant = signal.checklistPassed >= 7 && signal.rrNet >= 2.0;
    return compliant
      ? `COMPLIANT — Setup ${signal.direction} ${signal.symbol} sesuai V2 strategy. ADX=${signal.adxValue.toFixed(1)} trending (>25 ✓), RR net=${signal.rrNet.toFixed(2)} ≥ 2.0 ✓, checklist ${signal.checklistPassed}/8 ✓. ${signal.setupType} terkonfirmasi di sesi ${signal.session}. REKOMENDASI: Eksekusi dengan lot sesuai risk 1%.`
      : `NON-COMPLIANT — Setup tidak memenuhi V2. ${signal.checklistPassed < 8 ? `Checklist hanya ${signal.checklistPassed}/8.` : ''} ${signal.rrNet < 2.0 ? `RR net ${signal.rrNet.toFixed(2)} < 2.0 minimum.` : ''} REKOMENDASI: SKIP sesuai aturan emas #1 & #2.`;
  }
  const res = await fetchAPI<{ verdict: string }>('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  });
  return res.verdict;
}

export async function getSettings(): Promise<Settings> {
  if (IS_DEMO) {
    return {
      mt5: { login: '50384721', password: '', server: 'FinexIC-Markets', broker: 'Finex Indonesia' },
      ollama: { url: 'http://localhost:11434', model: 'llama3.2:latest' },
      tiingo: { apiKey: 'demo_key_*****' },
      risk: {
        riskPctPerTrade: 0.01,
        maxPositions: 3,
        maxDailyTrades: 5,
        rrNetMin: 2.0,
        softStopPct: -0.01,
        hardStopPct: -0.02,
        weeklyStopPct: -0.04,
        overallStopPct: -0.10,
      },
      pairs: ['EURUSD', 'GBPUSD', 'USDJPY'],
      pythonApiUrl: 'http://localhost:8000',
    };
  }
  return fetchAPI<Settings>('/api/settings');
}

export async function saveSettings(settings: Settings): Promise<{ success: boolean }> {
  if (IS_DEMO) return { success: true };
  return fetchAPI('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

// Demo AI response generator (only used in sandbox)
function generateDemoAIResponse(userText: string, context?: string): string {
  const text = userText.toLowerCase();

  if (text.includes('adx') || text.includes('regime')) {
    return `Berdasarkan V2 strategy, ADX(14) di timeframe 15M adalah filter regime utama:

• ADX > 25 → TRENDING → TRADE (setup valid bisa dieksekusi)
• ADX 20-25 → TRANSISI → WAIT (hanya entry setup A+ lainnya)
• ADX < 20 → RANGING → SKIP (jangan entry apapun, tutup platform)
• ADX > 50 → EXHAUSTION → hati-hati, kemungkinan reversal besar

EUR/USD di 5M hanya trending ~30% waktu, ranging ~70%. Inilah kenapa ADX filter adalah perbaikan paling penting di V2 — mengeliminasi ~70% waktu pasar yang ranging.

Aturan wajib: cek ADX(14) di 15M SEBELUM melihat chart 5M. Bila ADX 15M < 20, tutup platform atau lakukan hal lain hari itu.`;
  }

  if (text.includes('rr') || text.includes('risk reward') || text.includes('biaya')) {
    return `RR Net V2 dihitung setelah biaya transaksi:

RR Net = (TP brutto − biaya) / (SL brutto + biaya)
di mana biaya = spread + komisi (dalam pip setara)

Contoh EUR/USD broker ECN:
• Spread 0.6 pip + komisi $7/lot (≈0.7 pip) = 1.3 pip total
• V2 target: TP 20 pip, SL 10 pip → RR net = 18.7/11.3 = 1.65 (sehat)
• V2 TP2: TP 40 pip → RR net = 38.7/11.3 = 3.42 (excellent)

Aturan emas #2: RR net ≥ 2.0 atau SKIP. Hitung SEBELUM entry, bukan setelah. Bila setup tidak menjanjikan ruang 25+ pip, lewati.`;
  }

  if (text.includes('sl') || text.includes('stop loss') || text.includes('atr')) {
    return `Stop Loss V2 adaptif berbasis ATR(14):

SL (pip) = ATR(14) × 1.5 + 2 pip buffer (di luar swing)

Mengapa fixed pip gagal:
• Sydney ATR ~3 pip → SL V2 6.5 pip (V1 8 pip terlalu longgar)
• London ATR ~9 pip → SL V2 15.5 pip (V1 8 pip terlalu ketat)
• Overlap ATR ~12 pip → SL V2 20 pip (V1 8 pip hampir pasti kena)

Penempatan: SL di swing high/low terdekat + 2 pip buffer, asalkan mendekati 1.5×ATR. Bila swing hanya 10 pip dari entry tapi ATR 9 (SL teoritis 15.5), pilih 15.5 untuk ruang napas.

Lot otomatis menyesuaikan: SL 12 pip → lot 0.17 (bulatkan 0.15), SL 20 pip → lot 0.10. Selalu hitung ulang.`;
  }

  if (text.includes('session') || text.includes('sesi') || text.includes('waktu')) {
    return `Jam emas scalping V2 (WIB/UTC+7):

✓ TRADE:
• London Open 14:00-17:00 — sesi terbaik #1, EUR/USD & GBP/USD paling aktif
• Overlap London+NY 19:30-23:00 — jam emas, likuiditas puncak, ATR tertinggi
• Tokyo 09:00-12:00 — hanya untuk USD/JPY bila berpengalaman

✗ SKIP:
• Sydney 05:00-14:00 — sepi, spread lebar, false signal
• London Lunch 17:00-19:30 — sideways
• Senin 05:00-08:00 — likuiditas belum penuh
• Jumat 22:00-04:00 — position closing
• ±30 menit sebelum/sesudah news HIGH impact

Trading 2-3 jam fokus di jam emas jauh lebih produktif daripada 8 jam di depan chart. Bila tidak bisa hadir di jam ini, pertimbangkan day trading 1H/4H.`;
  }

  if (text.includes('pair') || text.includes('pasangan')) {
    return `Pair scalping V2 (urutan prioritas):

#1 EUR/USD — Sangat Direkomendasikan
• Spread ECN 0.6-0.8 pip, ADR 80-100 pip
• Likuiditas tertinggi (~21% turnover global)
• Perilaku paling "bersih" dan technical
• Mulai di sini selama 3 bulan pertama

#2 GBP/USD — Volatilitas Lebih
• Spread ECN 0.8-1.2 pip, ADR 80-120 pip (paling volatil major)
• Movement besar → potensi TP2 trailing lebih besar
• Tapi spread lebih lebar, perilaku "greedy" — bisa spike tajam

#3 USD/JPY — Tren Bersih
• Spread ECN 0.7-0.9 pip, ADR 70-90 pip
• Tren paling halus di major — cocok trend-following V2
• Spike BoJ predictable, korelasi kuat yield US Treasury

WAJIB DIHINDARI: Exotic pairs (USD/TRY, USD/ZAR), cross low liquidity (NZD/CHF), high volatility (GBP/JPY untuk pemula).`;
  }

  if (text.includes('checklist') || text.includes('pre trade')) {
    return `Pre-Trade Checklist V2 (8 poin — SEMUA harus tercentang):

1. ADX(14) di 15M > 25? (< 20 tutup platform, 20-25 hanya A+)
2. EMA9 > EMA21 (buy) atau < (sell) di 5M, miring konsisten?
3. Harga di sisi VWAP yang sama dengan arah entry?
4. Pullback ke area EMA9-EMA21 (bukan di akhir pergerakan)?
5. Konfirmasi candle pattern (engulfing, pin bar, inside bar)?
6. SL = 1.5×ATR(14) + 2 pip, lot sesuai risk 1%?
7. RR net (setelah biaya) ≥ 2.0? (TP brutto ~2.5× SL brutto)
8. Tidak ada news HIGH 30 menit & belum soft stop 1%?

Bila satu saja tidak terpenuhi → NO TRADE. Tidak ada pengecualian, sekalipun "feeling sangat yakin". V2 hanya punya 7 kondisi entry vs V1 12, tapi masing-masing lebih ketat & terukur.`;
  }

  if (text.includes('kill') || text.includes('emergency') || text.includes('stop bot')) {
    return `Kill Switch & Safety Override V2:

🔴 KILL SWITCH (emergency):
• Tutup SEMUA posisi terbuka via market order
• Hentikan bot trading engine
• Lock bot sampai manual reset

Tiered Stop (auto):
• Soft -1% harian → jurnal kenapa, no trade 30 menit
• Hard -2% harian → tutup platform hari itu
• Weekly -4% → re-evaluasi, skip 1 hari
• Overall -10% → stop trading 1 minggu, review sistem

Position Limits:
• Maks 3 posisi simultan (hindari korelasi pair)
• Maks 5 trade per hari
• Setelah 2 loss beruntun → tutup platform 30 menit
• Setelah 3 loss di hari sama → tutup sampai besok

Psikologi: tiered stop melindungi saat psikologi bocor. Bila tidak bisa mematuhi hard stop 2%, scalping bukan untuk Anda.`;
  }

  // Default: strategy overview
  return `Strategi Scalping V2 — ringkasan:

Filosofi: edge kecil dieksekusi ratusan kali dengan biaya terhitung, SL adaptif volatilitas, disiplin tidak trade saat pasar tidak kondusif. Sederhana, terukur, diulang.

7 Perbaikan Major dari V1:
1. Biaya transaksi dihitung net (RR ≥ 2.0 setelah spread+komisi)
2. 3 indikator core (EMA+VWAP+ATR), bukan 6
3. SL adaptif ATR, bukan fixed pip
4. Win rate target realistis 45% (bukan 50-55%)
5. Backtest 300 trade + forward demo 3 bulan
6. ADX filter regime (>25 trade, <20 skip)
7. Tiered stop (1%/2%/4%/10%) bukan daily stop 3%

Roadmap 9 bulan: 1-3 belajar, 4-6 backtest 300 trade, 7-9 forward demo, 10-12 mikro live, 13+ scale up.

Pertanyaan spesifik? Tanya tentang: ADX, RR net, SL/ATR, session, pair, checklist, kill switch, atau psikologi scalper.`;
}
