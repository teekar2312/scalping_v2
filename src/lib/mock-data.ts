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
  AuthLoginResponse,
  AuthMeResponse,
  ApiKeyInfo,
  SecretMetadata,
  RiskDisclosureStatus,
  StressScenario,
  StressTestResult,
  RiskMetrics,
  MonteCarloRequest,
  MonteCarloResult,
  WalkForwardRequest,
  WalkForwardResult,
  KellyStats,
  SlippageStats,
  LatencyStats,
  ReadinessResponse,
  HealthzResponse,
  TradeReconstruction,
  AuditChainVerifyResponse,
  BappebtiStatus,
  EncryptionStatus,
  VaRMethod,
  PriceAlert,
  PriceAlertCreateRequest,
  PriceAlertType,
  PriceAlertNotifyMethod,
  SystemInfoResponse,
  ServiceStatusResponse,
  DrawdownRealtimeResponse,
  CurrencyStrengthResponse,
  VolumeProfileResponse,
  CorrelationMatrixResponse,
  VolatilitySurfaceResponse,
  OrderFlowResponse,
  NewsSentimentResponse,
  SurpriseIndexResponse,
  BrokerStatusResponse,
  SwapsReportResponse,
  TickBacktestRequest,
  TickBacktestResult,
  SendTestEmailResponse,
  DailyReport,
  BenchmarkResult,
  PerformanceRatios,
  SeasonalityAnalysis,
  SeasonalityScore,
  OptimizationResult,
  OptimizationHistoryEntry,
  OptimalParams,
  VoiceTestResult,
  VoiceStatus,
  TelegramCommand,
  TelegramCommandResponse,
  ScreenshotInfo,
  ScreenshotListResponse,
  MLTrainResult,
  MLPrediction,
  MLFeatures,
  NewsTradingStatus,
  NewsTradingStats,
  AddAccountRequest,
  MT5Account,
  MT5AccountsListResponse,
  AggregatedStats,
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

// --------------------------------------------------------------------------- //
// Sprint 5-8 demo data — auth, secrets, regulatory, analytics, DevOps
// --------------------------------------------------------------------------- //

const DEMO_USER = {
  username: 'admin',
  role: 'admin' as const,
  login_at: new Date().toISOString(),
  ip: '192.168.1.42',
};

export function getDemoAuthLogin(username: string): AuthLoginResponse {
  const id = Math.random().toString(36).slice(2, 12);
  return {
    api_key: `sk_demo_${id}_${Math.random().toString(36).slice(2, 28)}`,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    user: { ...DEMO_USER, username: username || DEMO_USER.username },
  };
}

export function getDemoAuthMe(): AuthMeResponse {
  return {
    user: DEMO_USER,
    api_key_preview: 'sk_demo_••••••8f3a',
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  };
}

export function getDemoApiKeys(): ApiKeyInfo[] {
  return [
    {
      id: 'key_1',
      label: 'Web Dashboard',
      prefix: 'sk_demo_abcd',
      created_at: new Date(Date.now() - 7 * 86400_000).toISOString(),
      last_used: new Date(Date.now() - 3600_000).toISOString(),
      expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    },
    {
      id: 'key_2',
      label: 'Mobile App',
      prefix: 'sk_demo_efgh',
      created_at: new Date(Date.now() - 30 * 86400_000).toISOString(),
      last_used: new Date(Date.now() - 5 * 86400_000).toISOString(),
      expires_at: null,
    },
  ];
}

export function getDemoSecrets(): SecretMetadata[] {
  return [
    {
      name: 'MT5_PASSWORD',
      updated_at: new Date(Date.now() - 12 * 86400_000).toISOString(),
      set_by: 'admin',
    },
    {
      name: 'TIINGO_API_KEY',
      updated_at: new Date(Date.now() - 30 * 86400_000).toISOString(),
      set_by: 'admin',
    },
    {
      name: 'TELEGRAM_BOT_TOKEN',
      updated_at: new Date(Date.now() - 18 * 86400_000).toISOString(),
      set_by: 'admin',
    },
    {
      name: 'OLLAMA_URL',
      updated_at: new Date(Date.now() - 60 * 86400_000).toISOString(),
      set_by: 'admin',
    },
  ];
}

export function getDemoRiskDisclosureStatus(): RiskDisclosureStatus {
  const ackAt = new Date(Date.now() - 12 * 86400_000);
  const expiresAt = new Date(ackAt.getTime() + 30 * 86400_000);
  const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400_000));
  return {
    acknowledged: true,
    acknowledged_at: ackAt.toISOString(),
    acknowledged_by: 'admin',
    expires_at: expiresAt.toISOString(),
    days_remaining: daysRemaining,
    requires_reack: daysRemaining < 7,
  };
}

export function getDemoAuditChainVerify(): AuditChainVerifyResponse {
  return {
    valid: true,
    total_rows: 1247,
    verified_rows: 1247,
    broken_at_row: null,
    broken_at_id: null,
    expected_hash: null,
    actual_hash: null,
    verified_at: new Date().toISOString(),
  };
}

export function getDemoBappebtiStatus(): BappebtiStatus {
  return {
    registered: true,
    broker_name: 'Finex Indonesia (PT Finex Indosurya Berjangka)',
    bappebti_license: '135/BAPPEBTI/SI/XII/2007',
    status: 'REGISTERED',
    last_checked: new Date(Date.now() - 3600_000).toISOString(),
    warnings: [],
  };
}

export function getDemoEncryptionStatus(): EncryptionStatus {
  return {
    enabled: true,
    cipher: 'sqlcipher',
    kdf_iters: 64000,
    page_size: 4096,
    tested_at: new Date(Date.now() - 3600_000).toISOString(),
  };
}

// --- Stress test scenarios + results ---------------------------------------- //

export function getDemoStressScenarios(): StressScenario[] {
  return [
    {
      id: 'SNB_UNPEG_2015',
      name: 'SNB Unpeg (Jan 15, 2015)',
      description:
        'Swiss National Bank removed the EUR/CHF floor; CHF pairs spiked ~30% in minutes. EUR/CHF liquidity evaporated; brokers failed.',
      date: '2015-01-15',
      multiplier: 8.5,
      pip_jump: 2200,
      asset_class: 'CHF majors',
    },
    {
      id: 'BREXIT_2016',
      name: 'Brexit Vote (Jun 24, 2016)',
      description:
        'GBP referendum shock — GBP/USD dropped 8% overnight (1800 pip equivalent move). GBP pairs gapped at session open.',
      date: '2016-06-24',
      multiplier: 4.2,
      pip_jump: 1800,
      asset_class: 'GBP majors',
    },
    {
      id: 'COVID_CRASH_2020',
      name: 'COVID Crash (Mar 2020)',
      description:
        'Global dollar squeeze — USD/JPY whipsawed 600 pips intraday over 2 weeks. VIX > 80. Spread widened to 5-15 pips on majors.',
      date: '2020-03-09',
      multiplier: 3.5,
      pip_jump: 600,
      asset_class: 'USD majors',
    },
    {
      id: 'GFC_2008',
      name: 'Global Financial Crisis (Sep-Oct 2008)',
      description:
        'Lehman collapse — EUR/USD moved 800+ pips over days with multi-pip gaps. Banking-sector liquidity freeze.',
      date: '2008-09-15',
      multiplier: 5.0,
      pip_jump: 850,
      asset_class: 'EUR/GBP/USD',
    },
  ];
}

export function getDemoStressTestResults(): StressTestResult[] {
  const baseScenarios = getDemoStressScenarios();
  return baseScenarios.map((s, idx) => {
    // Pre-baked survival outcomes — SNB is the only one that breaks the demo
    const survival: 'PASS' | 'FAIL' = s.id === 'SNB_UNPEG_2015' ? 'FAIL' : 'PASS';
    const stressedDD = survival === 'FAIL' ? 14.8 + idx * 0.4 : 4.8 + idx * 1.2;
    const balanceAfter = survival === 'FAIL' ? 8420 : 10000 - idx * 220;
    return {
      id: `stress-${s.id.toLowerCase()}`,
      scenario: s.id,
      scenario_name: s.name,
      multiplier: s.multiplier,
      survival,
      original_max_dd_pct: parseFloat((2.1 + idx * 0.3).toFixed(2)),
      stressed_max_dd_pct: parseFloat(stressedDD.toFixed(2)),
      original_final_balance: 10000 + 480 - idx * 100,
      stressed_final_balance: balanceAfter,
      balance_after: balanceAfter,
      worst_pip_move: s.pip_jump,
      triggered_hard_stop: survival === 'FAIL',
      triggered_kill_switch: survival === 'FAIL' && s.id === 'SNB_UNPEG_2015',
      margin_call: false,
      duration_seconds: 4 + idx * 0.4,
      computed_at: new Date(Date.now() - idx * 60_000).toISOString(),
    };
  });
}

// --- VaR / CVaR demo -------------------------------------------------------- //

export function getDemoRiskMetrics(
  confidence: number,
  days: number,
  method?: VaRMethod,
): RiskMetrics {
  // Reasonable demo numbers for $10k account at 1% risk/trade.
  // VaR values are negative (loss side).
  const c = confidence >= 0.99 ? 1.0 : 0.95;
  const baseLoss = 0.012 * (days / 30) * (c >= 1 ? 1.4 : 1.0);
  return {
    var_95: parseFloat((-baseLoss * 10000).toFixed(2)),
    var_99: parseFloat((-baseLoss * 1.4 * 10000).toFixed(2)),
    cvar_95: parseFloat((-baseLoss * 1.18 * 10000).toFixed(2)),
    cvar_99: parseFloat((-baseLoss * 1.55 * 10000).toFixed(2)),
    method: method ?? 'historical',
    period_days: days,
    confidence,
    sample_size: Math.max(60, days * 4),
    currency: 'USD',
    computed_at: new Date().toISOString(),
  };
}

// --- Monte Carlo demo ------------------------------------------------------- //

export function getDemoMonteCarlo(req: MonteCarloRequest): MonteCarloResult {
  const iters = req.iterations || 500;
  const initial = req.initial_balance ?? 10000;
  // Build distribution: 12 buckets between -50% and +200% of initial
  const buckets: Array<{ bucket: string; count: number; lower: number; upper: number }> = [];
  const min = initial * 0.5;
  const max = initial * 3;
  const nBuckets = 12;
  const bw = (max - min) / nBuckets;
  // Approximate log-normal-ish distribution centred around +50% gain
  for (let i = 0; i < nBuckets; i++) {
    const lower = min + i * bw;
    const upper = lower + bw;
    // weight: peaked around bucket 5-6 (≈ +50% to +75% gain)
    const w = Math.exp(-Math.pow(i - 5.5, 2) / 6);
    const count = Math.max(1, Math.round((w / 6) * iters));
    buckets.push({
      bucket: `${(lower / 1000).toFixed(1)}k–${(upper / 1000).toFixed(1)}k`,
      count,
      lower: parseFloat(lower.toFixed(0)),
      upper: parseFloat(upper.toFixed(0)),
    });
  }
  const blowUps = Math.max(1, Math.round(iters * 0.04));
  const survival = ((iters - blowUps) / iters) * 100;

  // Fan chart: 30 steps with median drifting up and widening band
  const fan: MonteCarloResult['fan'] = [];
  for (let step = 0; step <= 30; step++) {
    const t = step / 30;
    const median = initial * (1 + 0.55 * t);
    const spread = initial * 0.05 * Math.sqrt(t + 0.001);
    fan.push({
      step,
      median: parseFloat(median.toFixed(2)),
      p5: parseFloat((median - 1.65 * spread).toFixed(2)),
      p95: parseFloat((median + 1.65 * spread).toFixed(2)),
    });
  }

  return {
    id: `mc_${Math.random().toString(36).slice(2, 10)}`,
    iterations: iters,
    survival_rate_pct: parseFloat(survival.toFixed(2)),
    median_final_balance: parseFloat((initial * 1.52).toFixed(2)),
    p5_final_balance: parseFloat((initial * 0.78).toFixed(2)),
    p95_final_balance: parseFloat((initial * 2.34).toFixed(2)),
    median_max_dd_pct: 5.8,
    p95_max_dd_pct: 11.4,
    mean_final_balance: parseFloat((initial * 1.48).toFixed(2)),
    worst_final_balance: parseFloat((initial * 0.42).toFixed(2)),
    best_final_balance: parseFloat((initial * 3.12).toFixed(2)),
    blow_ups: blowUps,
    distribution: buckets,
    fan,
    computed_at: new Date().toISOString(),
  };
}

// --- Walk-forward demo ------------------------------------------------------ //

export function getDemoWalkForward(_req: WalkForwardRequest): WalkForwardResult {
  const start = new Date(Date.now() - 365 * 86400_000);
  const windows: WalkForwardResult['windows'] = [];
  for (let i = 0; i < 6; i++) {
    const inStart = new Date(start.getTime() + i * 30 * 86400_000);
    const inEnd = new Date(inStart.getTime() + 60 * 86400_000);
    const outStart = inEnd;
    const outEnd = new Date(outStart.getTime() + 30 * 86400_000);
    const inPf = 1.45 + Math.sin(i) * 0.2 + i * 0.03;
    const outPf = inPf * (0.78 + Math.random() * 0.1);
    const deg = ((inPf - outPf) / inPf) * 100;
    windows.push({
      window_index: i + 1,
      in_sample_start: inStart.toISOString().split('T')[0],
      in_sample_end: inEnd.toISOString().split('T')[0],
      out_sample_start: outStart.toISOString().split('T')[0],
      out_sample_end: outEnd.toISOString().split('T')[0],
      in_sample_pf: parseFloat(inPf.toFixed(2)),
      out_sample_pf: parseFloat(outPf.toFixed(2)),
      degradation_pct: parseFloat(deg.toFixed(1)),
      in_sample_trades: 60 + i * 4,
      out_sample_trades: 28 + i * 2,
      robust: deg < 20,
    });
  }
  const avgDeg = windows.reduce((a, b) => a + b.degradation_pct, 0) / windows.length;
  const robust = windows.filter((w) => w.robust).length;
  return {
    id: `wf_${Math.random().toString(36).slice(2, 10)}`,
    windows,
    avg_degradation_pct: parseFloat(avgDeg.toFixed(1)),
    stable: avgDeg < 20,
    verdict:
      avgDeg < 20
        ? 'Parameters stable — strategy generalises across periods.'
        : 'Parameters unstable — re-fit needed before live deployment.',
    total_windows: windows.length,
    robust_windows: robust,
    computed_at: new Date().toISOString(),
  };
}

// --- Kelly demo ------------------------------------------------------------- //

export function getDemoKelly(): KellyStats {
  const winRate = 0.47;
  const avgWin = 25;
  const avgLoss = 18;
  // f = W - (1-W)/(avgWin/avgLoss)
  const ratio = avgWin / avgLoss;
  const fKelly = winRate - (1 - winRate) / ratio;
  return {
    win_rate: winRate,
    avg_win: avgWin,
    avg_loss: avgLoss,
    f_kelly: parseFloat(fKelly.toFixed(4)),
    f_quarter_kelly: parseFloat((fKelly * 0.25).toFixed(4)),
    current_risk_pct: 0.01,
    recommended_risk_pct: parseFloat((Math.max(0.005, Math.min(0.02, fKelly * 0.25 * 0.1))).toFixed(4)),
    sample_trades: 47,
    use_kelly: false,
    note: 'Quarter-Kelly is conservative. Full Kelly is theoretically optimal but maximises drawdown variance.',
  };
}

// --- Slippage demo ---------------------------------------------------------- //

export function getDemoSlippageStats(days: number): SlippageStats {
  const bySymbol = [
    { symbol: 'EURUSD', fills: 412, avg_pips: 0.6, p95_pips: 1.8 },
    { symbol: 'GBPUSD', fills: 248, avg_pips: 0.9, p95_pips: 2.6 },
    { symbol: 'USDJPY', fills: 196, avg_pips: 0.7, p95_pips: 2.1 },
  ];
  const timeSeries: SlippageStats['time_series'] = [];
  const stepMs = (days * 86400_000) / 24;
  for (let i = 0; i < 24; i++) {
    const ts = new Date(Date.now() - (24 - i) * stepMs).toISOString();
    const base = 0.7 + Math.sin(i / 3) * 0.2;
    timeSeries.push({
      timestamp: ts,
      avg_pips: parseFloat(base.toFixed(2)),
      p95_pips: parseFloat((base * 2.2).toFixed(2)),
    });
  }
  const p95 = 2.4;
  return {
    total_fills: bySymbol.reduce((a, b) => a + b.fills, 0),
    avg_slippage_pips: 0.72,
    p50_pips: 0.55,
    p95_pips: p95,
    p99_pips: 3.6,
    worst_pips: 6.2,
    by_symbol: bySymbol,
    time_series: timeSeries,
    alert: p95 > 3,
    threshold_pips: 3,
  };
}

// --- Latency demo ----------------------------------------------------------- //

export function getDemoLatencyStats(hours: number): LatencyStats {
  const byEndpoint = [
    { endpoint: 'GET /api/status', requests: 1840, avg_ms: 42, p95_ms: 110 },
    { endpoint: 'GET /api/positions', requests: 920, avg_ms: 68, p95_ms: 142 },
    { endpoint: 'POST /api/bot/start', requests: 18, avg_ms: 215, p95_ms: 410 },
    { endpoint: 'GET /api/chart/EURUSD', requests: 412, avg_ms: 88, p95_ms: 180 },
    { endpoint: 'POST /api/ai/chat', requests: 64, avg_ms: 1850, p95_ms: 3200 },
  ];
  const timeSeries: LatencyStats['time_series'] = [];
  const stepMs = (hours * 3600_000) / 24;
  for (let i = 0; i < 24; i++) {
    const ts = new Date(Date.now() - (24 - i) * stepMs).toISOString();
    const base = 75 + Math.sin(i / 4) * 18 + (i > 18 ? 35 : 0);
    timeSeries.push({
      timestamp: ts,
      avg_ms: Math.round(base),
      p95_ms: Math.round(base * 1.8),
    });
  }
  const p99 = 420;
  return {
    total_requests: byEndpoint.reduce((a, b) => a + b.requests, 0),
    avg_ms: 92,
    p50_ms: 58,
    p95_ms: 240,
    p99_ms: p99,
    worst_ms: 1820,
    by_endpoint: byEndpoint,
    time_series: timeSeries,
    alert: p99 > 100,
    threshold_ms: 100,
  };
}

// --- Trade reconstruction demo ---------------------------------------------- //

export function getDemoTradeReconstruction(ticket: number): TradeReconstruction {
  const baseTime = Date.now() - 90 * 60_000;
  const entryPrice = 1.0853;
  const slInit = 1.0838;
  const slBe = 1.0853;
  const slTrail1 = 1.0868;
  const slTrail2 = 1.0878;
  const tp1Price = 1.0883;
  const tp2Price = 1.0913;
  const exitPrice = 1.0908;
  const events: TradeReconstruction['events'] = [
    { timestamp: new Date(baseTime).toISOString(), type: 'ENTRY', price: entryPrice, volume: 0.1, reason: 'EMA9/EMA21 cross + VWAP confirmation + ADX 28.4' },
    { timestamp: new Date(baseTime + 4 * 60_000).toISOString(), type: 'SL_MOVE', price: entryPrice, sl_old: slInit, sl_new: slInit, reason: 'Initial SL at 1.5×ATR + 2 pip buffer' },
    { timestamp: new Date(baseTime + 22 * 60_000).toISOString(), type: 'TP1_HIT', price: tp1Price, volume: 0.05, reason: 'TP1 (20 pip) hit — partial close 50%' },
    { timestamp: new Date(baseTime + 22 * 60_000 + 5_000).toISOString(), type: 'BE_MOVE', price: tp1Price, sl_old: slInit, sl_new: slBe, reason: 'SL moved to break-even after TP1' },
    { timestamp: new Date(baseTime + 38 * 60_000).toISOString(), type: 'TRAILING', price: 1.0889, sl_old: slBe, sl_new: slTrail1, reason: 'Trail 2×ATR behind swing low' },
    { timestamp: new Date(baseTime + 64 * 60_000).toISOString(), type: 'TRAILING', price: 1.0899, sl_old: slTrail1, sl_new: slTrail2, reason: 'Trail updated on continuation' },
    { timestamp: new Date(baseTime + 88 * 60_000).toISOString(), type: 'EXIT', price: exitPrice, volume: 0.05, reason: 'Trailing SL hit at 1.0878 (TP2 missed by 4 pips)' },
  ];
  return {
    ticket,
    symbol: 'EURUSD',
    direction: 'BUY',
    entry_time: new Date(baseTime).toISOString(),
    entry_price: entryPrice,
    initial_volume: 0.1,
    exit_time: new Date(baseTime + 88 * 60_000).toISOString(),
    exit_price: exitPrice,
    close_reason: 'TRAILING',
    events,
    final_pnl: 31.40,
    r_multiple: 2.09,
  };
}

// --- Health & readiness demo ------------------------------------------------ //

export function getDemoReadiness(): ReadinessResponse {
  return {
    status: 'healthy',
    checks: [
      { name: 'MT5 Connection', status: 'healthy', latency_ms: 142, message: 'connected as 50384721' },
      { name: 'SQLite Database', status: 'healthy', latency_ms: 3, message: '1247 audit rows' },
      { name: 'Ollama AI', status: 'healthy', latency_ms: 38, message: 'llama3.2:latest' },
      { name: 'Tiingo Calendar', status: 'healthy', latency_ms: 215, message: '8 HIGH events cached' },
      { name: 'Disk Space', status: 'healthy', message: '62% free' },
      { name: 'Memory', status: 'healthy', message: '412 MB / 2 GB' },
    ],
    checked_at: new Date().toISOString(),
  };
}

export function getDemoHealthz(): HealthzResponse {
  return {
    status: 'healthy',
    uptime_seconds: 142_873,
    version: '2.0.0',
  };
}

// --------------------------------------------------------------------------- //
// Frontend-100 — Demo data for new endpoints
// --------------------------------------------------------------------------- //

export function getDemoPriceAlerts(): PriceAlert[] {
  return [
    {
      id: 'alert_eurusd_above',
      type: 'PRICE_ABOVE',
      symbol: 'EURUSD',
      threshold: 1.092,
      notify_method: 'BOTH',
      active: true,
      note: 'Resistance test — breakout candidate',
      last_triggered: null,
      trigger_count: 0,
      created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
      updated_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
    },
    {
      id: 'alert_gbpusd_below',
      type: 'PRICE_BELOW',
      symbol: 'GBPUSD',
      threshold: 1.262,
      notify_method: 'BROWSER',
      active: true,
      note: 'Support break — short setup',
      last_triggered: new Date(Date.now() - 6 * 3600_000).toISOString(),
      trigger_count: 1,
      created_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
      updated_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
    },
    {
      id: 'alert_usdjpy_adx',
      type: 'ADX_CROSS_UP',
      symbol: 'USDJPY',
      threshold: 25,
      notify_method: 'TELEGRAM',
      active: true,
      note: 'Trending regime — start scanning',
      last_triggered: null,
      trigger_count: 0,
      created_at: new Date(Date.now() - 1 * 86400_000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 86400_000).toISOString(),
    },
    {
      id: 'alert_eurusd_rsi_ob',
      type: 'RSI_OVERBOUGHT',
      symbol: 'EURUSD',
      threshold: 70,
      notify_method: 'BOTH',
      active: false,
      note: 'Reversal warning (paused)',
      last_triggered: new Date(Date.now() - 14 * 3600_000).toISOString(),
      trigger_count: 3,
      created_at: new Date(Date.now() - 12 * 86400_000).toISOString(),
      updated_at: new Date(Date.now() - 14 * 3600_000).toISOString(),
    },
  ];
}

export function getDemoCreatePriceAlert(body: PriceAlertCreateRequest): PriceAlert {
  return {
    id: `alert_${Math.random().toString(36).slice(2, 12)}`,
    type: body.type,
    symbol: body.symbol,
    threshold: body.threshold,
    notify_method: body.notify_method,
    active: body.active ?? true,
    note: body.note ?? null,
    last_triggered: null,
    trigger_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function getDemoSystemInfo(): SystemInfoResponse {
  return {
    python_version: '3.14.0',
    os: 'Windows 11 10.0.22631',
    hostname: 'SCALPING-V2-WIN',
    cpu_count: 8,
    cpu_percent: 18.4,
    memory_total_bytes: 16_374_256_640,
    memory_used_bytes: 5_242_880_000,
    memory_percent: 32.0,
    disk_total_bytes: 512_000_000_000,
    disk_used_bytes: 218_000_000_000,
    disk_percent: 42.6,
    uptime_seconds: 142_873,
    active_db_connections: 4,
    boot_time: new Date(Date.now() - 142_873_000).toISOString(),
    process_id: 12_484,
  };
}

export function getDemoServiceStatus(): ServiceStatusResponse {
  return {
    services: [
      { name: 'MT5 Connection', ok: true, latency_ms: 142, detail: 'connected as 50384721 @ FinexIC-Markets' },
      { name: 'SQLite Database', ok: true, latency_ms: 3, detail: '1247 audit rows · SQLCipher AES-256' },
      { name: 'Ollama AI', ok: true, latency_ms: 38, detail: 'llama3.2:latest @ http://localhost:11434' },
      { name: 'Tiingo Calendar', ok: true, latency_ms: 215, detail: '8 HIGH events cached · next refresh in 12m' },
      { name: 'Telegram Bot', ok: true, latency_ms: 89, detail: '@scalping_v2_bot → chat 50384721' },
      { name: 'WebSocket Hub', ok: true, latency_ms: 1, detail: '3 clients connected' },
    ],
    checked_at: new Date().toISOString(),
  };
}

export function getDemoDrawdownRealtime(): DrawdownRealtimeResponse {
  return {
    current_drawdown_pct: -1.42,
    max_drawdown_pct_24h: -2.18,
    peak_equity: 10_124.5,
    current_equity: 9_981.2,
    trough_equity_24h: 9_903.4,
    recovered: false,
    updated_at: new Date().toISOString(),
  };
}

export function getDemoMetrics(): string {
  return `# HELP scalping_v2_bot_total_trades Total trades since bot start.
# TYPE scalping_v2_bot_total_trades counter
scalping_v2_bot_total_trades 412
# HELP scalping_v2_bot_uptime_seconds Uptime in seconds.
# TYPE scalping_v2_bot_uptime_seconds gauge
scalping_v2_bot_uptime_seconds 142873
# HELP scalping_v2_http_request_duration_seconds HTTP request latency.
# TYPE scalping_v2_http_request_duration_seconds histogram
scalping_v2_http_request_duration_seconds_bucket{le="0.05"} 1840
scalping_v2_http_request_duration_seconds_bucket{le="0.1"} 2412
scalping_v2_http_request_duration_seconds_bucket{le="0.5"} 2984
scalping_v2_http_request_duration_seconds_bucket{le="1"} 3012
scalping_v2_http_request_duration_seconds_bucket{le="+Inf"} 3034
# HELP scalping_v2_active_positions Current open positions.
# TYPE scalping_v2_active_positions gauge
scalping_v2_active_positions 2
# HELP scalping_v2_equity Current account equity.
# TYPE scalping_v2_equity gauge
scalping_v2_equity 9981.20
`;
}

export function getDemoCurrencyStrength(): CurrencyStrengthResponse {
  const base: Array<{ c: string; s: number; ch: number }> = [
    { c: 'USD', s: 78, ch: 2.4 },
    { c: 'EUR', s: -32, ch: -1.2 },
    { c: 'GBP', s: 18, ch: 0.8 },
    { c: 'JPY', s: -58, ch: -3.1 },
    { c: 'CHF', s: 12, ch: 0.4 },
    { c: 'AUD', s: -22, ch: -0.9 },
    { c: 'CAD', s: 8, ch: 0.3 },
    { c: 'NZD', s: -4, ch: 0.1 },
  ];
  const sorted = base.slice().sort((a, b) => b.s - a.s);
  return {
    timestamp: new Date().toISOString(),
    currencies: sorted.map((x, idx) => ({
      currency: x.c,
      strength: x.s,
      rank: idx + 1,
      change_24h: x.ch,
    })),
  };
}

export function getDemoVolumeProfile(symbol: string): VolumeProfileResponse {
  const base = symbol === 'USDJPY' ? 151.45 : 1.0853;
  const decimals = symbol === 'USDJPY' ? 2 : 4;
  const step = symbol === 'USDJPY' ? 0.05 : 0.0005;
  const levels: VolumeProfileResponse['levels'] = [];
  const pocIdx = 12;
  for (let i = 0; i < 25; i++) {
    const price = parseFloat((base + (i - 12) * step).toFixed(decimals));
    // Bell-ish curve peaked around POC.
    const vol = Math.round(800 * Math.exp(-Math.pow(i - pocIdx, 2) / 30) + 80);
    const inValueArea = Math.abs(i - pocIdx) <= 6;
    levels.push({
      price,
      volume: vol,
      is_poc: i === pocIdx,
      in_value_area: inValueArea,
    });
  }
  const pocPrice = levels[pocIdx].price;
  const vahPrice = levels[pocIdx + 6].price;
  const valPrice = levels[pocIdx - 6].price;
  const totalVolume = levels.reduce((a, b) => a + b.volume, 0);
  return {
    symbol,
    levels,
    poc_price: pocPrice,
    vah_price: vahPrice,
    val_price: valPrice,
    total_volume: totalVolume,
    value_area_volume_pct: 0.7,
    computed_at: new Date().toISOString(),
  };
}

export function getDemoCorrelationMatrix(
  pairs: string[],
  _window: number,
): CorrelationMatrixResponse {
  const n = pairs.length;
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 1;
      // Deterministic pseudo-correlation: EURUSD & USDCHF strong inverse,
      // AUDUSD & USDCAD mild inverse, GBPUSD & EURUSD positive.
      const a = pairs[i];
      const b = pairs[j];
      if (a === 'EURUSD' && b === 'USDCHF') return -0.92;
      if (a === 'USDCHF' && b === 'EURUSD') return -0.92;
      if (a === 'AUDUSD' && b === 'USDCAD') return -0.61;
      if (a === 'USDCAD' && b === 'AUDUSD') return -0.61;
      if (a === 'EURUSD' && b === 'GBPUSD') return 0.78;
      if (a === 'GBPUSD' && b === 'EURUSD') return 0.78;
      if (a === 'USDJPY' && b === 'EURUSD') return -0.34;
      if (a === 'EURUSD' && b === 'USDJPY') return -0.34;
      // fallback deterministic value
      const seed = (i * 7 + j * 13) % 100;
      return parseFloat(((seed - 50) / 100).toFixed(2));
    })
  );
  return {
    pairs,
    window_days: _window,
    matrix,
    computed_at: new Date().toISOString(),
  };
}

export function getDemoVolatilitySurface(symbol: string): VolatilitySurfaceResponse {
  const base = symbol === 'USDJPY' ? 8.4 : symbol === 'GBPUSD' ? 10.2 : 7.6;
  const tenors = ['1D', '5D', '10D', '20D', '60D'];
  return {
    symbol,
    tenors: tenors.map((t, idx) => {
      const scale = 1 + idx * 0.18;
      const v = base * scale * (0.9 + Math.sin(idx) * 0.1);
      return {
        tenor: t,
        volatility_pct: parseFloat(v.toFixed(2)),
        annualized_pct: parseFloat((v * Math.sqrt(252 / Math.max(1, idx + 1))).toFixed(2)),
      };
    }),
    computed_at: new Date().toISOString(),
  };
}

export function getDemoOrderFlow(symbol: string): OrderFlowResponse {
  // L2 depth not supported in demo — return levels with a note.
  const base = symbol === 'USDJPY' ? 151.45 : 1.0853;
  const decimals = symbol === 'USDJPY' ? 2 : 4;
  const step = symbol === 'USDJPY' ? 0.01 : 0.0001;
  const levels: OrderFlowResponse['levels'] = [];
  for (let i = -5; i <= 5; i++) {
    const price = parseFloat((base + i * step).toFixed(decimals));
    const bidVol = Math.round(120 + Math.random() * 80 + (i < 0 ? 60 : 0));
    const askVol = Math.round(120 + Math.random() * 80 + (i > 0 ? 60 : 0));
    levels.push({
      price,
      bid_volume: bidVol,
      ask_volume: askVol,
      imbalance: parseFloat(((askVol - bidVol) / (askVol + bidVol)).toFixed(2)),
    });
  }
  return {
    symbol,
    supported: false,
    levels,
    total_bid_volume: levels.reduce((a, b) => a + b.bid_volume, 0),
    total_ask_volume: levels.reduce((a, b) => a + b.ask_volume, 0),
    note: 'L2 market depth not available in demo mode. Connect MT5 broker with Level-2 subscription to enable order-flow analytics.',
    computed_at: new Date().toISOString(),
  };
}

export function getDemoNewsSentiment(): NewsSentimentResponse {
  const now = Date.now();
  const items = [
    {
      id: 'ns1',
      title: 'EUR/USD breaks 1.092 resistance on hawkish ECB minutes',
      source: 'Reuters',
      published_at: new Date(now - 2 * 3600_000).toISOString(),
      sentiment: 'BULLISH' as const,
      confidence: 0.82,
      affected_currencies: ['EUR', 'USD'],
      url: 'https://example.com/news/eurusd-resistance-break',
    },
    {
      id: 'ns2',
      title: 'US CPI prints hotter than expected — dollar extends gains',
      source: 'Bloomberg',
      published_at: new Date(now - 4 * 3600_000).toISOString(),
      sentiment: 'BEARISH' as const,
      confidence: 0.71,
      affected_currencies: ['USD', 'EUR', 'GBP'],
    },
    {
      id: 'ns3',
      title: 'BoJ governor signals patience on rate hikes — JPY softens',
      source: 'NHK',
      published_at: new Date(now - 7 * 3600_000).toISOString(),
      sentiment: 'BEARISH' as const,
      confidence: 0.64,
      affected_currencies: ['JPY', 'USD'],
    },
    {
      id: 'ns4',
      title: 'UK GDP in line with forecast — pound muted',
      source: 'FT',
      published_at: new Date(now - 10 * 3600_000).toISOString(),
      sentiment: 'NEUTRAL' as const,
      confidence: 0.55,
      affected_currencies: ['GBP'],
    },
    {
      id: 'ns5',
      title: 'Risk sentiment improves as equity markets rally',
      source: 'CNBC',
      published_at: new Date(now - 14 * 3600_000).toISOString(),
      sentiment: 'BULLISH' as const,
      confidence: 0.58,
      affected_currencies: ['AUD', 'CAD', 'NZD'],
    },
  ];
  return {
    items,
    total: items.length,
    fetched_at: new Date().toISOString(),
  };
}

export function getDemoSurpriseIndex(days: number): SurpriseIndexResponse {
  const entries = [
    { c: 'USD', actual: 0.31, forecast: 0.28, previous: 0.29, count: 8 },
    { c: 'EUR', actual: -0.12, forecast: 0.05, previous: -0.08, count: 6 },
    { c: 'GBP', actual: 0.18, forecast: 0.15, previous: 0.12, count: 5 },
    { c: 'JPY', actual: 0.42, forecast: 0.30, previous: 0.35, count: 4 },
    { c: 'AUD', actual: -0.05, forecast: 0.10, previous: 0.02, count: 3 },
    { c: 'CAD', actual: 0.22, forecast: 0.20, previous: 0.18, count: 3 },
    { c: 'CHF', actual: 0.08, forecast: 0.10, previous: 0.06, count: 2 },
  ];
  return {
    days,
    entries: entries.map((e) => ({
      currency: e.c,
      actual: e.actual,
      forecast: e.forecast,
      previous: e.previous,
      events_count: e.count,
      surprise_score: parseFloat(
        (((e.actual - e.forecast) / Math.abs(e.forecast || 0.01)) * 100).toFixed(1)
      ),
    })),
    computed_at: new Date().toISOString(),
  };
}

export function getDemoBrokerStatus(): BrokerStatusResponse {
  return {
    mt5_connected: true,
    mt5_login: 50384721,
    mt5_server: 'FinexIC-Markets',
    ollama_connected: true,
    ollama_model: 'llama3.2:latest',
    tiingo_connected: true,
    primary: 'mt5',
    failover_active: false,
    failover_reason: null,
    last_check: new Date().toISOString(),
  };
}

export function getDemoSwapsReport(): SwapsReportResponse {
  return {
    entries: [
      { symbol: 'EURUSD', swap_long: -1.42, swap_short: 0.78, swap_long_pips: -0.142, swap_short_pips: 0.078, currency: 'USD', source: 'mt5' },
      { symbol: 'GBPUSD', swap_long: -1.85, swap_short: 0.92, swap_long_pips: -0.185, swap_short_pips: 0.092, currency: 'USD', source: 'mt5' },
      { symbol: 'USDJPY', swap_long: -0.62, swap_short: 0.41, swap_long_pips: -0.062, swap_short_pips: 0.041, currency: 'JPY', source: 'mt5' },
      { symbol: 'USDCHF', swap_long: -0.34, swap_short: 0.18, swap_long_pips: -0.034, swap_short_pips: 0.018, currency: 'CHF', source: 'mt5' },
      { symbol: 'AUDUSD', swap_long: 0.52, swap_short: -0.82, swap_long_pips: 0.052, swap_short_pips: -0.082, currency: 'USD', source: 'mt5' },
      { symbol: 'USDCAD', swap_long: -0.92, swap_short: 0.36, swap_long_pips: -0.092, swap_short_pips: 0.036, currency: 'CAD', source: 'mt5' },
    ],
    total: 6,
    generated_at: new Date().toISOString(),
  };
}

export function getDemoTickBacktest(body: TickBacktestRequest): TickBacktestResult {
  return {
    id: `tick_${Math.random().toString(36).slice(2, 12)}`,
    symbol: body.symbol,
    total_ticks: 184_250,
    trades: 47,
    wins: 22,
    losses: 25,
    final_balance: (body.initial_balance ?? 10000) * 1.084,
    max_drawdown_pct: 4.2,
    profit_factor: 1.32,
    duration_seconds: 18.4,
    computed_at: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------------- //
// FRONTEND-FEATURES: demo generators for 10 new feature surfaces
// --------------------------------------------------------------------------- //

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function getDemoSendTestEmail(recipient: string): SendTestEmailResponse {
  return {
    ok: true,
    recipient,
    subject: '[Scalping V2] Test Email — Demo Mode',
    sent_at: new Date().toISOString(),
    message: `SMTP test email delivered to ${recipient} (demo). Daily digest will be sent at 22:00 WIB.`,
  };
}

export function getDemoDailyReport(date?: string): DailyReport {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return {
    date: d,
    starting_balance: 10000,
    ending_balance: 10284.42,
    daily_pnl: 284.42,
    daily_pnl_pct: 2.84,
    trades_count: 4,
    wins: 3,
    losses: 1,
    breakeven: 0,
    win_rate: 75,
    profit_factor: 3.12,
    best_trade: {
      ticket: 50384722,
      symbol: 'EURUSD',
      direction: 'BUY',
      result: 'WIN',
      r_multiple: 2.4,
      profit: 184.20,
      close_reason: 'TP2',
    },
    worst_trade: {
      ticket: 50384719,
      symbol: 'GBPUSD',
      direction: 'SELL',
      result: 'LOSS',
      r_multiple: -1.0,
      profit: -82.10,
      close_reason: 'SL',
    },
    compliance_score: 92,
    notes:
      'Sesi London Open + Overlap memberikan kontribusi terbesar. ADX rata-rata 31.2 — trending yang sehat.',
    generated_at: new Date().toISOString(),
  };
}

export function getDemoBenchmark(start: string, end: string): BenchmarkResult {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400_000));
  const series: BenchmarkResult['series'] = [];
  let botEq = 10000;
  let bhEq = 10000;
  let rndEq = 10000;
  for (let i = 0; i < days; i++) {
    const ts = new Date(startDate.getTime() + i * 86400_000).toISOString().slice(0, 10);
    const botDay = 0.0011 + Math.sin(i / 7) * 0.0045 + (i % 11 === 0 ? -0.008 : 0);
    const bhDay = 0.0007 + Math.cos(i / 11) * 0.0035;
    const rndDay = (Math.random() - 0.5) * 0.006;
    botEq = botEq * (1 + botDay);
    bhEq = bhEq * (1 + bhDay);
    rndEq = rndEq * (1 + rndDay);
    series.push({
      date: ts,
      bot_equity: parseFloat(botEq.toFixed(2)),
      buy_hold_equity: parseFloat(bhEq.toFixed(2)),
      random_equity: parseFloat(rndEq.toFixed(2)),
      bot_daily_pct: parseFloat((botDay * 100).toFixed(3)),
      buy_hold_daily_pct: parseFloat((bhDay * 100).toFixed(3)),
      random_daily_pct: parseFloat((rndDay * 100).toFixed(3)),
    });
  }
  const botPct = ((botEq / 10000 - 1) * 100);
  const bhPct = ((bhEq / 10000 - 1) * 100);
  const rndPct = ((rndEq / 10000 - 1) * 100);
  return {
    start_date: start,
    end_date: end,
    series,
    bot_pnl_pct: parseFloat(botPct.toFixed(2)),
    buy_hold_pnl_pct: parseFloat(bhPct.toFixed(2)),
    random_pnl_pct: parseFloat(rndPct.toFixed(2)),
    alpha: parseFloat((botPct - bhPct).toFixed(2)),
    beta: parseFloat((0.62 + Math.random() * 0.12).toFixed(2)),
    outperformance_pct: parseFloat((botPct - bhPct).toFixed(2)),
    p_value: parseFloat((0.018 + Math.random() * 0.01).toFixed(4)),
    significant: true,
    bot_sharpe: parseFloat((1.42 + Math.random() * 0.2).toFixed(2)),
    buy_hold_sharpe: parseFloat((0.78 + Math.random() * 0.15).toFixed(2)),
    computed_at: new Date().toISOString(),
  };
}

export function getDemoRatios(): PerformanceRatios {
  return {
    sharpe: 1.48,
    sortino: 1.92,
    alpha: 4.21,
    beta: 0.58,
    calmar: 1.34,
    max_drawdown_pct: -6.8,
    volatility_pct: 9.4,
    downside_deviation_pct: 5.2,
    up_capture: 0.71,
    down_capture: 0.18,
    information_ratio: 0.86,
    treynor_ratio: 18.42,
    computed_at: new Date().toISOString(),
  };
}

export function getDemoSeasonality(): SeasonalityAnalysis {
  const dayStats: SeasonalityAnalysis['by_day_of_week'] = DAYS_OF_WEEK.map((day, idx) => {
    const base = [62, 58, 71, 64, 49, 31, 28][idx];
    const trades = [42, 38, 51, 47, 33, 8, 3][idx];
    return {
      day,
      trades,
      wins: Math.round(trades * base / 100),
      losses: trades - Math.round(trades * base / 100),
      win_rate: base,
      r_net: parseFloat(((base - 50) / 50 * 0.4).toFixed(2)),
      profit: parseFloat(((base - 50) * 12.4).toFixed(2)),
    };
  });
  const monthStats: SeasonalityAnalysis['by_month'] = MONTHS.map((m, idx) => {
    const base = [54, 61, 67, 58, 63, 70, 72, 65, 59, 52, 48, 44][idx];
    const trades = [38, 42, 51, 45, 48, 56, 58, 52, 47, 40, 32, 28][idx];
    return {
      month: m,
      month_num: idx + 1,
      trades,
      wins: Math.round(trades * base / 100),
      win_rate: base,
      r_net: parseFloat(((base - 50) / 50 * 0.5).toFixed(2)),
      profit: parseFloat(((base - 50) * 18.7).toFixed(2)),
    };
  });
  const hourStats: SeasonalityAnalysis['by_hour'] = Array.from({ length: 24 }, (_, h) => {
    let trades = 0;
    let wr = 40;
    // Tokyo 9-12, London 14-17, Overlap 19:30-23
    if (h >= 9 && h <= 12) { trades = 12; wr = 58; }
    if (h >= 14 && h <= 17) { trades = 18; wr = 64; }
    if (h >= 19 && h <= 23) { trades = 22; wr = 67; }
    if (h >= 0 && h <= 5) { trades = 3; wr = 38; }
    if (trades === 0) { trades = 2; wr = 44; }
    return {
      hour: h,
      trades,
      wins: Math.round(trades * wr / 100),
      win_rate: wr,
      r_net: parseFloat(((wr - 50) / 50 * 0.3).toFixed(2)),
      profit: parseFloat(((wr - 50) * 8.4).toFixed(2)),
    };
  });
  const bySession: SeasonalityAnalysis['by_session'] = [
    { session: 'TOKYO', trades: 142, win_rate: 58, r_net: 0.16, profit: 412.4 },
    { session: 'LONDON', trades: 224, win_rate: 64, r_net: 0.28, profit: 1284.5 },
    { session: 'OVERLAP', trades: 268, win_rate: 67, r_net: 0.34, profit: 2104.8 },
    { session: 'SYDNEY', trades: 24, win_rate: 42, r_net: -0.08, profit: -94.2 },
    { session: 'LONDON_LUNCH', trades: 38, win_rate: 38, r_net: -0.12, profit: -148.4 },
    { session: 'SKIP', trades: 12, win_rate: 33, r_net: -0.18, profit: -64.0 },
  ];
  return {
    by_day_of_week: dayStats,
    by_month: monthStats,
    by_hour: hourStats,
    by_session: bySession,
    best_days: ['Wed', 'Thu', 'Tue'],
    best_months: ['Jul', 'Jun', 'Aug'],
    worst_days: ['Sun', 'Sat'],
    worst_months: ['Dec', 'Nov'],
    total_trades_analyzed: 708,
    computed_at: new Date().toISOString(),
  };
}

export function getDemoSeasonalityScore(date: string): SeasonalityScore {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun
  const dowName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
  // Wed (3) & Thu (4) → best; Sun (0) & Sat (6) → worst
  const scoreMap: Record<number, { score: number; label: SeasonalityScore['label']; wr: number; r: number }> = {
    0: { score: -72, label: 'AVOID', wr: 28, r: -0.32 },
    1: { score: 12, label: 'NEUTRAL', wr: 62, r: 0.10 },
    2: { score: 54, label: 'FAVORABLE', wr: 71, r: 0.32 },
    3: { score: 78, label: 'HIGHLY_FAVORABLE', wr: 76, r: 0.42 },
    4: { score: 64, label: 'FAVORABLE', wr: 68, r: 0.36 },
    5: { score: -38, label: 'AVOID', wr: 31, r: -0.22 },
    6: { score: -65, label: 'AVOID', wr: 27, r: -0.30 },
  };
  const info = scoreMap[dow] ?? scoreMap[1];
  return {
    date,
    day_of_week: dowName,
    score: info.score,
    label: info.label,
    expected_win_rate: info.wr,
    expected_r_net: info.r,
    rationale:
      info.label === 'AVOID'
        ? `Historical win rate for ${dowName} hanya ${info.wr}% — weekend/low-liquidity. Skip trading.`
        : info.label === 'HIGHLY_FAVORABLE'
          ? `${dowName} menunjukkan win rate ${info.wr}% dan R-net +${info.r} — kondisi ideal untuk scalping.`
          : `${dowName} win rate ${info.wr}% — tradeable namun selektif terhadap setup A+.`,
  };
}

export function getDemoOptimalParams(): OptimalParams {
  return {
    risk_pct_per_trade: 0.012,
    max_positions: 3,
    max_daily_trades: 5,
    rr_net_min: 2.1,
    sl_atr_mult: 1.5,
    tp1_mult: 2.0,
    tp2_mult: 4.0,
    trailing_atr_mult: 2.0,
    be_buffer_pips: 2.0,
    adx_trending_threshold: 25,
    adx_ranging_threshold: 20,
  };
}

export function getDemoOptimizationResult(): OptimizationResult {
  return {
    run_id: `opt_${Math.random().toString(36).slice(2, 10)}`,
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    finished_at: new Date().toISOString(),
    status: 'COMPLETED',
    previous_params: getDemoOptimalParams(),
    optimized_params: {
      ...getDemoOptimalParams(),
      risk_pct_per_trade: 0.014,
      rr_net_min: 2.25,
      tp2_mult: 4.2,
      adx_trending_threshold: 27,
    },
    backtest_before: {
      pnl_pct: 12.4,
      sharpe: 1.18,
      max_dd_pct: 7.2,
      profit_factor: 1.42,
    },
    backtest_after: {
      pnl_pct: 18.6,
      sharpe: 1.48,
      max_dd_pct: 6.4,
      profit_factor: 1.78,
    },
    improvement_pct: 50.0,
    trials: 128,
    note: 'Bayesian optimization (128 trials, 5-fold walk-forward) menemukan risk 1.4% + RR≥2.25 optimal untuk regime trending.',
  };
}

export function getDemoOptimizationHistory(): OptimizationHistoryEntry[] {
  const now = Date.now();
  return [
    { run_id: 'opt_9a8b', finished_at: new Date(now - 1 * 86400_000).toISOString(), status: 'COMPLETED', improvement_pct: 50.0, pnl_after_pct: 18.6, sharpe_after: 1.48, trials: 128 },
    { run_id: 'opt_k2j7', finished_at: new Date(now - 4 * 86400_000).toISOString(), status: 'COMPLETED', improvement_pct: 28.4, pnl_after_pct: 14.2, sharpe_after: 1.31, trials: 96 },
    { run_id: 'opt_p3x1', finished_at: new Date(now - 7 * 86400_000).toISOString(), status: 'PARTIAL', improvement_pct: 12.1, pnl_after_pct: 11.8, sharpe_after: 1.18, trials: 64 },
    { run_id: 'opt_q9z4', finished_at: new Date(now - 11 * 86400_000).toISOString(), status: 'COMPLETED', improvement_pct: 34.7, pnl_after_pct: 15.9, sharpe_after: 1.36, trials: 112 },
    { run_id: 'opt_m5r2', finished_at: new Date(now - 14 * 86400_000).toISOString(), status: 'FAILED', improvement_pct: -3.2, pnl_after_pct: 8.4, sharpe_after: 0.92, trials: 48 },
  ];
}

export function getDemoVoiceTestResult(text: string, volume: number): VoiceTestResult {
  return {
    ok: true,
    text,
    volume,
    engine: 'pyttsx3',
    duration_ms: Math.round(text.length * 75),
    fired_at: new Date().toISOString(),
  };
}

export function getDemoVoiceStatus(): VoiceStatus {
  return {
    enabled: true,
    engine: 'pyttsx3',
    volume: 0.7,
    voice_id: 'en-us-male',
    last_alert: 'KILL SWITCH TEST — issued 2 menit lalu',
    alerts_fired_today: 14,
    available_voices: 4,
    supported: true,
  };
}

export function getDemoTelegramCommands(): TelegramCommand[] {
  return [
    { command: '/status', description: 'Lihat status bot & akun MT5', args: '(none)', example: '/status', admin_only: false },
    { command: '/start', description: 'Start bot auto-trading', args: '(none)', example: '/start', admin_only: true },
    { command: '/stop', description: 'Stop bot (pause, tidak kill)', args: '(none)', example: '/stop', admin_only: true },
    { command: '/kill', description: 'KILL SWITCH — tutup semua posisi & hentikan', args: '(none)', example: '/kill', admin_only: true },
    { command: '/positions', description: 'Daftar posisi terbuka', args: '(none)', example: '/positions', admin_only: false },
    { command: '/daily', description: 'Ringkasan daily P&L', args: '[date]', example: '/daily 2026-01-12', admin_only: false },
    { command: '/risk', description: 'Status tiered stop risk', args: '(none)', example: '/risk', admin_only: false },
    { command: '/config', description: 'Lihat parameter V2 aktif', args: '(none)', example: '/config', admin_only: true },
    { command: '/report', description: 'Kirim daily report email sekarang', args: '[recipient]', example: '/report me@example.com', admin_only: true },
    { command: '/screenshot', description: 'Screenshot chart terbaru', args: '[ticket]', example: '/screenshot 50384722', admin_only: false },
  ];
}

export function getDemoTelegramCommandResponse(command: string): TelegramCommandResponse {
  const cmd = command.trim().toLowerCase();
  let text = '';
  switch (cmd) {
    case '/status':
      text = '🟢 Bot RUNNING\nBalance: $10,284.42\nOpen positions: 2\nToday P&L: +2.84%';
      break;
    case '/positions':
      text = 'Open positions (2):\n• #50384722 EURUSD BUY +0.4R\n• #50384725 USDJPY SELL +1.2R (TP1 hit)';
      break;
    case '/risk':
      text = 'Tiered stops:\nSoft 1%: 0% used\nHard 2%: 0% used\nWeekly 4%: 1.2% used\nOverall 10%: 2.8% used';
      break;
    default:
      text = `✅ Command "${command}" diterima & diproses.`;
  }
  return {
    ok: true,
    command,
    response_text: text,
    chat_id: '-1001234567890',
    sent_at: new Date().toISOString(),
  };
}

export function getDemoScreenshot(ticket: number): ScreenshotInfo {
  return {
    ticket,
    symbol: ticket % 2 === 0 ? 'EURUSD' : 'USDJPY',
    captured_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    file_path: `/screenshots/ticket_${ticket}_entry.png`,
    thumbnail_url: null,
    full_url: null,
    width: 1280,
    height: 720,
    size_bytes: 248_402,
    caption: `Entry chart untuk ticket #${ticket} — EURUSD 5M timeframe (snapshot at TP1 hit)`,
  };
}

export function getDemoScreenshotList(ticket: number): ScreenshotListResponse {
  const shots: ScreenshotInfo[] = [
    { ...getDemoScreenshot(ticket), captured_at: new Date(Date.now() - 180 * 60_000).toISOString(), caption: `Pre-entry chart #${ticket}` },
    { ...getDemoScreenshot(ticket), captured_at: new Date(Date.now() - 120 * 60_000).toISOString(), caption: `Entry confirmation #${ticket}` },
    { ...getDemoScreenshot(ticket), captured_at: new Date(Date.now() - 60 * 60_000).toISOString(), caption: `TP1 hit #${ticket}` },
  ];
  return { ticket, total: shots.length, screenshots: shots };
}

export function getDemoMLTrainResult(): MLTrainResult {
  return {
    ok: true,
    model_version: `ml-v2-${Math.random().toString(36).slice(2, 8)}`,
    trained_at: new Date().toISOString(),
    samples: 1284,
    features: 24,
    accuracy: 0.682,
    precision: 0.71,
    recall: 0.64,
    f1: 0.673,
    auc: 0.74,
    duration_seconds: 18.4,
    note: 'GradientBoostingClassifier (regime + direction). 5-fold walk-forward CV dengan purge embargo.',
  };
}

export function getDemoMLPrediction(symbol: string): MLPrediction {
  const regimes = ['TRENDING', 'TRANSITION', 'RANGING', 'EXHAUSTION'] as const;
  const directions = ['BUY', 'SELL'] as const;
  const regime = regimes[Math.floor(Math.random() * regimes.length)];
  const dir = Math.random() > 0.4 ? directions[Math.floor(Math.random() * directions.length)] : null;
  return {
    symbol,
    predicted_regime: regime,
    regime_confidence: parseFloat((0.62 + Math.random() * 0.32).toFixed(2)),
    predicted_direction: dir,
    direction_confidence: dir ? parseFloat((0.55 + Math.random() * 0.25).toFixed(2)) : 0,
    predicted_win_prob: parseFloat((0.48 + Math.random() * 0.22).toFixed(2)),
    features_snapshot: {
      adx_15m: 27 + Math.random() * 8,
      atr_5m_pips: 8 + Math.random() * 4,
      rsi_14: 42 + Math.random() * 24,
      vwap_distance_pips: 1 + Math.random() * 3,
      spread_pips: 0.8 + Math.random() * 0.4,
    },
    model_version: 'ml-v2-1a4f7c',
    predicted_at: new Date().toISOString(),
  };
}

export function getDemoMLFeatures(): MLFeatures {
  const features: MLFeatures['features'] = [
    { name: 'adx_15m', importance: 0.184, description: 'ADX 14-period on 15M timeframe (regime filter)', category: 'regime' },
    { name: 'atr_5m_pips', importance: 0.142, description: 'ATR(14) on 5M expressed in pips (volatility)', category: 'volatility' },
    { name: 'vwap_distance_pips', importance: 0.118, description: 'Distance price to VWAP in pips', category: 'price' },
    { name: 'rsi_14', importance: 0.094, description: 'RSI 14-period momentum', category: 'momentum' },
    { name: 'ema9_ema21_slope', importance: 0.082, description: 'Slope of EMA9-EMA21 spread', category: 'momentum' },
    { name: 'session_overlap', importance: 0.078, description: 'Binary: 1 jika overlap London-NY', category: 'session' },
    { name: 'spread_pips', importance: 0.064, description: 'Live spread in pips', category: 'price' },
    { name: 'volume_zscore', importance: 0.058, description: 'Volume z-score vs 20-period mean', category: 'volume' },
    { name: 'hour_sin', importance: 0.052, description: 'Sine encoding of hour-of-day', category: 'session' },
    { name: 'atr_pct_change', importance: 0.048, description: 'ATR rate-of-change', category: 'volatility' },
    { name: 'price_above_ema21', importance: 0.042, description: 'Binary: price above EMA21', category: 'price' },
    { name: 'adx_slope', importance: 0.038, description: 'ADX rate-of-change', category: 'regime' },
  ];
  return {
    model_version: 'ml-v2-1a4f7c',
    features,
    total_features: features.length,
    computed_at: new Date().toISOString(),
  };
}

export function getDemoNewsTradingStatus(): NewsTradingStatus {
  return {
    enabled: true,
    risk_pct: 0.005,
    blackout_minutes_before: 30,
    blackout_minutes_after: 30,
    min_impact: 'HIGH',
    auto_reduce_positions: true,
    active_blackouts: 1,
    next_event: {
      title: 'US CPI (m/m)',
      time: new Date(Date.now() + 90 * 60_000).toISOString(),
      impact: 'HIGH',
      currency: 'USD',
    },
  };
}

export function getDemoNewsTradingStats(): NewsTradingStats {
  return {
    total_events: 184,
    trades_during_blackout: 0,
    trades_blocked: 47,
    positions_reduced: 12,
    blackouts_triggered: 184,
    pnl_during_events_pct: 4.8,
    pnl_during_blackouts_pct: -0.4,
    avg_volatility_during_event: 2.4,
    window_days: 90,
    computed_at: new Date().toISOString(),
  };
}

export function getDemoMT5Accounts(): MT5AccountsListResponse {
  const accounts: MT5Account[] = [
    {
      name: 'primary',
      login: 50384721,
      server: 'FinexIC-Markets',
      broker: 'Finex Indonesia',
      currency: 'USD',
      leverage: 100,
      balance: 10284.42,
      equity: 10312.10,
      margin: 412.40,
      margin_free: 9899.70,
      margin_level: 2502.7,
      profit: 27.68,
      bot_status: 'RUNNING',
      bot_mode: 'PAPER',
      last_sync: new Date().toISOString(),
      connected: true,
    },
    {
      name: 'aggressive',
      login: 50384722,
      server: 'FinexIC-Markets',
      broker: 'Finex Indonesia',
      currency: 'USD',
      leverage: 200,
      balance: 5120.00,
      equity: 5184.20,
      margin: 280.10,
      margin_free: 4904.10,
      margin_level: 1850.5,
      profit: 64.20,
      bot_status: 'RUNNING',
      bot_mode: 'LIVE',
      last_sync: new Date().toISOString(),
      connected: true,
    },
    {
      name: 'conservative',
      login: 50384723,
      server: 'FinexIC-Markets',
      broker: 'Finex Indonesia',
      currency: 'USD',
      leverage: 50,
      balance: 20480.00,
      equity: 20462.30,
      margin: 0,
      margin_free: 20462.30,
      margin_level: 0,
      profit: -17.70,
      bot_status: 'STOPPED',
      bot_mode: 'DRY',
      last_sync: new Date(Date.now() - 5 * 60_000).toISOString(),
      connected: false,
    },
  ];
  return { accounts, total: accounts.length, active_bots: 2 };
}

export function getDemoAddAccount(body: AddAccountRequest): MT5Account {
  return {
    name: body.name,
    login: body.login,
    server: body.server,
    broker: body.broker ?? 'Finex Indonesia',
    currency: 'USD',
    leverage: 100,
    balance: body.initial_balance ?? 5000,
    equity: body.initial_balance ?? 5000,
    margin: 0,
    margin_free: body.initial_balance ?? 5000,
    margin_level: 0,
    profit: 0,
    bot_status: 'STOPPED',
    bot_mode: 'PAPER',
    last_sync: new Date().toISOString(),
    connected: true,
  };
}

export function getDemoAggregatedStats(): AggregatedStats {
  return {
    total_balance: 35884.42,
    total_equity: 35958.60,
    total_profit: 74.18,
    total_margin_used: 692.50,
    total_free_margin: 35266.10,
    accounts_count: 3,
    connected_count: 2,
    bots_running: 2,
    bots_stopped: 1,
    best_account: { name: 'aggressive', pnl_pct: 1.25 },
    worst_account: { name: 'conservative', pnl_pct: -0.09 },
    total_trades_today: 14,
    blended_pnl_pct: 0.21,
    computed_at: new Date().toISOString(),
  };
}
