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
} from './types';
import {
  PRE_TRADE_CHECKLIST,
  TRADING_PAIRS,
  V2_RULES,
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

const SETUP_TYPES = ['VWAP_BOUNCE', 'EMA_CROSS', 'PIN_BAR', 'ENGULFING', 'INSIDE_BAR'] as const;
const SESSIONS = ['TOKYO', 'LONDON', 'OVERLAP'] as const;

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
