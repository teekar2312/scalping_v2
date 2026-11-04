// TypeScript types for Forex Scalping V2 Trading System
// Matches Python backend models in /download/python-backend/database.py

export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'OPEN' | 'CLOSED' | 'PENDING';
export type TradeResult = 'WIN' | 'LOSS' | 'BREAKEVEN';
export type CloseReason = 'TP1' | 'TP2' | 'SL' | 'TRAILING' | 'MANUAL' | 'INVALID';
export type MarketRegime = 'TRENDING' | 'TRANSITION' | 'RANGING' | 'EXHAUSTION';
export type SetupType = 'VWAP_BOUNCE' | 'EMA_CROSS' | 'PIN_BAR' | 'ENGULFING' | 'INSIDE_BAR';
export type SessionName = 'TOKYO' | 'LONDON' | 'OVERLAP' | 'SYDNEY' | 'LONDON_LUNCH' | 'SKIP';
export type SignalStatus = 'ACTIVE' | 'EXECUTED' | 'EXPIRED' | 'SKIPPED';
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export type BotStatus = 'RUNNING' | 'STOPPED' | 'PAUSED' | 'KILLED';

export interface Account {
  login: number;
  server: string;
  broker: string;
  currency: string;
  leverage: number;
  balance: number;
  equity: number;
  margin: number;
  marginFree: number;
  marginLevel: number;
  profit: number;
  lastSync: string;
}

export interface ChecklistResult {
  point: number;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface Trade {
  id: string;
  ticket: number;
  symbol: string;
  direction: TradeDirection;
  volume: number;
  openPrice: number;
  closePrice: number | null;
  sl: number;
  tp1: number;
  tp2: number | null;
  slPips: number;
  tp1Pips: number;
  rrNet: number;
  atrValue: number;
  adxValue: number;
  regime: MarketRegime;
  setupType: SetupType;
  session: SessionName;
  status: TradeStatus;
  result: TradeResult | null;
  rMultiple: number | null;
  profitNet: number | null;
  closeReason: CloseReason | null;
  entryTime: string;
  closeTime: string | null;
  durationMin: number | null;
  checklist: ChecklistResult[];
  aiAnalysis: string | null;
}

export interface Signal {
  id: string;
  symbol: string;
  direction: TradeDirection;
  timeframe: string;
  entryPrice: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  slPips: number;
  tp1Pips: number;
  rrNet: number;
  atrValue: number;
  adxValue: number;
  vwapValue: number;
  ema9Value: number;
  ema21Value: number;
  regime: MarketRegime;
  setupType: SetupType;
  session: SessionName;
  checklistPassed: number;
  status: SignalStatus;
  reason: string | null;
  aiVerdict: string | null;
  createdAt: string;
  expiresAt: string | null;
  checklist: ChecklistResult[];
}

export interface NewsEvent {
  id: string;
  ticker: string;
  title: string;
  impact: NewsImpact;
  country: string;
  currency: string;
  eventTime: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string;
  blackoutStart: string | null;
  blackoutEnd: string | null;
}

export interface BotState {
  status: BotStatus;
  autoTrade: boolean;
  killSwitch: boolean;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  uptimeSec: number;
  mt5Connected: boolean;
  ollamaConnected: boolean;
  tiingoConnected: boolean;
}

export interface DailyRisk {
  date: string;
  startingBalance: number;
  currentBalance: number;
  dailyPnl: number;
  dailyPnlPct: number;
  tradesCount: number;
  winsCount: number;
  lossesCount: number;
  softStopHit: boolean;
  hardStopHit: boolean;
  botLocked: boolean;
  lockReason: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context: string | null;
  model: string;
  createdAt: string;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData {
  ema9: number[];
  ema21: number[];
  vwap: number[];
  atr: number[];
  adx: number[];
  rsi: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
}

export interface ChartData {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  indicators: IndicatorData;
  sessionMarkers: { time: string; session: SessionName; trade: boolean }[];
  signalMarkers: { time: string; type: 'BUY' | 'SELL'; price: number }[];
}

export interface SystemStatus {
  bot: BotState;
  account: Account | null;
  dailyRisk: DailyRisk | null;
  openPositionsCount: number;
  todayTradesCount: number;
  weeklyPnlPct: number;
  overallPnlPct: number;
  mt5Available: boolean;
  ollamaAvailable: boolean;
  tiingoAvailable: boolean;
  pythonBackendUrl: string | null;
  demoMode: boolean;
}

export interface Settings {
  mt5: {
    login: string;
    password: string;
    server: string;
    broker: string;
  };
  ollama: {
    url: string;
    model: string;
  };
  tiingo: {
    apiKey: string;
  };
  risk: {
    riskPctPerTrade: number;
    maxPositions: number;
    maxDailyTrades: number;
    rrNetMin: number;
    softStopPct: number;
    hardStopPct: number;
    weeklyStopPct: number;
    overallStopPct: number;
  };
  pairs: string[];
  pythonApiUrl: string;
}
