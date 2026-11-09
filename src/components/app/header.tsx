'use client';

import { Sun, Moon, AlignJustify, Square, Maximize2, Wifi, WifiOff, Loader2, HeartPulse, LogOut, User as UserIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '@/lib/store';
import { DENSITY_MODES, type DensityMode } from '@/lib/constants';
import { getReadiness } from '@/lib/api';
import { logout, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KillSwitchButton } from './kill-switch';
import { BotControl } from './bot-control';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ReadinessResponse, HealthState } from '@/lib/types';

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
  positions: { title: 'Posisi & Trade', subtitle: 'Open positions + history + tick reconstruction' },
  journal: { title: 'Trade Journal', subtitle: 'Riwayat lengkap dengan R-net, attribution, compliance & emosi' },
  backtest: { title: 'Backtest Engine V2', subtitle: '300-trade mandatory · Monte Carlo · Walk-Forward' },
  'stress-test': { title: 'Stress Test Engine', subtitle: 'Black swan scenario replay · historical crisis multiplier' },
  analytics: { title: 'Slippage & Latency Analytics', subtitle: 'Execution-quality + Kelly criterion + position sizing' },
  audit: { title: 'Audit Log', subtitle: 'Immutable event trail — hash-chain verified · real-time WS' },
  ai: { title: 'AI Analisa (Ollama llama3.2)', subtitle: 'Chat AI dengan context strategi V2' },
  news: { title: 'Kalender Ekonomi Tiingo', subtitle: 'News impact + blackout windows' },
  strategy: { title: 'Strategi V2 Reference', subtitle: 'Manual lengkap strategi scalping V2' },
  alerts: { title: 'Price & Indicator Alerts', subtitle: 'Threshold alerts: price, ADX, RSI, spread' },
  market: { title: 'Market Analysis', subtitle: 'Currency strength · Volume profile · Correlation · Volatility · Order flow · Sentiment · Surprise index' },
  system: { title: 'System Health', subtitle: 'Service status · CPU · memory · disk · Prometheus metrics' },
  settings: { title: 'Settings', subtitle: 'Auth, Secrets, Regulatory, MT5, Ollama, Tiingo, Bot Mode, Backup, PWA Push' },
};

// --- Health status pill (Sprint 8 — DevOps readiness) ---------------------- //

const HEALTH_COLORS: Record<HealthState, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'border-bull/40 bg-bull/10', text: 'text-bull', label: 'ALL HEALTHY' },
  degraded: { bg: 'border-warn/40 bg-warn/10', text: 'text-warn', label: 'DEGRADED' },
  unhealthy: { bg: 'border-bear/40 bg-bear/10', text: 'text-bear', label: 'UNHEALTHY' },
};

function HealthPill() {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const isDemo = !process.env.NEXT_PUBLIC_PYTHON_API_URL;

  useEffect(() => {
    if (isDemo) {
      // In demo mode just load once.
      let mounted = true;
      getReadiness().then((r) => mounted && setReadiness(r)).catch(() => {});
      return () => {
        mounted = false;
      };
    }
    let mounted = true;
    // Poll /readyz every 30s in production.
    const tick = () => {
      getReadiness()
        .then((r) => mounted && setReadiness(r))
        .catch(() => {
          if (mounted) {
            setReadiness({
              status: 'unhealthy',
              checks: [],
              checked_at: new Date().toISOString(),
            });
          }
        });
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isDemo]);

  if (!readiness) {
    return (
      <div className="hidden md:flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground font-medium">checking…</span>
      </div>
    );
  }

  const colors = HEALTH_COLORS[readiness.status];
  const tooltipDetail = (
    <div className="space-y-1 min-w-[200px]">
      <div className="font-semibold text-xs mb-1">Readiness Checks</div>
      {readiness.checks.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">
          {isDemo ? 'Demo mode — all mocked healthy.' : 'No checks returned.'}
        </div>
      ) : (
        readiness.checks.map((c) => (
          <div key={c.name} className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  c.status === 'healthy' ? 'bg-bull' : c.status === 'degraded' ? 'bg-warn' : 'bg-bear',
                )}
              />
              {c.name}
            </span>
            <span
              className={cn(
                'font-mono tabular-nums',
                c.status === 'healthy' ? 'text-bull' : c.status === 'degraded' ? 'text-warn' : 'text-bear',
              )}
            >
              {c.latency_ms !== undefined ? `${c.latency_ms}ms` : c.status}
            </span>
          </div>
        ))
      )}
      <div className="border-t pt-1 mt-1 text-[10px] text-muted-foreground">
        Checked {new Date(readiness.checked_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('hidden md:flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs', colors.bg)}>
            <HeartPulse className={cn('h-3 w-3', colors.text)} />
            <span className={cn('font-medium', colors.text)}>{colors.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {tooltipDetail}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// --- User dropdown (Sprint 5 auth) ----------------------------------------- //

function UserMenu() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated || !user) return null;
  const initial = user.username.charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
            {initial}
          </div>
          <span className="text-xs hidden sm:inline">{user.username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{user.username}</span>
            <span className="text-[10px] text-muted-foreground">
              Role: {user.role}
            </span>
            {user.login_at && (
              <span className="text-[10px] text-muted-foreground">
                Login: {new Date(user.login_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
              </span>
            )}
            {user.ip && (
              <span className="text-[10px] text-muted-foreground">IP: {user.ip}</span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-xs gap-2 text-bear"
          onClick={() => {
            logout();
            toast({ title: 'Logged out', description: 'API key cleared from memory.' });
          }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
        <HealthPill />
        <ConnectionPill />
        <BotControl />
        <KillSwitchButton />
        <UserMenu />

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
