'use client';

import { useEffect, useState } from 'react';
import { Briefcase, TrendingUp, X } from 'lucide-react';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getOpenTrades, getTradeHistory, controlBot } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { Trade } from '@/lib/types';

export function PositionsView() {
  const [open, setOpen] = useState<Trade[]>([]);
  const [history, setHistory] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getOpenTrades(), getTradeHistory()])
      .then(([o, h]) => {
        setOpen(o);
        setHistory(h);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleClosePosition = async (ticket: number, symbol: string) => {
    toast({
      title: 'Close position request',
      description: `Ticket #${ticket} ${symbol} — manual close via MT5`,
    });
    setOpen((prev) => prev.filter((t) => t.ticket !== ticket));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat posisi...</div>
      </div>
    );
  }

  const totalProfit = open.reduce((a, b) => a + (b.profitNet || 0), 0);
  const totalVolume = open.reduce((a, b) => a + b.volume, 0);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open Positions" value={open.length} icon={Briefcase} />
        <StatCard label="Total Volume" value={totalVolume.toFixed(2)} unit="lot" />
        <StatCard
          label="Floating P&L"
          value={`${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}`}
          unit="USD"
          trend={totalProfit >= 0 ? 'up' : 'down'}
          variant={totalProfit >= 0 ? 'bull' : 'bear'}
        />
        <StatCard label="History (30)" value={history.length} icon={TrendingUp} />
      </div>

      {/* Open Positions */}
      <PanelCard
        title="Open Positions"
        subtitle={`${open.length} aktif · klik Close untuk exit manual`}
        icon={Briefcase}
      >
        <div className="pt-3">
          {open.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
              <Briefcase className="h-8 w-8 mb-2 opacity-30" />
              Tidak ada posisi terbuka
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-2 font-medium">Ticket</th>
                    <th className="text-left font-medium">Symbol</th>
                    <th className="text-left font-medium">Dir</th>
                    <th className="text-right font-medium">Vol</th>
                    <th className="text-right font-medium">Entry</th>
                    <th className="text-right font-medium">SL</th>
                    <th className="text-right font-medium">TP1</th>
                    <th className="text-right font-medium">TP2</th>
                    <th className="text-right font-medium">SL pip</th>
                    <th className="text-right font-medium">RR Net</th>
                    <th className="text-right font-medium">ADX</th>
                    <th className="text-right font-medium">ATR</th>
                    <th className="text-right font-medium">Setup</th>
                    <th className="text-right font-medium">Session</th>
                    <th className="text-right font-medium">Entry Time</th>
                    <th className="text-right font-medium">P&L</th>
                    <th className="text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((t) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="py-1.5 px-2 font-mono text-[10px]">{t.ticket}</td>
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
                      <td className="text-right tabular-nums text-bear">{t.sl}</td>
                      <td className="text-right tabular-nums text-bull">{t.tp1}</td>
                      <td className="text-right tabular-nums text-bull">{t.tp2}</td>
                      <td className="text-right tabular-nums">{t.slPips.toFixed(1)}</td>
                      <td className="text-right tabular-nums font-semibold">{t.rrNet.toFixed(2)}</td>
                      <td className="text-right tabular-nums">{t.adxValue.toFixed(1)}</td>
                      <td className="text-right tabular-nums">{t.atrValue.toFixed(1)}</td>
                      <td className="text-right text-[10px]">{t.setupType.replace('_', ' ')}</td>
                      <td className="text-right text-[10px]">{t.session}</td>
                      <td className="text-right tabular-nums text-[10px]">
                        {new Date(t.entryTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => handleClosePosition(t.ticket, t.symbol)}
                        >
                          <X className="h-3 w-3" /> Close
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PanelCard>

      {/* Recent History */}
      <PanelCard
        title="Recent History (30 trades)"
        subtitle="Closed positions"
        icon={TrendingUp}
      >
        <div className="pt-3">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Ticket</th>
                  <th className="text-left font-medium">Symbol</th>
                  <th className="text-left font-medium">Dir</th>
                  <th className="text-right font-medium">Vol</th>
                  <th className="text-right font-medium">Entry</th>
                  <th className="text-right font-medium">Exit</th>
                  <th className="text-right font-medium">SL pip</th>
                  <th className="text-right font-medium">RR Net</th>
                  <th className="text-right font-medium">Result</th>
                  <th className="text-right font-medium">R</th>
                  <th className="text-right font-medium">P&L</th>
                  <th className="text-right font-medium">Close Reason</th>
                  <th className="text-right font-medium">Duration</th>
                  <th className="text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="py-1.5 px-2 font-mono text-[10px]">{t.ticket}</td>
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
                    <td className="text-right tabular-nums">{t.rrNet.toFixed(2)}</td>
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
                    <td className="text-right text-[10px]">{t.closeReason}</td>
                    <td className="text-right tabular-nums text-[10px]">
                      {t.durationMin ? `${t.durationMin}m` : '-'}
                    </td>
                    <td className="text-right tabular-nums text-[10px]">
                      {new Date(t.entryTime).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jakarta' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PanelCard>
    </div>
  );
}
