'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DensityMode } from './constants';
import type { Settings, BotMode, Signal, Trade, TickPrice, AuthUser, PositionSizingMode, VaRMethod } from './types';

export type AppView =
  | 'dashboard'
  | 'chart'
  | 'signals'
  | 'positions'
  | 'journal'
  | 'ai'
  | 'news'
  | 'strategy'
  | 'backtest'
  | 'audit'
  | 'settings'
  | 'stress-test'
  | 'analytics';

interface AppStore {
  // Display
  density: DensityMode;
  setDensity: (d: DensityMode) => void;

  // Navigation
  activeView: AppView;
  setActiveView: (v: AppView) => void;

  // Symbol selection
  activeSymbol: string;
  setActiveSymbol: (s: string) => void;

  // Settings (persisted)
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;

  // Kill switch confirmation modal
  killSwitchOpen: boolean;
  setKillSwitchOpen: (open: boolean) => void;

  // --- Auth (NOT persisted to localStorage) --- //
  authApiKey: string | null;
  authUser: AuthUser | null;
  isAuthenticated: boolean;
  setAuth: (apiKey: string, user: AuthUser) => void;
  clearAuth: () => void;

  // --- New state for audit-fix backend endpoints --- //

  /** Bot execution mode (LIVE / PAPER / DRY). */
  botMode: BotMode;
  setBotMode: (m: BotMode) => void;

  /** Dry-run toggle (generate signals without execution). */
  dryRun: boolean;
  setDryRun: (v: boolean) => void;

  /** Paper-mode flag (separate from dry-run). */
  paperMode: boolean;
  setPaperMode: (v: boolean) => void;

  /** Active cooldown (set by WebSocket `cooldown_engaged` events). */
  cooldownActive: boolean;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  setCooldown: (active: boolean, until?: string | null, reason?: string | null) => void;

  /** Streak status (consecutive wins / losses, set by backend `status` push). */
  consecutiveLosses: number;
  consecutiveWins: number;

  /** Live prices pushed by WebSocket `tick` events. */
  livePrices: Record<string, TickPrice>;
  updateLivePrice: (symbol: string, price: TickPrice) => void;

  /** Open positions updated by WebSocket order_placed / position_closed events. */
  realtimeTrades: Trade[];
  onTradeUpdate: (trade: Trade) => void;
  onPositionClosed: (ticket: number) => void;

  /** Latest signals (pushed by `signal` events). */
  realtimeSignals: Signal[];
  onSignalUpdate: (signal: Signal) => void;

  /** Counter that bumps when an audit-log-relevant event arrives (so AuditLogView can refresh). */
  auditLogRefresh: number;
  bumpAuditLog: () => void;

  /** Margin level warning flag (set by `margin_warning`). */
  marginWarning: number | null;
  setMarginWarning: (level: number | null) => void;

  /** WebSocket connection state. */
  wsConnected: boolean;
  wsConnecting: boolean;
  setWsState: (connected: boolean, connecting: boolean) => void;

  /** Reset realtime transient state (used when disconnecting). */
  resetRealtime: () => void;

  // --- Advanced risk settings (Sprint 7) --- //
  /** Position sizing mode: fixed 1%, quarter-Kelly, or custom. */
  positionSizing: PositionSizingMode;
  setPositionSizing: (m: PositionSizingMode) => void;

  /** VaR confidence level selector. */
  varConfidence: 0.95 | 0.99;
  setVarConfidence: (c: 0.95 | 0.99) => void;

  /** VaR method (historical or parametric). */
  varMethod: VaRMethod;
  setVarMethod: (m: VaRMethod) => void;

  /** Whether to use Kelly sizing (drives settings update). */
  useKelly: boolean;
  setUseKelly: (v: boolean) => void;
}

const DEFAULT_SETTINGS: Settings = {
  mt5: {
    login: '',
    password: '',
    server: 'FinexIC-Markets',
    broker: 'Finex Indonesia',
  },
  ollama: {
    url: 'http://localhost:11434',
    model: 'llama3.2:latest',
  },
  tiingo: {
    apiKey: '',
  },
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

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      density: 'compact',
      setDensity: (d) => set({ density: d }),

      activeView: 'dashboard',
      setActiveView: (v) => set({ activeView: v }),

      activeSymbol: 'EURUSD',
      setActiveSymbol: (s) => set({ activeSymbol: s }),

      settings: DEFAULT_SETTINGS,
      updateSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),

      killSwitchOpen: false,
      setKillSwitchOpen: (open) => set({ killSwitchOpen: open }),

      // --- Auth state (transient, NOT persisted) --- //
      authApiKey: null,
      authUser: null,
      isAuthenticated: false,
      setAuth: (apiKey, user) =>
        set({ authApiKey: apiKey, authUser: user, isAuthenticated: true }),
      clearAuth: () =>
        set({ authApiKey: null, authUser: null, isAuthenticated: false }),

      // --- New realtime state --- //
      botMode: 'PAPER',
      setBotMode: (m) => set({ botMode: m }),

      dryRun: false,
      setDryRun: (v) => set({ dryRun: v }),

      paperMode: true,
      setPaperMode: (v) => set({ paperMode: v }),

      cooldownActive: false,
      cooldownUntil: null,
      cooldownReason: null,
      setCooldown: (active, until = null, reason = null) =>
        set({ cooldownActive: active, cooldownUntil: until, cooldownReason: reason }),

      consecutiveLosses: 0,
      consecutiveWins: 0,

      livePrices: {},
      updateLivePrice: (symbol, price) =>
        set((state) => ({
          livePrices: { ...state.livePrices, [symbol]: price },
        })),

      realtimeTrades: [],
      onTradeUpdate: (trade) =>
        set((state) => {
          const existing = state.realtimeTrades.findIndex((t) => t.id === trade.id);
          if (existing >= 0) {
            const next = [...state.realtimeTrades];
            next[existing] = trade;
            return { realtimeTrades: next };
          }
          return { realtimeTrades: [trade, ...state.realtimeTrades].slice(0, 20) };
        }),
      onPositionClosed: (ticket) =>
        set((state) => ({
          realtimeTrades: state.realtimeTrades.filter((t) => t.ticket !== ticket),
        })),

      realtimeSignals: [],
      onSignalUpdate: (signal) =>
        set((state) => ({
          realtimeSignals: [signal, ...state.realtimeSignals].slice(0, 20),
        })),

      auditLogRefresh: 0,
      bumpAuditLog: () => set((state) => ({ auditLogRefresh: state.auditLogRefresh + 1 })),

      marginWarning: null,
      setMarginWarning: (level) => set({ marginWarning: level }),

      wsConnected: false,
      wsConnecting: false,
      setWsState: (connected, connecting) =>
        set({ wsConnected: connected, wsConnecting: connecting }),

      resetRealtime: () =>
        set({
          livePrices: {},
          realtimeTrades: [],
          realtimeSignals: [],
          cooldownActive: false,
          cooldownUntil: null,
          cooldownReason: null,
          marginWarning: null,
          wsConnected: false,
          wsConnecting: false,
        }),

      // --- Advanced risk settings --- //
      positionSizing: 'FIXED_1PCT',
      setPositionSizing: (m) => set({ positionSizing: m }),

      varConfidence: 0.95,
      setVarConfidence: (c) => set({ varConfidence: c }),

      varMethod: 'historical',
      setVarMethod: (m) => set({ varMethod: m }),

      useKelly: false,
      setUseKelly: (v) => set({ useKelly: v }),
    }),
    {
      name: 'forex-scalping-v2-store',
      partialize: (state) => ({
        density: state.density,
        settings: state.settings,
        activeSymbol: state.activeSymbol,
        botMode: state.botMode,
        dryRun: state.dryRun,
        paperMode: state.paperMode,
        positionSizing: state.positionSizing,
        varConfidence: state.varConfidence,
        varMethod: state.varMethod,
        useKelly: state.useKelly,
      }),
    }
  )
);
