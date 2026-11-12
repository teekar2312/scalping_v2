'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollText,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Hash,
} from 'lucide-react';
import { PanelCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getAuditLog,
  verifyAuditChain,
  triggerDownload,
} from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/hooks/use-toast';
import { AUDIT_EVENT_TYPES, AUDIT_SEVERITIES, type AuditColorToken } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { AuditLogEntry, AuditChainVerifyResponse } from '@/lib/types';

const COLOR_CLASS: Record<AuditColorToken, string> = {
  info: 'text-info border-info',
  bull: 'text-bull border-bull',
  bear: 'text-bear border-bear',
  warn: 'text-warn border-warn',
};

function findEventColor(eventType: string): AuditColorToken {
  const found = AUDIT_EVENT_TYPES.find((e) => e.value === eventType);
  return found?.color ?? 'info';
}

function findSeverityColor(severity: string): AuditColorToken {
  const found = AUDIT_SEVERITIES.find((s) => s.value === severity);
  return found?.color ?? 'info';
}

function findEventLabel(eventType: string): string {
  return AUDIT_EVENT_TYPES.find((e) => e.value === eventType)?.label ?? eventType;
}

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Jakarta' }),
    time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }),
  };
}

function parseDetail(entry: AuditLogEntry): Record<string, unknown> | null {
  if (entry.detail && typeof entry.detail === 'object') {
    return entry.detail as Record<string, unknown>;
  }
  if (entry.detail_json) {
    try {
      return JSON.parse(entry.detail_json);
    } catch {
      return null;
    }
  }
  return null;
}

function AuditRow({ entry, idx }: { entry: AuditLogEntry; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const detail = useMemo(() => parseDetail(entry), [entry]);
  const detailStr = useMemo(() => (detail ? JSON.stringify(detail) : ''), [detail]);
  const { date, time } = formatTimestamp(entry.timestamp);
  const evColor = findEventColor(entry.event_type);
  const sevColor = findSeverityColor(entry.severity);
  // Derive a short hash preview (first 8 chars of detail_json) to surface the
  // integrity-checkpoint column. Falls back to entry.id hex when no detail.
  const hashPreview = useMemo(() => {
    const src = entry.detail_json ?? String(entry.id);
    return src.slice(0, 8);
  }, [entry.detail_json, entry.id]);

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-accent/30 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <td className="py-2 px-2 text-muted-foreground tabular-nums">{idx + 1}</td>
        <td className="px-2 tabular-nums text-[10px]">
          <div>{date}</div>
          <div className="text-muted-foreground">{time}</div>
        </td>
        <td className="px-2">
          <Badge variant="outline" className={cn('text-[10px] px-1.5', COLOR_CLASS[evColor])}>
            {findEventLabel(entry.event_type)}
          </Badge>
        </td>
        <td className="px-2">
          <Badge variant="outline" className={cn('text-[10px] px-1.5 uppercase', COLOR_CLASS[sevColor])}>
            {entry.severity}
          </Badge>
        </td>
        <td className="px-2 tabular-nums text-xs">{entry.symbol ?? '—'}</td>
        <td className="px-2 tabular-nums text-xs">{entry.ticket ?? '—'}</td>
        <td className="px-2 text-[10px] text-muted-foreground max-w-[280px] truncate">
          {detailStr || <span className="opacity-50">— no detail —</span>}
        </td>
        <td className="px-2 text-right text-[10px] font-mono tabular-nums text-muted-foreground">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help inline-flex items-center gap-0.5">
                  <Hash className="h-2.5 w-2.5" />
                  {hashPreview}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-mono">
                Chain hash preview (first 8 chars of detail_json)
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </td>
        <td className="px-2 text-right">
          {detailStr ? (
            expanded ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronRight className="h-3 w-3 inline" />
          ) : null}
        </td>
      </tr>
      {expanded && detailStr && (
        <tr className="bg-muted/20">
          <td colSpan={9} className="px-4 py-2">
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(detail, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditLogView() {
  const [eventType, setEventType] = useState<string>('ALL');
  const [severity, setSeverity] = useState<string>('ALL');
  const [limit, setLimit] = useState<number>(100);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [chainVerify, setChainVerify] = useState<AuditChainVerifyResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const auditLogRefresh = useAppStore((s) => s.auditLogRefresh);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAuditLog({
        event_type: eventType === 'ALL' ? undefined : eventType,
        severity: severity === 'ALL' ? undefined : severity,
        limit,
      });
      setEntries(rows);
    } catch (e) {
      toast({
        title: 'Gagal memuat audit log',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [eventType, severity, limit]);

  // Initial load + filter change reload
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Auto-refresh every 5s when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchEntries, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchEntries]);

  // Re-fetch on WebSocket refresh signal (any WS event bumps the counter)
  useEffect(() => {
    if (auditLogRefresh === 0) return;
    fetchEntries();
  }, [auditLogRefresh, fetchEntries]);

  const handleExportCsv = () => {
    if (entries.length === 0) {
      toast({ title: 'Tidak ada data untuk diexport', variant: 'destructive' });
      return;
    }
    const header = 'id,timestamp,event_type,severity,symbol,ticket,detail\n';
    const rows = entries
      .map((e) => {
        const detail = parseDetail(e);
        const detailStr = detail ? JSON.stringify(detail).replace(/"/g, '""') : '';
        return [
          e.id,
          e.timestamp,
          e.event_type,
          e.severity,
          e.symbol ?? '',
          e.ticket ?? '',
          `"${detailStr}"`,
        ].join(',');
      })
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    triggerDownload(blob, `audit_log_${new Date().toISOString().split('T')[0]}.csv`);
    toast({ title: 'CSV exported', description: `${entries.length} entries` });
  };

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const res = await verifyAuditChain();
      setChainVerify(res);
      toast({
        title: res.valid
          ? `Chain integrity OK · ${res.verified_rows} rows verified`
          : `Chain BROKEN at row ${res.broken_at_row}`,
        description: res.valid
          ? 'Hash chain from row 1 → N is intact (SHA-256 chained).'
          : `Expected ${res.expected_hash?.slice(0, 8) ?? '—'}, got ${res.actual_hash?.slice(0, 8) ?? '—'}.`,
        variant: res.valid ? 'default' : 'destructive',
      });
    } catch (e) {
      toast({
        title: 'Audit chain verification gagal',
        description: String(e),
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  // Stats
  const stats = useMemo(() => {
    const bySev: Record<string, number> = { INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
    for (const e of entries) {
      bySev[e.severity] = (bySev[e.severity] || 0) + 1;
    }
    return { total: entries.length, bySev };
  }, [entries]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Total Events</div>
          <div className="text-xl font-bold tabular-nums">{stats.total}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] text-info uppercase">Info</div>
          <div className="text-xl font-bold tabular-nums text-info">{stats.bySev.INFO}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] text-warn uppercase">Warn</div>
          <div className="text-xl font-bold tabular-nums text-warn">{stats.bySev.WARN}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] text-bear uppercase">Error</div>
          <div className="text-xl font-bold tabular-nums text-bear">{stats.bySev.ERROR}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] text-bear uppercase">Critical</div>
          <div className="text-xl font-bold tabular-nums text-bear">{stats.bySev.CRITICAL}</div>
        </div>
      </div>

      {/* Chain integrity verify panel (Sprint 6) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2">
          <PanelCard
            title="Hash Chain Integrity"
            subtitle="Verify audit_log SHA-256 chain from row 1 → N (tamper detection)"
            icon={chainVerify?.valid === false ? ShieldAlert : ShieldCheck}
            actions={
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleVerifyChain}
                disabled={verifying}
              >
                {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                Verify Chain Integrity
              </Button>
            }
          >
            <div className="pt-3">
              {chainVerify ? (
                <div
                  className={cn(
                    'rounded-md border p-3 flex items-start gap-3',
                    chainVerify.valid
                      ? 'border-bull/40 bg-bull/10'
                      : 'border-bear/40 bg-bear/10',
                  )}
                >
                  {chainVerify.valid ? (
                    <ShieldCheck className="h-5 w-5 text-bull shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-bear shrink-0 mt-0.5" />
                  )}
                  <div className="text-xs flex-1">
                    <div
                      className={cn(
                        'font-semibold',
                        chainVerify.valid ? 'text-bull' : 'text-bear',
                      )}
                    >
                      {chainVerify.valid
                        ? `✓ Chain VALID — ${chainVerify.verified_rows}/${chainVerify.total_rows} rows verified`
                        : `✗ Chain BROKEN at row ${chainVerify.broken_at_row} (id ${chainVerify.broken_at_id})`}
                    </div>
                    {chainVerify.broken_at_row !== null && (
                      <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                        Expected: {chainVerify.expected_hash?.slice(0, 16) ?? '—'}…
                        <br />
                        Actual: {chainVerify.actual_hash?.slice(0, 16) ?? '—'}…
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Verified at{' '}
                      {new Date(chainVerify?.verified_at).toLocaleString('id-ID', {
                        timeZone: 'Asia/Jakarta',
                      })}{' '}
                      WIB
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  Klik "Verify Chain Integrity" untuk menguji hash chain audit_log
                  (Sprint 6 — tamper-evident SHA-256 chaining).
                </div>
              )}
            </div>
          </PanelCard>
        </div>
        <div className="rounded-md border border-info/30 bg-info/5 p-3 text-[11px] flex items-start gap-2">
          <Hash className="h-4 w-4 text-info shrink-0 mt-0.5" />
          <div>
            <strong className="text-info">Tamper-evident log:</strong> Setiap row di{' '}
            <code>audit_log</code> menyimpan hash SHA-256 dari (prev_hash || row_data).
            Tambah, edit, atau delete row apapun akan memutus chain — terdeteksi
            pada verify berikutnya. Klik row di tabel untuk lihat detail + hash preview
            (8 char pertama).
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <PanelCard
        title="Audit Log"
        subtitle={`${entries.length} events · auto-refresh ${autoRefresh ? 'ON (5s)' : 'OFF'}${auditLogRefresh > 0 ? ' · WS live' : ''}`}
        icon={ScrollText}
        actions={
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 text-xs">
                    <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} id="auto-refresh" />
                    <Label htmlFor="auto-refresh" className="text-xs cursor-pointer">
                      Auto
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Auto-refresh every 5s + on WebSocket events
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchEntries} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleExportCsv}>
              <Download className="h-3 w-3" />
              CSV
            </Button>
          </div>
        }
      >
        <div className="pt-3 flex flex-wrap items-center gap-3">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Event:</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All events</SelectItem>
                {AUDIT_EVENT_TYPES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Severity:</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                {AUDIT_SEVERITIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Limit:</Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(parseInt(v))}>
              <SelectTrigger className="h-8 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[50, 100, 200, 500].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="pt-3">
          <div className="overflow-x-auto scroll-thin max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium w-10">#</th>
                  <th className="text-left font-medium w-32">Timestamp</th>
                  <th className="text-left font-medium w-36">Event Type</th>
                  <th className="text-left font-medium w-24">Severity</th>
                  <th className="text-left font-medium w-20">Symbol</th>
                  <th className="text-left font-medium w-24">Ticket</th>
                  <th className="text-left font-medium">Detail</th>
                  <th className="text-left font-medium w-24">Hash</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-muted-foreground">
                      Tidak ada audit log entries untuk filter ini.
                    </td>
                  </tr>
                )}
                {entries.map((entry, idx) => (
                  <AuditRow key={entry.id} entry={entry} idx={idx} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PanelCard>

      <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs flex items-start gap-2">
        <ScrollText className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <div>
          <strong className="text-info">Audit trail immutable:</strong> Setiap event
          penting dari engine (signal, order, TP/SL hit, kill switch, risk gate block,
          cooldown, margin warning, AI rejection) ditulis ke SQLite <code>audit_log</code>{' '}
          table dan di-push via WebSocket <code>/ws</code>. Filter by event type &
          severity untuk root-cause analysis pasca-incident.
        </div>
      </div>
    </div>
  );
}
