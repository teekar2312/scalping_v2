'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DensityMode } from './constants';
import type { Settings } from './types';

interface AppStore {
  // Display
  density: DensityMode;
  setDensity: (d: DensityMode) => void;

  // Navigation
  activeView:
    | 'dashboard'
    | 'chart'
    | 'signals'
    | 'positions'
    | 'journal'
    | 'ai'
    | 'news'
    | 'strategy'
    | 'settings';
  setActiveView: (v: AppStore['activeView']) => void;

  // Symbol selection
  activeSymbol: string;
  setActiveSymbol: (s: string) => void;

  // Settings (persisted)
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;

  // Kill switch confirmation modal
  killSwitchOpen: boolean;
  setKillSwitchOpen: (open: boolean) => void;
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
    }),
    {
      name: 'forex-scalping-v2-store',
      partialize: (state) => ({
        density: state.density,
        settings: state.settings,
        activeSymbol: state.activeSymbol,
      }),
    }
  )
);
