'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Activity,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Database,
  Clock,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  CloudUpload,
  Zap,
} from 'lucide-react';
import { PanelCard, StatCard, StatusDot } from '../shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import {
  getSystemInfo,
  getServiceStatus,
  getDrawdownRealtime,
  getReadiness,
  getEnhancedHealthz,
  getMetrics,
  getBrokerStatus,
  triggerBrokerFailover,
  triggerOffsiteBackup,
} from '@/lib/api';
import type {
  SystemInfoResponse,
  ServiceStatusResponse,
  DrawdownRealtimeResponse,
  ReadinessResponse,
  EnhancedHealthzResponse,
  BrokerStatusResponse,
} from '@/lib/types';

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)} KB`;
  return `${bytes} B`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function SystemHealthView() {
  const [info, setInfo] = useState<SystemInfoResponse | null>(null);
  const [services, setServices] = useState<ServiceStatusResponse | null>(null);
  const [drawdown, setDrawdown] = useState<DrawdownRealtimeResponse | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [healthz, setHealthz] = useState<EnhancedHealthzResponse | null>(null);
  const [broker, setBroker] = useState<BrokerStatusResponse | null>(null);
  const [metricsText, setMetricsText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failoverBusy, setFailoverBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  const refresh = async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const [i, s, d, r, h, b, m] = await Promise.all([
        getSystemInfo(),
        getServiceStatus(),
        getDrawdownRealtime(),
        getReadiness(),
        getEnhancedHealthz(),
        getBrokerStatus(),
        getMetrics(),
      ]);
      setInfo(i);
      setServices(s);
      setDrawdown(d);
      setReadiness(r);
      setHealthz(h);
      setBroker(b);
      setMetricsText(m);
    } catch (e) {
      if (!silent) toast({ title: 'Refresh failed', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
    // Poll every 10s (per spec).
    const id = setInterval(() => refresh(true), 10_000);
    return () => clearInterval(id);
  }, []);

  const requestRate = useMemo(() => {
    if (!metricsText) return null;
    const match = metricsText.match(/scalping_v2_http_request_duration_seconds_bucket\{le="\+Inf"\}\s+(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }, [metricsText]);

  const errorRate = useMemo(() => {
    if (!metricsText) return null;
    const match = metricsText.match(/scalping_v2_http_errors_total\s+(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }, [metricsText]);

  if (loading && !info) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin mr-2 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading system health…</span>
      </div>
    );
  }

  const overallStatus = readiness?.status ?? 'healthy';

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Top stat row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="System Status"
          value={overallStatus.toUpperCase()}
          variant={overallStatus === 'healthy' ? 'bull' : overallStatus === 'degraded' ? 'warn' : 'bear'}
          icon={Activity}
          trendValue={healthz ? `v${healthz.version}` : ''}
        />
        <StatCard
          label="Uptime"
          value={info ? formatUptime(info.uptime_seconds) : '—'}
          icon={Clock}
          trendValue={healthz ? `boot ${new Date(healthz.checked_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}` : ''}
        />
        <StatCard
          label="CPU Usage"
          value={info ? `${(info.cpu_percent ?? 0).toFixed(1)}%` : '—'}
          unit=""
          icon={Cpu}
          variant={info && (info.cpu_percent ?? 0) > 80 ? 'bear' : info && (info.cpu_percent ?? 0) > 60 ? 'warn' : 'default'}
          trendValue={info ? `${info.cpu_count} cores` : ''}
        />
        <StatCard
          label="Memory Usage"
          value={info ? `${(info.memory_percent ?? 0).toFixed(1)}%` : '—'}
          unit=""
          icon={MemoryStick}
          variant={info && (info.memory_percent ?? 0) > 85 ? 'bear' : info && (info.memory_percent ?? 0) > 70 ? 'warn' : 'default'}
          trendValue={info ? `${formatBytes(info.memory_used_bytes)} / ${formatBytes(info.memory_total_bytes)}` : ''}
        />
      </div>

      <PanelCard
        title="System Info"
        subtitle={info ? `${info.python_version} · ${info.os}` : 'Python backend system info'}
        icon={Server}
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => refresh(false)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
        }
      >
        <div className="pt-3 grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3 text-xs">
          {info && (
            <>
              <InfoRow label="Hostname" value={info.hostname} mono />
              <InfoRow label="OS" value={info.os} />
              <InfoRow label="Python" value={info.python_version} mono />
              <InfoRow label="CPU Count" value={`${info.cpu_count} cores`} mono />
              <InfoRow label="CPU Usage" value={`${(info.cpu_percent ?? 0).toFixed(1)}%`} mono />
              <InfoRow label="Process ID" value={String(info.process_id)} mono />
              <InfoRow
                label="Memory"
                value={`${formatBytes(info.memory_used_bytes)} / ${formatBytes(info.memory_total_bytes)}`}
                mono
              />
              <InfoRow
                label="Disk"
                value={`${formatBytes(info.disk_used_bytes)} / ${formatBytes(info.disk_total_bytes)}`}
                mono
              />
              <InfoRow label="Uptime" value={formatUptime(info.uptime_seconds)} mono />
              <InfoRow label="Boot Time" value={info.boot_time ? new Date(info.boot_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '—'} />
              <InfoRow label="Active DB Conns" value={String(info.active_db_connections)} mono />
            </>
          )}
        </div>
      </PanelCard>

      {/* Resource gauges row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PanelCard title="Memory Usage" subtitle="RAM consumption" icon={MemoryStick}>
          <GaugeBar
            used={info?.memory_used_bytes ?? 0}
            total={info?.memory_total_bytes ?? 0}
            percent={info?.memory_percent ?? 0}
            unit="GB"
            formatBytes={formatBytes}
            warn={70}
            danger={85}
          />
        </PanelCard>
        <PanelCard title="Disk Usage" subtitle="Primary partition" icon={HardDrive}>
          <GaugeBar
            used={info?.disk_used_bytes ?? 0}
            total={info?.disk_total_bytes ?? 0}
            percent={info?.disk_percent ?? 0}
            unit="GB"
            formatBytes={formatBytes}
            warn={75}
            danger={90}
          />
        </PanelCard>
        <PanelCard title="CPU Usage" subtitle="Real-time load" icon={Cpu}>
          <div className="pt-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">
                {info ? `${(info.cpu_percent ?? 0).toFixed(1)}%` : '—'}
              </span>
              <span className="text-xs text-muted-foreground">
                {info ? `${info.cpu_count} cores` : ''}
              </span>
            </div>
            <Progress
              value={info?.cpu_percent ?? 0}
              className={cn(
                'h-2',
                (info?.cpu_percent ?? 0) > 80 && '[&>div]:bg-bear',
                (info?.cpu_percent ?? 0) > 60 && (info?.cpu_percent ?? 0) <= 80 && '[&>div]:bg-warn',
              )}
            />
            <div className="mt-2 text-[10px] text-muted-foreground">
              Sustained load &gt; 80% for 5+ minutes → check bot loop / Ollama inference.
            </div>
          </div>
        </PanelCard>
      </div>

      {/* Service status table */}
      <PanelCard
        title="Service Status"
        subtitle="MT5 · DB · Ollama · Tiingo · Telegram · WebSocket — polled every 10s"
        icon={Activity}
      >
        <div className="pt-3">
          {services && Array.isArray(services.services) && services.services.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Service</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Latency</TableHead>
                  <TableHead className="text-xs">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.services.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="text-xs font-medium">{s.name}</TableCell>
                    <TableCell>
                      {s.ok ? (
                        <Badge variant="outline" className="text-[10px] text-bull border-bull gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> UP
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-bear border-bear gap-1">
                          <XCircle className="h-2.5 w-2.5" /> DOWN
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {s.latency_ms > 0 ? `${s.latency_ms} ms` : '—'}
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{s.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Tidak ada service status tersedia.
            </div>
          )}
        </div>
      </PanelCard>

      {/* Broker + readiness + drawdown */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PanelCard
          title="Broker Status"
          subtitle="MT5 + Ollama + Tiingo failover"
          icon={Server}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={async () => {
                setFailoverBusy(true);
                try {
                  const r = await triggerBrokerFailover('manual operator trigger');
                  toast({
                    title: `Failover triggered → ${r.switched_to}`,
                    description: r.reason,
                  });
                  const b = await getBrokerStatus();
                  setBroker(b);
                } catch (e) {
                  toast({ title: 'Failover gagal', description: String(e), variant: 'destructive' });
                } finally {
                  setFailoverBusy(false);
                }
              }}
              disabled={failoverBusy}
            >
              {failoverBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Failover
            </Button>
          }
        >
          <div className="pt-3 flex flex-col gap-3">
            {broker && (
              <>
                <StatusDot
                  status={broker.mt5_connected ? 'ok' : 'error'}
                  label="MT5"
                  value={broker.mt5_server ?? 'disconnected'}
                />
                <StatusDot
                  status={broker.ollama_connected ? 'ok' : 'error'}
                  label="Ollama"
                  value={broker.ollama_model ?? '—'}
                />
                <StatusDot
                  status={broker.tiingo_connected ? 'ok' : 'error'}
                  label="Tiingo"
                  value={broker.primary === 'tiingo' ? 'PRIMARY' : 'standby'}
                />
                <div className="my-1 border-t" />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Primary</span>
                  <span className="font-semibold tabular-nums">{broker.primary}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Failover Active</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      broker.failover_active ? 'text-warn border-warn' : 'text-muted-foreground'
                    )}
                  >
                    {broker.failover_active ? 'YES' : 'no'}
                  </Badge>
                </div>
                {broker.failover_reason && (
                  <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn">
                    {broker.failover_reason}
                  </div>
                )}
              </>
            )}
          </div>
        </PanelCard>

        <PanelCard title="Readiness Check" subtitle="Kubernetes-style readiness probe" icon={CheckCircle2}>
          <div className="pt-3 flex flex-col gap-2">
            {readiness ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Overall</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      readiness.status === 'healthy'
                        ? 'text-bull border-bull'
                        : readiness.status === 'degraded'
                        ? 'text-warn border-warn'
                        : 'text-bear border-bear'
                    )}
                  >
                    {readiness.status.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  {readiness.checks.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            c.status === 'healthy'
                              ? 'bg-bull'
                              : c.status === 'degraded'
                              ? 'bg-warn'
                              : 'bg-bear'
                          )}
                        />
                        {c.name}
                      </span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {c.latency_ms !== undefined ? `${c.latency_ms}ms` : c.status}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-2 text-[10px] text-muted-foreground">
                  Checked: {new Date(readiness.checked_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Memuat…</div>
            )}
          </div>
        </PanelCard>

        <PanelCard
          title="Realtime Drawdown"
          subtitle="24h peak-to-trough"
          icon={AlertTriangle}
        >
          <div className="pt-3 flex flex-col gap-2">
            {drawdown && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">Current DD</div>
                    <div
                      className={cn(
                        'text-lg font-bold tabular-nums',
                        Math.abs(drawdown.current_drawdown_pct ?? 0) > 2 ? 'text-bear' : 'text-foreground'
                      )}
                    >
                      {(drawdown.current_drawdown_pct ?? 0).toFixed(2)}%
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground uppercase">Max DD 24h</div>
                    <div className="text-lg font-bold tabular-nums text-warn">
                      {(drawdown.max_drawdown_pct_24h ?? 0).toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Peak Equity</span>
                  <span className="font-mono tabular-nums">
                    ${(drawdown.peak_equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Current Equity</span>
                  <span className="font-mono tabular-nums">
                    ${(drawdown.current_equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Recovered</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      drawdown.recovered ? 'text-bull border-bull' : 'text-warn border-warn'
                    )}
                  >
                    {drawdown.recovered ? 'YES' : 'in drawdown'}
                  </Badge>
                </div>
              </>
            )}
          </div>
        </PanelCard>
      </div>

      {/* Request rate + error rate + DB conns + backup */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Request Rate"
          value={requestRate !== null ? requestRate.toLocaleString() : '—'}
          unit="req"
          icon={Activity}
          trendValue="since boot"
        />
        <StatCard
          label="Error Rate"
          value={errorRate ?? 0}
          unit="errors"
          icon={AlertTriangle}
          variant={(errorRate ?? 0) > 0 ? 'bear' : 'default'}
          trendValue="total since boot"
        />
        <StatCard
          label="Active DB Conns"
          value={info?.active_db_connections ?? 0}
          icon={Database}
          trendValue="SQLite pool"
        />
        <div className="rounded-md border p-3 flex flex-col gap-2">
          <div className="text-[10px] text-muted-foreground uppercase">Offsite Backup</div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={async () => {
              setBackupBusy(true);
              try {
                const r = await triggerOffsiteBackup();
                toast({
                  title: 'Offsite backup uploaded',
                  description: `${r.destination} · ${formatBytes(r.size_bytes)}`,
                });
              } catch (e) {
                toast({ title: 'Backup gagal', description: String(e), variant: 'destructive' });
              } finally {
                setBackupBusy(false);
              }
            }}
            disabled={backupBusy}
          >
            {backupBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudUpload className="h-3 w-3" />}
            Upload Now
          </Button>
        </div>
      </div>

      {/* Prometheus metrics */}
      <PanelCard
        title="Prometheus Metrics"
        subtitle="Raw exposition format from /metrics endpoint"
        icon={Activity}
        actions={
          <a
            href="/metrics"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-info hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open /metrics
          </a>
        }
      >
        <div className="pt-3">
          <pre className="rounded-md border bg-muted/30 p-3 text-[10px] font-mono overflow-x-auto max-h-[300px] scroll-thin">
            {metricsText || 'Loading metrics…'}
          </pre>
        </div>
      </PanelCard>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium tabular-nums', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function GaugeBar({
  used,
  total,
  percent,
  unit,
  formatBytes,
  warn,
  danger,
}: {
  used: number;
  total: number;
  percent: number;
  unit: string;
  formatBytes: (b: number) => string;
  warn: number;
  danger: number;
}) {
  return (
    <div className="pt-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-2xl font-bold tabular-nums">{percent.toFixed(1)}%</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatBytes(used)} / {formatBytes(total)} {unit}
        </span>
      </div>
      <Progress
        value={percent}
        className={cn(
          'h-2',
          percent > danger && '[&>div]:bg-bear',
          percent > warn && percent <= danger && '[&>div]:bg-warn',
        )}
      />
      <div className="mt-2 text-[10px] text-muted-foreground">
        Threshold: warn &gt;{warn}% · danger &gt;{danger}%
      </div>
    </div>
  );
}
