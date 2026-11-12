'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  Activity,
  Gauge,
  AlertTriangle,
  Loader2,
  RefreshCw,
  TrendingDown,
  Clock,
  Zap,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getSlippageStats,
  getLatencyStats,
  getKellyStats,
} from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { SlippageStats, LatencyStats, KellyStats } from '@/lib/types';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

export function AnalyticsView() {
  const [slippage, setSlippage] = useState<SlippageStats | null>(null);
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [kelly, setKelly] = useState<KellyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [slippageDays, setSlippageDays] = useState(30);
  const [latencyHours, setLatencyHours] = useState(24);

  const useKelly = useAppStore((s) => s.useKelly);
  const setUseKelly = useAppStore((s) => s.setUseKelly);
  const positionSizing = useAppStore((s) => s.positionSizing);
  const setPositionSizing = useAppStore((s) => s.setPositionSizing);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [s, l, k] = await Promise.all([
        getSlippageStats(slippageDays),
        getLatencyStats(latencyHours),
        getKellyStats(),
      ]);
      setSlippage(s);
      setLatency(l);
      setKelly(k);
    } catch (e) {
      toast({ title: 'Gagal memuat analytics', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Re-fetch slippage/latency when their respective windows change.
  useEffect(() => {
    if (!slippageDays) return;
    getSlippageStats(slippageDays).then(setSlippage).catch(() => {});
  }, [slippageDays]);
  useEffect(() => {
    if (!latencyHours) return;
    getLatencyStats(latencyHours).then(setLatency).catch(() => {});
  }, [latencyHours]);

  const handleToggleKelly = (checked: boolean) => {
    setUseKelly(checked);
    if (checked) {
      setPositionSizing('KELLY_QUARTER');
    } else {
      setPositionSizing('FIXED_1PCT');
    }
    toast({
      title: `Kelly sizing ${checked ? 'ON' : 'OFF'}`,
      description: checked
        ? 'Position sizing: quarter-Kelly (conservative). Will apply on next signal.'
        : 'Position sizing reverted to fixed 1% per trade.',
    });
  };

  if (loading && !slippage && !latency) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat analytics…</div>
      </div>
    );
  }

  const slippageChartData = Array.isArray(slippage?.time_series)
    ? (slippage?.time_series ?? []).map((p) => ({
        time: fmtTime(p.timestamp),
        avg: p.avg_pips,
        p95: p.p95_pips,
      }))
    : [];
  const latencyChartData = Array.isArray(latency?.time_series)
    ? (latency?.time_series ?? []).map((p) => ({
        time: fmtTime(p.timestamp),
        avg: p.avg_ms,
        p95: p.p95_ms,
      }))
    : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header / refresh */}
      <PanelCard
        title="Slippage & Latency Analytics"
        subtitle="Execution-quality monitoring · alerts when p95 > 3 pips or p99 latency > 100 ms"
        icon={BarChart3}
        actions={
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchAll} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
        }
      >
        <div className="pt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Slippage window:</Label>
            <Select value={String(slippageDays)} onValueChange={(v) => setSlippageDays(parseInt(v))}>
              <SelectTrigger className="h-8 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[7, 14, 30, 60, 90].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Latency window:</Label>
            <Select value={String(latencyHours)} onValueChange={(v) => setLatencyHours(parseInt(v))}>
              <SelectTrigger className="h-8 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 6, 12, 24, 48, 72].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}h
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PanelCard>

      {/* Slippage stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Avg Slippage"
          value={slippage ? `${(slippage.avg_slippage_pips ?? 0).toFixed(2)}` : '—'}
          unit="pip"
          icon={TrendingDown}
          variant={slippage && (slippage.avg_slippage_pips ?? 0) > 1 ? 'bear' : 'default'}
        />
        <StatCard label="p50" value={slippage ? `${(slippage.p50_pips ?? 0).toFixed(2)}` : '—'} unit="pip" />
        <StatCard
          label="p95"
          value={slippage ? `${(slippage.p95_pips ?? 0).toFixed(2)}` : '—'}
          unit="pip"
          variant={slippage && slippage.alert ? 'bear' : 'warn'}
        />
        <StatCard
          label="p99"
          value={slippage ? `${(slippage.p99_pips ?? 0).toFixed(2)}` : '—'}
          unit="pip"
          variant="bear"
        />
        <StatCard label="Worst" value={slippage ? `${(slippage.worst_pips ?? 0).toFixed(2)}` : '—'} unit="pip" variant="bear" />
      </div>

      {/* Slippage alert + chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <PanelCard
          title="Slippage Over Time"
          subtitle={`Avg + p95 per period · last ${slippageDays}d`}
          icon={Activity}
          className="xl:col-span-2"
          bodyClassName="h-[220px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={slippageChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} tickFormatter={(v) => `${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                formatter={(v: number, n) => [`${Number(v).toFixed(2)} pip`, n === 'avg' ? 'Avg' : 'p95']}
              />
              <ReferenceLine y={3} stroke="var(--bear)" strokeDasharray="3 3" label={{ value: 'Alert 3 pip', fontSize: 9, fill: 'var(--bear)' }} />
              <Line type="monotone" dataKey="avg" stroke="var(--info)" strokeWidth={1.5} dot={false} name="avg" />
              <Line type="monotone" dataKey="p95" stroke="var(--warn)" strokeWidth={1.5} dot={false} name="p95" />
            </LineChart>
          </ResponsiveContainer>
        </PanelCard>

        <PanelCard
          title="Slippage by Symbol"
          subtitle="Per-pair fill breakdown"
          icon={BarChart3}
          bodyClassName="h-[220px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={slippage?.by_symbol ?? []}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="symbol" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                formatter={(v: number, n) => [`${Number(v).toFixed(2)} pip`, n === 'avg_pips' ? 'Avg' : 'p95']}
              />
              <Bar dataKey="avg_pips" name="avg_pips" fill="var(--info)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="p95_pips" name="p95_pips" fill="var(--warn)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </PanelCard>
      </div>

      {slippage?.alert && (
        <div className="rounded-md border border-bear/40 bg-bear/10 p-3 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-bear shrink-0 mt-0.5" />
          <div>
            <strong className="text-bear">SLIPPAGE ALERT:</strong> p95 slippage{' '}
            {(slippage.p95_pips ?? 0).toFixed(2)} pip melebihi threshold{' '}
            {slippage.threshold_pips ?? '—'} pip. Pertimbangkan: (1) broker ECN dengan spread tighter,
            (2) limit order instead of market, (3) avoid trading di sepi jam.
          </div>
        </div>
      )}

      {/* Latency stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Avg Latency" value={latency?.avg_ms ?? '—'} unit="ms" icon={Clock} />
        <StatCard label="p50" value={latency?.p50_ms ?? '—'} unit="ms" />
        <StatCard label="p95" value={latency?.p95_ms ?? '—'} unit="ms" variant="warn" />
        <StatCard label="p99" value={latency?.p99_ms ?? '—'} unit="ms" variant={latency && latency.alert ? 'bear' : 'warn'} />
        <StatCard label="Worst" value={latency?.worst_ms ?? '—'} unit="ms" variant="bear" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <PanelCard
          title="Latency Over Time"
          subtitle={`Avg + p95 per period · last ${latencyHours}h`}
          icon={Activity}
          className="xl:col-span-2"
          bodyClassName="h-[220px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={latencyChartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                formatter={(v: number, n) => [`${Number(v).toFixed(0)} ms`, n === 'avg' ? 'Avg' : 'p95']}
              />
              <ReferenceLine y={100} stroke="var(--bear)" strokeDasharray="3 3" label={{ value: 'Alert 100ms', fontSize: 9, fill: 'var(--bear)' }} />
              <Line type="monotone" dataKey="avg" stroke="var(--info)" strokeWidth={1.5} dot={false} name="avg" />
              <Line type="monotone" dataKey="p95" stroke="var(--warn)" strokeWidth={1.5} dot={false} name="p95" />
            </LineChart>
          </ResponsiveContainer>
        </PanelCard>

        <PanelCard
          title="Latency by Endpoint"
          subtitle="Per-API-call breakdown"
          icon={BarChart3}
          bodyClassName="h-[220px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={latency?.by_endpoint ?? []}
              layout="vertical"
              margin={{ top: 8, right: 8, bottom: 0, left: 80 }}
            >
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis
                type="category"
                dataKey="endpoint"
                tick={{ fontSize: 9 }}
                stroke="var(--muted-foreground)"
                width={80}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                formatter={(v: number, n) => [`${Number(v).toFixed(0)} ms`, n === 'avg_ms' ? 'Avg' : 'p95']}
              />
              <Bar dataKey="avg_ms" name="avg_ms" fill="var(--info)" radius={[0, 3, 3, 0]}>
                {(latency?.by_endpoint ?? []).map((entry, i) => (
                  <Cell key={i} fill={(entry.p95_ms ?? 0) > 100 ? 'var(--bear)' : 'var(--info)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </PanelCard>
      </div>

      {latency?.alert && (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warn shrink-0 mt-0.5" />
          <div>
            <strong className="text-warn">LATENCY WARNING:</strong> p99 latency{' '}
            {latency.p99_ms ?? '—'}ms melebihi threshold {latency.threshold_ms ?? '—'}ms. Untuk scalping
            M5 ini acceptable tapi bila &gt; 500ms pertimbangkan: (1) backend closer to broker,
            (2) reduce chart polling interval, (3) upgrade Ollama hardware.
          </div>
        </div>
      )}

      {/* Kelly criterion panel */}
      <PanelCard
        title="Kelly Criterion — Position Sizing"
        subtitle="Optimal risk fraction based on win rate & avg win/loss"
        icon={Gauge}
      >
        <div className="pt-3 grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Win Rate" value={kelly ? `${((kelly.win_rate ?? 0) * 100).toFixed(1)}` : '—'} unit="%" variant="bull" />
              <StatCard label="Sample" value={kelly?.sample_trades ?? '—'} unit="trades" />
              <StatCard label="Avg Win" value={kelly ? `${(kelly.avg_win ?? 0).toFixed(2)}` : '—'} unit="USD" variant="bull" />
              <StatCard label="Avg Loss" value={kelly ? `${(kelly.avg_loss ?? 0).toFixed(2)}` : '—'} unit="USD" variant="bear" />
            </div>
            <div className="rounded-md border p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Full Kelly (f*)</span>
                <span className={cn('font-mono tabular-nums font-semibold', (kelly?.f_kelly ?? 0) > 0.25 ? 'text-bear' : 'text-info')}>
                  {kelly ? `${((kelly.f_kelly ?? 0) * 100).toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quarter-Kelly</span>
                <span className="font-mono tabular-nums font-semibold text-bull">
                  {kelly ? `${((kelly.f_quarter_kelly ?? 0) * 100).toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Risk</span>
                <span className="font-mono tabular-nums">{kelly ? `${((kelly.current_risk_pct ?? 0) * 100).toFixed(2)}%` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recommended</span>
                <span className="font-mono tabular-nums font-semibold text-bull">
                  {kelly ? `${((kelly.recommended_risk_pct ?? 0) * 100).toFixed(2)}%` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-md border p-3 flex flex-col gap-3 text-xs">
            <div className="font-semibold text-sm flex items-center gap-1">
              <Zap className="h-3.5 w-3.5 text-info" />
              Sizing Mode
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['FIXED_1PCT', 'KELLY_QUARTER', 'CUSTOM'] as const).map((m) => {
                const isActive = positionSizing === m;
                return (
                  <button
                    key={m}
                    onClick={() => setPositionSizing(m)}
                    className={cn(
                      'rounded-md border p-2 text-center transition-colors',
                      isActive ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    <div className="text-[10px] font-bold">
                      {m === 'FIXED_1PCT' ? 'Fixed 1%' : m === 'KELLY_QUARTER' ? 'Quarter-Kelly' : 'Custom'}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <div>
                <div className="text-xs font-medium">Use Kelly sizing</div>
                <div className="text-[10px] text-muted-foreground">
                  Auto-switch to quarter-Kelly on next signal
                </div>
              </div>
              <Switch checked={useKelly} onCheckedChange={handleToggleKelly} />
            </div>
            {kelly?.note && (
              <p className="text-[10px] text-muted-foreground italic border-t pt-2">{kelly.note}</p>
            )}
          </div>

          <div className="rounded-md border border-info/30 bg-info/5 p-3 text-[11px]">
            <div className="font-semibold text-info mb-2 flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" />
              Kelly Theory
            </div>
            <p className="leading-relaxed">
              The Kelly fraction maximises long-term geometric growth:
              <code className="block bg-muted/40 rounded px-1.5 py-1 my-1.5 font-mono text-[10px]">
                f* = W − (1−W) / (avg_win / avg_loss)
              </code>
              Full Kelly is theoretically optimal but maximises drawdown variance.
              Traders typically use <strong>quarter-Kelly</strong> for conservative
              sizing. V2 default is fixed 1% per trade — enable Kelly only with
              ≥ 100 trades of clean sample data.
            </p>
          </div>
        </div>
      </PanelCard>
    </div>
  );
}
