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
  AuditLogEntry,
  AuditLogResponse,
  EquityCurvePoint,
  EquityCurveResponse,
  PerformanceAttribution,
  ComplianceScore,
  PreLiveCheck,
  BacktestRequest,
  BacktestResult,
  HolidaysResponse,
  BotModeState,
  BotMode,
  EmotionalSummaryResponse,
  EmotionalState,
  LogEmotionRequest,
  TimeSyncResponse,
  RestoreResponse,
  RiskDisclosureResponse,
  ServiceTestResult,
  WSEvent,
  WSEventType,
  AuthLoginResponse,
  AuthMeResponse,
  ApiKeyListResponse,
  CreateApiKeyResponse,
  SecretListResponse,
  RiskDisclosureStatus,
  RiskDisclosureAckRequest,
  RiskDisclosureAckResponse,
  AuditChainVerifyResponse,
  BappebtiStatus,
  TradeReconstruction,
  RiskMetrics,
  StressScenario,
  StressTestRequest,
  StressTestResult,
  MonteCarloRequest,
  MonteCarloResult,
  WalkForwardRequest,
  WalkForwardResult,
  KellyStats,
  SlippageStats,
  LatencyStats,
  ReadinessResponse,
  HealthzResponse,
  EncryptionStatus,
  VaRMethod,
  PriceAlert,
  PriceAlertCreateRequest,
  PriceAlertListResponse,
  PriceAlertTestResponse,
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
  EnhancedHealthzResponse,
  BrokerStatusResponse,
  FailoverResponse,
  SwapsReportResponse,
  SwapsReportEntry,
  TickBacktestRequest,
  TickBacktestResult,
  BackupOffsiteResponse,
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
  getDemoAuditLog,
  getDemoEquityCurve,
  getDemoPerformanceAttribution,
  getDemoComplianceScore,
  getDemoPreLiveCheck,
  getDemoTimeSync,
  getDemoRiskDisclosure,
  getDemoEmotionalSummary,
  getDemoBacktestResult,
  getDemoHolidays,
  getDemoBotMode,
  getDemoServiceTest,
  getDemoAuthLogin,
  getDemoAuthMe,
  getDemoApiKeys,
  getDemoSecrets,
  getDemoRiskDisclosureStatus,
  getDemoStressScenarios,
  getDemoStressTestResults,
  getDemoRiskMetrics,
  getDemoMonteCarlo,
  getDemoWalkForward,
  getDemoKelly,
  getDemoSlippageStats,
  getDemoLatencyStats,
  getDemoReadiness,
  getDemoHealthz,
  getDemoTradeReconstruction,
  getDemoAuditChainVerify,
  getDemoBappebtiStatus,
  getDemoEncryptionStatus,
  getDemoPriceAlerts,
  getDemoCreatePriceAlert,
  getDemoSystemInfo,
  getDemoServiceStatus,
  getDemoDrawdownRealtime,
  getDemoMetrics,
  getDemoCurrencyStrength,
  getDemoVolumeProfile,
  getDemoCorrelationMatrix,
  getDemoVolatilitySurface,
  getDemoOrderFlow,
  getDemoNewsSentiment,
  getDemoSurpriseIndex,
  getDemoBrokerStatus,
  getDemoSwapsReport,
  getDemoTickBacktest,
} from './mock-data';

// In demo mode (sandbox), use Next.js API routes that return mock data
// In production (Windows with Python backend), set NEXT_PUBLIC_PYTHON_API_URL
const PYTHON_API = process.env.NEXT_PUBLIC_PYTHON_API_URL || '';
const IS_DEMO = !PYTHON_API;

export const DEMO_MODE = IS_DEMO;

// --- Auth header injection (Sprint 5) --------------------------------------- //
// Auth state is read lazily from the Zustand store via a module-level accessor.
// The store is set by `auth.ts` at runtime so we don't create a circular import.
let authKeyGetter: (() => string | null) | null = null;
let authLogoutHandler: (() => void) | null = null;

/**
 * Wire the auth store getter so fetchAPI can attach the Bearer token and
 * handle 401 by clearing auth + redirecting to the login view. Called once
 * from the app shell during mount (see `auth.ts`).
 */
export function configureAuthAccessor(
  getKey: () => string | null,
  onUnauthorized: () => void,
): void {
  authKeyGetter = getKey;
  authLogoutHandler = onUnauthorized;
}

function authHeaders(): Record<string, string> {
  const key = authKeyGetter?.() ?? null;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function mergeAuthHeaders(options?: RequestInit): RequestInit {
  const headers = new Headers(options?.headers);
  const auth = authHeaders();
  for (const [k, v] of Object.entries(auth)) {
    headers.set(k, v);
  }
  return { ...(options ?? {}), headers };
}

async function handleUnauthorized(res: Response): Promise<void> {
  if (res.status === 401 && authLogoutHandler) {
    authLogoutHandler();
  }
}

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  if (IS_DEMO) {
    // Use Next.js internal API routes (mock)
    const res = await fetch(path, options);
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json();
  } else {
    // Use Python FastAPI backend
    const url = `${PYTHON_API}${path}`;
    const res = await fetch(url, mergeAuthHeaders(options));
    if (!res.ok) {
      await handleUnauthorized(res);
      throw new Error(`Python API ${path} failed: ${res.status}`);
    }
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
  return fetchAPI<SystemStatus>('/api/status').then((s) => s.bot);
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

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 1 #10: Audit log
// --------------------------------------------------------------------------- //

export interface AuditLogFilters {
  event_type?: string;
  severity?: string;
  limit?: number;
  offset?: number;
  start?: string;
  end?: string;
}

export async function getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  if (IS_DEMO) {
    let rows = getDemoAuditLog(filters.limit ?? 100);
    if (filters.event_type) rows = rows.filter((r) => r.event_type === filters.event_type);
    if (filters.severity) rows = rows.filter((r) => r.severity === filters.severity);
    return rows.slice(0, filters.limit ?? 100);
  }
  const params = new URLSearchParams();
  if (filters.event_type) params.set('event_type', filters.event_type);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  if (filters.start) params.set('start', filters.start);
  if (filters.end) params.set('end', filters.end);
  const res = await fetchAPI<AuditLogResponse>(`/api/audit-log?${params.toString()}`);
  return res.events;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 3 #19: Equity curve
// --------------------------------------------------------------------------- //

export async function getEquityCurve(hours = 24): Promise<EquityCurvePoint[]> {
  if (IS_DEMO) return getDemoEquityCurve(hours);
  const res = await fetchAPI<EquityCurveResponse>(`/api/equity-curve?hours=${hours}`);
  return res.samples;
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 3 #20-21: Performance attribution + compliance
// --------------------------------------------------------------------------- //

export async function getPerformanceAttribution(start?: string, end?: string): Promise<PerformanceAttribution> {
  if (IS_DEMO) return getDemoPerformanceAttribution();
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return fetchAPI<PerformanceAttribution>(`/api/analytics/attribution?${params.toString()}`);
}

export async function getComplianceScore(start?: string, end?: string): Promise<ComplianceScore> {
  if (IS_DEMO) return getDemoComplianceScore();
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return fetchAPI<ComplianceScore>(`/api/analytics/compliance?${params.toString()}`);
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 3 #22: Emotional-state logging
// --------------------------------------------------------------------------- //

export async function getEmotionalSummary(limit = 200): Promise<EmotionalSummaryResponse> {
  if (IS_DEMO) return getDemoEmotionalSummary();
  return fetchAPI<EmotionalSummaryResponse>(`/api/analytics/emotions?limit=${limit}`);
}

export async function logEmotion(
  tradeId: number,
  state: EmotionalState,
  note?: string,
): Promise<{ ok: boolean; trade_id: number; state: string }> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, trade_id: tradeId, state };
  }
  const body: LogEmotionRequest = { state, note };
  return fetchAPI(`/api/trade/${tradeId}/emotion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #15: Pre-live checklist + Sprint 4 #27 time-sync
// --------------------------------------------------------------------------- //

export async function getPreLiveCheck(): Promise<PreLiveCheck> {
  if (IS_DEMO) return getDemoPreLiveCheck();
  return fetchAPI<PreLiveCheck>('/api/pre-live-check');
}

export async function getTimeSync(): Promise<TimeSyncResponse> {
  if (IS_DEMO) return getDemoTimeSync();
  return fetchAPI<TimeSyncResponse>('/api/time-sync');
}

export async function getRiskDisclosure(): Promise<RiskDisclosureResponse> {
  if (IS_DEMO) return getDemoRiskDisclosure();
  return fetchAPI<RiskDisclosureResponse>('/api/risk-disclosure');
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 4 #29-30: Real probes (test buttons)
// --------------------------------------------------------------------------- //

export async function testMT5(): Promise<ServiceTestResult> {
  if (IS_DEMO) return getDemoServiceTest('mt5');
  return fetchAPI<ServiceTestResult>('/api/test/mt5');
}

export async function testOllama(): Promise<ServiceTestResult> {
  if (IS_DEMO) return getDemoServiceTest('ollama');
  return fetchAPI<ServiceTestResult>('/api/test/ollama');
}

export async function testTiingo(): Promise<ServiceTestResult> {
  if (IS_DEMO) return getDemoServiceTest('tiingo');
  return fetchAPI<ServiceTestResult>('/api/test/tiingo');
}

export async function testTelegram(): Promise<{ ok: boolean; message: string }> {
  if (IS_DEMO) return getDemoServiceTest('telegram');
  return fetchAPI<{ ok: boolean; message: string }>('/api/notifications/test', { method: 'POST' });
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #11: Backtest
// --------------------------------------------------------------------------- //

export async function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 800));
    return getDemoBacktestResult(req);
  }
  return fetchAPI<BacktestResult>('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getBacktestResult(id: number): Promise<BacktestResult> {
  if (IS_DEMO) {
    return getDemoBacktestResult({
      symbol: 'EURUSD',
      timeframe: 'M5',
      start_date: new Date(Date.now() - 90 * 86400_000).toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      initial_balance: 10000,
    });
  }
  return fetchAPI<BacktestResult>(`/api/backtest/results/${id}`);
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 2 #17: Holidays + Sprint 2 #12 bot mode
// --------------------------------------------------------------------------- //

export async function getHolidays(year?: number): Promise<HolidaysResponse> {
  if (IS_DEMO) {
    return { year: year ?? 2026, holidays: getDemoHolidays(year ?? 2026) };
  }
  const q = year ? `?year=${year}` : '';
  return fetchAPI<HolidaysResponse>(`/api/holidays${q}`);
}

export async function getBotMode(): Promise<BotModeState> {
  if (IS_DEMO) return getDemoBotMode();
  return fetchAPI<BotModeState>('/api/bot/mode');
}

export async function setBotMode(mode: BotMode): Promise<BotModeState> {
  if (IS_DEMO) {
    const isPaper = mode === 'PAPER';
    const isDry = mode === 'DRY';
    return { mode: mode.toLowerCase(), paper_mode: isPaper, dry_run: isDry };
  }
  return fetchAPI<BotModeState>('/api/bot/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export async function setDryRun(enabled: boolean): Promise<BotModeState> {
  if (IS_DEMO) {
    return { mode: enabled ? 'dry' : 'paper', paper_mode: !enabled, dry_run: enabled };
  }
  return fetchAPI<BotModeState>('/api/bot/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

// --------------------------------------------------------------------------- //
// Audit-fix Sprint 4 #24-26: Backup / restore / PDF / tax exports
// --------------------------------------------------------------------------- //

function buildPythonUrl(path: string): string {
  return `${PYTHON_API}${path}`;
}

function buildPythonUrlWithAuth(path: string): string {
  // URL stays the same; auth handled via headers
  return buildPythonUrl(path);
}

export async function downloadBackup(): Promise<Blob> {
  if (IS_DEMO) {
    // Generate a fake SQLite-style blob (JSON dump of demo data) for demo mode
    const payload = {
      exported_at: new Date().toISOString(),
      demo_mode: true,
      trades: getDemoTradeHistory(30),
      audit_log: getDemoAuditLog(50),
      equity_curve: getDemoEquityCurve(24),
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/octet-stream' });
  }
  const res = await fetch(buildPythonUrlWithAuth('/api/backup'), mergeAuthHeaders());
  if (!res.ok) throw new Error(`backup failed: ${res.status}`);
  return res.blob();
}

export async function restoreBackup(file: File): Promise<RestoreResponse> {
  if (IS_DEMO) {
    return {
      ok: true,
      restored_to: 'demo://memory.db',
      size_bytes: file.size,
    };
  }
  const form = new FormData();
  form.append('file', file);
  const opts: RequestInit = { method: 'POST', body: form };
  const res = await fetch(buildPythonUrlWithAuth('/api/restore'), mergeAuthHeaders(opts));
  if (!res.ok) throw new Error(`restore failed: ${res.status}`);
  return res.json();
}

export async function downloadPDF(weekStart: string): Promise<Blob> {
  if (IS_DEMO) {
    // Demo: return a simple text PDF-like blob
    const text = `WEEKLY JOURNAL — Week of ${weekStart}\n\nGenerated from demo data.\n\nThis is a placeholder PDF in demo mode.`;
    return new Blob([text], { type: 'application/pdf' });
  }
  const res = await fetch(buildPythonUrlWithAuth(`/api/export/pdf?week_start=${encodeURIComponent(weekStart)}`), mergeAuthHeaders());
  if (!res.ok) throw new Error(`PDF export failed: ${res.status}`);
  return res.blob();
}

export async function downloadTax(year: number, format?: 'csv' | 'spt'): Promise<Blob> {
  if (IS_DEMO) {
    const trades = getDemoTradeHistory(30).filter(
      (t) => t.closeTime && t.closeTime.startsWith(String(year)),
    );
    const header = 'ticket,symbol,direction,volume,open_time,close_time,open_price,close_price,profit,commission,swap,net_profit,pnl_currency\n';
    const rows = trades.map((t) =>
      [
        t.ticket,
        t.symbol,
        t.direction,
        t.volume,
        t.entryTime,
        t.closeTime,
        t.openPrice,
        t.closePrice,
        t.profitNet ?? 0,
        0,
        0,
        t.profitNet ?? 0,
        'USD',
      ].join(','),
    );
    return new Blob([header + rows.join('\n')], { type: 'text/csv' });
  }
  const fmt = format ? `&format=${format}` : '';
  const res = await fetch(buildPythonUrlWithAuth(`/api/export/tax?year=${year}${fmt}`), mergeAuthHeaders());
  if (!res.ok) throw new Error(`tax export failed: ${res.status}`);
  return res.blob();
}

// Helper to trigger a browser download from a Blob
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke shortly after to release memory
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --------------------------------------------------------------------------- //
// WebSocket client (Sprint WS — `/ws`)
// --------------------------------------------------------------------------- //

type EventCallback<T = unknown> = (event: WSEvent<T>) => void;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private url: string | null = null;
  private listeners = new Map<WSEventType | '*', Set<EventCallback>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
  private stateListeners = new Set<(state: WebSocketClient['connectionState']) => void>();

  get state(): WebSocketClient['connectionState'] {
    return this.connectionState;
  }

  /** Returns the WebSocket URL derived from NEXT_PUBLIC_PYTHON_API_URL. */
  private resolveUrl(): string {
    if (typeof window === 'undefined') return '';
    const api = process.env.NEXT_PUBLIC_PYTHON_API_URL || '';
    if (!api) return '';
    // Convert http(s)://host -> ws(s)://host
    const wsUrl = api.replace(/^http/, 'ws');
    let base = `${wsUrl.replace(/\/$/, '')}/ws`;
    // Append the auth token as a query param if available so the backend
    // can authenticate the WS upgrade request.
    const token = authKeyGetter?.() ?? null;
    if (token) {
      base += `?token=${encodeURIComponent(token)}`;
    }
    return base;
  }

  /** Subscribe to either a specific event type or all events ('*'). */
  subscribe<T = unknown>(eventType: WSEventType | '*', callback: EventCallback<T>): () => void {
    if (!this.listeners.has(eventType)) this.listeners.set(eventType, new Set());
    this.listeners.get(eventType)!.add(callback as EventCallback);
    return () => {
      this.listeners.get(eventType)?.delete(callback as EventCallback);
    };
  }

  /** Subscribe to connection-state changes. */
  onStateChange(listener: (state: WebSocketClient['connectionState']) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(s: WebSocketClient['connectionState']) {
    if (this.connectionState === s) return;
    this.connectionState = s;
    this.stateListeners.forEach((l) => l(s));
  }

  /** Open the WebSocket connection (no-op if already open or in demo mode). */
  connect(): void {
    if (typeof window === 'undefined') return;
    if (IS_DEMO) {
      this.setState('disconnected');
      return;
    }
    const url = this.resolveUrl();
    if (!url) {
      this.setState('disconnected');
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.url = url;
    this.setState(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    try {
      this.socket = new WebSocket(url);
    } catch (e) {
      console.warn('WebSocket connect failed:', e);
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
    };

    this.socket.onmessage = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as WSEvent;
        if (!payload || !payload.type) return;
        this.dispatch(payload);
      } catch {
        // ignore malformed JSON
      }
    };

    this.socket.onerror = () => {
      // Errors are followed by onclose, which triggers reconnect.
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      } else {
        this.setState('disconnected');
      }
    };
  }

  private dispatch(event: WSEvent): void {
    const specific = this.listeners.get(event.type);
    specific?.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.warn('WS listener error:', e);
      }
    });
    const wildcard = this.listeners.get('*');
    wildcard?.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.warn('WS wildcard listener error:', e);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= 5) {
      this.setState('disconnected');
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (max ~30s)
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** Send a message to the server (action: ping/subscribe/chart). */
  send(message: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (e) {
        console.warn('WS send failed:', e);
      }
    }
  }

  /** Close the connection and disable auto-reconnect. */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.setState('disconnected');
  }

  /** Reset the auto-reconnect flag (used when re-enabling after disconnect). */
  enableAutoReconnect(): void {
    this.shouldReconnect = true;
  }
}

export const wsClient = new WebSocketClient();

// Demo AI response generator (only used in sandbox)
function generateDemoAIResponse(userText: string, _context?: string): string {
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

// --------------------------------------------------------------------------- //
// Sprint 5-8: Auth, secrets, regulatory, advanced analytics, DevOps
// --------------------------------------------------------------------------- //

// --- Auth (Sprint 5) -------------------------------------------------------- //

export async function login(username: string, password: string): Promise<AuthLoginResponse> {
  if (IS_DEMO) return getDemoAuthLogin(username);
  return fetchAPI<AuthLoginResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function getAuthMe(): Promise<AuthMeResponse> {
  if (IS_DEMO) return getDemoAuthMe();
  return fetchAPI<AuthMeResponse>('/api/auth/me');
}

export async function listApiKeys(): Promise<ApiKeyListResponse> {
  if (IS_DEMO) return { keys: getDemoApiKeys() };
  return fetchAPI<ApiKeyListResponse>('/api/auth/keys');
}

export async function createApiKey(label: string): Promise<CreateApiKeyResponse> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    const id = `key_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id,
      key: `sk_demo_${id}_${Math.random().toString(36).slice(2, 24)}`,
      label,
      created_at: new Date().toISOString(),
    };
  }
  return fetchAPI<CreateApiKeyResponse>('/api/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean }> {
  if (IS_DEMO) return { ok: true };
  return fetchAPI<{ ok: boolean }>(`/api/auth/keys/${id}`, { method: 'DELETE' });
}

// --- Secrets (Sprint 5) ----------------------------------------------------- //

export async function listSecrets(): Promise<SecretListResponse> {
  if (IS_DEMO) return { secrets: getDemoSecrets() };
  return fetchAPI<SecretListResponse>('/api/secrets');
}

export async function setSecret(name: string, value: string): Promise<{ ok: boolean }> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  }
  return fetchAPI<{ ok: boolean }>(`/api/secrets/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

export async function getSecret(name: string): Promise<{ name: string; value: string | null }> {
  if (IS_DEMO) {
    return { name, value: null };
  }
  return fetchAPI<{ name: string; value: string | null }>(`/api/secrets/${encodeURIComponent(name)}`);
}

// --- Risk disclosure (ack + status) (Sprint 5/6) ---------------------------- //

export async function getRiskDisclosureStatus(): Promise<RiskDisclosureStatus> {
  if (IS_DEMO) return getDemoRiskDisclosureStatus();
  return fetchAPI<RiskDisclosureStatus>('/api/risk-disclosure/status');
}

export async function acknowledgeRiskDisclosure(
  body: RiskDisclosureAckRequest,
): Promise<RiskDisclosureAckResponse> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    const now = new Date();
    const expiry = new Date(now.getTime() + 30 * 86400_000);
    return {
      ok: true,
      acknowledged_at: now.toISOString(),
      expires_at: expiry.toISOString(),
    };
  }
  return fetchAPI<RiskDisclosureAckResponse>('/api/risk-disclosure/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Audit chain verification (Sprint 6) ------------------------------------ //

export async function verifyAuditChain(): Promise<AuditChainVerifyResponse> {
  if (IS_DEMO) return getDemoAuditChainVerify();
  return fetchAPI<AuditChainVerifyResponse>('/api/audit-log/verify');
}

// --- Regulatory (Sprint 6) -------------------------------------------------- //

export async function getBappebtiStatus(): Promise<BappebtiStatus> {
  if (IS_DEMO) return getDemoBappebtiStatus();
  return fetchAPI<BappebtiStatus>('/api/regulatory/bappebti-status');
}

// --- Trade reconstruction (Sprint 7) ---------------------------------------- //

export async function getTradeReconstruction(ticket: number): Promise<TradeReconstruction> {
  if (IS_DEMO) return getDemoTradeReconstruction(ticket);
  return fetchAPI<TradeReconstruction>(`/api/trade/${ticket}/reconstruct`);
}

// --- VaR / CVaR (Sprint 7) -------------------------------------------------- //

export async function getRiskMetrics(
  confidence: number,
  days: number,
  method?: VaRMethod,
): Promise<RiskMetrics> {
  if (IS_DEMO) return getDemoRiskMetrics(confidence, days, method);
  const params = new URLSearchParams();
  params.set('confidence', String(confidence));
  params.set('days', String(days));
  if (method) params.set('method', method);
  return fetchAPI<RiskMetrics>(`/api/analytics/var?${params.toString()}`);
}

// --- Stress test (Sprint 7) ------------------------------------------------- //

export async function listStressScenarios(): Promise<StressScenario[]> {
  if (IS_DEMO) return getDemoStressScenarios();
  return fetchAPI<StressScenario[]>('/api/analytics/stress-test/scenarios');
}

export async function runStressTest(body: StressTestRequest): Promise<StressTestResult> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 700));
    const all = getDemoStressTestResults();
    const found = all.find((r) => r.scenario === body.scenario);
    return found ?? all[0];
  }
  return fetchAPI<StressTestResult>('/api/analytics/stress-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getStressTestResult(id: string): Promise<StressTestResult> {
  if (IS_DEMO) {
    const all = getDemoStressTestResults();
    return all.find((r) => r.id === id) ?? all[0];
  }
  return fetchAPI<StressTestResult>(`/api/analytics/stress-test/results/${id}`);
}

// --- Monte Carlo (Sprint 7) ------------------------------------------------- //

export async function runMonteCarlo(body: MonteCarloRequest): Promise<MonteCarloResult> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 900));
    return getDemoMonteCarlo(body);
  }
  return fetchAPI<MonteCarloResult>('/api/backtest/monte-carlo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Walk-forward (Sprint 7) ------------------------------------------------ //

export async function runWalkForward(body: WalkForwardRequest): Promise<WalkForwardResult> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 800));
    return getDemoWalkForward(body);
  }
  return fetchAPI<WalkForwardResult>('/api/backtest/walk-forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Kelly criterion (Sprint 7) --------------------------------------------- //

export async function getKellyStats(): Promise<KellyStats> {
  if (IS_DEMO) return getDemoKelly();
  return fetchAPI<KellyStats>('/api/analytics/kelly');
}

// --- Slippage & Latency (Sprint 7) ------------------------------------------ //

export async function getSlippageStats(days = 30): Promise<SlippageStats> {
  if (IS_DEMO) return getDemoSlippageStats(days);
  return fetchAPI<SlippageStats>(`/api/analytics/slippage?days=${days}`);
}

export async function getLatencyStats(hours = 24): Promise<LatencyStats> {
  if (IS_DEMO) return getDemoLatencyStats(hours);
  return fetchAPI<LatencyStats>(`/api/analytics/latency?hours=${hours}`);
}

// --- Health & readiness (Sprint 8 — DevOps) --------------------------------- //

export async function getHealthz(): Promise<HealthzResponse> {
  if (IS_DEMO) return getDemoHealthz();
  return fetchAPI<HealthzResponse>('/healthz');
}

export async function getReadiness(): Promise<ReadinessResponse> {
  if (IS_DEMO) return getDemoReadiness();
  return fetchAPI<ReadinessResponse>('/readyz');
}

// --- Encryption status (SQLCipher) ------------------------------------------ //

export async function getEncryptionStatus(): Promise<EncryptionStatus> {
  if (IS_DEMO) return getDemoEncryptionStatus();
  return fetchAPI<EncryptionStatus>('/api/security/encryption-status');
}

// --- Change password (Settings → Authentication & Security) ------------------ //

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; message: string }> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, message: 'Password changed (demo mode)' };
  }
  return fetchAPI<{ ok: boolean; message: string }>('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// --------------------------------------------------------------------------- //
// Frontend-100: Price alerts (Feature 5)
// --------------------------------------------------------------------------- //

export async function listPriceAlerts(): Promise<PriceAlertListResponse> {
  if (IS_DEMO) {
    return { alerts: getDemoPriceAlerts(), total: getDemoPriceAlerts().length };
  }
  return fetchAPI<PriceAlertListResponse>('/api/alerts');
}

export async function createPriceAlert(body: PriceAlertCreateRequest): Promise<PriceAlert> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 300));
    return getDemoCreatePriceAlert(body);
  }
  return fetchAPI<PriceAlert>('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deletePriceAlert(id: string): Promise<{ ok: boolean }> {
  if (IS_DEMO) return { ok: true };
  return fetchAPI<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testPriceAlert(id: string): Promise<PriceAlertTestResponse> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 250));
    return {
      ok: true,
      message: 'Alert test fired (demo) — browser notification + audit log entry',
      fired_at: new Date().toISOString(),
    };
  }
  return fetchAPI<PriceAlertTestResponse>(`/api/alerts/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
}

// --------------------------------------------------------------------------- //
// Frontend-100: System health (Feature 6)
// --------------------------------------------------------------------------- //

export async function getSystemInfo(): Promise<SystemInfoResponse> {
  if (IS_DEMO) return getDemoSystemInfo();
  return fetchAPI<SystemInfoResponse>('/api/system/info');
}

export async function getServiceStatus(): Promise<ServiceStatusResponse> {
  if (IS_DEMO) return getDemoServiceStatus();
  return fetchAPI<ServiceStatusResponse>('/api/services/status');
}

export async function getDrawdownRealtime(): Promise<DrawdownRealtimeResponse> {
  if (IS_DEMO) return getDemoDrawdownRealtime();
  return fetchAPI<DrawdownRealtimeResponse>('/api/drawdown/realtime');
}

export async function getEnhancedHealthz(): Promise<EnhancedHealthzResponse> {
  if (IS_DEMO) {
    return {
      status: 'healthy',
      uptime_seconds: 142_873,
      version: '2.0.0',
      build_id: 'frontend-100',
      commit_sha: 'feat/pwa-push-shortcuts-alerts',
      checked_at: new Date().toISOString(),
    };
  }
  return fetchAPI<EnhancedHealthzResponse>('/api/healthz');
}

export async function getMetrics(): Promise<string> {
  // Prometheus exposition format — plain text, not JSON.
  if (IS_DEMO) {
    return getDemoMetrics();
  }
  if (!PYTHON_API) {
    const res = await fetch('/metrics');
    return res.text();
  }
  const res = await fetch(`${PYTHON_API}/metrics`);
  return res.text();
}

// --------------------------------------------------------------------------- //
// Frontend-100: Market analysis (Feature 7)
// --------------------------------------------------------------------------- //

export async function getCurrencyStrength(): Promise<CurrencyStrengthResponse> {
  if (IS_DEMO) return getDemoCurrencyStrength();
  return fetchAPI<CurrencyStrengthResponse>('/api/market/currency-strength');
}

export async function getVolumeProfile(symbol: string): Promise<VolumeProfileResponse> {
  if (IS_DEMO) return getDemoVolumeProfile(symbol);
  return fetchAPI<VolumeProfileResponse>(`/api/volume-profile/${encodeURIComponent(symbol)}`);
}

export async function getCorrelationMatrix(
  pairs: string[],
  window: number,
): Promise<CorrelationMatrixResponse> {
  if (IS_DEMO) return getDemoCorrelationMatrix(pairs, window);
  const params = new URLSearchParams();
  params.set('pairs', pairs.join(','));
  params.set('window', String(window));
  return fetchAPI<CorrelationMatrixResponse>(`/api/analytics/correlation-matrix?${params.toString()}`);
}

export async function getVolatilitySurface(symbol: string): Promise<VolatilitySurfaceResponse> {
  if (IS_DEMO) return getDemoVolatilitySurface(symbol);
  return fetchAPI<VolatilitySurfaceResponse>(
    `/api/analytics/volatility-surface/${encodeURIComponent(symbol)}`
  );
}

export async function getOrderFlow(symbol: string): Promise<OrderFlowResponse> {
  if (IS_DEMO) return getDemoOrderFlow(symbol);
  return fetchAPI<OrderFlowResponse>(`/api/order-flow/${encodeURIComponent(symbol)}`);
}

export async function getNewsSentiment(): Promise<NewsSentimentResponse> {
  if (IS_DEMO) return getDemoNewsSentiment();
  return fetchAPI<NewsSentimentResponse>('/api/news/sentiment');
}

export async function getEconomicSurpriseIndex(days: number): Promise<SurpriseIndexResponse> {
  if (IS_DEMO) return getDemoSurpriseIndex(days);
  return fetchAPI<SurpriseIndexResponse>(
    `/api/economics/surprise-index?days=${days}`
  );
}

// --------------------------------------------------------------------------- //
// Frontend-100: Broker status / failover / swaps / tick backtest / backup
// (consumed by System Health view + future use)
// --------------------------------------------------------------------------- //

export async function getBrokerStatus(): Promise<BrokerStatusResponse> {
  if (IS_DEMO) return getDemoBrokerStatus();
  return fetchAPI<BrokerStatusResponse>('/api/broker/status');
}

export async function triggerBrokerFailover(reason: string): Promise<FailoverResponse> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 400));
    return {
      ok: true,
      switched_to: 'mt5',
      reason,
      switched_at: new Date().toISOString(),
    };
  }
  return fetchAPI<FailoverResponse>('/api/broker/failover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function getSwapsReport(): Promise<SwapsReportResponse> {
  if (IS_DEMO) return getDemoSwapsReport();
  return fetchAPI<SwapsReportResponse>('/api/swaps/report');
}

export async function getSwapsBySymbol(symbol: string): Promise<SwapsReportEntry> {
  if (IS_DEMO) {
    const all = getDemoSwapsReport();
    return all.entries.find((e) => e.symbol === symbol) ?? all.entries[0];
  }
  return fetchAPI<SwapsReportEntry>(`/api/swaps/by-symbol?symbol=${encodeURIComponent(symbol)}`);
}

export async function runTickBacktest(body: TickBacktestRequest): Promise<TickBacktestResult> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 600));
    return getDemoTickBacktest(body);
  }
  return fetchAPI<TickBacktestResult>('/api/backtest/tick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function triggerOffsiteBackup(): Promise<BackupOffsiteResponse> {
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 500));
    return {
      ok: true,
      destination: 's3://scalping-v2-backups/demo.sqlite',
      size_bytes: 1_245_184,
      uploaded_at: new Date().toISOString(),
      message: 'Offsite backup uploaded (demo)',
    };
  }
  return fetchAPI<BackupOffsiteResponse>('/api/backup/offsite', { method: 'POST' });
}
