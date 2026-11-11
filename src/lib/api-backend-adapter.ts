// Adapter functions to transform backend snake_case responses to frontend camelCase types.
//
// The Python FastAPI backend (database.py / routes) serialises its Pydantic models
// using snake_case field names (open_price, rr_net, last_sync, etc.) while the
// Next.js frontend expects camelCase fields (openPrice, rrNet, lastSync) as defined
// in `./types.ts`. Without an adapter, ~49 critical mismatches crash the views at
// runtime (TypeError: Cannot read properties of undefined / null.replace is not a
// function).
//
// These helpers:
//   • Map every snake_case field to its camelCase counterpart.
//   • Coerce untyped `Record<string, unknown>` payloads to typed interfaces.
//   • Derive missing fields (e.g. `rMultiple` from `rr_net`, `result` from `win`).
//   • Normalise enum casing (lowercase `buy` → `BUY`).
//   • Provide defensive defaults so the UI never crashes on partial payloads.
//
// Only used for the `!IS_DEMO` code path — demo mode returns already-correct mock
// objects and bypasses these transforms entirely.

import type {
  Account,
  BotState,
  BotStatus,
  Candle,
  ChartData,
  ChecklistResult,
  CloseReason,
  DailyRisk,
  IndicatorData,
  MarketRegime,
  NewsEvent,
  NewsImpact,
  SessionName,
  SetupType,
  Signal,
  SignalStatus,
  SystemStatus,
  Trade,
  TradeDirection,
  TradeResult,
  TradeStatus,
} from './types';

// --------------------------------------------------------------------------- //
// Primitive coercion helpers — never throw, always return a sane default.
// --------------------------------------------------------------------------- //

type Raw = Record<string, unknown>;

function asNum(v: unknown, def = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return def;
}

function asStr(v: unknown, def = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return def;
}

function asBool(v: unknown, def = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
  }
  return def;
}

function asArr<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}

function asISO(v: unknown, def: string | null = null): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Treat large numbers as epoch ms; small numbers as epoch seconds.
    const ms = v > 1e12 ? v : v * 1000;
    try {
      return new Date(ms).toISOString();
    } catch {
      return def;
    }
  }
  return def;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  if (typeof v === 'string') {
    const up = v.toUpperCase();
    if (allowed.includes(up as T)) return up as T;
  }
  return def;
}

// Enum normalisers — lowercase backend values → uppercase frontend enum.

const DIRECTIONS: readonly TradeDirection[] = ['BUY', 'SELL'];
const TRADE_STATUSES: readonly TradeStatus[] = ['OPEN', 'CLOSED', 'PENDING'];
const RESULTS: readonly TradeResult[] = ['WIN', 'LOSS', 'BREAKEVEN'];
const CLOSE_REASONS: readonly CloseReason[] = ['TP1', 'TP2', 'SL', 'TRAILING', 'MANUAL', 'INVALID'];
const REGIMES: readonly MarketRegime[] = ['TRENDING', 'TRANSITION', 'RANGING', 'EXHAUSTION'];
const SETUPS: readonly SetupType[] = ['VWAP_BOUNCE', 'EMA_CROSS', 'PIN_BAR', 'ENGULFING', 'INSIDE_BAR'];
const SESSIONS: readonly SessionName[] = ['TOKYO', 'LONDON', 'OVERLAP', 'SYDNEY', 'LONDON_LUNCH', 'SKIP'];
const SIGNAL_STATUSES: readonly SignalStatus[] = ['ACTIVE', 'EXECUTED', 'EXPIRED', 'SKIPPED'];
const IMPACTS: readonly NewsImpact[] = ['HIGH', 'MEDIUM', 'LOW'];
const BOT_STATUSES: readonly BotStatus[] = ['RUNNING', 'STOPPED', 'PAUSED', 'KILLED'];

// --------------------------------------------------------------------------- //
// Account
// --------------------------------------------------------------------------- //

export function transformAccount(raw: unknown): Account | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  return {
    login: asNum(r.login ?? r.account_id, 0),
    server: asStr(r.server, ''),
    broker: asStr(r.broker ?? r.server, ''),
    currency: asStr(r.currency, 'USD'),
    leverage: asNum(r.leverage, 100),
    balance: asNum(r.balance, 0),
    equity: asNum(r.equity, 0),
    margin: asNum(r.margin, 0),
    marginFree: asNum(r.margin_free ?? r.marginFree, 0),
    marginLevel: asNum(r.margin_level ?? r.marginLevel, 0),
    profit: asNum(r.profit, 0),
    lastSync: asStr(r.last_sync ?? r.lastSync, new Date().toISOString()),
  };
}

// --------------------------------------------------------------------------- //
// Trade
// Map: open_price→openPrice, close_price→closePrice, open_time→entryTime,
//      close_time→closeTime, rr_net→rrNet, profit→profitNet, exit_reason→closeReason
// Derive: result from win flag/profit, rMultiple from rr_net, durationMin from times
// --------------------------------------------------------------------------- //

export function transformTrade(raw: unknown): Trade {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const direction = pick(r.direction ?? r.side, DIRECTIONS, 'BUY');
  const status = pick(r.status, TRADE_STATUSES, r.close_time ? 'CLOSED' : 'OPEN');
  const setupType = pick(r.setup_type ?? r.setup ?? r.strategy, SETUPS, 'VWAP_BOUNCE');
  const session = pick(r.session_name ?? r.session, SESSIONS, 'SKIP');
  const regime = pick(r.regime, REGIMES, 'TRANSITION');

  const openPrice = asNum(r.open_price ?? r.openPrice ?? r.price_open, 0);
  const closePrice = asISO(r.close_time ?? r.closeTime) === null
    ? null
    : asNum(r.close_price ?? r.closePrice, 0);

  const sl = asNum(r.sl ?? r.stop_loss ?? r.sl_price, 0);
  const tp1 = asNum(r.tp1 ?? r.tp_1 ?? r.take_profit_1, 0);
  const tp2Field = r.tp2 ?? r.tp_2 ?? r.take_profit_2;
  const tp2: number | null = tp2Field === null || tp2Field === undefined
    ? null
    : asNum(tp2Field, 0);

  const slPips = asNum(r.sl_pips ?? r.pips, 0);
  const tp1Pips = asNum(r.tp1_pips ?? r.tp_1_pips, slPips > 0 ? slPips * 2 : 0);
  const rrNet = asNum(r.rr_net ?? r.rrNet ?? r.rr, 0);
  const atrValue = asNum(r.atr ?? r.atr_value, 0);
  const adxValue = asNum(r.adx ?? r.adx_value, 0);

  const entryTime = asStr(r.open_time ?? r.entry_time ?? r.entryTime, new Date().toISOString());
  const closeTime = asISO(r.close_time ?? r.closeTime);
  const durationMin: number | null = closeTime
    ? asNum(r.duration_min ?? r.duration_minutes,
      Math.max(0, Math.round((new Date(closeTime).getTime() - new Date(entryTime).getTime()) / 60_000)))
    : (r.duration_min !== undefined ? asNum(r.duration_min) : null);

  // Derive result from explicit field, else from `win` boolean, else from profit sign.
  const profitNetRaw = r.profit ?? r.profit_net ?? r.net_profit ?? r.pnl ?? r.profitNet;
  const profitNet: number | null = profitNetRaw === null || profitNetRaw === undefined
    ? null
    : asNum(profitNetRaw, 0);

  let result: TradeResult | null = null;
  if (typeof r.result === 'string') {
    result = pick(r.result, RESULTS, status === 'CLOSED' ? 'BREAKEVEN' : null as unknown as TradeResult);
    if (result === null) result = null;
  } else if (typeof r.win === 'boolean') {
    result = r.win ? 'WIN' : 'LOSS';
  } else if (profitNet !== null && status === 'CLOSED') {
    if (Math.abs(profitNet) < 0.01) result = 'BREAKEVEN';
    else result = profitNet > 0 ? 'WIN' : 'LOSS';
  }

  // Derive rMultiple from rr_net or from profit if risk unknown.
  const rMultipleRaw = r.r_multiple ?? r.rMultiple ?? r.r_value;
  const rMultiple: number | null = rMultipleRaw !== null && rMultipleRaw !== undefined
    ? asNum(rMultipleRaw, 0)
    : (status === 'CLOSED' && rrNet > 0 && profitNet !== null)
      ? Number((profitNet / (Math.abs(profitNet) > 0 ? Math.abs(profitNet) / Math.max(rrNet, 0.0001) : 1)).toFixed(2))
      : null;

  const closeReason: CloseReason | null =
    typeof r.exit_reason === 'string' || typeof r.close_reason === 'string'
      ? pick(r.exit_reason ?? r.close_reason, CLOSE_REASONS, 'MANUAL')
      : null;

  const checklist: ChecklistResult[] = asArr<Raw>(r.checklist).map((c, i) => {
    const item = c ?? {};
    return {
      point: asNum((item as Raw).point, i + 1),
      label: asStr((item as Raw).label ?? (item as Raw).text, `Checklist ${i + 1}`),
      passed: asBool((item as Raw).passed, false),
      detail: (item as Raw).detail !== undefined ? asStr((item as Raw).detail) : undefined,
    };
  });

  const aiAnalysis: string | null =
    typeof r.ai_analysis === 'string' || typeof r.aiAnalysis === 'string'
      ? asStr(r.ai_analysis ?? r.aiAnalysis)
      : null;

  return {
    id: asStr(r.id ?? r.ticket ?? r._id, `trade-${asNum(r.ticket, 0)}`),
    ticket: asNum(r.ticket ?? r.position_id ?? r.order_ticket, 0),
    symbol: asStr(r.symbol ?? r.pair, ''),
    direction,
    volume: asNum(r.volume ?? r.lots ?? r.size, 0),
    openPrice,
    closePrice,
    sl,
    tp1,
    tp2,
    slPips,
    tp1Pips,
    rrNet,
    atrValue,
    adxValue,
    regime,
    setupType,
    session,
    status,
    result,
    rMultiple,
    profitNet,
    closeReason,
    entryTime,
    closeTime,
    durationMin,
    checklist,
    aiAnalysis,
  };
}

// --------------------------------------------------------------------------- //
// Signal
// Map: sl/tp1/tp2 to slPrice/tp1Price/tp2Price, derive status from executed bool,
//      checklistPassed from checklist array length.
// --------------------------------------------------------------------------- //

export function transformSignal(raw: unknown): Signal {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const direction = pick(r.direction ?? r.side, DIRECTIONS, 'BUY');
  const setupType = pick(r.setup_type ?? r.setup ?? r.strategy, SETUPS, 'VWAP_BOUNCE');
  const session = pick(r.session_name ?? r.session, SESSIONS, 'SKIP');
  const regime = pick(r.regime, REGIMES, 'TRANSITION');
  const timeframe = asStr(r.timeframe ?? r.tf, 'M5');

  const checklist: ChecklistResult[] = asArr<Raw>(r.checklist).map((c, i) => {
    const item = (c ?? {}) as Raw;
    return {
      point: asNum(item.point, i + 1),
      label: asStr(item.label ?? item.text, `Checklist ${i + 1}`),
      passed: asBool(item.passed, false),
      detail: item.detail !== undefined ? asStr(item.detail) : undefined,
    };
  });

  // Derive checklistPassed from explicit field or count of passed items.
  const checklistPassed: number =
    r.checklist_passed !== undefined && r.checklist_passed !== null
      ? asNum(r.checklist_passed, 0)
      : checklist.filter((c) => c.passed).length;

  // Derive status from explicit field, else from `executed`/`skipped`/`expired` booleans.
  let status: SignalStatus;
  if (typeof r.status === 'string') {
    status = pick(r.status, SIGNAL_STATUSES, 'ACTIVE');
  } else if (asBool(r.executed, false)) {
    status = 'EXECUTED';
  } else if (asBool(r.skipped, false) || r.skip_reason !== undefined) {
    status = 'SKIPPED';
  } else if (asBool(r.expired, false)) {
    status = 'EXPIRED';
  } else {
    status = 'ACTIVE';
  }

  const reason: string | null =
    typeof r.reason === 'string' || typeof r.skip_reason === 'string'
      ? asStr(r.reason ?? r.skip_reason)
      : null;

  const aiVerdict: string | null =
    typeof r.ai_verdict === 'string' || typeof r.ai_analysis === 'string'
      ? asStr(r.ai_verdict ?? r.ai_analysis)
      : null;

  const entryPrice = asNum(r.entry_price ?? r.entryPrice ?? r.price, 0);
  const slPrice = asNum(r.sl ?? r.sl_price ?? r.stop_loss, 0);
  const tp1Price = asNum(r.tp1 ?? r.tp_1 ?? r.take_profit_1 ?? r.tp1_price, 0);
  const tp2Price = asNum(r.tp2 ?? r.tp_2 ?? r.take_profit_2 ?? r.tp2_price, 0);
  const slPips = asNum(r.sl_pips, 0);
  const tp1Pips = asNum(r.tp1_pips, slPips > 0 ? slPips * 2 : 0);
  const rrNet = asNum(r.rr_net ?? r.rrNet ?? r.rr, 0);
  const atrValue = asNum(r.atr ?? r.atr_value, 0);
  const adxValue = asNum(r.adx ?? r.adx_value, 0);
  const vwapValue = asNum(r.vwap ?? r.vwap_value, 0);
  const ema9Value = asNum(r.ema9 ?? r.ema_9 ?? r.ema9_value, 0);
  const ema21Value = asNum(r.ema21 ?? r.ema_21 ?? r.ema21_value, 0);

  const createdAt = asStr(r.created_at ?? r.createdAt, new Date().toISOString());
  const expiresAt = asISO(r.expires_at ?? r.expiresAt);

  return {
    id: asStr(r.id ?? r._id, `signal-${Date.now()}`),
    symbol: asStr(r.symbol ?? r.pair, ''),
    direction,
    timeframe,
    entryPrice,
    slPrice,
    tp1Price,
    tp2Price,
    slPips,
    tp1Pips,
    rrNet,
    atrValue,
    adxValue,
    vwapValue,
    ema9Value,
    ema21Value,
    regime,
    setupType,
    session,
    checklistPassed,
    status,
    reason,
    aiVerdict,
    createdAt,
    expiresAt,
    checklist,
  };
}

// --------------------------------------------------------------------------- //
// NewsEvent
// event_time→eventTime, symbol→ticker+currency, derive blackoutStart/End for HIGH impact.
// --------------------------------------------------------------------------- //

const NEWS_BLACKOUT_MINUTES = 15;

export function transformNewsEvent(raw: unknown): NewsEvent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const impact = pick(r.impact ?? r.importance, IMPACTS, 'MEDIUM');
  const symbol = asStr(r.symbol ?? r.ticker, '');
  const currency = asStr(r.currency, symbol.length >= 3 ? symbol.slice(0, 3) : '');
  const country = asStr(r.country ?? r.region, '');

  const eventTime = asStr(r.event_time ?? r.eventTime ?? r.time ?? r.date, new Date().toISOString());

  // Derive blackout window only for HIGH impact news, unless explicitly provided.
  const explicitBlackoutStart = asISO(r.blackout_start ?? r.blackoutStart);
  const explicitBlackoutEnd = asISO(r.blackout_end ?? r.blackoutEnd);

  let blackoutStart: string | null = explicitBlackoutStart;
  let blackoutEnd: string | null = explicitBlackoutEnd;
  if (impact === 'HIGH' && !blackoutStart && !blackoutEnd) {
    try {
      const t = new Date(eventTime).getTime();
      blackoutStart = new Date(t - NEWS_BLACKOUT_MINUTES * 60_000).toISOString();
      blackoutEnd = new Date(t + NEWS_BLACKOUT_MINUTES * 60_000).toISOString();
    } catch {
      blackoutStart = null;
      blackoutEnd = null;
    }
  }

  return {
    id: asStr(r.id ?? r._id, `news-${Date.now()}`),
    ticker: symbol,
    title: asStr(r.title ?? r.event ?? r.headline, ''),
    impact,
    country,
    currency,
    eventTime,
    actual: typeof r.actual === 'string' || typeof r.actual === 'number' ? asStr(r.actual) : null,
    forecast: typeof r.forecast === 'string' || typeof r.forecast === 'number' ? asStr(r.forecast) : null,
    previous: typeof r.previous === 'string' || typeof r.previous === 'number' ? asStr(r.previous) : null,
    source: asStr(r.source ?? r.provider, 'tiingo'),
    blackoutStart,
    blackoutEnd,
  };
}

// --------------------------------------------------------------------------- //
// ChartData
// Convert single vwap/atr/rsi floats to arrays (repeat value for each candle),
// unwrap adx object {adx, plus_di, minus_di} → adx array,
// unwrap bollinger {upper, middle, lower} → bbUpper/bbMiddle/bbLower arrays.
// --------------------------------------------------------------------------- //

function toPerCandleArray(value: unknown, count: number, def = 0): number[] {
  if (Array.isArray(value)) {
    return value.map((v) => asNum(v, def));
  }
  if (value === null || value === undefined) return new Array(count).fill(def);
  // Single scalar → repeat for each candle.
  const scalar = asNum(value, def);
  return new Array(Math.max(count, 0)).fill(scalar);
}

function unwrapAdxArray(adxRaw: unknown, count: number): number[] {
  if (Array.isArray(adxRaw)) {
    // Already an array — but it might be array of objects [{adx, plus_di, ...}].
    if (adxRaw.length > 0 && typeof adxRaw[0] === 'object' && adxRaw[0] !== null) {
      return adxRaw.map((v) => asNum((v as Raw).adx, 0));
    }
    return adxRaw.map((v) => asNum(v, 0));
  }
  if (adxRaw && typeof adxRaw === 'object') {
    // Single object {adx, plus_di, minus_di} → repeat scalar across candles.
    const scalar = asNum((adxRaw as Raw).adx, 0);
    return new Array(Math.max(count, 0)).fill(scalar);
  }
  return toPerCandleArray(adxRaw, count, 0);
}

function unwrapBollinger(
  bbRaw: unknown,
  count: number,
): { upper: number[]; middle: number[]; lower: number[] } {
  const def = new Array(Math.max(count, 0)).fill(0);
  if (bbRaw && typeof bbRaw === 'object' && !Array.isArray(bbRaw)) {
    const bb = bbRaw as Raw;
    const upperScalar = asNum(bb.upper ?? bb.bb_upper, 0);
    const middleScalar = asNum(bb.middle ?? bb.bb_middle ?? bb.sma, 0);
    const lowerScalar = asNum(bb.lower ?? bb.bb_lower, 0);
    if (Array.isArray(bb.upper)) {
      return {
        upper: bb.upper.map((v) => asNum(v, 0)),
        middle: (Array.isArray(bb.middle) ? bb.middle : []).map((v) => asNum(v, 0)),
        lower: (Array.isArray(bb.lower) ? bb.lower : []).map((v) => asNum(v, 0)),
      };
    }
    return {
      upper: new Array(count).fill(upperScalar),
      middle: new Array(count).fill(middleScalar),
      lower: new Array(count).fill(lowerScalar),
    };
  }
  return { upper: def.slice(), middle: def.slice(), lower: def.slice() };
}

export function transformChartData(raw: unknown): ChartData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;

  const candles: Candle[] = asArr<Raw>(r.candles ?? r.candle_list ?? r.ohlcv).map((c) => {
    const item = (c ?? {}) as Raw;
    return {
      time: asStr(item.time ?? item.timestamp ?? item.date, new Date().toISOString()),
      open: asNum(item.open, 0),
      high: asNum(item.high, 0),
      low: asNum(item.low, 0),
      close: asNum(item.close, 0),
      volume: asNum(item.volume ?? item.vol, 0),
    };
  });
  const count = candles.length;

  const indRaw = (r.indicators ?? r.indicator_data ?? r) as Raw;

  const ema9 = toPerCandleArray(indRaw.ema9 ?? indRaw.ema_9, count, 0);
  const ema21 = toPerCandleArray(indRaw.ema21 ?? indRaw.ema_21, count, 0);
  const vwap = toPerCandleArray(indRaw.vwap ?? indRaw.vwap_value, count, 0);
  const atr = toPerCandleArray(indRaw.atr ?? indRaw.atr_value, count, 0);
  const adx = unwrapAdxArray(indRaw.adx, count);
  const rsi = toPerCandleArray(indRaw.rsi ?? indRaw.rsi_value, count, 50);

  const bb = unwrapBollinger(indRaw.bollinger ?? indRaw.bbands ?? indRaw.bb, count);
  // Fallback: maybe the arrays are at the top level (bb_upper / bbUpper / etc).
  const bbUpper = bb.upper.length === count
    ? bb.upper
    : toPerCandleArray(indRaw.bb_upper ?? indRaw.bbUpper ?? indRaw.bollinger_upper, count, 0);
  const bbMiddle = bb.middle.length === count
    ? bb.middle
    : toPerCandleArray(indRaw.bb_middle ?? indRaw.bbMiddle ?? indRaw.bollinger_middle, count, 0);
  const bbLower = bb.lower.length === count
    ? bb.lower
    : toPerCandleArray(indRaw.bb_lower ?? indRaw.bbLower ?? indRaw.bollinger_lower, count, 0);

  const indicators: IndicatorData = {
    ema9,
    ema21,
    vwap,
    atr,
    adx,
    rsi,
    bbUpper,
    bbMiddle,
    bbLower,
  };

  const sessionMarkers = asArr<Raw>(r.session_markers ?? r.sessions).map((m) => {
    const item = (m ?? {}) as Raw;
    return {
      time: asStr(item.time ?? item.timestamp, new Date().toISOString()),
      session: pick(item.session ?? item.session_name, SESSIONS, 'SKIP'),
      trade: asBool(item.trade ?? item.tradable, false),
    };
  });

  const signalMarkers = asArr<Raw>(r.signal_markers ?? r.signals ?? r.markers).map((m) => {
    const item = (m ?? {}) as Raw;
    return {
      time: asStr(item.time ?? item.timestamp, new Date().toISOString()),
      type: pick(item.type ?? item.direction, DIRECTIONS, 'BUY'),
      price: asNum(item.price, 0),
    };
  });

  return {
    symbol: asStr(r.symbol ?? r.pair, ''),
    timeframe: asStr(r.timeframe ?? r.tf, 'M5'),
    candles,
    indicators,
    sessionMarkers,
    signalMarkers,
  };
}

// --------------------------------------------------------------------------- //
// BotState
// is_running→status (RUNNING/STOPPED), kill_switch→killSwitch,
// derive mt5Connected/ollamaConnected/tiingoConnected.
// --------------------------------------------------------------------------- //

export function transformBotState(raw: unknown): BotState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;

  let status: BotStatus;
  if (typeof r.status === 'string') {
    status = pick(r.status, BOT_STATUSES, 'STOPPED');
  } else if (asBool(r.is_running, false)) {
    status = 'RUNNING';
  } else if (asBool(r.kill_switch, false)) {
    status = 'KILLED';
  } else if (asBool(r.paused, false)) {
    status = 'PAUSED';
  } else {
    status = 'STOPPED';
  }

  const totalTrades = asNum(r.total_trades ?? r.trades_total, 0);
  const totalWins = asNum(r.total_wins ?? r.wins, 0);
  const totalLosses = asNum(r.total_losses ?? r.losses, 0);

  return {
    status,
    autoTrade: asBool(r.auto_trade ?? r.autoTrade ?? r.autotrade, false),
    killSwitch: asBool(r.kill_switch ?? r.killSwitch ?? r.kill, false),
    lastStartedAt: asISO(r.last_started_at ?? r.started_at ?? r.lastStartedAt),
    lastStoppedAt: asISO(r.last_stopped_at ?? r.stopped_at ?? r.lastStoppedAt),
    totalTrades,
    totalWins,
    totalLosses,
    uptimeSec: asNum(r.uptime_sec ?? r.uptime ?? r.uptime_seconds, 0),
    mt5Connected: asBool(r.mt5_connected ?? r.mt5Connected ?? r.mt5, false),
    ollamaConnected: asBool(r.ollama_connected ?? r.ollamaConnected ?? r.ollama, false),
    tiingoConnected: asBool(r.tiingo_connected ?? r.tiingoConnected ?? r.tiingo, false),
  };
}

// --------------------------------------------------------------------------- //
// DailyRisk
// --------------------------------------------------------------------------- //

export function transformDailyRisk(raw: unknown): DailyRisk | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const startingBalance = asNum(r.starting_balance ?? r.start_balance, 0);
  const currentBalance = asNum(r.current_balance ?? r.balance, startingBalance);
  const dailyPnl = asNum(r.daily_pnl ?? r.pnl ?? r.profit, currentBalance - startingBalance);
  return {
    date: asStr(r.date, new Date().toISOString().split('T')[0]),
    startingBalance,
    currentBalance,
    dailyPnl,
    dailyPnlPct: asNum(r.daily_pnl_pct ?? r.pnl_pct,
      startingBalance > 0 ? dailyPnl / startingBalance : 0),
    tradesCount: asNum(r.trades_count ?? r.daily_trades ?? r.trades, 0),
    winsCount: asNum(r.wins_count ?? r.wins, 0),
    lossesCount: asNum(r.losses_count ?? r.losses, 0),
    softStopHit: asBool(r.soft_stop_hit ?? r.soft_stop, false),
    hardStopHit: asBool(r.hard_stop_hit ?? r.hard_stop, false),
    botLocked: asBool(r.bot_locked ?? r.locked ?? r.lock, false),
    lockReason: typeof r.lock_reason === 'string' ? asStr(r.lock_reason) : null,
  };
}

// --------------------------------------------------------------------------- //
// SystemStatus
// bot_state→bot, mt5_available→mt5Available, open_positions→openPositionsCount,
// daily_trades→todayTradesCount, add default dailyRisk, weeklyPnlPct, overallPnlPct,
// account via transformAccount, bot via transformBotState.
// --------------------------------------------------------------------------- //

export function transformSystemStatus(raw: unknown): SystemStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const botRaw = r.bot_state ?? r.bot ?? r.bot_state_data ?? r;
  const accountRaw = r.account ?? r.account_info ?? r.mt5_account ?? null;

  const dailyRisk = transformDailyRisk(r.daily_risk ?? r.dailyRisk ?? r.daily) ?? {
    date: new Date().toISOString().split('T')[0],
    startingBalance: asNum((accountRaw as Raw | null)?.balance, 0),
    currentBalance: asNum((accountRaw as Raw | null)?.equity ?? (accountRaw as Raw | null)?.balance, 0),
    dailyPnl: 0,
    dailyPnlPct: 0,
    tradesCount: asNum(r.daily_trades ?? r.today_trades, 0),
    winsCount: 0,
    lossesCount: 0,
    softStopHit: false,
    hardStopHit: false,
    botLocked: false,
    lockReason: null,
  };

  return {
    bot: transformBotState(botRaw),
    account: transformAccount(accountRaw),
    dailyRisk,
    openPositionsCount: asNum(r.open_positions ?? r.open_positions_count, 0),
    todayTradesCount: asNum(r.daily_trades ?? r.today_trades ?? r.todays_trades, 0),
    weeklyPnlPct: asNum(r.weekly_pnl_pct ?? r.weekly_pnl, 0),
    overallPnlPct: asNum(r.overall_pnl_pct ?? r.overall_pnl ?? r.total_pnl_pct, 0),
    mt5Available: asBool(r.mt5_available ?? r.mt5, false),
    ollamaAvailable: asBool(r.ollama_available ?? r.ollama, false),
    tiingoAvailable: asBool(r.tiingo_available ?? r.tiingo, false),
    pythonBackendUrl: typeof r.python_backend_url === 'string' ? asStr(r.python_backend_url) : null,
    demoMode: asBool(r.demo_mode ?? r.demo, false),
  };
}

// --------------------------------------------------------------------------- //
// AI chat / analyze response adapters — backend Pydantic shapes.
// --------------------------------------------------------------------------- //

export interface AiChatResponse {
  reply?: string;
  response?: string;
  message?: string;
  text?: string;
  answer?: string;
}

export function transformAiChatResponse(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const r = raw as Raw;
  return asStr(
    r.reply ?? r.response ?? r.message ?? r.text ?? r.answer ?? r.content,
    '',
  );
}

export interface AiAnalyzeResponse {
  verdict?: string;
  compliant?: boolean;
  score?: number;
  suggestion?: string;
  reason?: string;
  analysis?: string;
  text?: string;
}

export function transformAiAnalyzeResponse(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const r = raw as Raw;

  if (typeof r.verdict === 'string' && r.verdict.length > 0) {
    return r.verdict;
  }
  if (typeof r.analysis === 'string' && r.analysis.length > 0) {
    return r.analysis;
  }
  if (typeof r.text === 'string' && r.text.length > 0) {
    return r.text;
  }

  // Format a verdict from structured fields: {compliant, score, suggestion, reason}
  const hasCompliant = r.compliant !== undefined && r.compliant !== null;
  if (hasCompliant || typeof r.score === 'number' || typeof r.suggestion === 'string') {
    const compliant = asBool(r.compliant, false);
    const score = asNum(r.score, 0);
    const suggestion = asStr(r.suggestion ?? r.reason, '');
    const tag = compliant ? 'COMPLIANT' : 'NON-COMPLIANT';
    const tail = suggestion ? ` ${suggestion}` : '';
    return `${tag} — Score: ${score}/100.${tail}`;
  }

  return '';
}

// --------------------------------------------------------------------------- //
// Settings serialiser — frontend nested Settings → backend flat dict.
// --------------------------------------------------------------------------- //

export function serializeSettings(settings: unknown): Record<string, string> {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Raw;
  const mt5 = (s.mt5 ?? {}) as Raw;
  const ollama = (s.ollama ?? {}) as Raw;
  const tiingo = (s.tiingo ?? {}) as Raw;
  const risk = (s.risk ?? {}) as Raw;
  const pairs = asArr<unknown>(s.pairs);

  const flat: Record<string, string> = {};

  // MT5
  flat['mt5_login'] = asStr(mt5.login, '');
  flat['mt5_password'] = asStr(mt5.password, '');
  flat['mt5_server'] = asStr(mt5.server, '');
  flat['mt5_broker'] = asStr(mt5.broker, '');

  // Ollama
  flat['ollama_url'] = asStr(ollama.url, 'http://localhost:11434');
  flat['ollama_model'] = asStr(ollama.model, 'llama3.2:latest');

  // Tiingo
  flat['tiingo_api_key'] = asStr(tiingo.apiKey ?? tiingo.api_key, '');

  // Risk params
  flat['risk_pct_per_trade'] = String(asNum(risk.riskPctPerTrade ?? risk.risk_pct_per_trade, 0.01));
  flat['max_positions'] = String(asNum(risk.maxPositions ?? risk.max_positions, 3));
  flat['max_daily_trades'] = String(asNum(risk.maxDailyTrades ?? risk.max_daily_trades, 5));
  flat['rr_net_min'] = String(asNum(risk.rrNetMin ?? risk.rr_net_min, 2.0));
  flat['soft_stop_pct'] = String(asNum(risk.softStopPct ?? risk.soft_stop_pct, -0.01));
  flat['hard_stop_pct'] = String(asNum(risk.hardStopPct ?? risk.hard_stop_pct, -0.02));
  flat['weekly_stop_pct'] = String(asNum(risk.weeklyStopPct ?? risk.weekly_stop_pct, -0.04));
  flat['overall_stop_pct'] = String(asNum(risk.overallStopPct ?? risk.overall_stop_pct, -0.10));

  // Pairs
  flat['pairs'] = pairs.map((p) => asStr(p, '')).filter(Boolean).join(',');

  // Python API URL passthrough
  if (typeof s.pythonApiUrl === 'string' || typeof s.python_api_url === 'string') {
    flat['python_api_url'] = asStr(s.pythonApiUrl ?? s.python_api_url, '');
  }

  return flat;
}
