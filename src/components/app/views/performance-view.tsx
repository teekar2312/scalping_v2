'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  Calendar,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Info,
  Target,
  Award,
  Flame,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';
import { PanelCard, StatCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  getBenchmark,
  getRatios,
  getSeasonality,
  getSeasonalityScore,
} from '@/lib/api';
import type {
  BenchmarkResult,
  PerformanceRatios,
  SeasonalityAnalysis,
  SeasonalityScore,
} from '@/lib/types';

function fmtPct(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function fmtNum(n: number, digits = 2): string {
  return n.toFixed(digits);
}

function winRateColor(wr: number): string {
  if (wr >= 65) return 'bg-bull';
  if (wr >= 55) return 'bg-bull/70';
  if (wr >= 50) return 'bg-warn/60';
  if (wr >= 40) return 'bg-warn';
  return 'bg-bear';
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-bull';
  if (score >= 30) return 'text-bull/80';
  if (score >= 0) return 'text-warn';
  return 'text-bear';
}

function scoreBadge(label: SeasonalityScore['label']): string {
  switch (label) {
    case 'HIGHLY_FAVORABLE': return 'border-bull text-bull bg-bull/10';
    case 'FAVORABLE': return 'border-bull/70 text-bull/80 bg-bull/5';
    case 'NEUTRAL': return 'border-warn text-warn bg-warn/5';
    case 'AVOID': return 'border-bear text-bear bg-bear/10';
  }
}

export function PerformanceView() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [ratios, setRatios] = useState<PerformanceRatios | null>(null);
  const [seasonality, setSeasonality] = useState<SeasonalityAnalysis | null>(null);
  const [score, setScore] = useState<SeasonalityScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [start, setStart] = useState(ninetyDaysAgo);
  const [end, setEnd] = useState(today);
  const [scoreDate, setScoreDate] = useState(today);

  const refresh = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      try {
        const [bm, rt, sea, sc] = await Promise.all([
          getBenchmark(start, end),
          getRatios(),
          getSeasonality(),
          getSeasonalityScore(scoreDate),
        ]);
        setBenchmark(bm);
        setRatios(rt);
        setSeasonality(sea);
        setScore(sc);
      } catch (e) {
        if (!silent)
          toast({ title: 'Gagal memuat performance', description: String(e), variant: 'destructive' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [start, end, scoreDate],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!scoreDate) return;
    getSeasonalityScore(scoreDate).then(setScore).catch(() => {});
  }, [scoreDate]);

  useEffect(() => {
    if (!start || !end) return;
    getBenchmark(start, end).then(setBenchmark).catch(() => {});
  }, [start, end]);

  if (loading && !benchmark) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading performance &amp; benchmark…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Performance &amp; benchmark — bandingkan bot vs Buy&amp;Hold vs Random. Ratios dihitung dari equity curve historis.
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => refresh(true)}
          disabled={refreshing}
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="benchmark" className="w-full">
        <TabsList>
          <TabsTrigger value="benchmark" className="text-xs">
            <BarChart3 className="mr-1 h-3 w-3" /> Benchmark
          </TabsTrigger>
          <TabsTrigger value="seasonality" className="text-xs">
            <Calendar className="mr-1 h-3 w-3" /> Seasonality
          </TabsTrigger>
          <TabsTrigger value="ratios" className="text-xs">
            <Award className="mr-1 h-3 w-3" /> Ratios
          </TabsTrigger>
        </TabsList>

        {/* === BENCHMARK TAB === */}
        <TabsContent value="benchmark">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Start date</Label>
                <Input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value || thirtyDaysAgo)}
                  className="h-8 w-44 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">End date</Label>
                <Input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value || today)}
                  className="h-8 w-44 text-xs"
                />
              </div>
              <Badge variant="outline" className="text-xs">
                {benchmark?.series.length ?? 0} hari
              </Badge>
              <div className="ml-auto flex items-center gap-2">
                <Badge
                  variant={benchmark && benchmark.alpha >= 0 ? 'default' : 'destructive'}
                  className="gap-1"
                >
                  {benchmark && benchmark.alpha >= 0
                    ? <TrendingUp className="h-3 w-3" />
                    : <TrendingDown className="h-3 w-3" />}
                  Alpha {benchmark ? fmtPct(benchmark.alpha) : '—'}
                </Badge>
                <Badge variant={benchmark?.significant ? 'default' : 'secondary'} className="gap-1">
                  <Target className="h-3 w-3" />
                  p={benchmark ? benchmark.p_value.toFixed(4) : '—'}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCard
                label="Bot P&L"
                value={benchmark ? fmtPct(benchmark.bot_pnl_pct) : '—'}
                icon={TrendingUp}
                variant={benchmark && benchmark.bot_pnl_pct >= 0 ? 'bull' : 'bear'}
                trendValue={`Sharpe ${benchmark ? benchmark.bot_sharpe.toFixed(2) : '—'}`}
                trend={benchmark && benchmark.bot_pnl_pct >= 0 ? 'up' : 'down'}
              />
              <StatCard
                label="Buy & Hold P&L"
                value={benchmark ? fmtPct(benchmark.buy_hold_pnl_pct) : '—'}
                icon={BarChart3}
                variant="default"
                trendValue={`Sharpe ${benchmark ? benchmark.buy_hold_sharpe.toFixed(2) : '—'}`}
                trend={benchmark && benchmark.buy_hold_pnl_pct >= 0 ? 'up' : 'down'}
              />
              <StatCard
                label="Random Baseline P&L"
                value={benchmark ? fmtPct(benchmark.random_pnl_pct) : '—'}
                icon={TrendingDown}
                variant={benchmark && benchmark.random_pnl_pct >= 0 ? 'bull' : 'bear'}
                trendValue="deterministic random walk"
                trend="neutral"
              />
            </div>

            <PanelCard
              title="Cumulative Equity — Bot vs Buy&amp;Hold vs Random"
              subtitle="Outperformance gap semakin lebar = bot semakin unggul"
              icon={TrendingUp}
            >
              <div className="h-[360px] w-full">
                {benchmark && benchmark.series.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={benchmark.series} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: 'currentColor' }}
                        tickFormatter={(d: string) => d.slice(5)}
                        minTickGap={24}
                      />
                      <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} width={70} />
                      <RTooltip
                        contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        formatter={(v: number) => `$${v.toFixed(2)}`}
                      />
                      <Line type="monotone" dataKey="bot_equity" stroke="#10b981" strokeWidth={2} dot={false} name="Bot" />
                      <Line type="monotone" dataKey="buy_hold_equity" stroke="#3b82f6" strokeWidth={2} dot={false} name="Buy&Hold" />
                      <Line type="monotone" dataKey="random_equity" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Random" />
                      <ReferenceLine y={10000} stroke="#6b7280" strokeDasharray="2 2" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No benchmark data
                  </div>
                )}
              </div>
            </PanelCard>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCard
                label="Outperformance"
                value={benchmark ? fmtPct(benchmark.outperformance_pct) : '—'}
                icon={TrendingUp}
                variant={benchmark && benchmark.outperformance_pct >= 0 ? 'bull' : 'bear'}
              />
              <StatCard
                label="Beta vs market"
                value={benchmark ? fmtNum(benchmark.beta) : '—'}
                icon={Target}
                variant="default"
                trendValue="target 0-1 market-neutral"
              />
              <StatCard
                label="Statistical significance"
                value={benchmark ? (benchmark.significant ? 'SIGNIFICANT' : 'NOT SIGNIFICANT') : '—'}
                icon={Award}
                variant={benchmark?.significant ? 'bull' : 'bear'}
              />
            </div>
          </div>
        </TabsContent>

        {/* === SEASONALITY TAB === */}
        <TabsContent value="seasonality">
          <div className="flex flex-col gap-4">
            {/* Day-of-week heatmap */}
            <PanelCard
              title="Day-of-Week Heatmap"
              subtitle="Win rate per weekday (Mon-Sun)"
              icon={Calendar}
            >
              <div className="grid grid-cols-7 gap-2 p-2">
                {seasonality?.by_day_of_week.map((d) => (
                  <div
                    key={d.day}
                    className={cn(
                      'flex flex-col items-center justify-center rounded-md p-3 text-xs',
                      winRateColor(d.win_rate),
                      'text-white',
                    )}
                  >
                    <span className="font-semibold">{d.day}</span>
                    <span className="text-sm font-bold tabular-nums">{d.win_rate}%</span>
                    <span className="opacity-90">{d.trades} trades</span>
                    <span className="opacity-90">R {d.r_net >= 0 ? '+' : ''}{d.r_net.toFixed(2)}</span>
                  </div>
                )) ?? []}
              </div>
            </PanelCard>

            {/* Month bar chart */}
            <PanelCard
              title="Monthly Win Rate & R-Net"
              subtitle="Jan-Dec · bars colored by win rate"
              icon={BarChart3}
            >
              <div className="h-[280px] w-full">
                {seasonality && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={seasonality.by_month} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'currentColor' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} width={40} domain={[0, 100]} />
                      <RTooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                      <ReferenceLine y={50} stroke="#9ca3af" strokeDasharray="2 2" label={{ value: '50%', fontSize: 10 }} />
                      <Bar dataKey="win_rate" radius={[3, 3, 0, 0]}>
                        {seasonality.by_month.map((m) => (
                          <Cell
                            key={m.month}
                            fill={
                              m.win_rate >= 65 ? '#10b981' :
                              m.win_rate >= 55 ? '#34d399' :
                              m.win_rate >= 50 ? '#f59e0b' :
                              m.win_rate >= 40 ? '#fb923c' : '#ef4444'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </PanelCard>

            {/* Hour-of-day table + session comparison */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PanelCard
                title="Hour-of-Day Performance (WIB)"
                subtitle="Trading sessions highlighted"
                icon={Calendar}
                bodyClassName="p-0"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Hour</TableHead>
                      <TableHead className="text-xs">Trades</TableHead>
                      <TableHead className="text-xs">Win %</TableHead>
                      <TableHead className="text-xs">R-net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seasonality?.by_hour
                      .filter((h) => h.trades > 0)
                      .map((h) => (
                        <TableRow key={h.hour}>
                          <TableCell className="text-xs font-mono">
                            {String(h.hour).padStart(2, '0')}:00
                          </TableCell>
                          <TableCell className="text-xs">{h.trades}</TableCell>
                          <TableCell className={cn('text-xs font-medium', scoreColor(h.win_rate - 50))}>
                            {h.win_rate}%
                          </TableCell>
                          <TableCell className={cn('text-xs font-medium', h.r_net >= 0 ? 'text-bull' : 'text-bear')}>
                            {h.r_net >= 0 ? '+' : ''}{h.r_net.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      )) ?? []}
                  </TableBody>
                </Table>
              </PanelCard>

              <PanelCard
                title="Session Comparison"
                subtitle="Tokyo · London · Overlap · Sydney"
                icon={Award}
                bodyClassName="p-0"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Session</TableHead>
                      <TableHead className="text-xs">Trades</TableHead>
                      <TableHead className="text-xs">Win %</TableHead>
                      <TableHead className="text-xs">P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seasonality?.by_session.map((s) => (
                      <TableRow key={s.session}>
                        <TableCell className="text-xs font-semibold">{s.session}</TableCell>
                        <TableCell className="text-xs">{s.trades}</TableCell>
                        <TableCell className={cn('text-xs font-medium', scoreColor(s.win_rate - 50))}>
                          {s.win_rate}%
                        </TableCell>
                        <TableCell className={cn('text-xs font-medium', s.profit >= 0 ? 'text-bull' : 'text-bear')}>
                          {s.profit >= 0 ? '+' : ''}${s.profit.toFixed(0)}
                        </TableCell>
                      </TableRow>
                    )) ?? []}
                  </TableBody>
                </Table>
              </PanelCard>
            </div>

            {/* Best/worst + today's score */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <PanelCard title="Best Trading Days" subtitle="Highest win rate" icon={TrendingUp}>
                <ul className="flex flex-col gap-1 p-2 text-xs">
                  {seasonality?.best_days.map((d) => (
                    <li key={d} className="flex items-center gap-2">
                      <Award className="h-3 w-3 text-bull" />
                      <span className="font-semibold">{d}</span>
                    </li>
                  )) ?? []}
                </ul>
              </PanelCard>

              <PanelCard title="Best Trading Months" subtitle="Highest win rate" icon={Calendar}>
                <ul className="flex flex-col gap-1 p-2 text-xs">
                  {seasonality?.best_months.map((m) => (
                    <li key={m} className="flex items-center gap-2">
                      <Award className="h-3 w-3 text-bull" />
                      <span className="font-semibold">{m}</span>
                    </li>
                  )) ?? []}
                </ul>
              </PanelCard>

              <PanelCard title="Today's Seasonality Score" subtitle="Should you trade today?" icon={Flame}>
                <div className="flex flex-col gap-2 p-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={scoreDate}
                      onChange={(e) => setScoreDate(e.target.value || today)}
                      className="h-7 w-36 text-xs"
                    />
                  </div>
                  {score && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{score.day_of_week}</span>
                        <Badge variant="outline" className={cn('text-xs', scoreBadge(score.label))}>
                          {score.label}
                        </Badge>
                      </div>
                      <div className={cn('text-2xl font-bold tabular-nums', scoreColor(score.score))}>
                        {score.score > 0 ? '+' : ''}{score.score}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Expected win rate: <span className="font-semibold">{score.expected_win_rate}%</span> · R-net: <span className="font-semibold">{score.expected_r_net >= 0 ? '+' : ''}{score.expected_r_net.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground italic">{score.rationale}</p>
                    </div>
                  )}
                </div>
              </PanelCard>
            </div>
          </div>
        </TabsContent>

        {/* === RATIOS TAB === */}
        <TabsContent value="ratios">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <RatioCard
                label="Sharpe Ratio"
                value={ratios?.sharpe}
                threshold={1.0}
                explanation="Risk-adjusted return. > 1.0 = good, > 2.0 = excellent. Bot V2 target: ≥ 1.5."
                goodIf="greater"
              />
              <RatioCard
                label="Sortino Ratio"
                value={ratios?.sortino}
                threshold={1.5}
                explanation="Sharpe variant yang hanya menghitung downside volatility. > 1.5 = sehat."
                goodIf="greater"
              />
              <RatioCard
                label="Alpha"
                value={ratios?.alpha}
                threshold={0}
                explanation="Excess return vs market benchmark. Positive = bot mengalahkan Buy&amp;Hold."
                goodIf="greater"
                suffix="%"
              />
              <RatioCard
                label="Beta"
                value={ratios?.beta}
                threshold={1}
                explanation="Sensitivity vs market. 0-1 = market-neutral (target V2). > 1 = lebih volatile dari market."
                goodIf="less"
              />
              <RatioCard
                label="Calmar Ratio"
                value={ratios?.calmar}
                threshold={1.0}
                explanation="Annual return / max drawdown. > 1.0 = sehat, > 3.0 = excellent."
                goodIf="greater"
              />
              <RatioCard
                label="Max Drawdown"
                value={ratios?.max_drawdown_pct}
                threshold={-8}
                explanation="Worst peak-to-trough loss. V2 weekly stop -4%, overall -10%. Closer to 0 = better."
                goodIf="greater"
                suffix="%"
              />
            </div>

            <PanelCard
              title="Additional Risk-Adjusted Metrics"
              subtitle="Capture ratios, information & Treynor"
              icon={Info}
              bodyClassName="p-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Metric</TableHead>
                    <TableHead className="text-xs">Value</TableHead>
                    <TableHead className="text-xs">Interpretation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Volatility (annualized)</TableCell>
                    <TableCell className="text-xs tabular-nums">{ratios ? fmtNum(ratios.volatility_pct) : '—'}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">Lower is better</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Downside Deviation</TableCell>
                    <TableCell className="text-xs tabular-nums">{ratios ? fmtNum(ratios.downside_deviation_pct) : '—'}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">Negative returns only</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Up Capture Ratio</TableCell>
                    <TableCell className="text-xs tabular-nums">{ratios ? fmtNum(ratios.up_capture * 100, 1) : '—'}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">% of market upside captured</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Down Capture Ratio</TableCell>
                    <TableCell className="text-xs tabular-nums">{ratios ? fmtNum(ratios.down_capture * 100, 1) : '—'}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">% of market downside captured</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Information Ratio</TableCell>
                    <TableCell className="text-xs tabular-nums">{ratios ? fmtNum(ratios.information_ratio) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">Active return / tracking error</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Treynor Ratio</TableCell>
                    <TableCell className="text-xs tabular-nums">{ratios ? fmtNum(ratios.treynor_ratio) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">Excess return per unit of beta</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </PanelCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface RatioCardProps {
  label: string;
  value: number | undefined;
  threshold: number;
  explanation: string;
  goodIf: 'greater' | 'less';
  suffix?: string;
}

function RatioCard({ label, value, threshold, explanation, goodIf, suffix }: RatioCardProps) {
  const isGood = value !== undefined && (goodIf === 'greater' ? value >= threshold : value <= threshold);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-xs font-medium text-muted-foreground underline decoration-dotted">
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px]">
            {explanation}
          </TooltipContent>
        </Tooltip>
        <Info className="h-3 w-3 text-muted-foreground" />
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          value === undefined ? 'text-muted-foreground' : isGood ? 'text-bull' : 'text-bear',
        )}
      >
        {value === undefined ? '—' : `${value > 0 && suffix === '%' ? '+' : ''}${value.toFixed(2)}${suffix ?? ''}`}
      </div>
      <div className="text-[10px] text-muted-foreground">
        Threshold: {goodIf === 'greater' ? '≥' : '≤'} {threshold}{suffix ?? ''}
      </div>
    </div>
  );
}
