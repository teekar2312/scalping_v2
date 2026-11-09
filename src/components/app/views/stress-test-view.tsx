'use client';

import { useEffect, useState } from 'react';
import {
  TrendingDown,
  Zap,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { PanelCard, StatCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { listStressScenarios, runStressTest } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { StressScenario, StressTestResult, StressScenarioId } from '@/lib/types';

export function StressTestView() {
  const [scenarios, setScenarios] = useState<StressScenario[]>([]);
  const [selected, setSelected] = useState<StressScenarioId | null>(null);
  const [running, setRunning] = useState<StressScenarioId | null>(null);
  const [results, setResults] = useState<Partial<Record<StressScenarioId, StressTestResult>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    listStressScenarios()
      .then((s) => {
        if (!mounted) return;
        setScenarios(s);
        setSelected(s[0]?.id ?? null);
      })
      .catch((e) => {
        if (!mounted) return;
        toast({ title: 'Gagal memuat scenarios', description: String(e), variant: 'destructive' });
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const handleRun = async (id: StressScenarioId) => {
    setRunning(id);
    try {
      const res = await runStressTest({ scenario: id, initial_balance: 10000 });
      setResults((prev) => ({ ...prev, [id]: res }));
      toast({
        title: `${res.scenario_name} — ${res.survival === 'PASS' ? 'SURVIVED' : 'FAILED'}`,
        description: `Stressed DD ${res.stressed_max_dd_pct.toFixed(2)}% · balance $${res.balance_after.toFixed(0)}`,
        variant: res.survival === 'PASS' ? 'default' : 'destructive',
      });
    } catch (e) {
      toast({ title: 'Stress test gagal', description: String(e), variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  };

  const handleRunAll = async () => {
    for (const s of scenarios) {
      // Sequential — avoids spawning too many backend jobs.
      await handleRun(s.id);
    }
  };

  const allResults = scenarios.map((s) => results[s.id]).filter(Boolean) as StressTestResult[];
  const allPassed = scenarios.length > 0 && allResults.length === scenarios.length && allResults.every((r) => r.survival === 'PASS');
  const anyFailed = allResults.some((r) => r.survival === 'FAIL');

  const chartData = allResults.map((r) => ({
    name: r.scenario_name.split(' ')[0],
    original: r.original_max_dd_pct,
    stressed: r.stressed_max_dd_pct,
    survival: r.survival,
  }));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat stress test scenarios…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <PanelCard
        title="Stress Test — Black Swan Replay"
        subtitle="Replay 4 historical crisis scenarios against your current equity curve"
        icon={Zap}
        actions={
          <Button size="sm" variant="default" className="gap-1.5" onClick={handleRunAll} disabled={running !== null}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run All Scenarios
          </Button>
        }
      >
        <div className="pt-3 text-xs text-muted-foreground">
          Each scenario applies the historical volatility multiplier to your PnL series.
          A <strong>PASS</strong> means your strategy's max drawdown stays under the hard-stop tier
          (−2%) and the bot didn't trigger the kill switch. A <strong>FAIL</strong> means your
          strategy is exposed to that regime — reduce position size or add a hedge.
        </div>
      </PanelCard>

      {/* Scenario cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {scenarios.map((s) => {
          const res = results[s.id];
          const isSelected = selected === s.id;
          return (
            <div
              key={s.id}
              className={cn(
                'rounded-md border p-3 transition-colors cursor-pointer',
                isSelected ? 'border-primary bg-accent' : 'hover:bg-accent/30',
              )}
              onClick={() => setSelected(s.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">{s.date}</div>
                </div>
                {res && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      res.survival === 'PASS' ? 'text-bull border-bull' : 'text-bear border-bear',
                    )}
                  >
                    {res.survival === 'PASS' ? (
                      <CheckCircle2 className="h-3 w-3 mr-0.5" />
                    ) : (
                      <XCircle className="h-3 w-3 mr-0.5" />
                    )}
                    {res.survival}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground leading-snug line-clamp-3">
                {s.description}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[10px]">
                <Badge variant="outline" className="text-warn border-warn">
                  ×{s.multiplier.toFixed(1)} vol
                </Badge>
                <Badge variant="outline" className="text-bear border-bear">
                  {s.pip_jump} pip jump
                </Badge>
              </div>
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1"
                  disabled={running !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRun(s.id);
                  }}
                >
                  {running === s.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Run Stress Test
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison chart */}
      {chartData.length > 0 && (
        <PanelCard
          title="Drawdown Comparison"
          subtitle="Original vs Stressed Max DD per scenario · -2% hard-stop reference"
          icon={TrendingDown}
          bodyClassName="h-[280px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
                width={50}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
                formatter={(value: number, name: string) => [`${Number(value).toFixed(2)}%`, name === 'original' ? 'Original DD' : 'Stressed DD']}
              />
              <ReferenceLine y={-2} stroke="var(--bear)" strokeDasharray="3 3" label={{ value: 'Hard stop -2%', fontSize: 9, fill: 'var(--bear)' }} />
              <Bar dataKey="original" name="original" fill="var(--info)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="stressed" name="stressed" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.survival === 'PASS' ? 'var(--warn)' : 'var(--bear)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </PanelCard>
      )}

      {/* Summary verdict */}
      {allResults.length > 0 && (
        <div
          className={cn(
            'rounded-md border p-3 flex items-center gap-3',
            allPassed
              ? 'border-bull/40 bg-bull/10'
              : anyFailed
              ? 'border-bear/40 bg-bear/10'
              : 'border-warn/40 bg-warn/10',
          )}
        >
          {allPassed ? (
            <ShieldAlert className="h-6 w-6 text-bull shrink-0" />
          ) : anyFailed ? (
            <AlertTriangle className="h-6 w-6 text-bear shrink-0" />
          ) : (
            <Activity className="h-6 w-6 text-warn shrink-0" />
          )}
          <div className="text-sm">
            <div className={cn('font-semibold', allPassed ? 'text-bull' : anyFailed ? 'text-bear' : 'text-warn')}>
              {allPassed
                ? 'PASS — Strategy survived all 4 black swans'
                : anyFailed
                ? 'FAIL — Strategy is exposed to one or more crisis regimes'
                : 'PARTIAL — Some scenarios missing'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {allPassed
                ? 'Robust to historical tail risks. Continue monitoring forward live performance.'
                : 'Reduce position size, add a tail hedge, or restrict trading hours around event risk.'}
            </div>
          </div>
        </div>
      )}

      {/* Per-scenario results detail */}
      {allResults.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {allResults.map((r) => (
            <StatCard
              key={r.id}
              label={r.scenario_name.split('(')[0].trim()}
              value={r.stressed_max_dd_pct.toFixed(2)}
              unit="% DD"
              variant={r.survival === 'PASS' ? 'bull' : 'bear'}
              trendValue={`Bal $${r.balance_after.toFixed(0)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
