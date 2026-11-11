'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Layers,
  Newspaper,
  FlaskConical,
  Activity,
  Loader2,
  RefreshCw,
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
  CartesianGrid,
} from 'recharts';
import { PanelCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { TRADING_PAIRS } from '@/lib/constants';
import {
  getCurrencyStrength,
  getVolumeProfile,
  getCorrelationMatrix,
  getVolatilitySurface,
  getOrderFlow,
  getNewsSentiment,
  getEconomicSurpriseIndex,
} from '@/lib/api';
import type {
  CurrencyStrengthResponse,
  VolumeProfileResponse,
  CorrelationMatrixResponse,
  VolatilitySurfaceResponse,
  OrderFlowResponse,
  NewsSentimentResponse,
  SurpriseIndexResponse,
} from '@/lib/types';

const ALL_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD'];
const CORR_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD'];

export function MarketAnalysisView() {
  const [symbol, setSymbol] = useState<string>('EURUSD');
  const [corrWindow, setCorrWindow] = useState<number>(60);
  const [surpriseDays, setSurpriseDays] = useState<number>(30);

  // Data state
  const [strength, setStrength] = useState<CurrencyStrengthResponse | null>(null);
  const [volProfile, setVolProfile] = useState<VolumeProfileResponse | null>(null);
  const [correlation, setCorrelation] = useState<CorrelationMatrixResponse | null>(null);
  const [volSurface, setVolSurface] = useState<VolatilitySurfaceResponse | null>(null);
  const [orderFlow, setOrderFlow] = useState<OrderFlowResponse | null>(null);
  const [sentiment, setSentiment] = useState<NewsSentimentResponse | null>(null);
  const [surprise, setSurprise] = useState<SurpriseIndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      try {
        const [s, vp, cm, vs, of, ns, si] = await Promise.all([
          getCurrencyStrength(),
          getVolumeProfile(symbol),
          getCorrelationMatrix(CORR_PAIRS, corrWindow),
          getVolatilitySurface(symbol),
          getOrderFlow(symbol),
          getNewsSentiment(),
          getEconomicSurpriseIndex(surpriseDays),
        ]);
        setStrength(s);
        setVolProfile(vp);
        setCorrelation(cm);
        setVolSurface(vs);
        setOrderFlow(of);
        setSentiment(ns);
        setSurprise(si);
      } catch (e) {
        if (!silent)
          toast({ title: 'Refresh failed', description: String(e), variant: 'destructive' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [symbol, corrWindow, surpriseDays]
  );

  useEffect(() => {
    refresh();
    // Currency strength + sentiment refresh every 60s per spec.
    const id = setInterval(() => {
      getCurrencyStrength().then(setStrength).catch(() => {});
      getNewsSentiment().then(setSentiment).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Re-fetch symbol-dependent data when symbol changes.
  useEffect(() => {
    getVolumeProfile(symbol).then(setVolProfile).catch(() => {});
    getVolatilitySurface(symbol).then(setVolSurface).catch(() => {});
    getOrderFlow(symbol).then(setOrderFlow).catch(() => {});
  }, [symbol]);

  // Re-fetch correlation when window changes.
  useEffect(() => {
    getCorrelationMatrix(CORR_PAIRS, corrWindow).then(setCorrelation).catch(() => {});
  }, [corrWindow]);

  // Re-fetch surprise index when days changes.
  useEffect(() => {
    getEconomicSurpriseIndex(surpriseDays).then(setSurprise).catch(() => {});
  }, [surpriseDays]);

  // Safety: coerce all backend array fields to real arrays so .map() never crashes
  // on responses that omit a field or return a single scalar.
  const currencies = Array.isArray(strength?.currencies) ? strength!.currencies : [];
  const volLevels = Array.isArray(volProfile?.levels) ? volProfile!.levels : [];
  const corrPairs = Array.isArray(correlation?.pairs) ? correlation!.pairs : [];
  const corrMatrix = Array.isArray(correlation?.matrix) ? correlation!.matrix : [];
  const volTenors = Array.isArray(volSurface?.tenors) ? volSurface!.tenors : [];
  const orderFlowLevels = Array.isArray(orderFlow?.levels) ? orderFlow!.levels : [];
  const sentimentItems = Array.isArray(sentiment?.items) ? sentiment!.items : [];
  const surpriseEntries = Array.isArray(surprise?.entries) ? surprise!.entries : [];

  if (loading && !strength) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin mr-2 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading market analysis…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Top action row */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Currency strength &amp; news sentiment auto-refresh every 60s · other panels refresh on symbol change.
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => refresh(false)}
          disabled={refreshing}
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh All
        </Button>
      </div>

      {/* Symbol + window selectors */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-md border p-3 flex flex-col gap-1">
          <Label className="text-xs">Symbol (Volume Profile · Volatility · Order Flow)</Label>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="h-8 text-xs">
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
        <div className="rounded-md border p-3 flex flex-col gap-1">
          <Label className="text-xs">Correlation Window</Label>
          <Select
            value={String(corrWindow)}
            onValueChange={(v) => setCorrWindow(parseInt(v))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30" className="text-xs">30 days</SelectItem>
              <SelectItem value="60" className="text-xs">60 days</SelectItem>
              <SelectItem value="90" className="text-xs">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-md border p-3 flex flex-col gap-1">
          <Label className="text-xs">Surprise Index Window</Label>
          <Select
            value={String(surpriseDays)}
            onValueChange={(v) => setSurpriseDays(parseInt(v))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="14" className="text-xs">14 days</SelectItem>
              <SelectItem value="30" className="text-xs">30 days</SelectItem>
              <SelectItem value="60" className="text-xs">60 days</SelectItem>
              <SelectItem value="90" className="text-xs">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Currency Strength Meter */}
      <PanelCard
        title="Currency Strength Meter"
        subtitle="8 majors ranked · green = strong, red = weak"
        icon={TrendingUp}
      >
        <div className="pt-3">
          {strength && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={currencies}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[-100, 100]}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  type="category"
                  dataKey="currency"
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  formatter={(value: number) => [value.toFixed(1), 'Strength']}
                />
                <ReferenceLine x={0} stroke="var(--muted-foreground)" />
                <Bar dataKey="strength" radius={[0, 4, 4, 0]}>
                  {currencies.map((c, idx) => (
                    <Cell
                      key={idx}
                      fill={c.strength >= 50 ? '#10b981' : c.strength >= 0 ? '#84cc16' : c.strength >= -50 ? '#f59e0b' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </PanelCard>

      {/* Volume Profile */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelCard
          title={`Volume Profile — ${symbol}`}
          subtitle="POC / VAH / VAL with price-level histogram"
          icon={BarChart3}
        >
          <div className="pt-3">
            {volProfile ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">POC</div>
                    <div className="font-mono tabular-nums font-semibold">{volProfile.poc_price}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">VAH</div>
                    <div className="font-mono tabular-nums">{volProfile.vah_price}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">VAL</div>
                    <div className="font-mono tabular-nums">{volProfile.val_price}</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={volLevels}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      type="category"
                      dataKey="price"
                      tick={{ fontSize: 9 }}
                      stroke="var(--muted-foreground)"
                      width={60}
                      domain={['dataMin', 'dataMax']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--popover)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '11px',
                      }}
                      formatter={(value: number, _name, props) => [
                        value,
                        `Price ${props.payload.price}${props.payload.is_poc ? ' · POC' : ''}`,
                      ]}
                    />
                    <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                      {volLevels.map((lvl, idx) => (
                        <Cell
                          key={idx}
                          fill={
                            lvl.is_poc
                              ? '#f59e0b'
                              : lvl.in_value_area
                              ? '#3b82f6'
                              : '#64748b'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Loading volume profile…</div>
            )}
          </div>
        </PanelCard>

        {/* Correlation Matrix */}
        <PanelCard
          title={`Correlation Matrix — ${corrWindow}d window`}
          subtitle="Heatmap: -1 (red) to +1 (blue)"
          icon={Layers}
        >
          <div className="pt-3">
            {correlation && (
              <CorrelationHeatmap pairs={corrPairs} matrix={corrMatrix} />
            )}
          </div>
        </PanelCard>
      </div>

      {/* Volatility Surface + Order Flow */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelCard
          title={`Volatility Surface — ${symbol}`}
          subtitle="Per tenor (1D/5D/10D/20D/60D)"
          icon={Activity}
        >
          <div className="pt-3">
            {volSurface ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={volTenors} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="tenor" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={50} unit="%" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                    formatter={(value: number, name) => [
                      `${value.toFixed(2)}%`,
                      name === 'volatility_pct' ? 'Volatility' : 'Annualized',
                    ]}
                  />
                  <Bar dataKey="volatility_pct" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="annualized_pct" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-muted-foreground">Loading volatility surface…</div>
            )}
          </div>
        </PanelCard>

        <PanelCard
          title={`Order Flow — ${symbol}`}
          subtitle="Bid/ask depth ladder + imbalance"
          icon={BarChart3}
        >
          <div className="pt-3">
            {orderFlow && (
              <>
                {!orderFlow.supported && (
                  <div className="mb-3 rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn flex items-start gap-2">
                    <FlaskConical className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{orderFlow.note}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">Total Bid Vol</div>
                    <div className="font-mono tabular-nums text-bull">{orderFlow.total_bid_volume.toLocaleString()}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">Total Ask Vol</div>
                    <div className="font-mono tabular-nums text-bear">{orderFlow.total_ask_volume.toLocaleString()}</div>
                  </div>
                </div>
                <ScrollArea className="h-[180px]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1 font-medium">Price</th>
                        <th className="text-right font-medium">Bid</th>
                        <th className="text-right font-medium">Ask</th>
                        <th className="text-right font-medium">Imbalance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderFlowLevels.map((lvl, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-1 font-mono tabular-nums">{lvl.price}</td>
                          <td className="text-right tabular-nums text-bull">{lvl.bid_volume}</td>
                          <td className="text-right tabular-nums text-bear">{lvl.ask_volume}</td>
                          <td
                            className={cn(
                              'text-right tabular-nums font-semibold',
                              lvl.imbalance > 0.1
                                ? 'text-bull'
                                : lvl.imbalance < -0.1
                                ? 'text-bear'
                                : 'text-muted-foreground'
                            )}
                          >
                            {lvl.imbalance > 0 ? '+' : ''}{(lvl.imbalance * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </>
            )}
          </div>
        </PanelCard>
      </div>

      {/* News Sentiment */}
      <PanelCard
        title="News Sentiment"
        subtitle="Latest headlines with BULLISH / BEARISH / NEUTRAL tags"
        icon={Newspaper}
      >
        <div className="pt-3">
          {sentiment && (
            <div className="flex flex-col gap-1.5">
              {sentimentItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 rounded-md border p-2 text-xs"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] px-1.5 py-0 shrink-0 mt-0.5',
                      item.sentiment === 'BULLISH'
                        ? 'text-bull border-bull'
                        : item.sentiment === 'BEARISH'
                        ? 'text-bear border-bear'
                        : 'text-muted-foreground'
                    )}
                  >
                    {item.sentiment}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span>{item.source}</span>
                      <span>·</span>
                      <span>
                        {item.published_at
                          ? new Date(item.published_at).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Jakarta',
                            })
                          : '—'}
                      </span>
                      <span>·</span>
                      <span>conf {((item.confidence ?? 0) * 100).toFixed(0)}%</span>
                      {Array.isArray(item.affected_currencies) && item.affected_currencies.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5">
                            {item.affected_currencies.map((c) => (
                              <Badge key={c} variant="outline" className="text-[8px] px-1 py-0 mr-0.5">
                                {c}
                              </Badge>
                            ))}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PanelCard>

      {/* Economic Surprise Index */}
      <PanelCard
        title={`Economic Surprise Index — last ${surpriseDays} days`}
        subtitle="Per currency: actual vs forecast → surprise score"
        icon={TrendingDown}
      >
        <div className="pt-3">
          {surprise && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={surpriseEntries} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="currency" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={50}
                  unit="%"
                  domain={[-100, 100]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Surprise']}
                />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                <Bar dataKey="surprise_score" radius={[4, 4, 0, 0]}>
                  {surpriseEntries.map((e, idx) => (
                    <Cell
                      key={idx}
                      fill={
                        e.surprise_score > 20
                          ? '#10b981'
                          : e.surprise_score > 0
                          ? '#84cc16'
                          : e.surprise_score > -20
                          ? '#f59e0b'
                          : '#ef4444'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Correlation heatmap (custom render — Recharts doesn't have a built-in)
// --------------------------------------------------------------------------- //

function CorrelationHeatmap({ pairs, matrix }: { pairs: string[]; matrix: number[][] }) {
  const colorForValue = (v: number) => {
    // -1 (red) → 0 (white/gray) → +1 (blue)
    if (v >= 0) {
      const intensity = Math.round(v * 255);
      return `rgb(${59 + (255 - 59) * (1 - v)}, ${130 - 130 * v}, ${246 - 246 * (1 - v)})`;
    }
    const abs = Math.abs(v);
    return `rgb(${239}, ${68 + 68 * (1 - abs)}, ${68 + 68 * (1 - abs)})`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="p-1"></th>
            {pairs.map((p) => (
              <th key={p} className="p-1 font-medium text-muted-foreground">
                {p.replace('USD', '').slice(0, 3) || 'USD'}
                <div className="text-[8px]">{p}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((row, i) => (
            <tr key={row}>
              <td className="p-1 font-medium text-muted-foreground whitespace-nowrap">{row}</td>
              {pairs.map((col, j) => {
                const v = matrix[i][j];
                const textColor = Math.abs(v) > 0.5 ? 'text-white' : 'text-foreground';
                return (
                  <td
                    key={col}
                    className="p-1 text-center tabular-nums border border-border"
                    style={{
                      backgroundColor: colorForValue(v),
                      minWidth: 48,
                      height: 28,
                    }}
                    title={`${row} vs ${col}: ${v.toFixed(2)}`}
                  >
                    <span className={cn('font-mono font-semibold', textColor)}>
                      {v.toFixed(2)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: 'rgb(239, 68, 68)' }} />
          -1 inverse
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-muted-foreground/30" />
          0 uncorrelated
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: 'rgb(59, 130, 246)' }} />
          +1 perfect
        </span>
      </div>
    </div>
  );
}
