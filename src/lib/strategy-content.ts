// Structured strategy content parsed from the 3 uploaded PDFs
// Used by the Strategy Reference page in the dashboard

export const STRATEGY_OVERVIEW = {
  title: 'Strategi Scalping Forex V2',
  revision: 'Revisi 2026 dari V1 (Oktober 2026)',
  publishDate: 'November 2026',
  targetRRNet: '≥ 2.0 setelah biaya',
  tagline: 'Tujuh perbaikan major dari V1: 3 indikator core (EMA + VWAP + ATR), stop loss adaptif berbasis volatilitas, filter regime pasar, perhitungan biaya transaksi realistis, dan kerangka backtest yang statistically sound.',
  philosophy:
    'Scalping yang sukses bukan tentang banyaknya indikator atau kerumitan rumus. Tapi tentang edge kecil yang dieksekusi ratusan kali dengan biaya yang sudah dihitung, stop loss yang menyesuaikan volatilitas, dan disiplin untuk tidak trading saat pasar tidak kondusif. Sederhana, terukur, diulang.',
};

export const V1_V2_COMPARISON = [
  {
    weakness: 'Biaya transaksi diabaikan',
    fix: 'Hitung net RR setelah spread + komisi. Target RR net ≥ 2.0',
    justification: 'Spread + komisi bisa makan 30%+ profit scalping kecil (Velotrade, 2026)',
  },
  {
    weakness: '6 indikator confluence (overfit)',
    fix: '3 indikator core: EMA + VWAP + ATR. Bollinger/RSI opsional',
    justification: '2-3 indikator cukup; lebih dari itu menurunkan kualitas sinyal (ClearEdge)',
  },
  {
    weakness: 'SL fixed 8 pip',
    fix: 'SL = 1.5×ATR(14) + 2 pip buffer di luar swing',
    justification: 'Fixed pip stop gagal di berbagai regime volatilitas (fxnx.com)',
  },
  {
    weakness: 'Win rate target 50-55%',
    fix: 'Target realistis 45%, dengan RR net ≥ 2.0',
    justification: 'Backtest publik scalping 5M: 35-58% win rate (Trading Rush, Medium)',
  },
  {
    weakness: 'Backtest 100 trade',
    fix: '300 trade + 3 bulan forward demo sebelum live',
    justification: 'Statistical significance untuk expectancy ±0.1R',
  },
  {
    weakness: 'Tidak ada filter regime',
    fix: 'ADX(14): >25 = trade, <20 = skip, 20-25 = wait',
    justification: 'EUR/USD 5M hanya trending ~30% waktu, ranging ~70%',
  },
  {
    weakness: 'Daily stop 3% (terlalu longgar)',
    fix: 'Tiered: soft 1%, hard 2%, weekly 4%, overall 10%',
    justification: 'Standar prop firm 2025-2026: max daily 2%, max overall 5-6%',
  },
];

export const STRATEGY_COMPONENTS = [
  {
    indicator: 'EMA 9 & 21',
    period: '9, 21',
    dimension: 'Tren jangka pendek',
    role: 'EMA9 > EMA21 = uptrend. Pullback ke area antara dua EMA = zona entry. Cross kebalikan = exit sinyal.',
    core: true,
  },
  {
    indicator: 'VWAP',
    period: 'Harian',
    dimension: 'Nilai rata-rata institusional',
    role: 'Harga > VWAP = buyer in control. Bounce dari VWAP di London/NY = setup probabilitas tinggi.',
    core: true,
  },
  {
    indicator: 'ATR 14',
    period: '14',
    dimension: 'Volatilitas',
    role: 'Dasar perhitungan SL dan TP. ATR adaptif ke kondisi pasar: kecil di sesi sepi, besar di overlap.',
    core: true,
  },
  {
    indicator: 'ADX (filter)',
    period: '14',
    dimension: 'Kekuatan tren (regime)',
    role: '>25 = trending (trade). <20 = ranging (skip). 20-25 = wait. Wajib sebelum entry apapun.',
    core: false,
  },
  {
    indicator: 'RSI (opsional)',
    period: '14',
    dimension: 'Momentum',
    role: 'Konfirmator saja. 40-60 & naik = bullish sehat. Jangan dipakai sebagai sinyal utama.',
    core: false,
  },
];

export const ADX_REGIME_TABLE = [
  { adx: '< 20', regime: 'Ranging / Sideways', characteristic: 'Tidak ada tren jelas, false breakout sering, Bollinger menyempit', action: 'SKIP. Jangan entry apapun' },
  { adx: '20-25', regime: 'Transisi', characteristic: 'Tren mulai terbentuk tapi belum kuat, masih mudah reversal', action: 'WAIT. Hanya entry bila ada setup A+ lainnya' },
  { adx: '> 25', regime: 'Trending', characteristic: 'Tren jelas, momentum kuat, pullback dangkal', action: 'TRADE. Setup valid bisa dieksekusi' },
  { adx: '> 50', regime: 'Exhaustion', characteristic: 'Tren terlalu kuat, kemungkinan reversal besar', action: 'Hati-hati. Trail ketat, jangan entry baru' },
];

export const SL_ADAPTIVE_TABLE = [
  { session: 'Sydney 05-14', atrTipikal: '3 pip', slV2: '6.5 pip', slV1: '8 pip', masalahV1: 'Terlalu longgar, sering tersentuh' },
  { session: 'Tokyo 08-17', atrTipikal: '5 pip', slV2: '9.5 pip', slV1: '8 pip', masalahV1: 'Agak ketat, false stop' },
  { session: 'London 14-23', atrTipikal: '9 pip', slV2: '15.5 pip', slV1: '8 pip', masalahV1: 'Terlalu ketat, stop oleh noise' },
  { session: 'Overlap 19:30-23', atrTipikal: '12 pip', slV2: '20 pip', slV1: '8 pip', masalahV1: 'Sangat ketat, hampir pasti kena' },
];

export const ENTRY_RULES_BUY = [
  'ADX(14) di 15M > 25: Pasar dalam tren yang cukup kuat. Bila < 20, tutup platform.',
  'EMA9 > EMA21 di 5M: Tren mikro mengarah naik, kedua EMA miring ke atas.',
  'Harga di atas VWAP harian: Buyer in control sesi ini.',
  'Pullback ke zona buy: Harga mundur ke area antara EMA9 dan EMA21 (idealnya 0.5×ATR dari EMA9).',
  'Konfirmasi candle: Bullish engulfing, pin bar ekor bawah, atau inside bar break ke atas.',
  'SL = 1.5×ATR(14) + 2 pip di bawah swing low terdekat.',
  'TP1 = 2×SL (RR net ~1.65 di broker ECN), TP2 = 4×SL (RR net ~3.4).',
];

export const ENTRY_RULES_SELL = [
  'ADX(14) di 15M > 25: Pasar dalam tren turun yang cukup kuat.',
  'EMA9 < EMA21 di 5M: Tren mikro mengarah turun, kedua EMA miring ke bawah.',
  'Harga di bawah VWAP harian: Seller in control sesi ini.',
  'Pullback ke zona sell: Harga naik ke area antara EMA9 dan EMA21.',
  'Konfirmasi candle: Bearish engulfing, shooting star, atau inside bar break ke bawah.',
  'SL = 1.5×ATR(14) + 2 pip di atas swing high terdekat.',
  'TP1 = 2×SL, TP2 = 4×SL. Pindahkan SL ke break-even setelah TP1 tersentuh.',
];

export const EXIT_LEVELS = [
  { level: 'TP1', target: '2 × SL', ilustrasi: '20 pip brutto → 18.7 net', aksi: 'Tutup 50%. Pindahkan SL ke break-even + 2 pip. Trade menjadi risk-free.' },
  { level: 'TP2', target: '4 × SL', ilustrasi: '40 pip brutto → 38.7 net', aksi: 'Tutup 30%. Sisa 20% ditrailing dengan SL = 2×ATR dari swing terakhir.' },
  { level: 'Trailing', target: 'Sampai reverse', ilustrasi: 'Terbuka sampai EMA9 cross EMA21', aksi: 'Sisa 20% ditutup saat EMA9 cross EMA21 berlawanan, atau SL trailing tersentuh.' },
];

export const TIERED_STOP_TABLE = [
  { tier: 'Soft Daily', limit: '-1%', trigger: 'Total loss harian mencapai 1% saldo', action: 'Jurnal kenapa. Tidak boleh trade baru 30 menit.' },
  { tier: 'Hard Daily', limit: '-2%', trigger: 'Total loss harian mencapai 2% saldo', action: 'Tutup platform. Tidak trade hari itu lagi.' },
  { tier: 'Weekly', limit: '-4%', trigger: 'Akumulasi loss mingguan 4%', action: 'Re-evaluasi mingguan. Pertimbangkan skip 1 hari.' },
  { tier: 'Overall', limit: '-10%', trigger: 'Saldo turun 10% dari puncak', action: 'Stop trading. Review sistem 1 minggu penuh.' },
  { tier: 'Trade Simultan', limit: 'Maks 3', trigger: 'Sudah ada 3 posisi terbuka', action: 'Tidak boleh entry ke-4. Hindari korelasi pair.' },
];

export const BACKTEST_PHASES = [
  { phase: 'F1 · Manual Backtest', duration: '2-3 minggu', minTrades: '300', tujuan: 'Validasi sistem di data historis 6 bulan terakhir', lolos: 'Win rate ≥ 45%, profit factor ≥ 1.3, max DD < 8%' },
  { phase: 'F2 · Forward Demo', duration: '3 bulan', minTrades: '100+', tujuan: 'Uji psikologi eksekusi & kepatuhan checklist', lolos: 'Win rate ≥ 45%, kepatuhan checklist > 90%' },
  { phase: 'F3 · Akun Mikro Live', duration: '3 bulan', minTrades: '100+', tujuan: 'Uji psikologi uang sungguhan dengan risiko kecil', lolos: 'Profit konsisten 3 bulan beruntun' },
  { phase: 'F4 · Scale Up', duration: 'Continues', minTrades: '-', tujuan: 'Tambah ukuran lot bertahap (10-20% per bulan)', lolos: 'Drawdown tidak melebihi tier weekly' },
];

export const SESSION_DETAILED_TABLE = [
  { waktu: '05:00-14:00', kondisi: 'Sydney, sepi', rekomendasi: 'Skip. Spread lebar, ATR rendah, false signal banyak.' },
  { waktu: '08:00-14:00', kondisi: 'Tokyo overlap Sydney', rekomendasi: 'Hanya untuk JPY pairs bila sangat berpengalaman. Pemula skip.' },
  { waktu: '14:00-17:00', kondisi: 'London Open', rekomendasi: 'Sesi terbaik #1. EUR/USD & GBP/USD mulai aktif. Setup A+ paling sering muncul.' },
  { waktu: '17:00-19:30', kondisi: 'London lunch', rekomendasi: 'Volatilitas turun, sering sideways. Skip atau wait.' },
  { waktu: '19:30-23:00', kondisi: 'Overlap London + NY', rekomendasi: 'Jam emas scalping. Likuiditas puncak, ATR tertinggi, setup paling akurat.' },
  { waktu: '22:00-23:00', kondisi: 'Menjelang news NFP/CPI', rekomendasi: 'Blacklist 30 menit sebelum & sesudah news high impact.' },
  { waktu: 'Senin 05:00-08:00', kondisi: 'Awal minggu', rekomendasi: 'Blacklist. Likuiditas belum penuh, sering false breakout.' },
  { waktu: 'Jumat 22:00-04:00', kondisi: 'Akhir minggu', rekomendasi: 'Blacklist. Likuiditas turun, banyak position closing.' },
];

export const FINAL_NOTES = [
  'Strategi terbaik bukan yang paling rumit, melainkan yang paling jujur.',
  'Hitung biaya sebelum hitung profit.',
  'Stop loss mengikuti volatilitas, bukan angka favorit.',
  'Filter regime lebih penting daripada indikator entry.',
  'Backtest 300 trade, bukan 100.',
  'Tiered stop melindungi saat psikologi bocor.',
];

export const PAIR_DETAILED_ANALYSIS = [
  {
    rank: 1,
    name: 'EUR/USD',
    title: 'Sangat Direkomendasikan (Pair #1)',
    metrics: [
      { kriteria: 'Spread ECN', nilai: '0.6-0.8 pip' },
      { kriteria: 'Spread retail', nilai: '1.0-1.5 pip' },
      { kriteria: 'Likuiditas', nilai: 'Tertinggi di dunia (~21% turnover global harian)' },
      { kriteria: 'ADR (Average Daily Range)', nilai: '~80-100 pip' },
      { kriteria: 'Volatilitas', nilai: 'Sedang, predictable' },
      { kriteria: 'Sesi terbaik', nilai: 'London Open + Overlap NY' },
    ],
    why: 'Spread tersempit artinya RR net paling sehat. Likuiditas tinggi = slippage minimal saat entry/exit. Perilaku harga paling "bersih" dan technical — fundamental hanya dominan saat news ECB/Fed. Sangat cocok untuk sistem V2 yang menuntut RR net ≥ 2.0.',
  },
  {
    rank: 2,
    name: 'GBP/USD',
    title: 'Pair #2 untuk Volatilitas Lebih',
    metrics: [
      { kriteria: 'Spread ECN', nilai: '0.8-1.2 pip' },
      { kriteria: 'Spread retail', nilai: '1.5-2.0 pip' },
      { kriteria: 'Likuiditas', nilai: 'Sangat tinggi' },
      { kriteria: 'ADR', nilai: '~80-120 pip (paling volatil di antara major)' },
      { kriteria: 'Volatilitas', nilai: 'Tinggi' },
      { kriteria: 'Sesi terbaik', nilai: 'London Open + Overlap NY' },
    ],
    why: 'Movement lebih besar dari EUR/USD, jadi potensi TP2 (trailing) lebih besar. Tapi spread sedikit lebih lebar dan perilaku lebih "greedy" — bisa spike tajam saat news UK (BoE, CPI, GDP). Cocok setelah mahir EUR/USD.',
  },
  {
    rank: 3,
    name: 'USD/JPY',
    title: 'Pair #3 untuk Sesi Asia & Tren Bersih',
    metrics: [
      { kriteria: 'Spread ECN', nilai: '0.7-0.9 pip' },
      { kriteria: 'Spread retail', nilai: '1.2-1.8 pip' },
      { kriteria: 'Likuiditas', nilai: 'Sangat tinggi' },
      { kriteria: 'ADR', nilai: '~70-90 pip' },
      { kriteria: 'Volatilitas', nilai: 'Sedang, tren cenderung halus' },
      { kriteria: 'Sesi terbaik', nilai: 'Tokyo + Overlap' },
    ],
    why: 'Tren paling halus di antara major — sangat cocok untuk strategi trend-following V2. Spike saat news BoJ sering predictable. Movement korelasi kuat dengan yield US Treasury (saat yield naik, USD/JPY naik). Bisa di-trade di sesi Tokyo bila punya waktu pagi WIB.',
  },
];

export const CALENDAR_GRID_STRUCTURE = {
  pair: 'EUR/USD',
  capTrade: '5 / HARI',
  rrNetMin: '≥ 2.0',
  riskPerTrade: '1%',
  sessions: [
    { name: 'TOKYO', time: '09:00-12:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
    { name: 'SKIP', time: '12:00-14:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'], note: 'LOW LIQUIDITY' },
    { name: 'LONDON', time: '14:00-17:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
    { name: 'SKIP', time: '17:00-19:30', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'], note: 'LONDON LUNCH' },
    { name: 'OVERLAP', time: '20:00-22:00', days: ['SEN', 'SEL', 'RAB', 'KAM', 'JUM'] },
  ],
  weeklySummary: ['TOTAL TRADE', 'WIN RATE', 'R-NET TOTAL', 'PROFIT FACTOR', 'MAX DD', 'KEPATUHAN CHECKLIST'],
};

export const TIINGO_NEWS_TEMPLATE = [
  { day: 'SEN', time: '19:00', event: 'ECB Speech', detail: 'Lagarde — EUR volatility', impact: 'MED' },
  { day: 'SEL', time: '19:00', event: 'EZ CPI Flash', detail: 'Inflasi Eurozone — EUR sensitive', impact: 'MED' },
  { day: 'RAB', time: '20:30', event: 'US CPI', detail: 'Inflasi US — USD volatility besar', impact: 'HIGH' },
  { day: 'KAM', time: '20:30', event: 'ECB Rate Decision', detail: '+ Press Conf 20:45 — EUR spike', impact: 'HIGH' },
  { day: 'JUM', time: '20:30', event: 'NFP (Non-Farm Payrolls)', detail: 'Jumat pertama bulan — USD besar', impact: 'HIGH' },
];

export const WEEKLY_NEWS_BLACKLIST_NOTE =
  '⚠ Blacklist: 30 menit sebelum & sesudah news high impact. Cek ForexFactory/Tiingo untuk update.';

export const TRADE_LOG_EXAMPLES = [
  {
    date: '03/11',
    pair: 'EUR/USD',
    session: 'London',
    result: '+1.8R net',
    details: 'ADX: 28 | ATR: 9 pip | SL: 15.5 pip | TP1: 31 pip | ENTRY: 1.0853 | EXIT: 1.0884 | SETUP: Pin bar @EMA21',
  },
  {
    date: '03/11',
    pair: 'EUR/USD',
    session: 'Overlap',
    result: '+3.5R net',
    details: 'ADX: 35 | ATR: 12 pip | SL: 20 pip | TP2: 80 pip (trailing) | ENTRY: 1.0840 | EXIT: 1.0920 | SETUP: VWAP bounce',
  },
  {
    date: '04/11',
    pair: 'GBP/USD',
    session: 'London',
    result: '-1.0R',
    details: 'ADX: 22 | ATR: 10 pip | SL: 17 pip | EXIT: SL tersentuh | ENTRY: 1.2710 | CATATAN: ADX 22 (transisi), seharusnya skip',
  },
  {
    date: '04/11',
    pair: 'USD/JPY',
    session: 'Tokyo',
    result: 'SKIP',
    details: 'ADX: 18 (ranging) | AKSI: Tidak entry sesuai aturan V2 | CATATAN: Disiplin filter regime berhasil menghindari false breakout',
  },
  {
    date: '05/11',
    pair: 'EUR/USD',
    session: 'London',
    result: '+1.6R net',
    details: 'ADX: 30 | ATR: 8 pip | SL: 14 pip | TP1: 28 pip | ENTRY: 1.0870 | EXIT: 1.0898 | SETUP: Engulfing + EMA cross',
  },
];

export const WEEKLY_TRADE_LESSON =
  'Perhatikan trade ke-4 (SKIP). Trader V1 akan kesulitan menahan diri di pasar ranging dan kemungkinan entry — yang akan berakhir loss. Trade ke-3 (loss) sebenarnya juga melanggar aturan ADX > 25 (entry saat ADX 22 = transisi). Inilah pentingnya jurnal: setiap pelanggaran tercatat dan bisa dievaluasi mingguan.';
