'use client';

import { useEffect, useState } from 'react';
import { Zap, Clock, TrendingUp, Filter, CheckCircle2, XCircle, Bot } from 'lucide-react';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getSignals, analyzeSetup } from '@/lib/api';
import { PRE_TRADE_CHECKLIST } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Signal } from '@/lib/types';

export function SignalsView() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'EXECUTED' | 'SKIPPED'>('ALL');
  const [selected, setSelected] = useState<Signal | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    getSignals()
      .then(setSignals)
      .finally(() => setLoading(false));
  }, []);

  const filtered = signals.filter((s) => filter === 'ALL' || s.status === filter);

  const handleAnalyze = async (signal: Signal) => {
    setSelected(signal);
    setAiAnalysis(null);
    setAiLoading(true);
    try {
      const verdict = await analyzeSetup(signal);
      setAiAnalysis(verdict);
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat sinyal...</div>
      </div>
    );
  }

  const activeCount = signals.filter((s) => s.status === 'ACTIVE').length;
  const executedCount = signals.filter((s) => s.status === 'EXECUTED').length;
  const skippedCount = signals.filter((s) => s.status === 'SKIPPED').length;
  const avgRr = signals.length > 0 ? signals.reduce((a, b) => a + b.rrNet, 0) / signals.length : 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Sinyal" value={signals.length} icon={Zap} />
        <StatCard label="Aktif" value={activeCount} variant="warn" icon={Clock} />
        <StatCard label="Dieksekusi" value={executedCount} variant="bull" icon={TrendingUp} />
        <StatCard label="Rata-rata RR Net" value={avgRr.toFixed(2)} variant={avgRr >= 2.0 ? 'bull' : 'bear'} />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {(['ALL', 'ACTIVE', 'EXECUTED', 'SKIPPED'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            className="text-xs"
            onClick={() => setFilter(f)}
          >
            {f}
            {f !== 'ALL' && (
              <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">
                {signals.filter((s) => s.status === f).length}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Signals list */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((sig) => (
          <PanelCard
            key={sig.id}
            title={`${sig.symbol} · ${sig.direction}`}
            subtitle={new Date(sig.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
            icon={sig.direction === 'BUY' ? TrendingUp : TrendingUp}
            actions={
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px]',
                  sig.status === 'ACTIVE' && 'text-warn border-warn',
                  sig.status === 'EXECUTED' && 'text-bull border-bull',
                  sig.status === 'SKIPPED' && 'text-bear border-bear',
                  sig.status === 'EXPIRED' && 'text-muted-foreground'
                )}
              >
                {sig.status}
              </Badge>
            }
          >
            <div className="flex flex-col gap-2 pt-3 text-xs">
              {/* Setup info */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-muted-foreground text-[10px]">Setup Type</div>
                  <div className="font-medium">{sig.setupType.replace('_', ' ')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Session</div>
                  <div className="font-medium">{sig.session}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">Entry</div>
                  <div className="font-mono tabular-nums">{sig.entryPrice}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">SL / TP1 / TP2 (pip)</div>
                  <div className="font-mono tabular-nums">
                    <span className="text-bear">{sig.slPips.toFixed(1)}</span> /{' '}
                    <span className="text-bull">{sig.tp1Pips.toFixed(1)}</span> /{' '}
                    <span className="text-bull">{(sig.tp1Pips * 2).toFixed(1)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">ATR / ADX</div>
                  <div className="font-mono tabular-nums">
                    {sig.atrValue.toFixed(1)} / {sig.adxValue.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px]">RR Net</div>
                  <div
                    className={cn(
                      'font-mono tabular-nums font-semibold',
                      sig.rrNet >= 2.0 ? 'text-bull' : 'text-bear'
                    )}
                  >
                    {sig.rrNet.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Checklist summary */}
              <div className="border-t pt-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground text-[10px]">Checklist V2 (8 poin)</span>
                  <span className="font-mono tabular-nums">
                    {sig.checklistPassed}/8
                  </span>
                </div>
                <div className="flex gap-0.5">
                  {sig.checklist.map((c) => (
                    <div
                      key={c.point}
                      className={cn(
                        'h-1.5 flex-1 rounded-sm',
                        c.passed ? 'bg-bull' : 'bg-bear'
                      )}
                      title={`#${c.point}: ${c.label} — ${c.passed ? 'PASS' : 'FAIL'}`}
                    />
                  ))}
                </div>
              </div>

              {sig.reason && (
                <div className="rounded-md border border-bear/30 bg-bear/5 p-2 text-bear">
                  <span className="text-[10px] font-medium">SKIP REASON:</span>{' '}
                  <span className="text-xs">{sig.reason}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs flex-1"
                      onClick={() => handleAnalyze(sig)}
                    >
                      <Bot className="h-3 w-3" /> AI Analisa
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5" />
                        AI Compliance Analysis — {sig.symbol} {sig.direction}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto scroll-thin">
                      {/* Setup summary */}
                      <div className="rounded-md border p-3 text-xs">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <div className="text-muted-foreground">Entry</div>
                            <div className="font-mono">{sig.entryPrice}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">SL/TP1 (pip)</div>
                            <div className="font-mono">{sig.slPips.toFixed(1)} / {sig.tp1Pips.toFixed(1)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">RR Net</div>
                            <div className="font-mono">{sig.rrNet.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">ADX</div>
                            <div className="font-mono">{sig.adxValue.toFixed(1)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">ATR</div>
                            <div className="font-mono">{sig.atrValue.toFixed(1)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Setup</div>
                            <div className="font-mono">{sig.setupType.replace('_', ' ')}</div>
                          </div>
                        </div>
                      </div>

                      {/* Checklist detail */}
                      <div className="rounded-md border p-3">
                        <div className="mb-2 text-xs font-medium">8-Point V2 Checklist</div>
                        <div className="flex flex-col gap-1.5">
                          {sig.checklist.map((c) => (
                            <div key={c.point} className="flex items-start gap-2 text-xs">
                              {c.passed ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-bull shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-bear shrink-0 mt-0.5" />
                              )}
                              <span className={cn(!c.passed && 'text-bear')}>
                                <span className="font-mono">#{c.point}.</span> {c.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* AI verdict */}
                      <div className="rounded-md border border-info/30 bg-info/5 p-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                          <Bot className="h-3.5 w-3.5" /> Ollama llama3.2 Verdict
                        </div>
                        {aiLoading ? (
                          <div className="text-xs text-muted-foreground">Menganalisa setup dengan AI...</div>
                        ) : aiAnalysis ? (
                          <pre className="whitespace-pre-wrap text-xs font-sans">{aiAnalysis}</pre>
                        ) : (
                          <div className="text-xs text-muted-foreground">Klik "AI Analisa" untuk memulai.</div>
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </PanelCard>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
          <Zap className="h-10 w-10 mb-3 opacity-20" />
          Tidak ada sinyal dengan filter {filter}
        </div>
      )}

      {/* Reference checklist */}
      <PanelCard title="Pre-Trade Checklist V2 (8 Pertanyaan)" subtitle="Wajib semua tercentang sebelum entry" icon={CheckCircle2}>
        <div className="flex flex-col gap-2 pt-3">
          {PRE_TRADE_CHECKLIST.map((item) => (
            <div key={item.id} className="flex items-start gap-2 text-xs">
              <span className="font-mono text-muted-foreground shrink-0">#{String(item.id).padStart(2, '0')}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}
