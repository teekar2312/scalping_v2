'use client';

import { Sun, Moon, AlignJustify, Square, Maximize2, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { useAppStore } from '@/lib/store';
import { DENSITY_MODES, type DensityMode } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { KillSwitchButton } from './kill-switch';
import { BotControl } from './bot-control';
import { cn } from '@/lib/utils';

const emptySubscribe = () => () => {};
function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

const VIEW_TITLES: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Overview real-time bot, akun, dan posisi' },
  chart: { title: 'Chart & Indikator V2', subtitle: 'EMA, VWAP, ATR, ADX, Bollinger, RSI, sesi & sinyal' },
  signals: { title: 'Sinyal V2', subtitle: 'Setup yang lolos checklist 8 poin' },
  positions: { title: 'Posisi & Trade', subtitle: 'Open positions + history' },
  journal: { title: 'Trade Journal', subtitle: 'Riwayat lengkap dengan R-net, attribution, compliance & emosi' },
  backtest: { title: 'Backtest Engine V2', subtitle: '300-trade mandatory backtest dengan target win ≥ 45%, PF ≥ 1.3, DD < 8%' },
  audit: { title: 'Audit Log', subtitle: 'Immutable event trail — real-time dari WebSocket' },
  ai: { title: 'AI Analisa (Ollama llama3.2)', subtitle: 'Chat AI dengan context strategi V2' },
  news: { title: 'Kalender Ekonomi Tiingo', subtitle: 'News impact + blackout windows' },
  strategy: { title: 'Strategi V2 Reference', subtitle: 'Manual lengkap strategi scalping V2' },
  settings: { title: 'Settings', subtitle: 'MT5, Ollama, Tiingo, Telegram, Bot Mode, Pre-Live, Backup' },
};

function ConnectionPill() {
  const wsConnected = useAppStore((s) => s.wsConnected);
  const wsConnecting = useAppStore((s) => s.wsConnecting);
  const isDemo = !process.env.NEXT_PUBLIC_PYTHON_API_URL;

  if (isDemo) {
    return (
      <div className="hidden md:flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs">
        <WifiOff className="h-3 w-3 text-warn" />
        <span className="text-warn font-medium">DEMO</span>
      </div>
    );
  }
  if (wsConnected) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 rounded-md border border-bull/40 bg-bull/10 px-2.5 py-1.5 text-xs">
              <Wifi className="h-3 w-3 text-bull" />
              <span className="text-bull font-medium">LIVE WS</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            WebSocket connected to Python backend
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs',
              wsConnecting
                ? 'border-warn/40 bg-warn/10'
                : 'border-bear/40 bg-bear/10',
            )}
          >
            {wsConnecting ? (
              <Loader2 className="h-3 w-3 animate-spin text-warn" />
            ) : (
              <WifiOff className="h-3 w-3 text-bear" />
            )}
            <span className={wsConnecting ? 'text-warn font-medium' : 'text-bear font-medium'}>
              {wsConnecting ? 'CONNECTING' : 'OFFLINE'}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {wsConnecting ? 'Reconnecting with exponential backoff…' : 'WebSocket disconnected — will retry'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Header() {
  const { theme, setTheme } = useTheme();
  const density = useAppStore((s) => s.density);
  const setDensity = useAppStore((s) => s.setDensity);
  const activeView = useAppStore((s) => s.activeView);
  const mounted = useIsMounted();

  const viewInfo = VIEW_TITLES[activeView] || VIEW_TITLES.dashboard;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4">
      <div className="flex flex-col min-w-0">
        <h1 className="text-base font-semibold leading-tight truncate">{viewInfo.title}</h1>
        <p className="text-xs text-muted-foreground leading-tight truncate">{viewInfo.subtitle}</p>
      </div>

      <div className="flex items-center gap-3">
        <ConnectionPill />
        <BotControl />
        <KillSwitchButton />

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroup
                type="single"
                value={density}
                onValueChange={(v) => v && setDensity(v as DensityMode)}
                className="border rounded-md"
              >
                <ToggleGroupItem value="minimal" className="px-2 py-1.5" aria-label="Minimal density">
                  <Maximize2 className="h-3.5 w-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="compact" className="px-2 py-1.5" aria-label="Compact density">
                  <Square className="h-3.5 w-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="dense" className="px-2 py-1.5" aria-label="Dense density">
                  <AlignJustify className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="flex flex-col gap-1">
                <span>Density: <strong>{DENSITY_MODES[density].label}</strong></span>
                <span className="text-muted-foreground">{DENSITY_MODES[density].description}</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {mounted && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Theme: {theme === 'dark' ? 'Gelap' : 'Terang'} (klik untuk switch)
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </header>
  );
}
