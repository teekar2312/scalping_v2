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

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 1 #10: Audit log entries
// --------------------------------------------------------------------------- //

export type AuditEventType =
  | 'SIGNAL'
  | 'ORDER_PLACED'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'SL_HIT'
  | 'KILL_SWITCH'
  | 'RISK_GATE_BLOCKED'
  | 'AI_REJECTED'
  | 'CONNECTION_LOST'
  | 'RECOVERY'
  | 'COOLDOWN_ENGAGED'
  | 'MARGIN_WARNING';

export type AuditSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  event_type: string;
  symbol?: string | null;
  ticket?: number | null;
  detail_json?: string | null;
  detail?: Record<string, unknown> | null;
  severity: string;
}

export interface AuditLogResponse {
  count: number;
  events: AuditLogEntry[];
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 3 #19: Equity curve time series
// --------------------------------------------------------------------------- //

export interface EquityCurvePoint {
  id?: number;
  timestamp: string;
  balance: number;
  equity: number;
  floating_pnl: number;
  daily_pnl_pct: number;
  drawdown_pct: number;
  peak_equity?: number | null;
}

export interface EquityCurveResponse {
  count: number;
  samples: EquityCurvePoint[];
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 3 #20-21: Performance attribution + compliance
// --------------------------------------------------------------------------- //

export interface SessionStats {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  r_net: number;
  profit: number;
}

export interface PerformanceAttribution {
  by_session: Record<string, SessionStats>;
  by_setup: Record<string, SessionStats>;
  by_regime: Record<string, SessionStats>;
  by_hour: Record<string, SessionStats>;
  by_day: Record<string, SessionStats>;
  by_pair: Record<string, SessionStats>;
}

export interface ComplianceScore {
  overall_pct: number;
  checklist_pass_rate: number;
  rr_compliance_rate: number;
  ai_compliance_rate: number;
  total_trades: number;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 3 #22: Emotional-state logging
// --------------------------------------------------------------------------- //

export type EmotionalState = 'SABAR' | 'FOMO' | 'FRUSTRASI' | 'OVERCONFIDENT';

export interface EmotionalSummaryResponse {
  total_logged: number;
  by_state: Record<string, number>;
  trades: EmotionalTradeEntry[];
}

export interface EmotionalTradeEntry {
  id: number;
  ticket: number;
  symbol: string;
  emotional_state: string;
  emotional_note?: string | null;
  profit?: number | null;
}

export interface LogEmotionRequest {
  state: EmotionalState;
  note?: string;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #15: Pre-live checklist
// --------------------------------------------------------------------------- //

export interface PreLiveCheck {
  mt5: { ok: boolean; login?: number; server?: string; balance?: number; message?: string };
  ollama: { ok: boolean; model?: string; url?: string; message?: string };
  tiingo: { ok: boolean; events_cached?: number; message?: string; warning?: string };
  config: { ok: boolean; warnings: string[] };
  db: { ok: boolean; trade_count?: number; message?: string };
  time_sync: { ok: boolean; drift_seconds?: number; message?: string };
  overall_ready: boolean;
  blocking_issues: string[];
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 4 #27: Time sync (NTP drift)
// --------------------------------------------------------------------------- //

export interface TimeSyncResponse {
  server_time: string;
  ntp_time: string | null;
  drift_seconds: number;
  ok: boolean;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 4 #24: DB backup / restore
// --------------------------------------------------------------------------- //

export interface RestoreResponse {
  ok: boolean;
  restored_to: string;
  size_bytes: number;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 4 #25-26: PDF / tax export
// --------------------------------------------------------------------------- //

export interface RiskDisclosureResponse {
  text: string;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 4 #29-30: Real probes (test buttons)
// --------------------------------------------------------------------------- //

export interface ServiceTestResult {
  ok: boolean;
  message: string;
  latency_ms: number;
  balance?: number;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #11: Backtest
// --------------------------------------------------------------------------- //

export interface BacktestRequest {
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  initial_balance?: number;
}

export interface BacktestTrade {
  ticket?: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  volume: number;
  open_price: number;
  close_price: number;
  sl: number;
  tp: number;
  open_time: string;
  close_time: string;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
  r_multiple: number;
  profit: number;
  pips?: number;
  setup_type?: string;
  session?: string;
}

export interface BacktestResult {
  id: number;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  initial_balance: number;
  final_balance: number;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  r_net_avg: number;
  profit_factor: number;
  max_drawdown_pct: number;
  compliance_score_pct: number;
  trades: BacktestTrade[];
  metrics?: Record<string, number>;
  created_at?: string;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #17: Holiday calendar
// --------------------------------------------------------------------------- //

export interface HolidayEntry {
  date: string;
  name: string;
  country?: string;
  closed?: boolean;
}

export interface HolidaysResponse {
  year: number | null;
  holidays: HolidayEntry[];
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #12: Bot mode (LIVE / PAPER / DRY)
// --------------------------------------------------------------------------- //

export type BotMode = 'LIVE' | 'PAPER' | 'DRY';

export interface BotModeState {
  mode: string;
  paper_mode: boolean;
  dry_run: boolean;
}

// --------------------------------------------------------------------------- //
// Streak / cooldown status (derived from bot state)
// --------------------------------------------------------------------------- //

export interface StreakStatus {
  consecutive_losses: number;
  consecutive_wins: number;
  cooldown_active: boolean;
  cooldown_until?: string | null;
  cooldown_reason?: string | null;
}

// --------------------------------------------------------------------------- //
// WebSocket events pushed by /ws
// --------------------------------------------------------------------------- //

export type WSEventType =
  | 'status'
  | 'signal'
  | 'order_placed'
  | 'position_closed'
  | 'tp1_hit'
  | 'tp2_hit'
  | 'kill_switch_engaged'
  | 'risk_gate_blocked'
  | 'cooldown_engaged'
  | 'margin_warning'
  | 'tick'
  | 'pong';

export interface WSEvent<T = unknown> {
  type: WSEventType;
  data?: T;
  symbol?: string;
  bid?: number;
  ask?: number;
  spread?: number;
  ts?: string;
  reason?: string;
  until?: string;
  level?: number;
  ticket?: number;
}

export interface TickPrice {
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
}

// --------------------------------------------------------------------------- //
// Sprint 5-8: Auth, security, regulatory, advanced analytics
// --------------------------------------------------------------------------- //

export interface AuthUser {
  username: string;
  role: 'admin' | 'trader' | 'viewer';
  login_at?: string;
  ip?: string;
}

export interface AuthLoginResponse {
  api_key: string;
  expires_at: string | null;
  user: AuthUser;
}

export interface AuthMeResponse {
  user: AuthUser;
  api_key_preview: string;
  expires_at: string | null;
}

export interface ApiKeyInfo {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used?: string | null;
  expires_at?: string | null;
}

export interface ApiKeyListResponse {
  keys: ApiKeyInfo[];
}

export interface CreateApiKeyResponse {
  id: string;
  key: string; // Only returned once at creation time
  label: string;
  created_at: string;
}

export interface SecretMetadata {
  name: string;
  updated_at: string;
  set_by?: string;
}

export interface SecretListResponse {
  secrets: SecretMetadata[];
}

// Risk disclosure acknowledgment (full status, beyond text-only)
export interface RiskDisclosureStatus {
  acknowledged: boolean;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  expires_at: string | null;
  days_remaining: number | null;
  requires_reack: boolean;
}

export interface RiskDisclosureAckRequest {
  version: string;
  accepted_rules: boolean;
  accepted_risks: boolean;
}

export interface RiskDisclosureAckResponse {
  ok: boolean;
  acknowledged_at: string;
  expires_at: string;
}

// Audit-log chain integrity verification (Sprint 6 — hash chaining)
export interface AuditChainVerifyResponse {
  valid: boolean;
  total_rows: number;
  verified_rows: number;
  broken_at_row: number | null;
  broken_at_id: number | null;
  expected_hash: string | null;
  actual_hash: string | null;
  verified_at: string;
}

// Regulatory (BAPPEBTI + tax export info)
export interface BappebtiStatus {
  registered: boolean;
  broker_name: string;
  bappebti_license: string | null;
  status: 'REGISTERED' | 'PENDING' | 'NOT_REGISTERED' | 'UNKNOWN';
  last_checked: string;
  warnings: string[];
}

// Trade reconstruction (tick-level timeline)
export type TradeEventType =
  | 'ENTRY'
  | 'SL_MOVE'
  | 'BE_MOVE'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TRAILING'
  | 'PARTIAL_CLOSE'
  | 'EXIT'
  | 'MANUAL_CLOSE';

export interface TradeEvent {
  timestamp: string;
  type: TradeEventType;
  price: number;
  volume?: number;
  sl_old?: number | null;
  sl_new?: number | null;
  reason?: string;
  ticket?: number;
}

export interface TradeReconstruction {
  ticket: number;
  symbol: string;
  direction: TradeDirection;
  entry_time: string;
  entry_price: number;
  initial_volume: number;
  exit_time: string | null;
  exit_price: number | null;
  close_reason: CloseReason | null;
  events: TradeEvent[];
  final_pnl: number | null;
  r_multiple: number | null;
}

// VaR / CVaR analytics (Sprint 7 — advanced risk analytics)
export type VaRMethod = 'historical' | 'parametric';

export interface RiskMetrics {
  var_95: number; // negative number = potential loss
  var_99: number;
  cvar_95: number;
  cvar_99: number;
  method: VaRMethod;
  period_days: number;
  confidence: number; // 0.95 or 0.99
  sample_size: number;
  currency: string;
  computed_at: string;
}

// Stress test (Sprint 7 — black swan scenario replay)
export type StressScenarioId =
  | 'SNB_UNPEG_2015'
  | 'BREXIT_2016'
  | 'COVID_CRASH_2020'
  | 'GFC_2008';

export interface StressScenario {
  id: StressScenarioId;
  name: string;
  description: string;
  date: string;
  multiplier: number; // volatility multiplier applied to historical returns
  pip_jump: number; // typical sudden pip move for the scenario
  asset_class: string;
}

export interface StressTestRequest {
  scenario: StressScenarioId;
  initial_balance?: number;
  position_value?: number;
  pairs?: string[];
}

export interface StressTestResult {
  id: string;
  scenario: StressScenarioId;
  scenario_name: string;
  multiplier: number;
  survival: 'PASS' | 'FAIL';
  original_max_dd_pct: number;
  stressed_max_dd_pct: number;
  original_final_balance: number;
  stressed_final_balance: number;
  balance_after: number;
  worst_pip_move: number;
  triggered_hard_stop: boolean;
  triggered_kill_switch: boolean;
  margin_call: boolean;
  duration_seconds: number;
  computed_at: string;
}

// Monte Carlo simulation (Sprint 7 — backtest robustness)
export interface MonteCarloRequest {
  iterations: number; // 100 / 500 / 1000
  trade_period_days?: number;
  initial_balance?: number;
  symbol?: string;
  seed?: number;
}

export interface MonteCarloResult {
  id: string;
  iterations: number;
  survival_rate_pct: number; // % of runs that didn't blow up
  median_final_balance: number;
  p5_final_balance: number;
  p95_final_balance: number;
  median_max_dd_pct: number;
  p95_max_dd_pct: number;
  mean_final_balance: number;
  worst_final_balance: number;
  best_final_balance: number;
  blow_ups: number; // runs ending below 50% of initial
  // Histogram bins (final balance distribution)
  distribution: Array<{ bucket: string; count: number; lower: number; upper: number }>;
  // Equity curve fan chart: one median + P5/P95 band per step
  fan: Array<{
    step: number;
    median: number;
    p5: number;
    p95: number;
  }>;
  computed_at: string;
}

// Walk-forward analysis (Sprint 7 — parameter stability)
export interface WalkForwardRequest {
  symbol?: string;
  in_sample_window_days?: number; // e.g. 60
  out_sample_window_days?: number; // e.g. 30
  initial_balance?: number;
}

export interface WalkForwardWindow {
  window_index: number;
  in_sample_start: string;
  in_sample_end: string;
  out_sample_start: string;
  out_sample_end: string;
  in_sample_pf: number;
  out_sample_pf: number;
  degradation_pct: number;
  in_sample_trades: number;
  out_sample_trades: number;
  robust: boolean;
}

export interface WalkForwardResult {
  id: string;
  windows: WalkForwardWindow[];
  avg_degradation_pct: number;
  stable: boolean;
  verdict: string;
  total_windows: number;
  robust_windows: number;
  computed_at: string;
}

// Kelly criterion (Sprint 7 — position sizing)
export interface KellyStats {
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  f_kelly: number; // full Kelly fraction
  f_quarter_kelly: number; // quarter Kelly (recommended)
  current_risk_pct: number;
  recommended_risk_pct: number;
  sample_trades: number;
  use_kelly: boolean;
  note?: string;
}

// Slippage analytics (Sprint 7)
export interface SlippageStats {
  total_fills: number;
  avg_slippage_pips: number;
  p50_pips: number;
  p95_pips: number;
  p99_pips: number;
  worst_pips: number;
  by_symbol: Array<{ symbol: string; fills: number; avg_pips: number; p95_pips: number }>;
  time_series: Array<{ timestamp: string; avg_pips: number; p95_pips: number }>;
  alert: boolean;
  threshold_pips: number;
}

// Latency analytics (Sprint 7)
export interface LatencyStats {
  total_requests: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  worst_ms: number;
  by_endpoint: Array<{ endpoint: string; requests: number; avg_ms: number; p95_ms: number }>;
  time_series: Array<{ timestamp: string; avg_ms: number; p95_ms: number }>;
  alert: boolean;
  threshold_ms: number;
}

// Health & readiness (Sprint 8 — DevOps)
export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheck {
  name: string;
  status: HealthState;
  latency_ms?: number;
  message?: string;
}

export interface ReadinessResponse {
  status: HealthState;
  checks: HealthCheck[];
  checked_at: string;
}

export interface HealthzResponse {
  status: HealthState;
  uptime_seconds: number;
  version: string;
}

// Position sizing mode (Settings → Advanced Risk)
export type PositionSizingMode = 'FIXED_1PCT' | 'KELLY_QUARTER' | 'CUSTOM';

// Encryption status indicator (SQLCipher)
export interface EncryptionStatus {
  enabled: boolean;
  cipher: 'sqlcipher' | 'aes-256' | 'none' | null;
  kdf_iters?: number;
  page_size?: number;
  tested_at: string;
}
