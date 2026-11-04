'use client';

import { useEffect, useState } from 'react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Activity,
  Zap,
  CalendarClock,
  Bot,
  AlertTriangle,
  Clock,
  Target,
  Percent,
} from 'lucide-react';
import { StatCard, PanelCard, StatusDot } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import {
  getSystemStatus,
  getOpenTrades,
  getSignals,
  getNews,
} from '@/lib/api';
import { TRADING_PAIRS, V2_RULES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type {
  SystemStatus,
  Trade,
  Signal,
  NewsEvent,
  BotStatus,
} from '@/lib/types';
import { BotControl } from '../bot-control';

export function DashboardView() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const activeSymbol = useAppStore((s) => s.activeSymbol);
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol);

  useEffect(() => {
    let mounted = true;
    Promise.all([getSystemStatus(), getOpenTrades(), getSignals(), getNews()])
      .then(([s, t, sig, n]) => {
        if (!mounted) return;
        setStatus(s);
        setTrades(t);
        setSignals(sig);
        setNews(n);
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !status) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat dashboard...</div>
      </div>
    );
  }

  const account = status.account!;
  const dailyRisk = status.dailyRisk!;
  const bot = status.bot;
  const todayHighNews = news.filter((n) => n.impact === 'HIGH').slice(0, 4);
  const activeSignals = signals.filter((s) => s.status === 'ACTIVE').slice(0, 5);
  const dailyPnlPct = dailyRisk.dailyPnlPct * 100;
  const weeklyPnlPct = status.weeklyPnlPct * 100;

  // Risk tier progress (negative = loss)
  const softStopPct = Math.abs(V2_RULES.TIERED_STOPS.SOFT_DAILY * 100);
  const hardStopPct = Math.abs(V2_RULES.TIERED_STOPS.HARD_DAILY * 100);
  const dailyLossProgress = dailyPnlPct < 0 ? Math.min(100, (Math.abs(dailyPnlPct) / hardStopPct) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Top row: Account + System Status + Risk Status */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Balance"
          value={account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          unit={account.currency}
          icon={Wallet}
          variant="default"
        />
        <StatCard
          label="Equity"
          value={account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          unit={account.currency}
          icon={TrendingUp}
          trend={account.profit >= 0 ? 'up' : 'down'}
          trendValue={`${account.profit >= 0 ? '+' : ''}${account.profit.toFixed(2)}`}
          variant={account.profit >= 0 ? 'bull' : 'bear'}
        />
        <StatCard
          label="Daily P&L"
          value={`${dailyPnlPct >= 0 ? '+' : ''}${dailyPnlPct.toFixed(2)}`}
          unit="%"
          icon={Percent}
          trend={dailyPnlPct >= 0 ? 'up' : 'down'}
          trendValue={`${dailyRisk.tradesCount} trades · ${dailyRisk.winsCount}W/${dailyRisk.lossesCount}L`}
          variant={dailyPnlPct >= 0 ? 'bull' : 'bear'}
        />
        <StatCard
          label="Weekly P&L"
          value={`${weeklyPnlPct >= 0 ? '+' : ''}${weeklyPnlPct.toFixed(2)}`}
          unit="%"
          icon={Activity}
          trend={weeklyPnlPct >= 0 ? 'up' : 'down'}
          trendValue={`Overall ${(status.overallPnlPct * 100).toFixed(1)}%`}
          variant={weeklyPnlPct >= 0 ? 'bull' : 'bear'}
        />
      </div>

      {/* System Status + Bot Control + Risk Status */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* System Status */}
        <PanelCard
          title="System Status"
          subtitle={`${status.demoMode ? 'Demo Mode · ' : ''}Python backend ${status.pythonBackendUrl || 'tidak terhubung'}`}
          icon={Activity}
          actions={<BotControl status={bot.status} onStatusChange={(s: BotStatus) => setStatus({ ...status, bot: { ...bot, status: s } })} />}
        >
          <div className="flex flex-col gap-3 pt-3">
            <StatusDot status={status.mt5Available ? 'ok' : 'error'} label="MT5 Connection" value={account.server} />
            <StatusDot status={status.ollamaAvailable ? 'ok' : 'error'} label="Ollama AI" value="llama3.2:latest" />
            <StatusDot status={status.tiingoAvailable ? 'ok' : 'error'} label="Tiingo Calendar" value="Connected" />
            <div className="my-2 border-t" />
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Bot Status</div>
                <div className="font-semibold tabular-nums">{bot.status}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Uptime</div>
                <div className="font-semibold tabular-nums">
                  {Math.floor(bot.uptimeSec / 60)}m {bot.uptimeSec % 60}s
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Trades</div>
                <div className="font-semibold tabular-nums">{bot.totalTrades}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Win Rate</div>
                <div className="font-semibold tabular-nums">
                  {bot.totalTrades > 0 ? ((bot.totalWins / bot.totalTrades) * 100).toFixed(1) : '0'}%
                </div>
              </div>
            </div>
          </div>
        </PanelCard>

        {/* Risk Status - Tiered Stop Tracker */}
        <PanelCard
          title="Tiered Stop Tracker"
          subtitle="V2 Risk Management"
          icon={ShieldCheck}
        >
          <div className="flex flex-col gap-3 pt-3">
            <RiskRow
              label="Soft Daily Stop"
              limit="-1%"
              status={dailyRisk.softStopHit ? 'HIT' : dailyPnlPct <= -1 ? 'HIT' : 'OK'}
              current={`${dailyPnlPct.toFixed(2)}%`}
            />
            <RiskRow
              label="Hard Daily Stop"
              limit="-2%"
              status={dailyRisk.hardStopHit ? 'HIT' : dailyPnlPct <= -2 ? 'HIT' : 'OK'}
              current={`${dailyPnlPct.toFixed(2)}%`}
            />
            <RiskRow
              label="Weekly Drawdown"
              limit="-4%"
              status={weeklyPnlPct <= -4 ? 'HIT' : 'OK'}
              current={`${weeklyPnlPct.toFixed(2)}%`}
            />
            <RiskRow
              label="Overall Drawdown"
              limit="-10%"
              status={status.overallPnlPct * 100 <= -10 ? 'HIT' : 'OK'}
              current={`${(status.overallPnlPct * 100).toFixed(2)}%`}
            />
            <div className="my-1 border-t" />
            <div className="text-xs">
              <div className="mb-2 flex justify-between">
                <span className="text-muted-foreground">Daily Loss Progress</span>
                <span className="tabular-nums font-medium">
                  {Math.abs(dailyPnlPct).toFixed(2)}% / {hardStopPct.toFixed(0)}% hard stop
                </span>
              </div>
              <Progress
                value={dailyLossProgress}
                className={cn('h-2', dailyLossProgress > 50 && '[&>div]:bg-warn', dailyLossProgress > 80 && '[&>div]:bg-bear')}
              />
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Positions:</span>
              <Badge variant="outline" className="tabular-nums">
                {status.openPositionsCount}/{V2_RULES.MAX_POSITIONS}
              </Badge>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">Today Trades:</span>
              <Badge variant="outline" className="tabular-nums">
                {status.todayTradesCount}/{V2_RULES.MAX_DAILY_TRADES}
              </Badge>
            </div>
          </div>
        </PanelCard>

        {/* Active Symbol Quick Select + News */}
        <PanelCard
          title="Pair Monitor"
          subtitle="Klik untuk lihat chart"
          icon={Target}
        >
          <div className="flex flex-col gap-2 pt-3">
            {TRADING_PAIRS.map((pair) => {
              const isActive = activeSymbol === pair.symbol;
              return (
                <button
                  key={pair.symbol}
                  onClick={() => {
                    setActiveSymbol(pair.symbol);
                    setActiveView('chart');
                  }}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors',
                    isActive ? 'border-primary bg-accent' : 'hover:bg-accent/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: pair.color }}
                    />
                    <div>
                      <div className="text-sm font-semibold">{pair.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        ADR {pair.adr} · {pair.volatility}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">#{pair.rank}</Badge>
                </button>
              );
            })}
            <div className="mt-2 border-t pt-2">
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                News HIGH Berikutnya
              </div>
              <ScrollArea className="h-20">
                <div className="flex flex-col gap-1">
                  {todayHighNews.map((n) => (
                    <div key={n.id} className="flex items-center gap-2 text-xs">
                      <AlertTriangle className="h-3 w-3 text-bear" />
                      <span className="font-medium">{n.title}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                        {new Date(n.eventTime).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Jakarta',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </PanelCard>
      </div>

      {/* Open Positions + Active Signals */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Open Positions */}
        <PanelCard
          title="Open Positions"
          subtitle={`${trades.length} aktif`}
          icon={TrendingUp}
          className="xl:col-span-2"
          actions={
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActiveView('positions')}>
              Lihat semua →
            </Button>
          }
        >
          <div className="pt-3">
            {trades.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                <TrendingUp className="h-8 w-8 mb-2 opacity-30" />
                Tidak ada posisi terbuka
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 font-medium">Symbol</th>
                    <th className="text-left font-medium">Dir</th>
                    <th className="text-right font-medium">Volume</th>
                    <th className="text-right font-medium">Entry</th>
                    <th className="text-right font-medium">SL (pip)</th>
                    <th className="text-right font-medium">TP1 (pip)</th>
                    <th className="text-right font-medium">RR Net</th>
                    <th className="text-right font-medium">ADX</th>
                    <th className="text-right font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="py-2 font-semibold">{t.symbol}</td>
                      <td>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5',
                            t.direction === 'BUY' ? 'text-bull border-bull' : 'text-bear border-bear'
                          )}
                        >
                          {t.direction}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">{t.volume.toFixed(2)}</td>
                      <td className="text-right tabular-nums">{t.openPrice}</td>
                      <td className="text-right tabular-nums text-bear">{t.slPips.toFixed(1)}</td>
                      <td className="text-right tabular-nums text-bull">{t.tp1Pips.toFixed(1)}</td>
                      <td className="text-right tabular-nums font-semibold">{t.rrNet.toFixed(2)}</td>
                      <td className="text-right tabular-nums">{t.adxValue.toFixed(1)}</td>
                      <td
                        className={cn(
                          'text-right tabular-nums font-semibold',
                          (t.profitNet || 0) >= 0 ? 'text-bull' : 'text-bear'
                        )}
                      >
                        {(t.profitNet || 0) >= 0 ? '+' : ''}
                        {(t.profitNet || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </PanelCard>

        {/* Active Signals */}
        <PanelCard
          title="Sinyal V2 Aktif"
          subtitle={`${activeSignals.length} setup menunggu`}
          icon={Zap}
          actions={
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActiveView('signals')}>
              Semua →
            </Button>
          }
        >
          <div className="flex flex-col gap-2 pt-3">
            {activeSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
                <Zap className="h-8 w-8 mb-2 opacity-30" />
                Tidak ada sinyal aktif
              </div>
            ) : (
              activeSignals.map((sig) => (
                <div key={sig.id} className="rounded-md border p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] px-1.5',
                          sig.direction === 'BUY' ? 'text-bull border-bull' : 'text-bear border-bear'
                        )}
                      >
                        {sig.direction}
                      </Badge>
                      <span className="text-sm font-semibold">{sig.symbol}</span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      RR {sig.rrNet.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>ADX {sig.adxValue.toFixed(1)}</span>
                    <span>ATR {sig.atrValue.toFixed(1)}</span>
                    <span>{sig.setupType.replace('_', ' ')}</span>
                    <span className="ml-auto">{sig.session}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </PanelCard>
      </div>

      {/* Bottom: Session Indicator + News Calendar Mini */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelCard
          title="Sesi Trading WIB"
          subtitle="Jam emas: 14:00-17:00 & 19:30-22:00"
          icon={Clock}
        >
          <SessionTimeline />
        </PanelCard>

        <PanelCard
          title="Kalender Ekonomi"
          subtitle="Berikutnya 7 hari · Tiingo"
          icon={CalendarClock}
          actions={
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActiveView('news')}>
              Detail →
            </Button>
          }
        >
          <div className="pt-3">
            <div className="flex flex-col gap-1.5">
              {news.slice(0, 6).map((n) => (
                <div key={n.id} className="flex items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] px-1 py-0',
                      n.impact === 'HIGH' ? 'text-bear border-bear' : n.impact === 'MEDIUM' ? 'text-warn border-warn' : 'text-muted-foreground'
                    )}
                  >
                    {n.impact}
                  </Badge>
                  <span className="font-medium truncate flex-1">{n.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(n.eventTime).toLocaleString('id-ID', {
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Jakarta',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </PanelCard>
      </div>
    </div>
  );
}

function RiskRow({
  label,
  limit,
  status,
  current,
}: {
  label: string;
  limit: string;
  status: 'OK' | 'WARN' | 'HIT';
  current: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0 tabular-nums">
          {limit}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">{current}</span>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] px-1.5 py-0',
            status === 'OK' && 'text-bull border-bull',
            status === 'WARN' && 'text-warn border-warn',
            status === 'HIT' && 'text-bear border-bear'
          )}
        >
          {status}
        </Badge>
      </div>
    </div>
  );
}

function SessionTimeline() {
  // Show 24h timeline with session markers
  const now = new Date();
  const wibHour = (now.getUTCHours() + 7) % 24;
  const wibMin = now.getUTCMinutes();
  const currentWib = wibHour + wibMin / 60;

  const sessions = [
    { name: 'Sydney', start: 5, end: 14, color: 'bg-muted', trade: false },
    { name: 'Tokyo', start: 9, end: 12, color: 'bg-info/40', trade: true },
    { name: 'London', start: 14, end: 17, color: 'bg-bull/40', trade: true },
    { name: 'Lunch', start: 17, end: 19.5, color: 'bg-muted', trade: false },
    { name: 'Overlap', start: 19.5, end: 23, color: 'bg-bull/60', trade: true },
  ];

  return (
    <div className="pt-3">
      {/* Timeline */}
      <div className="relative h-10 rounded-md border bg-muted/20 overflow-hidden">
        {sessions.map((s) => (
          <div
            key={s.name}
            className={cn('absolute top-0 bottom-0 flex items-center justify-center text-[10px] font-medium', s.color)}
            style={{
              left: `${(s.start / 24) * 100}%`,
              width: `${((s.end - s.start) / 24) * 100}%`,
            }}
            title={`${s.name} ${Math.floor(s.start)}:00-${Math.floor(s.end)}:00 WIB`}
          >
            {s.name}
          </div>
        ))}
        {/* Current time marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-foreground"
          style={{ left: `${(currentWib / 24) * 100}%` }}
        >
          <div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-foreground" />
        </div>
      </div>
      {/* Hour labels */}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      <div className="mt-2 text-xs">
        <span className="text-muted-foreground">WIB sekarang: </span>
        <span className="font-semibold tabular-nums">
          {String(wibHour).padStart(2, '0')}:{String(wibMin).padStart(2, '0')}
        </span>
        <span className="ml-2">
          {(() => {
            const current = sessions.find((s) => currentWib >= s.start && currentWib < s.end);
            if (!current) return <Badge variant="outline" className="text-[10px]">SKIP</Badge>;
            return current.trade ? (
              <Badge variant="outline" className="text-[10px] text-bull border-bull">
                TRADE · {current.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                SKIP · {current.name}
              </Badge>
            );
          })()}
        </span>
      </div>
    </div>
  );
}
