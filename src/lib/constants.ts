// V2 Strategy constants & trading data
// All values match Strategi_Scalping_Forex_V2.pdf

export const V2_RULES = {
  // Risk Management
  RISK_PCT_PER_TRADE: 0.01, // 1%
  MAX_POSITIONS: 3,
  MAX_DAILY_TRADES: 5,
  RR_NET_MIN: 2.0,

  // Stop Loss
  SL_ATR_MULT: 1.5,
  SL_PIP_BUFFER: 2.0,

  // Take Profit
  TP1_MULT: 2.0,
  TP2_MULT: 4.0,
  TP1_CLOSE_PCT: 0.5,
  TP2_CLOSE_PCT: 0.3,
  TRAIL_ATR_MULT: 2.0,
  BE_BUFFER_PIPS: 2.0,

  // Regime Filter
  ADX_TRENDING: 25.0,
  ADX_RANGING: 20.0,
  ADX_EXHAUSTION: 50.0,

  // Indicators
  EMA_FAST: 9,
  EMA_SLOW: 21,
  ATR_PERIOD: 14,
  ADX_PERIOD: 14,
  RSI_PERIOD: 14,
  BB_PERIOD: 20,
  BB_STD: 2.0,

  // Sessions WIB (UTC+7)
  NEWS_BLACKOUT_MINUTES: 30,

  // Tiered Stops
  TIERED_STOPS: {
    SOFT_DAILY: -0.01, // -1%
    HARD_DAILY: -0.02, // -2%
    WEEKLY: -0.04, // -4%
    OVERALL: -0.10, // -10%
  },
} as const;

// Trading sessions in WIB (UTC+7)
export const SESSIONS = [
  { name: 'Sydney', start: '05:00', end: '14:00', wib: true, trade: false, note: 'Skip — likuiditas rendah' },
  { name: 'Tokyo', start: '09:00', end: '12:00', wib: true, trade: true, note: 'JPY pairs aktif' },
  { name: 'London Open', start: '14:00', end: '17:00', wib: true, trade: true, note: 'Sesi terbaik #1' },
  { name: 'London Lunch', start: '17:00', end: '19:30', wib: true, trade: false, note: 'Skip — sideways' },
  { name: 'Overlap London+NY', start: '19:30', end: '23:00', wib: true, trade: true, note: 'Jam emas scalping' },
] as const;

export const BLACKLIST_TIMES = [
  { time: 'Senin 05:00-08:00', note: 'Likuiditas belum penuh, false breakout' },
  { time: 'Jumat 22:00-04:00', note: 'Likuiditas turun, position closing' },
  { time: '±30 min news HIGH impact', note: 'Blackout wajib' },
];

// Trading pairs with characteristics from Pair_Scalping_Forex_V2.pdf
export const TRADING_PAIRS = [
  {
    symbol: 'EURUSD',
    name: 'EUR/USD',
    rank: 1,
    spreadEcn: '0.6-0.8 pip',
    spreadRetail: '1.0-1.5 pip',
    adr: '80-100 pip',
    volatility: 'Sedang',
    liquidity: 'Tertinggi (~21% turnover global)',
    bestSession: 'London Open + Overlap NY',
    recommendation: 'Sangat Direkomendasikan (Pair #1)',
    reason: 'Spread tersempit → RR net paling sehat. Perilaku harga paling "bersih" dan technical.',
    color: '#10b981',
  },
  {
    symbol: 'GBPUSD',
    name: 'GBP/USD',
    rank: 2,
    spreadEcn: '0.8-1.2 pip',
    spreadRetail: '1.5-2.0 pip',
    adr: '80-120 pip',
    volatility: 'Tinggi',
    liquidity: 'Sangat tinggi',
    bestSession: 'London Open + Overlap NY',
    recommendation: 'Pair #2 untuk Volatilitas Lebih',
    reason: 'Movement lebih besar → potensi TP2 trailing lebih besar. Tapi spread lebih lebar.',
    color: '#f59e0b',
  },
  {
    symbol: 'USDJPY',
    name: 'USD/JPY',
    rank: 3,
    spreadEcn: '0.7-0.9 pip',
    spreadRetail: '1.2-1.8 pip',
    adr: '70-90 pip',
    volatility: 'Sedang, tren halus',
    liquidity: 'Sangat tinggi',
    bestSession: 'Tokyo + Overlap',
    recommendation: 'Pair #3 untuk Sesi Asia & Tren Bersih',
    reason: 'Tren paling halus di antara major — cocok untuk trend-following V2.',
    color: '#8b5cf6',
  },
];

export const SECONDARY_PAIRS = [
  { symbol: 'USDCHF', spread: '1.0-1.5 pip', note: 'Invers EUR/USD, pergerakan mirror' },
  { symbol: 'EURGBP', spread: '1.0-1.5 pip', note: 'Volatilitas rendah, range predictable' },
  { symbol: 'AUDUSD', spread: '1.0-1.5 pip', note: 'Sensitif komoditas, perilaku halus' },
  { symbol: 'USDCAD', spread: '1.2-2.0 pip', note: 'Sensitif harga minyak' },
];

export const AVOID_PAIRS = [
  { symbol: 'USDTRY', note: 'Spread 20-100 pip — bunuh diri untuk scalping' },
  { symbol: 'USDZAR', note: 'Exotic, spread sangat lebar' },
  { symbol: 'USDMXN', note: 'Exotic, slippage besar' },
  { symbol: 'GBJPY', note: 'Sangat volatile, butuh kapital besar — advanced only' },
];

// V2 Pre-trade Checklist (8 points)
export const PRE_TRADE_CHECKLIST = [
  { id: 1, text: 'ADX(14) di 15M > 25? (Bila < 20, tutup platform. Bila 20-25, hanya entry setup A+.)' },
  { id: 2, text: 'EMA9 di atas/bawah EMA21 di 5M sesuai arah yang diinginkan, keduanya miring konsisten?' },
  { id: 3, text: 'Harga berada di sisi VWAP yang sama dengan arah entry (di atas VWAP untuk buy, di bawah untuk sell)?' },
  { id: 4, text: 'Sudah ada pullback ke area antara EMA9 dan EMA21 (bukan entry di akhir pergerakan)?' },
  { id: 5, text: 'Ada konfirmasi candle pattern valid (engulfing, pin bar, inside bar break)?' },
  { id: 6, text: 'SL = 1.5×ATR(14) + 2 pip di luar swing, lot disesuaikan risk 1%?' },
  { id: 7, text: 'RR net (setelah spread + komisi) ≥ 2.0? (TP brutto ~2.5× SL brutto.)' },
  { id: 8, text: 'Tidak ada news HIGH impact 30 menit & belum soft stop 1%?' },
];

export const POST_TRADE_CHECKLIST = [
  { id: 1, text: 'Semua 8 checklist pre-trade tercentang jujur?' },
  { id: 2, text: 'SL dipindahkan ke break-even setelah TP1 tersentuh?' },
  { id: 3, text: 'Keluar manual saat setup invalid sebelum SL tersentuh?' },
  { id: 4, text: 'Kepatuhan tiered stop loss (soft/hard/weekly)?' },
  { id: 5, text: 'Emosi dominan: sabar, FOMO, frustrasi, atau overconfident?' },
];

// 10 Aturan Emas V2
export const GOLDEN_RULES = [
  'ADX < 20 di 15M = tidak trade, tidak ada pengecualian.',
  'RR net (setelah biaya) ≥ 2.0 atau skip. Hitung sebelum entry.',
  'SL adaptif: 1.5×ATR(14) + 2 pip di luar swing. Jangan fixed pip.',
  'Risk 1% per trade, maksimum 3 trade simultan, 5 trade per hari.',
  'Tiered stop: soft 1%, hard 2%, weekly 4%, overall 10% — hentikan saat tercapai.',
  'Backtest 300 trade + forward demo 3 bulan sebelum akun mikro live.',
  'Trading hanya di jam emas: 14:00–17:00 atau 19:30–22:00 WIB.',
  'Blacklist: 30 menit sebelum/sesudah news, Senin awal, Jumat akhir.',
  'Setelah 2 loss beruntun: tutup platform 30 menit. Setelah 3 loss: tutup hari itu.',
  'Jurnal setiap trade dengan ATR, RR net, dan emosi. Evaluasi mingguan wajib.',
];

// ATR tipikal per session (EUR/USD 5M, historical estimate)
export const ATR_PER_SESSION = [
  { session: 'Sydney 05-14', atrPip: 3, slV2: 6.5, slV1: 8, problem: 'Terlalu longgar, sering tersentuh' },
  { session: 'Tokyo 08-17', atrPip: 5, slV2: 9.5, slV1: 8, problem: 'Agak ketat, false stop' },
  { session: 'London 14-23', atrPip: 9, slV2: 15.5, slV1: 8, problem: 'Terlalu ketat, stop oleh noise' },
  { session: 'Overlap 19:30-23', atrPip: 12, slV2: 20, slV1: 8, problem: 'Sangat ketat, hampir pasti kena' },
];

// RR Net calculation scenarios
export const RR_NET_SCENARIOS = [
  { scenario: 'V1 broker ECN', tpBrutto: 12, slBrutto: 8, cost: 1.3, rrNet: 1.15, status: 'Margin tipis' },
  { scenario: 'V1 broker retail', tpBrutto: 12, slBrutto: 8, cost: 2.0, rrNet: 1.0, status: 'Break-even' },
  { scenario: 'V2 broker ECN', tpBrutto: 20, slBrutto: 10, cost: 1.3, rrNet: 1.65, status: 'Sehat' },
  { scenario: 'V2 broker retail', tpBrutto: 20, slBrutto: 10, cost: 2.0, rrNet: 1.5, status: 'Layak' },
  { scenario: 'V2 target TP2 (2×SL)', tpBrutto: 40, slBrutto: 10, cost: 1.3, rrNet: 3.42, status: 'Excellent' },
];

// Roadmap 9 bulan
export const ROADMAP_9_MONTHS = [
  { phase: 'F1 · Belajar Sistem', months: '1-3', activity: 'Baca V2 lengkap, pasang indikator di demo, kenali pola setup A+', target: 'Identifikasi setup valid < 30 detik' },
  { phase: 'F2 · Backtest Manual', months: '4-6', activity: '300 trade di data historis 6 bulan terakhir dengan jurnal ketat', target: 'Win rate ≥ 45%, PF ≥ 1.3, max DD < 8%' },
  { phase: 'F3 · Forward Demo', months: '7-9', activity: 'Trading real-time di akun demo, evaluasi mingguan', target: 'Kepatuhan checklist > 90%, profit konsisten 3 bulan' },
  { phase: 'F4 · Akun Mikro Live', months: '10-12', activity: 'Modal $100-500, lot terkecil, fokus psikologi uang', target: 'Tanpa pelanggaran tiered stop, profit konsisten 3 bulan' },
  { phase: 'F5 · Scale Up', months: '13+', activity: 'Tambah ukuran lot 10-20% per bulan bila profit konsisten', target: 'Drawdown tidak melebihi tier weekly' },
];

// 5 Musuh Scalper V2 dengan mitigasi
export const SCALPER_ENEMIES = [
  {
    name: 'FOMO',
    mitigation: 'Pasang alert harga di level zona entry. Jangan kejar harga > 0.3×ATR dari zona ideal. Max 1 trade per 30 menit pertama sesi.',
  },
  {
    name: 'Revenge Trading',
    mitigation: 'Setelah 2 loss beruntun: tutup platform 30 min. Setelah 3 loss di hari sama: tutup sampai besok. Hard stop 2% wajib.',
  },
  {
    name: 'Overtrading',
    mitigation: 'Cap harian 5 trade. Setelah cap tercapai, tutup platform. Bila rata-rata harian > 4 trade/minggu → overtrading.',
  },
  {
    name: 'Tidak Terima Loss',
    mitigation: 'Setelah SL dipasang, jangan sentuh kecuali pindah ke BE setelah TP1. Keluar manual bila setup invalid via market order.',
  },
  {
    name: 'Tilt',
    mitigation: 'Kenali tanda: jantung berdebar, tangan dingin, mudah marah. Saat muncul → tutup platform + aktivitas fisik 15 menit.',
  },
];

// Display density configurations
export const DENSITY_MODES = {
  minimal: {
    label: 'Minimal',
    description: 'Lega & mudah dibaca',
    cardPadding: 'p-6',
    cardGap: 'gap-6',
    textBase: 'text-base',
    textSm: 'text-sm',
    textXs: 'text-xs',
    cellPad: 'px-4 py-3',
    iconSize: 'h-5 w-5',
    rowHeight: 'h-12',
  },
  compact: {
    label: 'Compact',
    description: 'Seimbang',
    cardPadding: 'p-4',
    cardGap: 'gap-4',
    textBase: 'text-sm',
    textSm: 'text-sm',
    textXs: 'text-xs',
    cellPad: 'px-3 py-2',
    iconSize: 'h-4 w-4',
    rowHeight: 'h-10',
  },
  dense: {
    label: 'Dense',
    description: 'Maksimal data di layar',
    cardPadding: 'p-2.5',
    cardGap: 'gap-2',
    textBase: 'text-xs',
    textSm: 'text-xs',
    textXs: 'text-[10px]',
    cellPad: 'px-2 py-1',
    iconSize: 'h-3.5 w-3.5',
    rowHeight: 'h-8',
  },
} as const;

export type DensityMode = keyof typeof DENSITY_MODES;

// News calendar template from Kalender_Trading_Scalping_V2.pdf
export const WEEKLY_NEWS_TEMPLATE = [
  { day: 'SEN', time: '19:00', event: 'ECB Speech', detail: 'Lagarde — EUR volatility', impact: 'MED' },
  { day: 'SEL', time: '19:00', event: 'EZ CPI Flash', detail: 'Inflasi Eurozone — EUR sensitive', impact: 'MED' },
  { day: 'RAB', time: '20:30', event: 'US CPI', detail: 'Inflasi US — USD volatility besar', impact: 'HIGH' },
  { day: 'KAM', time: '20:30', event: 'ECB Rate Decision', detail: '+ Press Conf 20:45 — EUR spike', impact: 'HIGH' },
  { day: 'JUM', time: '20:30', event: 'NFP (Non-Farm Payrolls)', detail: 'Jumat pertama bulan — USD besar', impact: 'HIGH' },
];

// Session grid from Kalender Trading
export const SESSION_GRID = [
  { session: 'TOKYO', time: '09:00-12:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
  { session: 'SKIP', time: '12:00-14:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
  { session: 'LONDON', time: '14:00-17:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
  { session: 'SKIP', time: '17:00-19:30', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
  { session: 'OVERLAP', time: '20:00-22:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
];
