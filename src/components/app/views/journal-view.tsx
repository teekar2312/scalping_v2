'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  BookOpen,
  Download,
  TrendingUp,
  Filter,
  PieChart,
  ShieldCheck,
  Smile,
  Loader2,
  GitBranch,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ScrollArea,
} from '@/components/ui/scroll-area';
import {
  getTradeHistory,
  getPerformanceAttribution,
  getComplianceScore,
  getEmotionalSummary,
  logEmotion,
  downloadPDF,
  downloadTax,
  triggerDownload,
  getTradeReconstruction,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { EMOTIONAL_STATES } from '@/lib/constants';
import type {
  Trade,
  PerformanceAttribution,
  ComplianceScore,
  EmotionalSummaryResponse,
  SessionStats,
  EmotionalState,
  TradeReconstruction,
  TradeEvent,
  TradeEventType,
} from '@/lib/types';

function fmtWeekStart(): string {
  // Get most recent Monday
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' | 'warn' | 'info' }) {
  const color = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-info' : 'text-foreground';
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold tabular-nums', color)}>{value}</span>
    </div>
  );
}

function AttributionTable({ title, rows }: { title: string; rows: Record<string, SessionStats> }) {
  const entries = Object.entries(rows);
  if (entries.length === 0) {
    return (
      <div className="rounded-md border p-3">
        <div className="text-sm font-semibold mb-2">{title}</div>
        <div className="text-xs text-muted-foreground">No data</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left font-medium pb-1">Category</th>
            <th className="text-right font-medium">Trades</th>
            <th className="text-right font-medium">Win%</th>
            <th className="text-right font-medium">R-Net</th>
            <th className="text-right font-medium">P&L</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([cat, s]) => (
            <tr key={cat} className="border-b last:border-0">
              <td className="py-1 font-medium">{cat.replace('_', ' ')}</td>
              <td className="text-right tabular-nums">{s.trades}</td>
              <td className={cn('text-right tabular-nums', s.win_rate >= 45 ? 'text-bull' : 'text-bear')}>
                {s.win_rate.toFixed(1)}%
              </td>
              <td className={cn('text-right tabular-nums', s.r_net >= 0 ? 'text-bull' : 'text-bear')}>
                {s.r_net >= 0 ? '+' : ''}{s.r_net.toFixed(2)}
              </td>
              <td className={cn('text-right tabular-nums', s.profit >= 0 ? 'text-bull' : 'text-bear')}>
                {s.profit >= 0 ? '+' : ''}{s.profit.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WinRateChart({ rows, title }: { rows: Record<string, SessionStats>; title: string }) {
  const data = Object.entries(rows).map(([cat, s]) => ({ category: cat.replace('_', ' '), winRate: s.win_rate }));
  if (data.length === 0) return null;
  return (
    <PanelCard title={title} subtitle="Win-rate comparison per category" icon={TrendingUp} bodyClassName="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="category" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" width={30} domain={[0, 100]} />
          <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: '11px' }} formatter={(v: number) => [`${v.toFixed(1)}%`, 'Win Rate']} />
          <Bar dataKey="winRate" radius={[3, 3, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.winRate >= 45 ? 'var(--bull)' : 'var(--bear)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </PanelCard>
  );
}

function ComplianceGauge({ value }: { value: number }) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 90 ? 'var(--bull)' : value >= 75 ? 'var(--warn)' : 'var(--bear)';
  return (
    <div className="flex flex-col items-center justify-center py-2">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} stroke="var(--muted)" strokeWidth="10" fill="none" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          stroke={color}
          strokeWidth="10"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="70" y="76" textAnchor="middle" fontSize="24" fontWeight="bold" fill={color}>
          {value.toFixed(0)}%
        </text>
      </svg>
      <div className="text-xs text-muted-foreground -mt-1">Overall Compliance</div>
    </div>
  );
}

function EmotionLogModal({
  trade,
  open,
  onOpenChange,
}: {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, setState] = useState<EmotionalState>('SABAR');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setState('SABAR');
      setNote('');
    }
  }, [open]);

  if (!trade) return null;

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await logEmotion(trade.ticket, state, note || undefined);
      toast({
        title: 'Emotion logged',
        description: `Trade #${trade.ticket} tagged: ${state}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Gagal log emotion',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Emotional State</DialogTitle>
          <DialogDescription>
            Trade #{trade.ticket} · {trade.symbol} {trade.direction} · P&L{' '}
            {(trade.profitNet ?? 0).toFixed(2)} USD
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Emotional State</Label>
            <Select value={state} onValueChange={(v) => setState(v as EmotionalState)}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMOTIONAL_STATES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    <span style={{ color: e.color }} className="inline-block h-2 w-2 rounded-full mr-1 align-middle" />
                    {e.label} — <span className="text-muted-foreground">{e.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Misalnya: revenge setelah 2 SL beruntun"
              className="mt-1"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Menyimpan…' : 'Save Emotion'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------- //
// Sprint 7 — Trade reconstruction modal (tick-level timeline)
// --------------------------------------------------------------------------- //

const EVENT_TYPE_COLOR: Record<TradeEventType, string> = {
  ENTRY: 'text-info border-info',
  SL_MOVE: 'text-warn border-warn',
  BE_MOVE: 'text-bull border-bull',
  TP1_HIT: 'text-bull border-bull',
  TP2_HIT: 'text-bull border-bull',
  TRAILING: 'text-info border-info',
  PARTIAL_CLOSE: 'text-info border-info',
  EXIT: 'text-bear border-bear',
  MANUAL_CLOSE: 'text-bear border-bear',
};

const EVENT_TYPE_LABEL: Record<TradeEventType, string> = {
  ENTRY: 'Entry',
  SL_MOVE: 'SL Move',
  BE_MOVE: 'Break-Even',
  TP1_HIT: 'TP1 Hit',
  TP2_HIT: 'TP2 Hit',
  TRAILING: 'Trailing Update',
  PARTIAL_CLOSE: 'Partial Close',
  EXIT: 'Exit',
  MANUAL_CLOSE: 'Manual Close',
};

function fmtTimeShort(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

function TradeReconstructionModal({
  trade,
  open,
  onOpenChange,
}: {
  trade: Trade | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [recon, setRecon] = useState<TradeReconstruction | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !trade) return;
    let mounted = true;
    let cancelled = false;
    // Reset + flip loading asynchronously (after mount commit) to avoid
    // the `react-hooks/set-state-in-effect` warning.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setRecon(null);
      setLoading(true);
    });
    getTradeReconstruction(trade.ticket)
      .then((r) => {
        if (mounted) setRecon(r);
      })
      .catch((e) => {
        toast({
          title: 'Reconstruction gagal',
          description: String(e),
          variant: 'destructive',
        });
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
      cancelled = true;
    };
  }, [open, trade]);

  if (!trade) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-info" />
            Trade Reconstruction · #{trade.ticket}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {trade.symbol} {trade.direction} · vol {trade.volume} lot · tick-level
            timeline dari entry → exit, termasuk semua SL/TP/trailing events.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Reconstructing tick timeline…
          </div>
        ) : recon ? (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded-md border p-2">
                <div className="text-[10px] text-muted-foreground">Entry</div>
                <div className="font-mono tabular-nums">{recon.entry_price}</div>
                <div className="text-[10px] text-muted-foreground">{fmtTimeShort(recon.entry_time)}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[10px] text-muted-foreground">Exit</div>
                <div className="font-mono tabular-nums">{recon.exit_price ?? '—'}</div>
                <div className="text-[10px] text-muted-foreground">
                  {recon.exit_time ? fmtTimeShort(recon.exit_time) : '—'}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[10px] text-muted-foreground">Final P&L</div>
                <div
                  className={cn(
                    'font-mono tabular-nums font-semibold',
                    (recon.final_pnl ?? 0) >= 0 ? 'text-bull' : 'text-bear',
                  )}
                >
                  {(recon.final_pnl ?? 0) >= 0 ? '+' : ''}
                  {recon.final_pnl?.toFixed(2) ?? '—'} USD
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[10px] text-muted-foreground">R-Multiple</div>
                <div
                  className={cn(
                    'font-mono tabular-nums font-semibold',
                    (recon.r_multiple ?? 0) >= 0 ? 'text-bull' : 'text-bear',
                  )}
                >
                  {(recon.r_multiple ?? 0) >= 0 ? '+' : ''}
                  {recon.r_multiple?.toFixed(2) ?? '—'}R
                </div>
                <div className="text-[10px] text-muted-foreground">{recon.close_reason}</div>
              </div>
            </div>

            {/* Vertical timeline */}
            <ScrollArea className="h-[400px] rounded-md border p-3">
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-3">
                  {recon.events.map((ev, idx) => {
                    const color = EVENT_TYPE_COLOR[ev.type];
                    return (
                      <div key={idx} className="relative pl-9">
                        {/* Dot on the timeline */}
                        <div
                          className={cn(
                            'absolute left-1.5 top-1 h-3 w-3 rounded-full border-2',
                            color,
                          )}
                        />
                        <div className="rounded-md border bg-card p-2 text-xs">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <Badge variant="outline" className={cn('text-[10px]', color)}>
                              {EVENT_TYPE_LABEL[ev.type]}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {fmtTimeShort(ev.timestamp)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                            <span>
                              <span className="text-muted-foreground">Price: </span>
                              <span className="font-mono tabular-nums">{ev.price}</span>
                            </span>
                            {ev.volume !== undefined && (
                              <span>
                                <span className="text-muted-foreground">Vol: </span>
                                <span className="font-mono tabular-nums">{ev.volume}</span>
                              </span>
                            )}
                            {ev.sl_old !== undefined && ev.sl_old !== null && (
                              <span className="flex items-center gap-1">
                                <span className="font-mono tabular-nums">{ev.sl_old}</span>
                                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                                <span className="font-mono tabular-nums">{ev.sl_new}</span>
                              </span>
                            )}
                          </div>
                          {ev.reason && (
                            <p className="mt-1 text-[10px] text-muted-foreground italic">{ev.reason}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScrollArea>

            <div className="rounded-md border border-info/30 bg-info/5 p-2 text-[10px] text-info">
              <strong>Sprint 7 — Trade Reconstruction:</strong> Replay tick-level
              event log dari trade lifecycle. Berguna untuk audit post-trade:
              apakah SL dipindahkan tepat waktu? Apakah TP1 hit dan SL dipindah ke BE?
              Apakah trailing aktif saat trend continuation?
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-8 text-center">
            Tidak ada data reconstruction.
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CircularProgress({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="32" stroke="var(--muted)" strokeWidth="6" fill="none" />
          <circle
            cx="40"
            cy="40"
            r="32"
            stroke={color}
            strokeWidth="6"
            fill="none"
            strokeDasharray={2 * Math.PI * 32}
            strokeDashoffset={2 * Math.PI * 32 - (value / 100) * 2 * Math.PI * 32}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">
          {value.toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

export function JournalView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [attribution, setAttribution] = useState<PerformanceAttribution | null>(null);
  const [compliance, setCompliance] = useState<ComplianceScore | null>(null);
  const [emotional, setEmotional] = useState<EmotionalSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState<string>('ALL');
  const [filterResult, setFilterResult] = useState<string>('ALL');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingTax, setExportingTax] = useState(false);
  const [emotionTrade, setEmotionTrade] = useState<Trade | null>(null);
  const [reconTrade, setReconTrade] = useState<Trade | null>(null);

  useEffect(() => {
    Promise.all([
      getTradeHistory(),
      getPerformanceAttribution(),
      getComplianceScore(),
      getEmotionalSummary(),
    ])
      .then(([t, a, c, e]) => {
        setTrades(t);
        setAttribution(a);
        setCompliance(c);
        setEmotional(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return trades.filter(
      (t) =>
        (filterSymbol === 'ALL' || t.symbol === filterSymbol) &&
        (filterResult === 'ALL' || t.result === filterResult)
    );
  }, [trades, filterSymbol, filterResult]);

  const stats = useMemo(() => {
    const wins = trades.filter((t) => t.result === 'WIN');
    const losses = trades.filter((t) => t.result === 'LOSS');
    const totalR = trades.reduce((a, b) => a + (b.rMultiple || 0), 0);
    const grossProfit = wins.reduce((a, b) => a + (b.profitNet || 0), 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + (b.profitNet || 0), 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    return {
      total: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      totalR,
      avgR: trades.length > 0 ? totalR / trades.length : 0,
      profitFactor: pf,
      totalPnl: trades.reduce((a, b) => a + (b.profitNet || 0), 0),
    };
  }, [trades]);

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const weekStart = fmtWeekStart();
      const blob = await downloadPDF(weekStart);
      triggerDownload(blob, `weekly_journal_${weekStart}.pdf`);
      toast({
        title: 'PDF exported',
        description: `Mingguan ${weekStart} — ${blob.size} bytes`,
      });
    } catch (e) {
      toast({ title: 'PDF export gagal', description: String(e), variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportTax = async () => {
    setExportingTax(true);
    try {
      const year = new Date().getFullYear();
      const blob = await downloadTax(year);
      triggerDownload(blob, `tax_export_${year}.csv`);
      toast({
        title: 'Tax CSV exported',
        description: `Year ${year} — ${blob.size} bytes`,
      });
    } catch (e) {
      toast({ title: 'Tax export gagal', description: String(e), variant: 'destructive' });
    } finally {
      setExportingTax(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat journal...</div>
      </div>
    );
  }

  const symbols = ['ALL', ...new Set(trades.map((t) => t.symbol))];
  const results = ['ALL', 'WIN', 'LOSS', 'BREAKEVEN'];

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <StatCard label="Total Trades" value={stats.total} icon={BookOpen} />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}`}
          unit="%"
          variant={stats.winRate >= 45 ? 'bull' : 'bear'}
          trend={stats.winRate >= 45 ? 'up' : 'down'}
          trendValue={`target ≥ 45%`}
        />
        <StatCard
          label="Total R"
          value={`${stats.totalR >= 0 ? '+' : ''}${stats.totalR.toFixed(2)}`}
          unit="R"
          variant={stats.totalR >= 0 ? 'bull' : 'bear'}
        />
        <StatCard
          label="Avg R/Trade"
          value={stats.avgR.toFixed(3)}
          unit="R"
          variant={stats.avgR >= 0.15 ? 'bull' : 'bear'}
          trendValue={`target ≥ +0.15R`}
        />
        <StatCard
          label="Profit Factor"
          value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
          variant={stats.profitFactor >= 1.3 ? 'bull' : 'bear'}
          trendValue={`target ≥ 1.3`}
        />
        <StatCard
          label="Total P&L"
          value={`${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}`}
          unit="USD"
          variant={stats.totalPnl >= 0 ? 'bull' : 'bear'}
        />
        <StatCard
          label="W/L Ratio"
          value={`${stats.wins}/${stats.losses}`}
          icon={TrendingUp}
        />
      </div>

      {/* Export actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={handleExportTax}
          disabled={exportingTax}
        >
          {exportingTax ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Export Tax CSV {new Date().getFullYear()}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={handleExportPdf}
          disabled={exportingPdf}
        >
          {exportingPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Export PDF Mingguan
        </Button>
      </div>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log" className="text-xs gap-1">
            <BookOpen className="h-3.5 w-3.5" /> Trade Log
          </TabsTrigger>
          <TabsTrigger value="attribution" className="text-xs gap-1">
            <PieChart className="h-3.5 w-3.5" /> Attribution
          </TabsTrigger>
          <TabsTrigger value="compliance" className="text-xs gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Compliance
          </TabsTrigger>
          <TabsTrigger value="emotional" className="text-xs gap-1">
            <Smile className="h-3.5 w-3.5" /> Emotional
          </TabsTrigger>
        </TabsList>

        {/* Trade log tab */}
        <TabsContent value="log">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Symbol:</span>
                {symbols.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={filterSymbol === s ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setFilterSymbol(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Result:</span>
                {results.map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={filterResult === r ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setFilterResult(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </div>

            <PanelCard
              title="Trade Journal"
              subtitle={`${filtered.length} trades · RR net, ATR, checklist lengkap`}
              icon={BookOpen}
            >
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">#</th>
                        <th className="text-left font-medium">Date</th>
                        <th className="text-left font-medium">Symbol</th>
                        <th className="text-left font-medium">Dir</th>
                        <th className="text-right font-medium">Vol</th>
                        <th className="text-right font-medium">Entry</th>
                        <th className="text-right font-medium">Exit</th>
                        <th className="text-right font-medium">SL pip</th>
                        <th className="text-right font-medium">ATR</th>
                        <th className="text-right font-medium">ADX</th>
                        <th className="text-right font-medium">RR Net</th>
                        <th className="text-left font-medium">Setup</th>
                        <th className="text-left font-medium">Session</th>
                        <th className="text-right font-medium">Result</th>
                        <th className="text-right font-medium">R net</th>
                        <th className="text-right font-medium">P&L</th>
                        <th className="text-right font-medium">CL</th>
                        <th className="text-right font-medium">Emosi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t, idx) => (
                        <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30">
                          <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                          <td className="tabular-nums text-[10px]">
                            {new Date(t.entryTime).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jakarta' })}
                            <span className="block text-muted-foreground">
                              {new Date(t.entryTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}
                            </span>
                          </td>
                          <td className="font-semibold">{t.symbol}</td>
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
                          <td className="text-right tabular-nums">{t.closePrice}</td>
                          <td className="text-right tabular-nums">{t.slPips.toFixed(1)}</td>
                          <td className="text-right tabular-nums">{t.atrValue.toFixed(1)}</td>
                          <td className="text-right tabular-nums">{t.adxValue.toFixed(1)}</td>
                          <td className="text-right tabular-nums font-semibold">{t.rrNet.toFixed(2)}</td>
                          <td className="text-left text-[10px]">{t.setupType.replace('_', ' ')}</td>
                          <td className="text-left text-[10px]">{t.session}</td>
                          <td>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] px-1.5',
                                t.result === 'WIN' && 'text-bull border-bull',
                                t.result === 'LOSS' && 'text-bear border-bear',
                                t.result === 'BREAKEVEN' && 'text-muted-foreground'
                              )}
                            >
                              {t.result}
                            </Badge>
                          </td>
                          <td
                            className={cn(
                              'text-right tabular-nums font-semibold',
                              (t.rMultiple || 0) > 0 && 'text-bull',
                              (t.rMultiple || 0) < 0 && 'text-bear'
                            )}
                          >
                            {(t.rMultiple || 0) >= 0 ? '+' : ''}
                            {(t.rMultiple || 0).toFixed(2)}R
                          </td>
                          <td
                            className={cn(
                              'text-right tabular-nums font-semibold',
                              (t.profitNet || 0) >= 0 ? 'text-bull' : 'text-bear'
                            )}
                          >
                            {(t.profitNet || 0) >= 0 ? '+' : ''}
                            {(t.profitNet || 0).toFixed(2)}
                          </td>
                          <td className="text-right">
                            <div className="flex gap-0.5 justify-end">
                              {t.checklist.map((c) => (
                                <div
                                  key={c.point}
                                  className={cn('h-2 w-2 rounded-sm', c.passed ? 'bg-bull' : 'bg-bear')}
                                  title={`#${c.point}: ${c.passed ? 'PASS' : 'FAIL'}`}
                                />
                              ))}
                            </div>
                          </td>
                          <td className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] gap-1"
                                onClick={() => setReconTrade(t)}
                              >
                                <GitBranch className="h-3 w-3" />
                                Replay
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] gap-1"
                                onClick={() => setEmotionTrade(t)}
                              >
                                <Smile className="h-3 w-3" />
                                Tag
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Attribution tab */}
        <TabsContent value="attribution">
          <div className="flex flex-col gap-3">
            <PanelCard
              title="Performance Attribution"
              subtitle="Win rate · R-net · P&L by session/setup/regime/hour/day/pair"
              icon={PieChart}
            >
              <div className="pt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {attribution && <AttributionTable title="By Session" rows={attribution.by_session} />}
                {attribution && <AttributionTable title="By Setup Type" rows={attribution.by_setup} />}
                {attribution && <AttributionTable title="By Regime" rows={attribution.by_regime} />}
                {attribution && <AttributionTable title="By Hour (WIB)" rows={attribution.by_hour} />}
                {attribution && <AttributionTable title="By Day" rows={attribution.by_day} />}
                {attribution && <AttributionTable title="By Pair" rows={attribution.by_pair} />}
              </div>
            </PanelCard>

            {attribution && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <WinRateChart rows={attribution.by_session} title="Win Rate by Session" />
                <WinRateChart rows={attribution.by_pair} title="Win Rate by Pair" />
              </div>
            )}
          </div>
        </TabsContent>

        {/* Compliance tab */}
        <TabsContent value="compliance">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <PanelCard title="Compliance Score" subtitle="V2 strategy adherence" icon={ShieldCheck}>
              <div className="pt-3">
                {compliance ? (
                  <>
                    <ComplianceGauge value={compliance.overall_pct} />
                    <div className="space-y-2 mt-3 border-t pt-3">
                      <StatRow label="Checklist Pass Rate" value={`${compliance.checklist_pass_rate.toFixed(1)}%`} tone={compliance.checklist_pass_rate >= 90 ? 'bull' : 'warn'} />
                      <StatRow label="RR Compliance Rate" value={`${compliance.rr_compliance_rate.toFixed(1)}%`} tone={compliance.rr_compliance_rate >= 85 ? 'bull' : 'warn'} />
                      <StatRow label="AI Compliance Rate" value={`${compliance.ai_compliance_rate.toFixed(1)}%`} tone={compliance.ai_compliance_rate >= 85 ? 'bull' : 'warn'} />
                      <StatRow label="Total Trades" value={String(compliance.total_trades)} />
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">No compliance data</div>
                )}
              </div>
            </PanelCard>

            <PanelCard
              title="Compliance Breakdown"
              subtitle="Pass-rate per category"
              icon={ShieldCheck}
              className="xl:col-span-2"
            >
              <div className="pt-3 grid grid-cols-3 gap-3">
                {compliance && (
                  <>
                    <div className="flex flex-col items-center">
                      <CircularProgress value={compliance.checklist_pass_rate} color="var(--info)" />
                      <div className="text-[10px] text-muted-foreground mt-1">Checklist</div>
                    </div>
                    <div className="flex flex-col items-center">
                      <CircularProgress value={compliance.rr_compliance_rate} color="var(--bull)" />
                      <div className="text-[10px] text-muted-foreground mt-1">RR ≥ 2.0</div>
                    </div>
                    <div className="flex flex-col items-center">
                      <CircularProgress value={compliance.ai_compliance_rate} color="var(--warn)" />
                      <div className="text-[10px] text-muted-foreground mt-1">AI Verdict</div>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Non-compliant trades (RR &lt; 2.0 atau checklist gagal)
                </div>
                <div className="max-h-[260px] overflow-y-auto scroll-thin">
                  {trades
                    .filter((t) => t.rrNet < 2.0 || t.checklist.some((c) => !c.passed))
                    .slice(0, 20)
                    .map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 text-xs py-1 border-b last:border-0"
                      >
                        <Badge variant="outline" className="text-[10px] text-bear border-bear">
                          {t.rrNet < 2.0 ? 'RR' : 'CL'}
                        </Badge>
                        <span className="font-medium">{t.symbol}</span>
                        <span className="text-muted-foreground">
                          RR {t.rrNet.toFixed(2)} · {t.checklist.filter((c) => !c.passed).length}/8 fail
                        </span>
                        <span className="ml-auto text-muted-foreground tabular-nums">
                          {new Date(t.entryTime).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jakarta' })}
                        </span>
                      </div>
                    ))}
                  {trades.filter((t) => t.rrNet < 2.0 || t.checklist.some((c) => !c.passed)).length === 0 && (
                    <div className="text-xs text-muted-foreground py-4 text-center">
                      Semua trade compliant.
                    </div>
                  )}
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Emotional tab */}
        <TabsContent value="emotional">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <PanelCard title="Emotional State Summary" subtitle="Post-trade psychology log" icon={Smile}>
              <div className="pt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                {EMOTIONAL_STATES.map((e) => {
                  const count = emotional?.by_state?.[e.value] ?? 0;
                  return (
                    <div
                      key={e.value}
                      className="rounded-md border p-3"
                      style={{ borderColor: `${e.color}40` }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                        <span className="text-xs font-semibold">{e.label}</span>
                      </div>
                      <div className="text-2xl font-bold tabular-nums">{count}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">{e.description}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Total logged: <strong>{emotional?.total_logged ?? 0}</strong> trades
              </div>
            </PanelCard>

            <PanelCard
              title="Correlation: Emotion vs Outcome"
              subtitle="Win rate per emotional state"
              icon={TrendingUp}
              bodyClassName="h-[280px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={EMOTIONAL_STATES.map((e) => {
                    const tagged = emotional?.trades.filter((t) => t.emotional_state === e.value) ?? [];
                    const wins = tagged.filter((t) => (t.profit ?? 0) > 0).length;
                    const winRate = tagged.length > 0 ? (wins / tagged.length) * 100 : 0;
                    return { state: e.label, winRate, count: tagged.length, color: e.color };
                  })}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <XAxis dataKey="state" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={30} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: '11px' }}
                    formatter={(v: number, _n, p) => [`${v.toFixed(1)}% (${(p as { payload?: { count?: number } })?.payload?.count ?? 0} trades)`, 'Win Rate']}
                  />
                  <Bar dataKey="winRate" radius={[3, 3, 0, 0]}>
                    {EMOTIONAL_STATES.map((e, i) => (
                      <Cell key={i} fill={e.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </PanelCard>
          </div>

          <PanelCard
            title="Recent Emotional Logs"
            subtitle="Klik 'Tag' di Trade Log tab untuk menambah emotion"
            icon={Smile}
          >
            <div className="pt-3">
              <div className="max-h-[300px] overflow-y-auto scroll-thin">
                {emotional?.trades.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    Belum ada emotion logged. Tag dari Trade Log tab.
                  </div>
                ) : (
                  emotional?.trades.map((t) => {
                    const stateMeta = EMOTIONAL_STATES.find((e) => e.value === t.emotional_state);
                    return (
                      <div key={t.id} className="flex items-center gap-2 text-xs py-1.5 border-b last:border-0">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: stateMeta?.color ?? 'var(--muted-foreground)' }}
                        />
                        <span className="font-semibold">{t.emotional_state}</span>
                        <span className="text-muted-foreground">
                          #{t.ticket} {t.symbol}
                        </span>
                        {t.emotional_note && (
                          <span className="text-muted-foreground italic">— {t.emotional_note}</span>
                        )}
                        <span
                          className={cn(
                            'ml-auto tabular-nums font-semibold',
                            (t.profit ?? 0) >= 0 ? 'text-bull' : 'text-bear',
                          )}
                        >
                          {(t.profit ?? 0) >= 0 ? '+' : ''}
                          {(t.profit ?? 0).toFixed(2)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </PanelCard>
        </TabsContent>
      </Tabs>

      <EmotionLogModal
        trade={emotionTrade}
        open={emotionTrade !== null}
        onOpenChange={(v) => !v && setEmotionTrade(null)}
      />

      <TradeReconstructionModal
        trade={reconTrade}
        open={reconTrade !== null}
        onOpenChange={(v) => !v && setReconTrade(null)}
      />
    </div>
  );
}
