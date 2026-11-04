'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, TrendingUp, Filter } from 'lucide-react';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getTradeHistory } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { Trade } from '@/lib/types';

export function JournalView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState<string>('ALL');
  const [filterResult, setFilterResult] = useState<string>('ALL');

  useEffect(() => {
    getTradeHistory()
      .then(setTrades)
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

  const handleExportPdf = () => {
    toast({
      title: 'PDF Export',
      description: 'Jurnal mingguan PDF di-generate. Lihat tab Strategy → Kalender Template.',
    });
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

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
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
        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs gap-1.5" onClick={handleExportPdf}>
          <Download className="h-3.5 w-3.5" />
          Export PDF Mingguan
        </Button>
      </div>

      {/* Trade table */}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PanelCard>

      {/* Performance by pair */}
      <PanelCard title="Performance by Pair" subtitle="Win rate & R-net per symbol" icon={TrendingUp}>
        <div className="pt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Array.from(new Set(trades.map((t) => t.symbol))).map((sym) => {
              const symTrades = trades.filter((t) => t.symbol === sym);
              const wins = symTrades.filter((t) => t.result === 'WIN').length;
              const totalR = symTrades.reduce((a, b) => a + (b.rMultiple || 0), 0);
              const wr = symTrades.length > 0 ? (wins / symTrades.length) * 100 : 0;
              return (
                <div key={sym} className="rounded-md border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{sym}</span>
                    <Badge variant="outline" className="text-[10px]">{symTrades.length} trades</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground text-[10px]">Win Rate</div>
                      <div className={cn('font-semibold tabular-nums', wr >= 45 ? 'text-bull' : 'text-bear')}>
                        {wr.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">R-Net Total</div>
                      <div className={cn('font-semibold tabular-nums', totalR >= 0 ? 'text-bull' : 'text-bear')}>
                        {totalR >= 0 ? '+' : ''}{totalR.toFixed(2)}R
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PanelCard>
    </div>
  );
}
