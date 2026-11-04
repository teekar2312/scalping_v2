'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  LineChart,
  Area,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Bar,
  BarChart,
  Cell,
} from 'recharts';
import { PanelCard, StatCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAppStore } from '@/lib/store';
import { getChartData } from '@/lib/api';
import { TRADING_PAIRS, V2_RULES, SESSIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ChartData, MarketRegime } from '@/lib/types';
import { CandlestickChart, TrendingUp, Activity, Gauge, Zap } from 'lucide-react';

const TIMEFRAMES = ['M1', 'M5', 'M15', 'H1', 'H4'] as const;

// Custom candlestick shape
interface CandleTick {
  open: number;
  high: number;
  low: number;
  close: number;
  isBull: boolean;
}
function CandlestickShape(props: any) {
  const { x, y, width, height, payload } = props;
  const { open, high, low, close } = payload;
  const isBull = close >= open;
  const color = isBull ? 'var(--bull)' : 'var(--bear)';

  const all = [open, high, low, close];
  const max = Math.max(...all);
  const min = Math.min(...all);
  const range = max - min || 1;

  // Map price to y coordinate
  const yScale = (price: number) => y + ((max - price) / range) * height;

  const bodyTop = yScale(Math.max(open, close));
  const bodyBottom = yScale(Math.min(open, close));
  const wickTop = yScale(high);
  const wickBottom = yScale(low);
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const bodyWidth = Math.max(1, width * 0.7);
  const bodyX = x + (width - bodyWidth) / 2;
  const wickX = x + width / 2;

  return (
    <g>
      {/* Wick */}
      <line x1={wickX} y1={wickTop} x2={wickX} y2={wickBottom} stroke={color} strokeWidth={1} />
      {/* Body */}
      <rect x={bodyX} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} stroke={color} strokeWidth={0.5} />
    </g>
  );
}

export function ChartView() {
  const activeSymbol = useAppStore((s) => s.activeSymbol);
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol);
  const [timeframe, setTimeframe] = useState<typeof TIMEFRAMES[number]>('M5');
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [showBB, setShowBB] = useState(true);
  const [showVWAP, setShowVWAP] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getChartData(activeSymbol).then((data) => {
      if (!cancelled) setChartData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSymbol]);

  // Derived loading state - true when data missing or symbol mismatch
  const loading = !chartData || chartData.symbol !== activeSymbol;

  const chartRows = useMemo(() => {
    if (!chartData) return [];
    return chartData.candles.map((c) => ({
      time: new Date(c.time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ema9: chartData.indicators.ema9[chartData.candles.indexOf(c)],
      ema21: chartData.indicators.ema21[chartData.candles.indexOf(c)],
      vwap: chartData.indicators.vwap[chartData.candles.indexOf(c)],
      bbUpper: chartData.indicators.bbUpper[chartData.candles.indexOf(c)],
      bbLower: chartData.indicators.bbLower[chartData.candles.indexOf(c)],
      isBull: c.close >= c.open,
    }));
  }, [chartData]);

  const indicatorRows = useMemo(() => {
    if (!chartData) return { adx: [], rsi: [], atr: [] };
    const fmtTime = (t: string) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
    return {
      adx: chartData.candles.map((c, i) => ({ time: fmtTime(c.time), adx: chartData.indicators.adx[i] })),
      rsi: chartData.candles.map((c, i) => ({ time: fmtTime(c.time), rsi: chartData.indicators.rsi[i] })),
      atr: chartData.candles.map((c, i) => ({ time: fmtTime(c.time), atr: chartData.indicators.atr[i] })),
    };
  }, [chartData]);

  const latest = chartRows[chartRows.length - 1];
  const latestAdx = indicatorRows.adx[indicatorRows.adx.length - 1]?.adx || 0;
  const latestRsi = indicatorRows.rsi[indicatorRows.rsi.length - 1]?.rsi || 50;
  const latestAtr = indicatorRows.atr[indicatorRows.atr.length - 1]?.atr || 0;

  const regime: MarketRegime =
    latestAdx > 50 ? 'EXHAUSTION' : latestAdx > 25 ? 'TRENDING' : latestAdx > 20 ? 'TRANSITION' : 'RANGING';
  const regimeColor = {
    TRENDING: 'text-bull border-bull',
    TRANSITION: 'text-warn border-warn',
    RANGING: 'text-bear border-bear',
    EXHAUSTION: 'text-warn border-warn',
  }[regime];

  const slPips = latestAtr * V2_RULES.SL_ATR_MULT + V2_RULES.SL_PIP_BUFFER;
  const tp1Pips = slPips * V2_RULES.TP1_MULT;
  const digits = activeSymbol === 'USDJPY' ? 3 : 5;

  if (loading || !chartData || !latest) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Memuat chart {activeSymbol}...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Symbol selector + timeframe */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {TRADING_PAIRS.map((p) => (
            <Button
              key={p.symbol}
              size="sm"
              variant={activeSymbol === p.symbol ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setActiveSymbol(p.symbol)}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={timeframe} onValueChange={(v) => v && setTimeframe(v as any)}>
            {TIMEFRAMES.map((tf) => (
              <ToggleGroupItem key={tf} value={tf} className="text-xs px-2 py-1">
                {tf}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button size="sm" variant={showBB ? 'default' : 'outline'} className="text-xs" onClick={() => setShowBB(!showBB)}>
            BB
          </Button>
          <Button size="sm" variant={showVWAP ? 'default' : 'outline'} className="text-xs" onClick={() => setShowVWAP(!showVWAP)}>
            VWAP
          </Button>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Price" value={latest.close.toFixed(digits)} icon={TrendingUp} />
        <StatCard label="EMA9" value={latest.ema9.toFixed(digits)} variant="info" />
        <StatCard label="EMA21" value={latest.ema21.toFixed(digits)} variant="info" />
        <StatCard
          label="ADX(14)"
          value={latestAdx.toFixed(1)}
          variant={regime === 'TRENDING' ? 'bull' : regime === 'RANGING' ? 'bear' : 'warn'}
        />
        <StatCard label="ATR(14)" value={latestAtr.toFixed(1)} unit="pip" icon={Activity} />
        <StatCard
          label="RSI(14)"
          value={latestRsi.toFixed(1)}
          variant={latestRsi > 70 ? 'bear' : latestRsi < 30 ? 'bull' : 'default'}
        />
      </div>

      {/* Regime + SL/TP info bar */}
      <div className="flex items-center gap-3 flex-wrap rounded-md border bg-muted/20 p-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Regime:</span>
          <Badge variant="outline" className={cn('text-[10px]', regimeColor)}>
            {regime}
          </Badge>
          {regime === 'RANGING' && <span className="text-bear">→ SKIP sesuai V2</span>}
          {regime === 'TRANSITION' && <span className="text-warn">→ WAIT, hanya setup A+</span>}
          {regime === 'TRENDING' && <span className="text-bull">→ TRADE valid</span>}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">SL adaptif:</span>
          <span className="font-mono tabular-nums">{slPips.toFixed(1)} pip</span>
          <span className="text-muted-foreground">= 1.5×ATR + 2</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">TP1:</span>
          <span className="font-mono tabular-nums text-bull">{tp1Pips.toFixed(1)} pip</span>
          <span className="text-muted-foreground">(2×SL)</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">TP2:</span>
          <span className="font-mono tabular-nums text-bull">{(tp1Pips * 2).toFixed(1)} pip</span>
          <span className="text-muted-foreground">(4×SL)</span>
        </div>
      </div>

      {/* Main chart */}
      <PanelCard
        title={`${activeSymbol} · ${timeframe}`}
        subtitle="Candlestick + EMA9/21 + VWAP + Bollinger Bands"
        icon={CandlestickChart}
        bodyClassName="h-[420px]"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              interval={Math.max(0, Math.floor(chartRows.length / 12))}
              stroke="var(--muted-foreground)"
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              width={70}
              tickFormatter={(v) => Number(v).toFixed(digits)}
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
              formatter={(value: any, name: string) => [Number(value).toFixed(digits), name]}
            />

            {/* Bollinger Bands */}
            {showBB && (
              <>
                <Line type="monotone" dataKey="bbUpper" stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} dot={false} name="BB Upper" />
                <Line type="monotone" dataKey="bbLower" stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} dot={false} name="BB Lower" />
              </>
            )}

            {/* Candlesticks via custom shape */}
            <Bar dataKey="high" shape={<CandlestickShape />} barSize={8} />

            {/* EMA lines */}
            <Line type="monotone" dataKey="ema9" stroke="var(--info)" strokeWidth={1.5} dot={false} name="EMA9" />
            <Line type="monotone" dataKey="ema21" stroke="var(--warn)" strokeWidth={1.5} dot={false} name="EMA21" />
            {showVWAP && (
              <Line type="monotone" dataKey="vwap" stroke="var(--chart-4)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="VWAP" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </PanelCard>

      {/* Indicator panels */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PanelCard title="ADX(14) — Regime Filter" subtitle=">25 trade, <20 skip" icon={Gauge} bodyClassName="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={indicatorRows.adx} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 9 }} interval={Math.max(0, Math.floor(indicatorRows.adx.length / 6))} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" width={30} domain={[0, 60]} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: '10px' }} />
              <ReferenceLine y={25} stroke="var(--bull)" strokeDasharray="3 3" label={{ value: 'TRADE 25', fontSize: 9, fill: 'var(--bull)' }} />
              <ReferenceLine y={20} stroke="var(--bear)" strokeDasharray="3 3" label={{ value: 'SKIP 20', fontSize: 9, fill: 'var(--bear)' }} />
              <Line type="monotone" dataKey="adx" stroke="var(--info)" strokeWidth={1.5} dot={false} name="ADX" />
            </LineChart>
          </ResponsiveContainer>
        </PanelCard>

        <PanelCard title="RSI(14) — Konfirmator" subtitle="Opsional · 30/70 levels" icon={Activity} bodyClassName="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={indicatorRows.rsi} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 9 }} interval={Math.max(0, Math.floor(indicatorRows.rsi.length / 6))} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" width={30} domain={[0, 100]} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: '10px' }} />
              <ReferenceLine y={70} stroke="var(--bear)" strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="var(--bull)" strokeDasharray="3 3" />
              <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="1 1" />
              <Line type="monotone" dataKey="rsi" stroke="var(--chart-5)" strokeWidth={1.5} dot={false} name="RSI" />
            </LineChart>
          </ResponsiveContainer>
        </PanelCard>

        <PanelCard title="ATR(14) — Volatilitas" subtitle="Dasar SL adaptif" icon={Activity} bodyClassName="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={indicatorRows.atr} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" tick={{ fontSize: 9 }} interval={Math.max(0, Math.floor(indicatorRows.atr.length / 6))} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" width={30} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: '10px' }} />
              <Line type="monotone" dataKey="atr" stroke="var(--warn)" strokeWidth={1.5} dot={false} name="ATR" />
            </LineChart>
          </ResponsiveContainer>
        </PanelCard>
      </div>

      {/* Session markers legend */}
      <PanelCard title="Sesi Trading & Blacklist WIB" subtitle="Highlight area trade vs skip" icon={Zap}>
        <div className="flex flex-wrap gap-2 pt-3">
          {SESSIONS.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
              <span className={cn('h-2 w-2 rounded-full', s.trade ? 'bg-bull' : 'bg-muted-foreground')} />
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">{s.start}-{s.end}</span>
              <span className="text-[10px] text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}
