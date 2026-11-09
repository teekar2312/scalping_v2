// Mock data generator for demo mode (when Python backend is not connected)
// Generates realistic forex trading data following V2 strategy rules

import type {
  Account,
  BotState,
  Candle,
  ChartData,
  DailyRisk,
  NewsEvent,
  Signal,
  Trade,
  ChecklistResult,
  SystemStatus,
  AuditLogEntry,
  EquityCurvePoint,
  PerformanceAttribution,
  SessionStats,
  ComplianceScore,
  PreLiveCheck,
  BacktestRequest,
  BacktestResult,
  BacktestTrade,
  StreakStatus,
  HolidayEntry,
  BotModeState,
  EmotionalSummaryResponse,
  TimeSyncResponse,
  RiskDisclosureResponse,
  ServiceTestResult,
  SetupType,
  SessionName,
} from './types';
import {
  PRE_TRADE_CHECKLIST,
  TRADING_PAIRS,
  V2_RULES,
  AUDIT_EVENT_TYPES,
} from './constants';

let seed = 42;
const rand = () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};
const randFloat = (min: number, max: number) => min + rand() * (max - min);
const randInt = (min: number, max: number) => Math.floor(randFloat(min, max + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const SYMBOL_PRICES: Record<string, number> = {
  EURUSD: 1.0853,
  GBPUSD: 1.2710,
  USDJPY: 151.45,
};

const PIP_SIZES: Record<string, number> = {
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDJPY: 0.01,
};

export function getDemoAccount(): Account {
  return {
    login: 50384721,
    server: 'FinexIC-Markets',
    broker: 'Finex Indonesia',
    currency: 'USD',
    leverage: 100,
    balance: 10000,
    equity: 10042.5,
    margin: 580.25,
    marginFree: 9462.25,
    marginLevel: 1731,
    profit: 42.5,
    lastSync: new Date().toISOString(),
  };
}

export function getDemoBotState(): BotState {
  return {
    status: 'RUNNING',
    autoTrade: true,
    killSwitch: false,
    lastStartedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    lastStoppedAt: null,
    totalTrades: 47,
    totalWins: 22,
    totalLosses: 25,
    uptimeSec: 3600,
    mt5Connected: true,
    ollamaConnected: true,
    tiingoConnected: true,
  };
}

export function getDemoDailyRisk(): DailyRisk {
  return {
    date: new Date().toISOString().split('T')[0],
    startingBalance: 10000,
    currentBalance: 10042.5,
    dailyPnl: 42.5,
    dailyPnlPct: 0.00425,
    tradesCount: 3,
    winsCount: 2,
    lossesCount: 1,
    softStopHit: false,
    hardStopHit: false,
    botLocked: false,
    lockReason: null,
  };
}

export function getDemoSystemStatus(): SystemStatus {
  return {
    bot: getDemoBotState(),
    account: getDemoAccount(),
    dailyRisk: getDemoDailyRisk(),
    openPositionsCount: 2,
    todayTradesCount: 3,
    weeklyPnlPct: 0.018,
    overallPnlPct: 0.045,
    mt5Available: true,
    ollamaAvailable: true,
    tiingoAvailable: true,
    pythonBackendUrl: null,
    demoMode: true,
  };
}

function generateChecklist(allPass = true): ChecklistResult[] {
  return PRE_TRADE_CHECKLIST.map((item, idx) => ({
    point: item.id,
    label: item.text,
    passed: allPass ? true : rand() > 0.15,
    detail: idx === 0 ? `ADX=${randFloat(25, 38).toFixed(1)}` : undefined,
  }));
}

const SETUP_TYPES: SetupType[] = ['VWAP_BOUNCE', 'EMA_CROSS', 'PIN_BAR', 'ENGULFING', 'INSIDE_BAR'];
const SESSIONS: SessionName[] = ['TOKYO', 'LONDON', 'OVERLAP'];

export function getDemoOpenTrades(): Trade[] {
  const trades: Trade[] = [];
  const symbols = ['EURUSD', 'GBPUSD'];

  for (let i = 0; i < 2; i++) {
    const symbol = symbols[i];
    const direction = i === 0 ? 'BUY' : 'SELL';
    const basePrice = SYMBOL_PRICES[symbol];
    const pipSize = PIP_SIZES[symbol];
    const atr = randFloat(8, 12);
    const slPips = atr * V2_RULES.SL_ATR_MULT + V2_RULES.SL_PIP_BUFFER;
    const tp1Pips = slPips * V2_RULES.TP1_MULT;
    const adx = randFloat(26, 35);
    const rrNet = randFloat(1.95, 2.4);
    const entryPrice = basePrice - (i === 0 ? 0.0008 : 0.0012);

    trades.push({
      id: `trade-open-${i}`,
      ticket: 50480000 + i,
      symbol,
      direction,
      volume: 0.1,
      openPrice: entryPrice,
      closePrice: null,
      sl: direction === 'BUY' ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize,
      tp1: direction === 'BUY' ? entryPrice + tp1Pips * pipSize : entryPrice - tp1Pips * pipSize,
      tp2: direction === 'BUY' ? entryPrice + tp1Pips * 2 * pipSize : entryPrice - tp1Pips * 2 * pipSize,
      slPips,
      tp1Pips,
      rrNet,
      atrValue: atr,
      adxValue: adx,
      regime: 'TRENDING',
      setupType: pick(SETUP_TYPES),
      session: pick(SESSIONS),
      status: 'OPEN',
      result: null,
      rMultiple: null,
      profitNet: rand() > 0.5 ? randFloat(5, 45) : -randFloat(5, 25),
      closeReason: null,
      entryTime: new Date(Date.now() - randFloat(15, 180) * 60 * 1000).toISOString(),
      closeTime: null,
      durationMin: null,
      checklist: generateChecklist(true),
      aiAnalysis: 'Setup A+ sesuai V2. ADX trending, RR net sehat. Konfirmasi candle valid.',
    });
  }

  return trades;
}

export function getDemoTradeHistory(count = 20): Trade[] {
  const trades: Trade[] = [];
  for (let i = 0; i < count; i++) {
    const pair = pick(TRADING_PAIRS);
    const direction = pick(['BUY', 'SELL'] as const);
    const basePrice = SYMBOL_PRICES[pair.symbol] || 1.085;
    const pipSize = PIP_SIZES[pair.symbol] || 0.0001;
    const atr = randFloat(6, 13);
    const slPips = atr * V2_RULES.SL_ATR_MULT + V2_RULES.SL_PIP_BUFFER;
    const tp1Pips = slPips * V2_RULES.TP1_MULT;
    const isWin = rand() > 0.55;
    const isBreakeven = !isWin && rand() > 0.85;
    const rMultiple = isWin ? randFloat(1.5, 3.5) : isBreakeven ? 0 : -1;
    const profitNet = rMultiple * 100 * 0.1; // risk 1% of 10k = 100, lot 0.1
    const entryPrice = basePrice + randFloat(-0.005, 0.005);
    const closePrice = isWin
      ? direction === 'BUY'
        ? entryPrice + tp1Pips * pipSize * (rMultiple / 2)
        : entryPrice - tp1Pips * pipSize * (rMultiple / 2)
      : direction === 'BUY'
      ? entryPrice - slPips * pipSize
      : entryPrice + slPips * pipSize;
    const entryTime = new Date(Date.now() - (count - i) * randFloat(120, 600) * 60 * 1000);
    const durationMin = randInt(8, 240);

    trades.push({
      id: `trade-hist-${i}`,
      ticket: 50470000 + i,
      symbol: pair.symbol,
      direction,
      volume: 0.1,
      openPrice: entryPrice,
      closePrice,
      sl: direction === 'BUY' ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize,
      tp1: direction === 'BUY' ? entryPrice + tp1Pips * pipSize : entryPrice - tp1Pips * pipSize,
      tp2: direction === 'BUY' ? entryPrice + tp1Pips * 2 * pipSize : entryPrice - tp1Pips * 2 * pipSize,
      slPips,
      tp1Pips,
      rrNet: randFloat(1.8, 2.6),
      atrValue: atr,
      adxValue: randFloat(20, 38),
      regime: pick(['TRENDING', 'TRANSITION'] as const),
      setupType: pick(SETUP_TYPES),
      session: pick(SESSIONS),
      status: 'CLOSED',
      result: isWin ? 'WIN' : isBreakeven ? 'BREAKEVEN' : 'LOSS',
      rMultiple,
      profitNet,
      closeReason: isWin ? (rMultiple > 2.5 ? 'TP2' : 'TP1') : 'SL',
      entryTime: entryTime.toISOString(),
      closeTime: new Date(entryTime.getTime() + durationMin * 60 * 1000).toISOString(),
      durationMin,
      checklist: generateChecklist(rand() > 0.2),
      aiAnalysis: rand() > 0.5 ? 'Setup valid, checklist penuh.' : null,
    });
  }
  return trades.sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
}

export function getDemoSignals(): Signal[] {
  const signals: Signal[] = [];
  for (let i = 0; i < 5; i++) {
    const pair = pick(TRADING_PAIRS);
    const direction = pick(['BUY', 'SELL'] as const);
    const basePrice = SYMBOL_PRICES[pair.symbol] || 1.085;
    const pipSize = PIP_SIZES[pair.symbol] || 0.0001;
    const atr = randFloat(7, 13);
    const slPips = atr * V2_RULES.SL_ATR_MULT + V2_RULES.SL_PIP_BUFFER;
    const tp1Pips = slPips * V2_RULES.TP1_MULT;
    const adx = randFloat(25, 42);
    const rrNet = randFloat(1.95, 2.6);
    const entryPrice = basePrice;
    const executed = i < 2;
    const skipped = !executed && rand() > 0.5;

    signals.push({
      id: `signal-${i}`,
      symbol: pair.symbol,
      direction,
      timeframe: 'M5',
      entryPrice,
      slPrice: direction === 'BUY' ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize,
      tp1Price: direction === 'BUY' ? entryPrice + tp1Pips * pipSize : entryPrice - tp1Pips * pipSize,
      tp2Price: direction === 'BUY' ? entryPrice + tp1Pips * 2 * pipSize : entryPrice - tp1Pips * 2 * pipSize,
      slPips,
      tp1Pips,
      rrNet,
      atrValue: atr,
      adxValue: adx,
      vwapValue: entryPrice + randFloat(-0.0005, 0.0005),
      ema9Value: entryPrice + randFloat(-0.0003, 0.0003),
      ema21Value: entryPrice + randFloat(-0.0006, 0.0006),
      regime: adx > 25 ? 'TRENDING' : adx > 20 ? 'TRANSITION' : 'RANGING',
      setupType: pick(SETUP_TYPES),
      session: pick(SESSIONS),
      checklistPassed: 8,
      status: executed ? 'EXECUTED' : skipped ? 'SKIPPED' : 'ACTIVE',
      reason: skipped ? 'RR net 1.85 < 2.0 minimum' : null,
      aiVerdict: 'COMPLIANT — Setup sesuai V2 strategy, semua checklist terpenuhi.',
      createdAt: new Date(Date.now() - i * randFloat(15, 90) * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      checklist: generateChecklist(!skipped),
    });
  }
  return signals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getDemoNews(): NewsEvent[] {
  const events: Omit<NewsEvent, 'id' | 'blackoutStart' | 'blackoutEnd'>[] = [
    { ticker: 'EUR', title: 'ECB Speech — Lagarde', impact: 'HIGH', country: 'Eurozone', currency: 'EUR', eventTime: getFutureTime(2), actual: null, forecast: null, previous: null, source: 'tiingo' },
    { ticker: 'USD', title: 'US CPI m/m', impact: 'HIGH', country: 'United States', currency: 'USD', eventTime: getFutureTime(5), actual: null, forecast: '0.3%', previous: '0.4%', source: 'tiingo' },
    { ticker: 'EUR', title: 'EZ CPI Flash y/y', impact: 'MEDIUM', country: 'Eurozone', currency: 'EUR', eventTime: getFutureTime(8), actual: null, forecast: '2.4%', previous: '2.5%', source: 'tiingo' },
    { ticker: 'USD', title: 'NFP — Non-Farm Payrolls', impact: 'HIGH', country: 'United States', currency: 'USD', eventTime: getFutureTime(28), actual: null, forecast: '180K', previous: '175K', source: 'tiingo' },
    { ticker: 'EUR', title: 'ECB Rate Decision', impact: 'HIGH', country: 'Eurozone', currency: 'EUR', eventTime: getFutureTime(30), actual: null, forecast: '4.25%', previous: '4.50%', source: 'tiingo' },
    { ticker: 'USD', title: 'FOMC Member Speech', impact: 'MEDIUM', country: 'United States', currency: 'USD', eventTime: getFutureTime(48), actual: null, forecast: null, previous: null, source: 'tiingo' },
    { ticker: 'GBP', title: 'BoE Gov Speech', impact: 'MEDIUM', country: 'United Kingdom', currency: 'GBP', eventTime: getFutureTime(72), actual: null, forecast: null, previous: null, source: 'tiingo' },
    { ticker: 'JPY', title: 'BoJ Policy Rate', impact: 'HIGH', country: 'Japan', currency: 'JPY', eventTime: getFutureTime(96), actual: null, forecast: '0.25%', previous: '0.25%', source: 'tiingo' },
  ];

  return events.map((e, i) => {
    const eventTime = new Date(e.eventTime);
    return {
      ...e,
      id: `news-${i}`,
      blackoutStart:
        e.impact === 'HIGH'
          ? new Date(eventTime.getTime() - V2_RULES.NEWS_BLACKOUT_MINUTES * 60 * 1000).toISOString()
          : null,
      blackoutEnd:
        e.impact === 'HIGH'
          ? new Date(eventTime.getTime() + V2_RULES.NEWS_BLACKOUT_MINUTES * 60 * 1000).toISOString()
          : null,
    };
  });
}

function getFutureTime(hoursAhead: number): string {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

// Generate candlestick chart data with realistic price action
export function getDemoChartData(symbol: string, count = 100): ChartData {
  const candles: Candle[] = [];
  let currentPrice = SYMBOL_PRICES[symbol] || 1.085;
  const pipSize = PIP_SIZES[symbol] || 0.0001;
  const baseVolatility = symbol === 'USDJPY' ? 0.04 : 0.0004;
  const now = Date.now();

  // Generate session markers
  const sessionMarkers: { time: string; session: any; trade: boolean }[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const time = new Date(now - i * 5 * 60 * 1000);
    const hourWIB = (time.getUTCHours() + 7) % 24;
    let session = 'SYDNEY';
    let trade = false;
    if (hourWIB >= 9 && hourWIB < 12) { session = 'TOKYO'; trade = true; }
    else if (hourWIB >= 14 && hourWIB < 17) { session = 'LONDON'; trade = true; }
    else if (hourWIB >= 20 && hourWIB < 22) { session = 'OVERLAP'; trade = true; }
    else if (hourWIB >= 17 && hourWIB < 19.5) { session = 'LONDON_LUNCH'; trade = false; }

    if (i % 12 === 0) {
      sessionMarkers.push({ time: time.toISOString(), session: session as any, trade });
    }

    const trend = Math.sin(i / 15) * baseVolatility * 0.5;
    const noise = (rand() - 0.5) * baseVolatility;
    const open = currentPrice;
    const close = open + trend + noise;
    const high = Math.max(open, close) + Math.abs(rand() - 0.5) * baseVolatility * 0.8;
    const low = Math.min(open, close) - Math.abs(rand() - 0.5) * baseVolatility * 0.8;
    const volume = randInt(100, 1000);

    candles.push({
      time: time.toISOString(),
      open: round(open, symbol),
      high: round(high, symbol),
      low: round(low, symbol),
      close: round(close, symbol),
      volume,
    });

    currentPrice = close;
  }

  // Calculate indicators
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const vwap = calcVwap(candles);
  const atr = calcAtr(highs, lows, closes, 14);
  const adx = calcAdx(highs, lows, closes, 14);
  const rsi = calcRsi(closes, 14);
  const { upper, middle, lower } = calcBollinger(closes, 20, 2);

  // Generate signal markers (last few candles)
  const signalMarkers: { time: string; type: 'BUY' | 'SELL'; price: number }[] = [];
  if (candles.length > 5) {
    const lastIdx = candles.length - 1;
    signalMarkers.push({
      time: candles[lastIdx - 3].time,
      type: 'BUY',
      price: candles[lastIdx - 3].close,
    });
    signalMarkers.push({
      time: candles[lastIdx - 8].time,
      type: 'SELL',
      price: candles[lastIdx - 8].close,
    });
  }

  return {
    symbol,
    timeframe: 'M5',
    candles,
    indicators: {
      ema9,
      ema21,
      vwap,
      atr,
      adx,
      rsi,
      bbUpper: upper,
      bbMiddle: middle,
      bbLower: lower,
    },
    sessionMarkers,
    signalMarkers,
  };
}

function round(value: number, symbol: string): number {
  const digits = symbol === 'USDJPY' ? 3 : 5;
  return parseFloat(value.toFixed(digits));
}

// Technical indicator calculations (matching Python backend)
function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let emaPrev = values[0];
  result.push(emaPrev);
  for (let i = 1; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
    result.push(emaPrev);
  }
  return result;
}

function calcVwap(candles: Candle[]): number[] {
  const result: number[] = [];
  let cumPV = 0;
  let cumV = 0;
  let currentDay = '';
  for (const c of candles) {
    const day = c.time.split('T')[0];
    if (day !== currentDay) {
      cumPV = 0;
      cumV = 0;
      currentDay = day;
    }
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    result.push(cumV > 0 ? cumPV / cumV : c.close);
  }
  return result;
}

function calcAtr(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const result: number[] = [];
  const tr: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
    } else {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }
  }
  let atrPrev = tr[0];
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      atrPrev = tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
    } else {
      atrPrev = (atrPrev * (period - 1) + tr[i]) / period;
    }
    result.push(atrPrev);
  }
  return result;
}

function calcAdx(highs: number[], lows: number[], closes: number[], period: number): number[] {
  // Simplified ADX calculation
  const result: number[] = [];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [highs[0] - lows[0]];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  // Smooth and calculate ADX
  let plusDI = 0;
  let minusDI = 0;
  let dx = 0;
  let adxPrev = 0;

  for (let i = 0; i < highs.length; i++) {
    if (i < period) {
      const avgTR = tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      const avgPlusDM = plusDM.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      const avgMinusDM = minusDM.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      plusDI = avgTR > 0 ? (avgPlusDM / avgTR) * 100 : 0;
      minusDI = avgTR > 0 ? (avgMinusDM / avgTR) * 100 : 0;
    } else {
      const avgTR = tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      const avgPlusDM = plusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      const avgMinusDM = minusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      plusDI = avgTR > 0 ? (avgPlusDM / avgTR) * 100 : 0;
      minusDI = avgTR > 0 ? (avgMinusDM / avgTR) * 100 : 0;
    }
    const sum = plusDI + minusDI;
    dx = sum > 0 ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0;
    adxPrev = i < period * 2 ? dx : (adxPrev * (period - 1) + dx) / period;
    result.push(adxPrev);
  }
  return result;
}

function calcRsi(closes: number[], period: number): number[] {
  const result: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      result.push(50);
      continue;
    }
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function calcBollinger(closes: number[], period: number, std: number) {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(closes[i]);
      middle.push(closes[i]);
      lower.push(closes[i]);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    middle.push(mean);
    upper.push(mean + sd * std);
    lower.push(mean - sd * std);
  }
  return { upper, middle, lower };
}

// --------------------------------------------------------------------------- //
// Demo generators for the 30 audit-fix endpoints
// --------------------------------------------------------------------------- //

export function getDemoAuditLog(limit = 50): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  const severities = ['INFO', 'WARN', 'ERROR', 'CRITICAL'] as const;
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', null];
  const detailTemplates: Record<string, Record<string, unknown>> = {
    SIGNAL: { direction: 'BUY', setup_type: 'VWAP_BOUNCE', adx: 28.3, rr_net: 2.15 },
    ORDER_PLACED: { volume: 0.1, sl_pips: 14.5, tp1_pips: 29.0 },
    TP1_HIT: { partial_close_pct: 0.5, profit_usd: 14.50 },
    TP2_HIT: { full_close: true, profit_usd: 38.20 },
    SL_HIT: { sl_pips: 14.5, loss_usd: -14.50 },
    KILL_SWITCH: { reason: 'manual_trigger', positions_closed: 2 },
    RISK_GATE_BLOCKED: { reason: 'rr_net_below_min', rr_net: 1.82 },
    AI_REJECTED: { model: 'llama3.2:latest', confidence: 0.42 },
    CONNECTION_LOST: { source: 'mt5', retry_in_s: 5 },
    RECOVERY: { service: 'mt5', latency_ms: 142 },
    COOLDOWN_ENGAGED: { until_minutes: 30, consecutive_losses: 2 },
    MARGIN_WARNING: { margin_level_pct: 145 },
  };

  for (let i = 0; i < limit; i++) {
    const eventDef = AUDIT_EVENT_TYPES[i % AUDIT_EVENT_TYPES.length];
    const eventType = eventDef.value;
    const sevIndex = eventType === 'KILL_SWITCH' || eventType === 'CONNECTION_LOST' || eventType === 'SL_HIT'
      ? (i % 2 === 0 ? 2 : 3)
      : eventType === 'MARGIN_WARNING' || eventType === 'RISK_GATE_BLOCKED' || eventType === 'AI_REJECTED' || eventType === 'COOLDOWN_ENGAGED'
      ? (i % 2 === 0 ? 1 : 2)
      : 0;
    const sev = severities[sevIndex];
    const symbol = symbols[i % symbols.length];
    const ticket = eventType === 'SIGNAL' || eventType === 'ORDER_PLACED' ? null : 50470000 + i;

    entries.push({
      id: 1000 + i,
      timestamp: new Date(Date.now() - i * randFloat(15, 240) * 1000).toISOString(),
      event_type: eventType,
      symbol: symbol ?? undefined,
      ticket: ticket ?? undefined,
      detail_json: JSON.stringify(detailTemplates[eventType] ?? {}),
      severity: sev,
    });
  }
  return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function getDemoEquityCurve(hours = 24): EquityCurvePoint[] {
  const samples: EquityCurvePoint[] = [];
  const totalMin = Math.max(60, hours * 60);
  const stepMin = 5;
  const n = Math.floor(totalMin / stepMin);
  const startBalance = 10000;
  let balance = startBalance;
  let peak = startBalance;
  let dailyOpen = startBalance;

  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.now() - (n - i) * stepMin * 60 * 1000);
    // Random walk with small upward drift during London/Overlap sessions
    const hourWIB = (ts.getUTCHours() + 7) % 24;
    const inSession = (hourWIB >= 14 && hourWIB < 17) || (hourWIB >= 20 && hourWIB < 23);
    const drift = inSession ? 0.6 : -0.1;
    const noise = (rand() - 0.5) * 18;
    balance += drift + noise;
    if (balance > peak) peak = balance;
    const floating = randFloat(-35, 55);
    const equity = balance + floating;
    const drawdownPct = ((balance - peak) / peak) * 100;
    const dailyPct = ((balance - dailyOpen) / dailyOpen) * 100;
    if (ts.getUTCHours() === 0 && ts.getUTCMinutes() < stepMin) {
      dailyOpen = balance;
    }
    samples.push({
      id: i + 1,
      timestamp: ts.toISOString(),
      balance: parseFloat(balance.toFixed(2)),
      equity: parseFloat(equity.toFixed(2)),
      floating_pnl: parseFloat(floating.toFixed(2)),
      daily_pnl_pct: parseFloat(dailyPct.toFixed(4)),
      drawdown_pct: parseFloat(drawdownPct.toFixed(4)),
      peak_equity: parseFloat(peak.toFixed(2)),
    });
  }
  return samples;
}

function buildSessionStats(tradeCount: number, baseWinRate: number, baseR: number, baseProfit: number): SessionStats {
  const trades = tradeCount;
  const wins = Math.round((baseWinRate / 100) * trades);
  const losses = trades - wins;
  return {
    trades,
    wins,
    losses,
    win_rate: parseFloat(((wins / trades) * 100).toFixed(1)),
    r_net: parseFloat((baseR * trades).toFixed(2)),
    profit: parseFloat((baseProfit * trades).toFixed(2)),
  };
}

export function getDemoPerformanceAttribution(): PerformanceAttribution {
  return {
    by_session: {
      TOKYO: buildSessionStats(8, 38, -0.05, -4.20),
      LONDON: buildSessionStats(18, 56, 0.28, 42.50),
      OVERLAP: buildSessionStats(15, 60, 0.35, 51.30),
      SYDNEY: buildSessionStats(3, 33, -0.12, -10.10),
      LONDON_LUNCH: buildSessionStats(2, 50, 0.0, 0.0),
    },
    by_setup: {
      VWAP_BOUNCE: buildSessionStats(16, 56, 0.32, 41.20),
      EMA_CROSS: buildSessionStats(12, 42, 0.05, 6.00),
      PIN_BAR: buildSessionStats(8, 50, 0.18, 14.40),
      ENGULFING: buildSessionStats(7, 57, 0.25, 17.50),
      INSIDE_BAR: buildSessionStats(3, 33, -0.10, -3.00),
    },
    by_regime: {
      TRENDING: buildSessionStats(28, 61, 0.34, 78.40),
      TRANSITION: buildSessionStats(12, 42, 0.02, 2.40),
      RANGING: buildSessionStats(6, 17, -0.42, -25.20),
      EXHAUSTION: buildSessionStats(1, 0, -1.0, -10.00),
    },
    by_hour: {
      '09': buildSessionStats(3, 33, -0.05, -1.50),
      '10': buildSessionStats(4, 50, 0.10, 4.00),
      '14': buildSessionStats(7, 57, 0.25, 17.50),
      '15': buildSessionStats(8, 62, 0.35, 28.00),
      '16': buildSessionStats(6, 50, 0.12, 7.20),
      '20': buildSessionStats(9, 56, 0.30, 27.00),
      '21': buildSessionStats(7, 57, 0.28, 19.60),
    },
    by_day: {
      MON: buildSessionStats(8, 38, -0.08, -6.40),
      TUE: buildSessionStats(10, 60, 0.30, 30.00),
      WED: buildSessionStats(9, 56, 0.22, 19.80),
      THU: buildSessionStats(11, 55, 0.25, 27.50),
      FRI: buildSessionStats(9, 44, 0.04, 3.60),
    },
    by_pair: {
      EURUSD: buildSessionStats(22, 55, 0.22, 48.40),
      GBPUSD: buildSessionStats(14, 50, 0.18, 25.20),
      USDJPY: buildSessionStats(11, 45, 0.10, 11.00),
    },
  };
}

export function getDemoComplianceScore(): ComplianceScore {
  return {
    overall_pct: 87,
    checklist_pass_rate: 92,
    rr_compliance_rate: 85,
    ai_compliance_rate: 88,
    total_trades: 47,
  };
}

export function getDemoPreLiveCheck(): PreLiveCheck {
  return {
    mt5: { ok: true, login: 50384721, server: 'FinexIC-Markets', balance: 10000 },
    ollama: { ok: true, model: 'llama3.2:latest', url: 'http://localhost:11434' },
    tiingo: { ok: true, events_cached: 8 },
    config: { ok: true, warnings: [] },
    db: { ok: true, trade_count: 47 },
    time_sync: { ok: true, drift_seconds: 0.12 },
    overall_ready: true,
    blocking_issues: [],
  };
}

export function getDemoTimeSync(): TimeSyncResponse {
  return {
    server_time: new Date().toISOString(),
    ntp_time: new Date().toISOString(),
    drift_seconds: 0.12,
    ok: true,
  };
}

export function getDemoRiskDisclosure(): RiskDisclosureResponse {
  return {
    text: `RISK DISCLOSURE — Forex Scalping V2 Strategy

Trading FX/CFD on margin carries a high level of risk and may not be suitable for all investors. The V2 strategy targets RR Net >= 2.0 with 1% risk per trade, max 3 simultaneous positions, and max 5 trades per day. Past performance (backtests) is NOT indicative of future results. Slippage, spread widening around news, broker rejections, and connectivity losses can cause realised losses to exceed the theoretical 1% risk per trade.

By enabling auto-trading you acknowledge that:
  1. You are the account holder and are responsible for all activity.
  2. You have tested the bot in PAPER mode before going LIVE.
  3. You understand the kill-switch and tiered stop logic (-1%/-2%/-4%/-10%).
  4. The software is provided "AS IS" without warranty of any kind.

If you do not understand these risks, do not enable auto-trading.`,
  };
}

export function getDemoEmotionalSummary(): EmotionalSummaryResponse {
  const trades = getDemoTradeHistory(20).slice(0, 12);
  const states = ['SABAR', 'SABAR', 'SABAR', 'SABAR', 'SABAR', 'FOMO', 'FOMO', 'FRUSTRASI', 'FRUSTRASI', 'OVERCONFIDENT', 'SABAR', 'SABAR'];
  const byState: Record<string, number> = { SABAR: 0, FOMO: 0, FRUSTRASI: 0, OVERCONFIDENT: 0 };
  const annotated = trades.map((t, i) => {
    const state = states[i % states.length];
    byState[state] = (byState[state] || 0) + 1;
    return {
      id: i + 1,
      ticket: t.ticket,
      symbol: t.symbol,
      emotional_state: state,
      emotional_note: state === 'FOMO' ? 'Kejar harga setelah miss setup' : state === 'FRUSTRASI' ? 'Revenge setelah 2 SL' : state === 'OVERCONFIDENT' ? 'PD setelah 3 win' : null,
      profit: t.profitNet,
    };
  });
  return {
    total_logged: annotated.length,
    by_state: byState,
    trades: annotated,
  };
}

export function getDemoBacktestResult(req: BacktestRequest): BacktestResult {
  const initialBalance = req.initial_balance ?? 10000;
  // Simulate 300 trades with realistic V2 metrics
  const totalTrades = 300;
  const targetWinRate = 47 + randFloat(-2, 3);
  const wins = Math.round((targetWinRate / 100) * totalTrades);
  const losses = totalTrades - wins;
  const basePrice = SYMBOL_PRICES[req.symbol] || 1.085;
  const pipSize = PIP_SIZES[req.symbol] || 0.0001;
  const setupTypes = ['VWAP_BOUNCE', 'EMA_CROSS', 'PIN_BAR', 'ENGULFING', 'INSIDE_BAR'];
  const sessions = ['TOKYO', 'LONDON', 'OVERLAP'];

  const trades: BacktestTrade[] = [];
  let balance = initialBalance;
  const startDate = new Date(req.start_date).getTime();
  const endDate = new Date(req.end_date).getTime();
  const stepMs = Math.max(60_000, Math.floor((endDate - startDate) / totalTrades));

  for (let i = 0; i < totalTrades; i++) {
    const direction = rand() > 0.5 ? 'BUY' : 'SELL';
    const atr = randFloat(7, 13);
    const slPips = atr * V2_RULES.SL_ATR_MULT + V2_RULES.SL_PIP_BUFFER;
    const isWin = i < wins;
    const rMult = isWin ? randFloat(1.6, 3.4) : -1;
    const profit = rMult * (balance * V2_RULES.RISK_PCT_PER_TRADE);
    balance += profit;
    const openPrice = basePrice + randFloat(-0.005, 0.005);
    const closePrice = isWin
      ? direction === 'BUY'
        ? openPrice + slPips * pipSize * (rMult / 2)
        : openPrice - slPips * pipSize * (rMult / 2)
      : direction === 'BUY'
      ? openPrice - slPips * pipSize
      : openPrice + slPips * pipSize;
    const openTime = new Date(startDate + i * stepMs).toISOString();
    const closeTime = new Date(startDate + (i + 1) * stepMs).toISOString();
    trades.push({
      ticket: 600000 + i,
      symbol: req.symbol,
      direction,
      volume: 0.1,
      open_price: parseFloat(openPrice.toFixed(5)),
      close_price: parseFloat(closePrice.toFixed(5)),
      sl: parseFloat((direction === 'BUY' ? openPrice - slPips * pipSize : openPrice + slPips * pipSize).toFixed(5)),
      tp: parseFloat((direction === 'BUY' ? openPrice + slPips * pipSize * 2 : openPrice - slPips * pipSize * 2).toFixed(5)),
      open_time: openTime,
      close_time: closeTime,
      result: isWin ? 'WIN' : 'LOSS',
      r_multiple: parseFloat(rMult.toFixed(2)),
      profit: parseFloat(profit.toFixed(2)),
      pips: parseFloat((isWin ? slPips * (rMult / 2) : slPips).toFixed(1)),
      setup_type: setupTypes[i % setupTypes.length],
      session: sessions[i % sessions.length],
    });
  }

  const grossProfit = trades.filter((t) => t.profit > 0).reduce((a, b) => a + b.profit, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.profit < 0).reduce((a, b) => a + b.profit, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const totalR = trades.reduce((a, b) => a + b.r_multiple, 0);

  // Compute max drawdown from equity curve
  let peak = initialBalance;
  let maxDD = 0;
  let running = initialBalance;
  for (const t of trades) {
    running += t.profit;
    if (running > peak) peak = running;
    const dd = ((running - peak) / peak) * 100;
    if (dd < maxDD) maxDD = dd;
  }

  return {
    id: Math.floor(rand() * 1000) + 1,
    symbol: req.symbol,
    timeframe: req.timeframe,
    start_date: req.start_date,
    end_date: req.end_date,
    initial_balance: initialBalance,
    final_balance: parseFloat(balance.toFixed(2)),
    total_trades: totalTrades,
    wins,
    losses,
    win_rate_pct: parseFloat(((wins / totalTrades) * 100).toFixed(2)),
    r_net_avg: parseFloat((totalR / totalTrades).toFixed(3)),
    profit_factor: profitFactor === Infinity ? 99 : parseFloat(profitFactor.toFixed(2)),
    max_drawdown_pct: parseFloat(Math.abs(maxDD).toFixed(2)),
    compliance_score_pct: 88,
    trades,
    metrics: {
      profit_factor: profitFactor === Infinity ? 99 : parseFloat(profitFactor.toFixed(2)),
      max_drawdown_pct: parseFloat(Math.abs(maxDD).toFixed(2)),
      compliance_score_pct: 88,
    },
    created_at: new Date().toISOString(),
  };
}

export function getDemoHolidays(year = 2026): HolidayEntry[] {
  return [
    { date: `${year}-01-01`, name: "New Year's Day", country: 'Global', closed: true },
    { date: `${year}-01-13`, name: 'Lunar New Year (early)', country: 'Asia', closed: false },
    { date: `${year}-03-25`, name: 'Good Friday', country: 'EU/UK/US', closed: true },
    { date: `${year}-03-28`, name: 'Easter Monday', country: 'EU/UK', closed: true },
    { date: `${year}-05-01`, name: 'Labour Day', country: 'EU', closed: true },
    { date: `${year}-05-30`, name: 'Memorial Day', country: 'US', closed: true },
    { date: `${year}-06-19`, name: 'Juneteenth', country: 'US', closed: true },
    { date: `${year}-07-04`, name: 'US Independence Day', country: 'US', closed: true },
    { date: `${year}-08-15`, name: "Assumption Day", country: 'EU', closed: false },
    { date: `${year}-09-07`, name: 'US Labour Day', country: 'US', closed: true },
    { date: `${year}-11-03`, name: 'Culture Day (Japan)', country: 'JP', closed: true },
    { date: `${year}-11-26`, name: 'US Thanksgiving', country: 'US', closed: true },
    { date: `${year}-12-24`, name: 'Christmas Eve (early close)', country: 'Global', closed: false },
    { date: `${year}-12-25`, name: 'Christmas Day', country: 'Global', closed: true },
    { date: `${year}-12-26`, name: 'Boxing Day', country: 'UK/EU', closed: true },
  ];
}

export function getDemoBotMode(): BotModeState {
  return { mode: 'paper', paper_mode: true, dry_run: false };
}

export function getDemoStreakStatus(): StreakStatus {
  return {
    consecutive_losses: 0,
    consecutive_wins: 2,
    cooldown_active: false,
    cooldown_until: null,
    cooldown_reason: null,
  };
}

export function getDemoServiceTest(service: 'mt5' | 'ollama' | 'tiingo' | 'telegram'): ServiceTestResult {
  const baseLatency = service === 'mt5' ? 142 : service === 'ollama' ? 38 : service === 'tiingo' ? 215 : 320;
  return {
    ok: true,
    message:
      service === 'mt5'
        ? 'connected as 50384721 (FinexIC-Markets)'
        : service === 'ollama'
        ? 'model llama3.2:latest available'
        : service === 'tiingo'
        ? 'got 8 HIGH events'
        : 'test message sent to chat 50384721',
    latency_ms: baseLatency + Math.floor(rand() * 30),
    balance: service === 'mt5' ? 10000 : undefined,
  };
}

export const DEMO_RISK_DISCLOSURE_TEXT = getDemoRiskDisclosure().text;
