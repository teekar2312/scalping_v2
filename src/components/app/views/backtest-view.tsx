'use client';

import { useState } from 'react';
import {
  FlaskConical,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Dice5,
  Repeat,
  Activity,
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  runBacktest,
  runMonteCarlo,
  runWalkForward,
} from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  BACKTEST_SYMBOLS,
  BACKTEST_TIMEFRAMES,
  TRADING_PAIRS,
  V2_BACKTEST_TARGETS,
} from '@/lib/constants';
import { cn } from '@/lib/utils';
import type {
  BacktestResult,
  BacktestRequest,
  MonteCarloResult,
  MonteCarloRequest,
  WalkForwardResult,
  WalkForwardRequest,
} from '@/lib/types';

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().split('T')[0];
}

function passFail(value: number, target: number, mode: 'ge' | 'le'): boolean {
  return mode === 'ge' ? value >= target : value <= target;
}

function PassFailBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] gap-1',
        pass ? 'text-bull border-bull' : 'text-bear border-bear',
      )}
    >
      {pass ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </Badge>
  );
}

export function BacktestView() {
  // --- Backtest form state --- //
  const [symbol, setSymbol] = useState<string>('EURUSD');
  const [timeframe, setTimeframe] = useState<string>('M5');
  const [startDate, setStartDate] = useState<string>(daysAgoISO(180));
  const [endDate, setEndDate] = useState<string>(todayISO());
  const [initialBalance, setInitialBalance] = useState<number>(10000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  // --- Monte Carlo state --- //
  const [mcIterations, setMcIterations] = useState<number>(500);
  const [mcTradePeriod, setMcTradePeriod] = useState<number>(90);
  const [mcInitialBalance, setMcInitialBalance] = useState<number>(10000);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);

  // --- Walk-forward state --- //
  const [wfInSample, setWfInSample] = useState<number>(60);
  const [wfOutSample, setWfOutSample] = useState<number>(30);
  const [wfInitialBalance, setWfInitialBalance] = useState<number>(10000);
  const [wfRunning, setWfRunning] = useState(false);
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);

  const handleRun = async () => {
    setRunning(true);
    try {
      const req: BacktestRequest = {
        symbol,
        timeframe,
        start_date: startDate,
        end_date: endDate,
        initial_balance: initialBalance,
      };
      const r = await runBacktest(req);
      setResult(r);
      toast({
        title: 'Backtest selesai',
        description: `${r.total_trades} trades · WR ${r.win_rate_pct.toFixed(1)}% · PF ${r.profit_factor.toFixed(2)} · DD ${r.max_drawdown_pct.toFixed(2)}%`,
      });
    } catch (e) {
      toast({
        title: 'Backtest gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  };

  const handleRunMonteCarlo = async () => {
    setMcRunning(true);
    try {
      const req: MonteCarloRequest = {
        iterations: mcIterations,
        trade_period_days: mcTradePeriod,
        initial_balance: mcInitialBalance,
      };
      const r = await runMonteCarlo(req);
      setMcResult(r);
      toast({
        title: 'Monte Carlo selesai',
        description: `${r.iterations} runs · survival ${r.survival_rate_pct.toFixed(1)}% · median $${r.median_final_balance.toFixed(0)}`,
      });
    } catch (e) {
      toast({
        title: 'Monte Carlo gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setMcRunning(false);
    }
  };

  const handleRunWalkForward = async () => {
    setWfRunning(true);
    try {
      const req: WalkForwardRequest = {
        in_sample_window_days: wfInSample,
        out_sample_window_days: wfOutSample,
        initial_balance: wfInitialBalance,
      };
      const r = await runWalkForward(req);
      setWfResult(r);
      toast({
        title: 'Walk-forward selesai',
        description: `${r.total_windows} windows · avg degradation ${r.avg_degradation_pct.toFixed(1)}% · ${r.stable ? 'STABLE' : 'UNSTABLE'}`,
      });
    } catch (e) {
      toast({
        title: 'Walk-forward gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setWfRunning(false);
    }
  };

  // Build equity curve from trades
  const equityCurve = result
    ? result.trades.reduce<
        Array<{ idx: number; time: string; balance: number }>
      >((acc, t, idx) => {
        const prev = idx === 0 ? result.initial_balance : acc[idx - 1].balance;
        acc.push({
          idx: idx + 1,
          time: t.close_time,
          balance: parseFloat((prev + t.profit).toFixed(2)),
        });
        return acc;
      }, [])
    : [];

  const totalR = result
    ? result.trades.reduce((a, b) => a + b.r_multiple, 0)
    : 0;
  const avgR = result ? totalR / result.total_trades : 0;

  // V2 target pass/fail verdict
  const passWinRate = result ? passFail(result.win_rate_pct, V2_BACKTEST_TARGETS.WIN_RATE_PCT, 'ge') : false;
  const passPF = result ? passFail(result.profit_factor, V2_BACKTEST_TARGETS.PROFIT_FACTOR, 'ge') : false;
  const passDD = result ? passFail(result.max_drawdown_pct, V2_BACKTEST_TARGETS.MAX_DRAWDOWN_PCT, 'le') : false;
  const passR = result ? passFail(avgR, V2_BACKTEST_TARGETS.MIN_R_PER_TRADE, 'ge') : false;
  const passCount = result ? result.total_trades >= V2_BACKTEST_TARGETS.MIN_TRADES : false;
  const passCompliance = result
    ? passFail(result.compliance_score_pct, V2_BACKTEST_TARGETS.COMPLIANCE_SCORE_PCT, 'ge')
    : false;
  const overallPass = passWinRate && passPF && passDD && passR && passCount && passCompliance;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Tabs defaultValue="backtest">
        <TabsList>
          <TabsTrigger value="backtest" className="text-xs gap-1">
            <FlaskConical className="h-3.5 w-3.5" />
            Backtest
          </TabsTrigger>
          <TabsTrigger value="monte-carlo" className="text-xs gap-1">
            <Dice5 className="h-3.5 w-3.5" />
            Monte Carlo
          </TabsTrigger>
          <TabsTrigger value="walk-forward" className="text-xs gap-1">
            <Repeat className="h-3.5 w-3.5" />
            Walk-Forward
          </TabsTrigger>
        </TabsList>

        {/* =================== Backtest tab (existing) =================== */}
        <TabsContent value="backtest">
          <div className="flex flex-col gap-4">
      {/* Header / form */}
      <PanelCard
        title="Backtest Engine V2"
        subtitle="300-trade mandatory backtest sebelum live (Roadmap F2)"
        icon={FlaskConical}
      >
        <div className="pt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKTEST_SYMBOLS.map((s) => {
                  const pair = TRADING_PAIRS.find((p) => p.symbol === s);
                  return (
                    <SelectItem key={s} value={s}>
                      {pair?.name ?? s}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Timeframe</Label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKTEST_TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Initial Balance (USD)</Label>
            <Input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] text-muted-foreground">
            V2 mandatory: <strong>≥ {V2_BACKTEST_TARGETS.MIN_TRADES} trade</strong>,
            win ≥ {V2_BACKTEST_TARGETS.WIN_RATE_PCT}%,
            PF ≥ {V2_BACKTEST_TARGETS.PROFIT_FACTOR},
            DD ≤ {V2_BACKTEST_TARGETS.MAX_DRAWDOWN_PCT}%,
            R ≥ +{V2_BACKTEST_TARGETS.MIN_R_PER_TRADE}R/trade.
            Statistical significance ±0.1R.
          </div>
          <Button onClick={handleRun} disabled={running} className="gap-1.5">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running backtest…' : 'Run Backtest'}
          </Button>
        </div>
      </PanelCard>

      {result && (
        <>
          {/* Verdict banner */}
          <div
            className={cn(
              'rounded-md border p-3 flex items-center gap-3',
              overallPass
                ? 'border-bull/40 bg-bull/10'
                : 'border-bear/40 bg-bear/10',
            )}
          >
            {overallPass ? (
              <CheckCircle2 className="h-6 w-6 text-bull shrink-0" />
            ) : (
              <XCircle className="h-6 w-6 text-bear shrink-0" />
            )}
            <div className="text-sm flex-1">
              <div className={cn('font-semibold', overallPass ? 'text-bull' : 'text-bear')}>
                {overallPass
                  ? 'PASS — semua V2 target tercapai, lanjut ke Forward Demo (F3)'
                  : 'FAIL — beberapa target V2 belum tercapai, jangan lanjut ke live'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-1.5">
                <PassFailBadge pass={passCount} label={`Trades ≥ ${V2_BACKTEST_TARGETS.MIN_TRADES}`} />
                <PassFailBadge pass={passWinRate} label={`WR ≥ ${V2_BACKTEST_TARGETS.WIN_RATE_PCT}%`} />
                <PassFailBadge pass={passPF} label={`PF ≥ ${V2_BACKTEST_TARGETS.PROFIT_FACTOR}`} />
                <PassFailBadge pass={passDD} label={`DD < ${V2_BACKTEST_TARGETS.MAX_DRAWDOWN_PCT}%`} />
                <PassFailBadge pass={passR} label={`R ≥ +${V2_BACKTEST_TARGETS.MIN_R_PER_TRADE}`} />
                <PassFailBadge pass={passCompliance} label={`Compliance ≥ ${V2_BACKTEST_TARGETS.COMPLIANCE_SCORE_PCT}%`} />
              </div>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Total Trades" value={result.total_trades} icon={FlaskConical} variant={passCount ? 'bull' : 'bear'} />
            <StatCard
              label="Win Rate"
              value={result.win_rate_pct.toFixed(1)}
              unit="%"
              variant={passWinRate ? 'bull' : 'bear'}
              trendValue={`target ≥ ${V2_BACKTEST_TARGETS.WIN_RATE_PCT}%`}
            />
            <StatCard
              label="Profit Factor"
              value={result.profit_factor.toFixed(2)}
              variant={passPF ? 'bull' : 'bear'}
              trendValue={`target ≥ ${V2_BACKTEST_TARGETS.PROFIT_FACTOR}`}
            />
            <StatCard
              label="Max Drawdown"
              value={result.max_drawdown_pct.toFixed(2)}
              unit="%"
              variant={passDD ? 'bull' : 'bear'}
              trendValue={`target < ${V2_BACKTEST_TARGETS.MAX_DRAWDOWN_PCT}%`}
            />
            <StatCard
              label="R-Net Total"
              value={`${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}`}
              unit="R"
              variant={totalR >= 0 ? 'bull' : 'bear'}
            />
            <StatCard
              label="Avg R / Trade"
              value={avgR.toFixed(3)}
              unit="R"
              variant={passR ? 'bull' : 'bear'}
              trendValue={`target ≥ +${V2_BACKTEST_TARGETS.MIN_R_PER_TRADE}R`}
            />
            <StatCard
              label="Compliance"
              value={result.compliance_score_pct.toFixed(0)}
              unit="%"
              variant={passCompliance ? 'bull' : 'bear'}
              trendValue={`target ≥ ${V2_BACKTEST_TARGETS.COMPLIANCE_SCORE_PCT}%`}
            />
          </div>

          {/* Equity curve */}
          <PanelCard
            title="Equity Curve"
            subtitle={`${result.symbol} · ${result.timeframe} · ${result.initial_balance.toLocaleString()} → ${result.final_balance.toLocaleString()} USD`}
            icon={TrendingUp}
            bodyClassName="h-[300px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={equityCurve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="btEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--bull)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--bull)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="idx"
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  label={{ value: 'Trade #', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--muted-foreground)' }}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={70}
                  tickFormatter={(v) => Number(v).toLocaleString()}
                  orientation="right"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  labelStyle={{ color: 'var(--muted-foreground)' }}
                  formatter={(value: number | string) => [Number(value).toLocaleString(), 'Balance']}
                  labelFormatter={(v: number) => `Trade #${v}`}
                />
                <ReferenceLine
                  y={result.initial_balance}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 3"
                  label={{ value: 'Initial', fontSize: 9, fill: 'var(--muted-foreground)' }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--bull)"
                  strokeWidth={1.5}
                  fill="url(#btEquity)"
                  name="Equity"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </PanelCard>

          {/* Trade list */}
          <PanelCard
            title="Trade List"
            subtitle={`${result.trades.length} simulated trades`}
            icon={FlaskConical}
          >
            <div className="pt-3">
              <div className="overflow-x-auto scroll-thin max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 px-2 font-medium">#</th>
                      <th className="text-left font-medium">Open</th>
                      <th className="text-left font-medium">Close</th>
                      <th className="text-left font-medium">Dir</th>
                      <th className="text-right font-medium">Entry</th>
                      <th className="text-right font-medium">Exit</th>
                      <th className="text-right font-medium">SL (pip)</th>
                      <th className="text-left font-medium">Setup</th>
                      <th className="text-left font-medium">Session</th>
                      <th className="text-right font-medium">Result</th>
                      <th className="text-right font-medium">R</th>
                      <th className="text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(0, 100).map((t, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-accent/30">
                        <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="tabular-nums text-[10px]">
                          {new Date(t.open_time).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Jakarta',
                          })}
                        </td>
                        <td className="tabular-nums text-[10px]">
                          {new Date(t.close_time).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Jakarta',
                          })}
                        </td>
                        <td>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] px-1.5',
                              t.direction === 'BUY' ? 'text-bull border-bull' : 'text-bear border-bear',
                            )}
                          >
                            {t.direction}
                          </Badge>
                        </td>
                        <td className="text-right tabular-nums">{t.open_price}</td>
                        <td className="text-right tabular-nums">{t.close_price}</td>
                        <td className="text-right tabular-nums">{t.pips?.toFixed(1) ?? '—'}</td>
                        <td className="text-left text-[10px]">{t.setup_type ?? '—'}</td>
                        <td className="text-left text-[10px]">{t.session ?? '—'}</td>
                        <td>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] px-1.5',
                              t.result === 'WIN' && 'text-bull border-bull',
                              t.result === 'LOSS' && 'text-bear border-bear',
                              t.result === 'BREAKEVEN' && 'text-muted-foreground',
                            )}
                          >
                            {t.result}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            'text-right tabular-nums font-semibold',
                            t.r_multiple > 0 && 'text-bull',
                            t.r_multiple < 0 && 'text-bear',
                          )}
                        >
                          {t.r_multiple >= 0 ? '+' : ''}
                          {t.r_multiple.toFixed(2)}R
                        </td>
                        <td
                          className={cn(
                            'text-right tabular-nums font-semibold',
                            t.profit >= 0 ? 'text-bull' : 'text-bear',
                          )}
                        >
                          {t.profit >= 0 ? '+' : ''}
                          {t.profit.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.trades.length > 100 && (
                  <div className="text-center text-[10px] text-muted-foreground py-2">
                    Showing first 100 of {result.trades.length} trades.
                  </div>
                )}
              </div>
            </div>
          </PanelCard>

          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-info shrink-0 mt-0.5" />
            <div>
              <strong className="text-info">Disclaimer:</strong> Past performance pada backtest
              bukan jaminan hasil di live trading. Slippage, spread widening di news,
              broker rejections, dan connectivity losses dapat menyebabkan realised
              losses melebihi 1% risk per trade. Lanjutkan ke Forward Demo (F3)
              setelah backtest PASS untuk validasi real-time 3 bulan.
            </div>
          </div>
        </>
      )}

      {!result && !running && (
        <PanelCard
          title="Ready to Backtest"
          subtitle="Konfigurasikan parameter di atas lalu klik Run Backtest"
          icon={FlaskConical}
        >
          <div className="pt-3 text-sm text-muted-foreground">
            V2 Roadmap F2 mensyaratkan <strong>300-trade backtest</strong> pada data
            historis 6 bulan terakhir sebelum akun mikro live (F4). Gunakan pair utama
            (EUR/USD, GBP/USD, USD/JPY) di timeframe M5 atau M15.
          </div>
        </PanelCard>
      )}
          </div>
        </TabsContent>

        {/* =================== Monte Carlo tab =================== */}
        <TabsContent value="monte-carlo">
          <div className="flex flex-col gap-4">
            <PanelCard
              title="Monte Carlo Simulation"
              subtitle="Resample trade sequence N times → survival rate & distribution"
              icon={Dice5}
            >
              <div className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Iterations</Label>
                  <Select value={String(mcIterations)} onValueChange={(v) => setMcIterations(parseInt(v))}>
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[100, 500, 1000, 5000].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n.toLocaleString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Trade Period (days)</Label>
                  <Input
                    type="number"
                    value={mcTradePeriod}
                    onChange={(e) => setMcTradePeriod(parseInt(e.target.value) || 90)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Initial Balance (USD)</Label>
                  <Input
                    type="number"
                    value={mcInitialBalance}
                    onChange={(e) => setMcInitialBalance(parseFloat(e.target.value) || 0)}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleRunMonteCarlo}
                    disabled={mcRunning}
                    className="w-full gap-1.5"
                  >
                    {mcRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {mcRunning ? 'Running…' : 'Run Monte Carlo'}
                  </Button>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Monte Carlo mengacak urutan trade hasil backtest untuk mengukur
                variansi outcome. <strong>Survival rate &gt; 95%</strong> berarti
                strategi robust terhadap urutan trade yang tidak menguntungkan.
              </div>
            </PanelCard>

            {mcResult && (
              <>
                {/* Verdict */}
                <div
                  className={cn(
                    'rounded-md border p-3 flex items-center gap-3',
                    mcResult.survival_rate_pct > 95
                      ? 'border-bull/40 bg-bull/10'
                      : mcResult.survival_rate_pct > 80
                      ? 'border-warn/40 bg-warn/10'
                      : 'border-bear/40 bg-bear/10',
                  )}
                >
                  {mcResult.survival_rate_pct > 95 ? (
                    <CheckCircle2 className="h-6 w-6 text-bull shrink-0" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-warn shrink-0" />
                  )}
                  <div className="text-sm flex-1">
                    <div
                      className={cn(
                        'font-semibold',
                        mcResult.survival_rate_pct > 95 ? 'text-bull' : 'text-warn',
                      )}
                    >
                      Survival Rate: {mcResult.survival_rate_pct.toFixed(2)}%
                      ({mcResult.iterations - mcResult.blow_ups}/{mcResult.iterations} runs survived)
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Median final balance: ${mcResult.median_final_balance.toFixed(2)} ·
                      P5–P95 range: ${mcResult.p5_final_balance.toFixed(0)} – ${mcResult.p95_final_balance.toFixed(0)}
                    </div>
                  </div>
                </div>

                {/* Summary stats */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <StatCard
                    label="Median Final"
                    value={mcResult.median_final_balance.toFixed(0)}
                    unit="USD"
                    variant="bull"
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Mean Final"
                    value={mcResult.mean_final_balance.toFixed(0)}
                    unit="USD"
                  />
                  <StatCard
                    label="Best"
                    value={mcResult.best_final_balance.toFixed(0)}
                    unit="USD"
                    variant="bull"
                  />
                  <StatCard
                    label="Worst"
                    value={mcResult.worst_final_balance.toFixed(0)}
                    unit="USD"
                    variant="bear"
                  />
                  <StatCard
                    label="Median Max DD"
                    value={mcResult.median_max_dd_pct.toFixed(2)}
                    unit="%"
                    variant="warn"
                  />
                  <StatCard
                    label="P95 Max DD"
                    value={mcResult.p95_max_dd_pct.toFixed(2)}
                    unit="%"
                    variant="bear"
                  />
                </div>

                {/* Distribution histogram */}
                <PanelCard
                  title="Final Balance Distribution"
                  subtitle={`${mcResult.iterations} iterations histogram`}
                  icon={Activity}
                  bodyClassName="h-[260px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={mcResult.distribution}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <XAxis dataKey="bucket" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                        formatter={(v: number) => [`${v} runs`, 'Count']}
                      />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {mcResult.distribution.map((b, i) => (
                          <Cell
                            key={i}
                            fill={b.lower >= mcInitialBalance ? 'var(--bull)' : 'var(--bear)'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </PanelCard>

                {/* Equity curve fan chart */}
                <PanelCard
                  title="Equity Curve Fan"
                  subtitle="Median + P5/P95 band per step"
                  icon={TrendingUp}
                  bodyClassName="h-[280px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={mcResult.fan}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="mcFan" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--info)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--info)" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="step"
                        tick={{ fontSize: 10 }}
                        stroke="var(--muted-foreground)"
                        label={{ value: 'Step', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--muted-foreground)' }}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="var(--muted-foreground)"
                        width={70}
                        tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
                        orientation="right"
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                        formatter={(v: number, n) => [`$${Number(v).toFixed(0)}`, n === 'median' ? 'Median' : n === 'p5' ? 'P5' : 'P95']}
                      />
                      <ReferenceLine
                        y={mcInitialBalance}
                        stroke="var(--muted-foreground)"
                        strokeDasharray="3 3"
                        label={{ value: 'Initial', fontSize: 9, fill: 'var(--muted-foreground)' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="p95"
                        stroke="none"
                        fill="url(#mcFan)"
                        name="p95"
                      />
                      <Area
                        type="monotone"
                        dataKey="p5"
                        stroke="none"
                        fill="var(--background)"
                        name="p5"
                      />
                      <Line
                        type="monotone"
                        dataKey="median"
                        stroke="var(--bull)"
                        strokeWidth={2}
                        dot={false}
                        name="median"
                      />
                      <Line
                        type="monotone"
                        dataKey="p5"
                        stroke="var(--bear)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        dot={false}
                        name="p5"
                      />
                      <Line
                        type="monotone"
                        dataKey="p95"
                        stroke="var(--info)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        dot={false}
                        name="p95"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </PanelCard>
              </>
            )}

            {!mcResult && !mcRunning && (
              <PanelCard
                title="Ready to Run Monte Carlo"
                subtitle="Konfigurasikan iterations di atas lalu klik Run"
                icon={Dice5}
              >
                <div className="pt-3 text-sm text-muted-foreground">
                  Monte Carlo menguji robustness strategi terhadap variansi urutan trade.
                  Lebih banyak iterations = lebih akurat distribusi (minimum 100 untuk
                  estimate kasar, 1000 untuk confidence interval ketat).
                </div>
              </PanelCard>
            )}
          </div>
        </TabsContent>

        {/* =================== Walk-Forward tab =================== */}
        <TabsContent value="walk-forward">
          <div className="flex flex-col gap-4">
            <PanelCard
              title="Walk-Forward Analysis"
              subtitle="In-sample → out-of-sample parameter stability test"
              icon={Repeat}
            >
              <div className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">In-Sample Window (days)</Label>
                  <Input
                    type="number"
                    value={wfInSample}
                    onChange={(e) => setWfInSample(parseInt(e.target.value) || 60)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Out-Sample Window (days)</Label>
                  <Input
                    type="number"
                    value={wfOutSample}
                    onChange={(e) => setWfOutSample(parseInt(e.target.value) || 30)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Initial Balance (USD)</Label>
                  <Input
                    type="number"
                    value={wfInitialBalance}
                    onChange={(e) => setWfInitialBalance(parseFloat(e.target.value) || 0)}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleRunWalkForward}
                    disabled={wfRunning}
                    className="w-full gap-1.5"
                  >
                    {wfRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {wfRunning ? 'Running…' : 'Run Walk-Forward'}
                  </Button>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Walk-forward membagi data historis jadi window berurutan. Untuk setiap
                window: parameter di-fit di <strong>in-sample</strong> lalu diuji di{' '}
                <strong>out-sample</strong>. Degradation {'<'} 20% = parameter stabil
                (tidak overfit). Degradation {'>'} 30% = parameter overfit.
              </div>
            </PanelCard>

            {wfResult && (
              <>
                {/* Verdict */}
                <div
                  className={cn(
                    'rounded-md border p-3 flex items-center gap-3',
                    wfResult.stable
                      ? 'border-bull/40 bg-bull/10'
                      : 'border-bear/40 bg-bear/10',
                  )}
                >
                  {wfResult.stable ? (
                    <CheckCircle2 className="h-6 w-6 text-bull shrink-0" />
                  ) : (
                    <XCircle className="h-6 w-6 text-bear shrink-0" />
                  )}
                  <div className="text-sm flex-1">
                    <div
                      className={cn(
                        'font-semibold',
                        wfResult.stable ? 'text-bull' : 'text-bear',
                      )}
                    >
                      {wfResult.stable ? 'PARAMETERS STABLE' : 'PARAMETERS UNSTABLE'}
                      {' · '}
                      avg degradation {wfResult.avg_degradation_pct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{wfResult.verdict}</div>
                  </div>
                </div>

                {/* Summary stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Total Windows" value={wfResult.total_windows} icon={Repeat} />
                  <StatCard
                    label="Robust Windows"
                    value={`${wfResult.robust_windows}/${wfResult.total_windows}`}
                    variant={wfResult.stable ? 'bull' : 'bear'}
                  />
                  <StatCard
                    label="Avg Degradation"
                    value={wfResult.avg_degradation_pct.toFixed(1)}
                    unit="%"
                    variant={wfResult.stable ? 'bull' : 'bear'}
                  />
                  <StatCard
                    label="Verdict"
                    value={wfResult.stable ? 'STABLE' : 'UNSTABLE'}
                    variant={wfResult.stable ? 'bull' : 'bear'}
                  />
                </div>

                {/* Windows table + chart */}
                <PanelCard
                  title="Walk-Forward Windows"
                  subtitle="In-sample PF vs Out-sample PF per window"
                  icon={Activity}
                >
                  <div className="pt-3">
                    <div className="overflow-x-auto scroll-thin">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2 px-2 font-medium">#</th>
                            <th className="text-left font-medium">In-Sample</th>
                            <th className="text-left font-medium">Out-Sample</th>
                            <th className="text-right font-medium">In PF</th>
                            <th className="text-right font-medium">Out PF</th>
                            <th className="text-right font-medium">Degradation</th>
                            <th className="text-right font-medium">In Trades</th>
                            <th className="text-right font-medium">Out Trades</th>
                            <th className="text-right font-medium">Robust</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wfResult.windows.map((w) => (
                            <tr key={w.window_index} className="border-b last:border-0 hover:bg-accent/30">
                              <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{w.window_index}</td>
                              <td className="text-[10px] tabular-nums">{w.in_sample_start} → {w.in_sample_end}</td>
                              <td className="text-[10px] tabular-nums">{w.out_sample_start} → {w.out_sample_end}</td>
                              <td className="text-right tabular-nums font-semibold text-info">{w.in_sample_pf.toFixed(2)}</td>
                              <td
                                className={cn(
                                  'text-right tabular-nums font-semibold',
                                  w.out_sample_pf >= 1.0 ? 'text-bull' : 'text-bear',
                                )}
                              >
                                {w.out_sample_pf.toFixed(2)}
                              </td>
                              <td
                                className={cn(
                                  'text-right tabular-nums font-semibold',
                                  w.degradation_pct < 20 ? 'text-bull' : w.degradation_pct < 30 ? 'text-warn' : 'text-bear',
                                )}
                              >
                                {w.degradation_pct.toFixed(1)}%
                              </td>
                              <td className="text-right tabular-nums">{w.in_sample_trades}</td>
                              <td className="text-right tabular-nums">{w.out_sample_trades}</td>
                              <td className="text-right">
                                {w.robust ? (
                                  <Badge variant="outline" className="text-[10px] text-bull border-bull">✓</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] text-bear border-bear">✗</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </PanelCard>

                <PanelCard
                  title="Profit Factor per Window"
                  subtitle="In-sample (info) vs Out-sample (bull/bear) bars"
                  icon={TrendingUp}
                  bodyClassName="h-[260px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={wfResult.windows.map((w) => ({
                        window: `W${w.window_index}`,
                        inSample: w.in_sample_pf,
                        outSample: w.out_sample_pf,
                      }))}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <XAxis dataKey="window" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                      <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                        formatter={(v: number, n) => [Number(v).toFixed(2), n === 'inSample' ? 'In-Sample PF' : 'Out-Sample PF']}
                      />
                      <ReferenceLine y={1.3} stroke="var(--bull)" strokeDasharray="3 3" label={{ value: 'Target PF 1.3', fontSize: 9, fill: 'var(--bull)' }} />
                      <ReferenceLine y={1.0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                      <Bar dataKey="inSample" name="inSample" fill="var(--info)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="outSample" name="outSample" fill="var(--bull)" radius={[3, 3, 0, 0]}>
                        {wfResult.windows.map((w, i) => (
                          <Cell key={i} fill={w.out_sample_pf >= 1.0 ? 'var(--bull)' : 'var(--bear)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </PanelCard>
              </>
            )}

            {!wfResult && !wfRunning && (
              <PanelCard
                title="Ready to Run Walk-Forward"
                subtitle="Set window sizes di atas lalu klik Run"
                icon={Repeat}
              >
                <div className="pt-3 text-sm text-muted-foreground">
                  V2 mensyaratkan minimum <strong>6 windows</strong> walk-forward sebelum
                  parameter dianggap stabil. Aturan umum: in-sample 60-90 hari, out-sample
                  30 hari, total data ≥ 6 bulan.
                </div>
              </PanelCard>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
