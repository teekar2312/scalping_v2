'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Bell,
  Plus,
  Trash2,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Gauge,
} from 'lucide-react';
import { PanelCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { TRADING_PAIRS } from '@/lib/constants';
import {
  listPriceAlerts,
  createPriceAlert,
  deletePriceAlert,
  testPriceAlert,
} from '@/lib/api';
import { showLocalNotification } from '@/lib/push-notifications';
import type {
  PriceAlert,
  PriceAlertType,
  PriceAlertNotifyMethod,
  PriceAlertCreateRequest,
} from '@/lib/types';

const ALERT_TYPES: Array<{ value: PriceAlertType; label: string; icon: typeof Bell }> = [
  { value: 'PRICE_ABOVE', label: 'Price Above', icon: ArrowUp },
  { value: 'PRICE_BELOW', label: 'Price Below', icon: ArrowDown },
  { value: 'ADX_CROSS_UP', label: 'ADX Cross Up (trending)', icon: TrendingUp },
  { value: 'ADX_CROSS_DOWN', label: 'ADX Cross Down (ranging)', icon: TrendingDown },
  { value: 'RSI_OVERBOUGHT', label: 'RSI Overbought (>70)', icon: ArrowUp },
  { value: 'RSI_OVERSOLD', label: 'RSI Oversold (<30)', icon: ArrowDown },
  { value: 'SPREAD_WIDE', label: 'Spread Wide (pip)', icon: Gauge },
];

const NOTIFY_METHODS: Array<{ value: PriceAlertNotifyMethod; label: string }> = [
  { value: 'BROWSER', label: 'Browser Push' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'BOTH', label: 'Both' },
];

function alertTypeLabel(t: PriceAlertType): string {
  return ALERT_TYPES.find((x) => x.value === t)?.label ?? t;
}

function alertTypeIcon(t: PriceAlertType) {
  return ALERT_TYPES.find((x) => x.value === t)?.icon ?? Bell;
}

function thresholdUnit(t: PriceAlertType, symbol: string): string {
  if (t.startsWith('PRICE')) return symbol === 'USDJPY' ? '¥' : '$';
  if (t.startsWith('ADX')) return '';
  if (t.startsWith('RSI')) return '';
  if (t === 'SPREAD_WIDE') return 'pip';
  return '';
}

export function AlertsView() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState<PriceAlertType>('PRICE_ABOVE');
  const [symbol, setSymbol] = useState<string>('EURUSD');
  const [threshold, setThreshold] = useState<string>('1.0920');
  const [notifyMethod, setNotifyMethod] = useState<PriceAlertNotifyMethod>('BOTH');
  const [active, setActive] = useState<boolean>(true);
  const [note, setNote] = useState<string>('');

  const refresh = () => {
    setLoading(true);
    listPriceAlerts()
      .then((r) => setAlerts(r.alerts))
      .catch(() => {
        // silent
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async () => {
    const thresholdNum = parseFloat(threshold);
    if (Number.isNaN(thresholdNum)) {
      toast({
        title: 'Threshold tidak valid',
        description: 'Masukkan angka yang valid untuk threshold.',
        variant: 'destructive',
      });
      return;
    }
    const body: PriceAlertCreateRequest = {
      type,
      symbol,
      threshold: thresholdNum,
      notify_method: notifyMethod,
      active,
      note: note.trim() || undefined,
    };
    setBusy('create');
    try {
      const created = await createPriceAlert(body);
      setAlerts((prev) => [created, ...prev]);
      toast({
        title: 'Alert created',
        description: `${alertTypeLabel(type)} · ${symbol} @ ${thresholdNum}`,
      });
      setNote('');
    } catch (e) {
      toast({
        title: 'Gagal membuat alert',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(`del-${id}`);
    try {
      await deletePriceAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast({ title: 'Alert deleted' });
    } catch (e) {
      toast({
        title: 'Gagal menghapus alert',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (a: PriceAlert) => {
    setBusy(`test-${a.id}`);
    try {
      const r = await testPriceAlert(a.id);
      // Also fire a local notification immediately (works in demo + production).
      await showLocalNotification(
        `🔔 Alert Test: ${alertTypeLabel(a.type)}`,
        `${a.symbol} threshold=${a.threshold} · ${r.message}`,
        { tag: `test-${a.id}` }
      );
      toast({
        title: 'Alert test fired',
        description: r.message,
      });
    } catch (e) {
      toast({
        title: 'Test gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleToggleActive = (a: PriceAlert) => {
    // Optimistically flip the active flag locally (real backend would POST update).
    setAlerts((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x))
    );
  };

  const stats = useMemo(() => {
    const activeCount = alerts.filter((a) => a.active).length;
    const triggeredToday = alerts.filter((a) => {
      if (!a?.last_triggered) return false;
      const lt = new Date(a?.last_triggered).getTime();
      return Date.now() - lt < 24 * 3600_000;
    }).length;
    return { total: alerts.length, active: activeCount, triggeredToday };
  }, [alerts]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <PanelCard
        title="Alerts Overview"
        subtitle={`${stats.total} total · ${stats.active} active · ${stats.triggeredToday} triggered (24h)`}
        icon={Bell}
        actions={
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={refresh}>
            <Activity className="h-3 w-3" />
            Refresh
          </Button>
        }
      >
        <div className="pt-3 grid grid-cols-3 gap-2">
          <div className="rounded-md border p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Total Alerts</div>
            <div className="text-2xl font-bold tabular-nums">{stats.total}</div>
          </div>
          <div className="rounded-md border p-3 border-bull/30">
            <div className="text-[10px] text-muted-foreground uppercase">Active</div>
            <div className="text-2xl font-bold tabular-nums text-bull">{stats.active}</div>
          </div>
          <div className="rounded-md border p-3 border-warn/30">
            <div className="text-[10px] text-muted-foreground uppercase">Triggered (24h)</div>
            <div className="text-2xl font-bold tabular-nums text-warn">{stats.triggeredToday}</div>
          </div>
        </div>
      </PanelCard>

      <PanelCard
        title="Create Alert"
        subtitle="Price / ADX / RSI / spread thresholds with browser + Telegram notification"
        icon={Plus}
      >
        <div className="pt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* Alert type */}
          <div>
            <Label className="text-xs">Alert Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as PriceAlertType)}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Symbol */}
          <div>
            <Label className="text-xs">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRADING_PAIRS.map((p) => (
                  <SelectItem key={p.symbol} value={p.symbol} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
                <SelectItem value="USDCHF" className="text-xs">USD/CHF</SelectItem>
                <SelectItem value="AUDUSD" className="text-xs">AUD/USD</SelectItem>
                <SelectItem value="USDCAD" className="text-xs">USD/CAD</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Threshold */}
          <div>
            <Label className="text-xs">
              Threshold ({thresholdUnit(type, symbol)})
            </Label>
            <Input
              type="number"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="mt-1 h-8 text-xs"
              placeholder="e.g. 1.0920"
            />
          </div>

          {/* Notify method */}
          <div>
            <Label className="text-xs">Notification Method</Label>
            <Select
              value={notifyMethod}
              onValueChange={(v) => setNotifyMethod(v as PriceAlertNotifyMethod)}
            >
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFY_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-xs font-medium">Active</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {/* Note */}
          <div className="md:col-span-2 xl:col-span-1">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 text-xs min-h-[36px]"
              placeholder="e.g. Breakout setup — alert me at resistance"
            />
          </div>

          <div className="md:col-span-2 xl:col-span-3 flex justify-end">
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={handleCreate}
              disabled={busy === 'create'}
            >
              {busy === 'create' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Create Alert
            </Button>
          </div>
        </div>
      </PanelCard>

      <PanelCard
        title="Active Alerts"
        subtitle={`${alerts.length} configured · click Test to fire immediately`}
        icon={Activity}
      >
        <div className="pt-3">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              Loading alerts…
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              Tidak ada alert terkonfigurasi. Buat satu di atas.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Symbol</TableHead>
                  <TableHead className="text-xs text-right">Threshold</TableHead>
                  <TableHead className="text-xs">Notify</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs">Last Triggered</TableHead>
                  <TableHead className="text-xs">Triggers</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => {
                  const Icon = alertTypeIcon(a.type);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{alertTypeLabel(a.type)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{a.symbol}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-mono">
                        {a.threshold} <span className="text-muted-foreground">{thresholdUnit(a.type, a.symbol)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {a.notify_method}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleToggleActive(a)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                            a.active
                              ? 'border-bull/40 bg-bull/10 text-bull'
                              : 'border-muted bg-muted/30 text-muted-foreground'
                          )}
                        >
                          {a.active ? (
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          ) : (
                            <XCircle className="h-2.5 w-2.5" />
                          )}
                          {a.active ? 'ACTIVE' : 'PAUSED'}
                        </button>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(a.created_at).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          timeZone: 'Asia/Jakarta',
                        })}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground tabular-nums">
                        {a?.last_triggered
                          ? new Date(a?.last_triggered).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Jakarta',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{a.trigger_count}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => handleTest(a)}
                            disabled={busy === `test-${a.id}`}
                          >
                            {busy === `test-${a.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <PlayCircle className="h-3 w-3" />
                            )}
                            Test
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-bear"
                            onClick={() => handleDelete(a.id)}
                            disabled={busy === `del-${a.id}`}
                          >
                            {busy === `del-${a.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </PanelCard>
    </div>
  );
}
