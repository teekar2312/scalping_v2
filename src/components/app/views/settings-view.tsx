'use client';

import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Bot,
  CalendarClock,
  Shield,
  Save,
  TestTube2,
  ExternalLink,
  AlertCircle,
  Send,
  ToggleLeft,
  ToggleRight,
  Database,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Upload,
} from 'lucide-react';
import { PanelCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/lib/store';
import {
  saveSettings,
  testMT5,
  testOllama,
  testTiingo,
  testTelegram,
  getPreLiveCheck,
  getTimeSync,
  downloadBackup,
  restoreBackup,
  triggerDownload,
  setBotMode,
  setDryRun,
  getBotMode,
} from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { TRADING_PAIRS, V2_RULES } from '@/lib/constants';
import { DEMO_MODE } from '@/lib/api';
import { cn } from '@/lib/utils';
import type {
  Settings,
  ServiceTestResult,
  PreLiveCheck,
  TimeSyncResponse,
  BotMode,
  RestoreResponse,
} from '@/lib/types';

interface TestState {
  loading: boolean;
  result: ServiceTestResult | { ok: boolean; message: string } | null;
}

function StatusCheck({ ok, label, value }: { ok: boolean; label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-bull" />
        ) : (
          <XCircle className="h-4 w-4 text-bear" />
        )}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {value && <span className="text-xs text-muted-foreground tabular-nums">{value}</span>}
    </div>
  );
}

export function SettingsView() {
  const { settings, updateSettings, botMode, setBotMode: storeSetBotMode, dryRun, setDryRun: storeSetDryRun, paperMode, setPaperMode } = useAppStore();
  const [local, setLocal] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Record<string, TestState>>({});
  const [preLive, setPreLive] = useState<PreLiveCheck | null>(null);
  const [preLiveLoading, setPreLiveLoading] = useState(false);
  const [timeSync, setTimeSync] = useState<TimeSyncResponse | null>(null);
  const [timeSyncLoading, setTimeSyncLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  // Sync bot mode from backend on mount
  useEffect(() => {
    if (DEMO_MODE) return;
    getBotMode()
      .then((m) => {
        const mode = (m.mode.toUpperCase() === 'DRY' ? 'DRY' : m.paper_mode ? 'PAPER' : 'LIVE') as BotMode;
        storeSetBotMode(mode);
        storeSetDryRun(m.dry_run);
        setPaperMode(m.paper_mode);
      })
      .catch(() => {
        // silent fail
      });
  }, [storeSetBotMode, storeSetDryRun, setPaperMode]);

  // Auto-fetch time sync on mount
  useEffect(() => {
    setTimeSyncLoading(true);
    getTimeSync()
      .then(setTimeSync)
      .catch(() => {
        // silent
      })
      .finally(() => setTimeSyncLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(local);
      updateSettings(local);
      toast({ title: 'Settings saved', description: 'Konfigurasi berhasil disimpan.' });
    } catch (e) {
      toast({ title: 'Save failed', description: String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (
    key: 'mt5' | 'ollama' | 'tiingo' | 'telegram',
    fn: () => Promise<ServiceTestResult | { ok: boolean; message: string }>,
  ) => {
    setTesting((s) => ({ ...s, [key]: { loading: true, result: null } }));
    try {
      const result = await fn();
      setTesting((s) => ({ ...s, [key]: { loading: false, result } }));
      toast({
        title: `${key.toUpperCase()} test ${result.ok ? 'OK' : 'FAIL'}`,
        description: result.message,
        variant: result.ok ? 'default' : 'destructive',
      });
    } catch (e) {
      const result = { ok: false, message: String(e) };
      setTesting((s) => ({ ...s, [key]: { loading: false, result } }));
      toast({ title: `${key.toUpperCase()} test failed`, description: String(e), variant: 'destructive' });
    }
  };

  const handlePreLiveCheck = async () => {
    setPreLiveLoading(true);
    try {
      const result = await getPreLiveCheck();
      setPreLive(result);
      toast({
        title: result.overall_ready ? 'Pre-live check PASS' : 'Pre-live check FAIL',
        description: result.overall_ready
          ? 'Semua sistem siap. Bot boleh di-start.'
          : `${result.blocking_issues.length} blocking issue(s)`,
        variant: result.overall_ready ? 'default' : 'destructive',
      });
    } catch (e) {
      toast({ title: 'Pre-live check gagal', description: String(e), variant: 'destructive' });
    } finally {
      setPreLiveLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      const blob = await downloadBackup();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      triggerDownload(blob, `trading_backup_${ts}.db`);
      toast({ title: 'Backup downloaded', description: `${(blob.size / 1024).toFixed(1)} KB` });
    } catch (e) {
      toast({ title: 'Backup gagal', description: String(e), variant: 'destructive' });
    }
  };

  const handleRestore = async (file: File) => {
    setRestoring(true);
    try {
      const result: RestoreResponse = await restoreBackup(file);
      toast({
        title: 'Restore berhasil',
        description: `${result.size_bytes} bytes → ${result.restored_to}`,
      });
    } catch (e) {
      toast({ title: 'Restore gagal', description: String(e), variant: 'destructive' });
    } finally {
      setRestoring(false);
    }
  };

  const handleModeSwitch = async (mode: BotMode) => {
    try {
      await setBotMode(mode);
      storeSetBotMode(mode);
      // Update derived flags
      if (mode === 'PAPER') {
        setPaperMode(true);
        storeSetDryRun(false);
      } else if (mode === 'DRY') {
        setPaperMode(false);
        storeSetDryRun(true);
      } else {
        setPaperMode(false);
        storeSetDryRun(false);
      }
      toast({
        title: `Mode: ${mode}`,
        description:
          mode === 'LIVE'
            ? 'Eksekusi real di MT5 aktif'
            : mode === 'PAPER'
            ? 'Order ke virtual account (paper)'
            : 'Signal di-generate tanpa eksekusi (dry run)',
        variant: mode === 'LIVE' ? 'destructive' : 'default',
      });
    } catch (e) {
      toast({ title: 'Gagal switch mode', description: String(e), variant: 'destructive' });
    }
  };

  const handleDryRunToggle = async (enabled: boolean) => {
    try {
      await setDryRun(enabled);
      storeSetDryRun(enabled);
      if (enabled) setPaperMode(false);
      toast({
        title: `Dry run ${enabled ? 'ON' : 'OFF'}`,
        description: enabled
          ? 'Signals akan di-generate tanpa eksekusi MT5'
          : 'Eksekusi normal (subject to mode)',
      });
    } catch (e) {
      toast({ title: 'Gagal toggle dry run', description: String(e), variant: 'destructive' });
    }
  };

  const canStartBot = preLive?.overall_ready ?? false;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Demo mode banner */}
      {DEMO_MODE && (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-warn shrink-0" />
          <div className="text-sm flex-1">
            <div className="font-semibold text-warn">DEMO MODE — Python backend tidak terhubung</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Test buttons memakai mock responses. Untuk probes riil, jalankan Python backend di Windows
              (lihat <code className="font-mono">/download/python-backend/README.md</code>) lalu set{' '}
              <code className="font-mono">NEXT_PUBLIC_PYTHON_API_URL</code>.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* MT5 Settings */}
        <PanelCard
          title="MT5 Connection"
          subtitle="Broker: Finex Indonesia"
          icon={Server}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => runTest('mt5', testMT5)}
              disabled={testing.mt5?.loading}
            >
              {testing.mt5?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              Test
            </Button>
          }
        >
          <div className="pt-3 space-y-3">
            <div>
              <Label className="text-xs">Broker</Label>
              <Input
                value={local.mt5.broker}
                onChange={(e) => setLocal({ ...local, mt5: { ...local.mt5, broker: e.target.value } })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">MT5 Login</Label>
              <Input
                value={local.mt5.login}
                onChange={(e) => setLocal({ ...local, mt5: { ...local.mt5, login: e.target.value } })}
                placeholder="50384721"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">MT5 Password</Label>
              <Input
                type="password"
                value={local.mt5.password}
                onChange={(e) => setLocal({ ...local, mt5: { ...local.mt5, password: e.target.value } })}
                placeholder="••••••••"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">MT5 Server</Label>
              <Input
                value={local.mt5.server}
                onChange={(e) => setLocal({ ...local, mt5: { ...local.mt5, server: e.target.value } })}
                placeholder="FinexIC-Markets"
                className="mt-1"
              />
            </div>
            {testing.mt5?.result && (
              <div
                className={cn(
                  'rounded-md border p-2 text-[10px]',
                  testing.mt5.result.ok ? 'border-bull/40 bg-bull/10 text-bull' : 'border-bear/40 bg-bear/10 text-bear',
                )}
              >
                <strong>{testing.mt5.result.ok ? 'OK' : 'FAIL'}</strong>: {testing.mt5.result.message}
                {'latency_ms' in testing.mt5.result && testing.mt5.result.latency_ms !== undefined && ` (${testing.mt5.result.latency_ms}ms)`}
              </div>
            )}
          </div>
        </PanelCard>

        {/* Ollama Settings */}
        <PanelCard
          title="Ollama AI"
          subtitle="Local AI untuk analisa strategi"
          icon={Bot}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => runTest('ollama', testOllama)}
              disabled={testing.ollama?.loading}
            >
              {testing.ollama?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              Test
            </Button>
          }
        >
          <div className="pt-3 space-y-3">
            <div>
              <Label className="text-xs">Ollama URL</Label>
              <Input
                value={local.ollama.url}
                onChange={(e) => setLocal({ ...local, ollama: { ...local.ollama, url: e.target.value } })}
                placeholder="http://localhost:11434"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Model</Label>
              <Input
                value={local.ollama.model}
                onChange={(e) => setLocal({ ...local, ollama: { ...local.ollama, model: e.target.value } })}
                placeholder="llama3.2:latest"
                className="mt-1"
              />
            </div>
            {testing.ollama?.result && (
              <div
                className={cn(
                  'rounded-md border p-2 text-[10px]',
                  testing.ollama.result.ok ? 'border-bull/40 bg-bull/10 text-bull' : 'border-bear/40 bg-bear/10 text-bear',
                )}
              >
                <strong>{testing.ollama.result.ok ? 'OK' : 'FAIL'}</strong>: {testing.ollama.result.message}
                {'latency_ms' in testing.ollama.result && testing.ollama.result.latency_ms !== undefined && ` (${testing.ollama.result.latency_ms}ms)`}
              </div>
            )}
          </div>
        </PanelCard>

        {/* Tiingo Settings */}
        <PanelCard
          title="Tiingo Calendar"
          subtitle="Economic calendar provider"
          icon={CalendarClock}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => runTest('tiingo', testTiingo)}
              disabled={testing.tiingo?.loading}
            >
              {testing.tiingo?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              Test
            </Button>
          }
        >
          <div className="pt-3 space-y-3">
            <div>
              <Label className="text-xs">Tiingo API Key</Label>
              <Input
                type="password"
                value={local.tiingo.apiKey}
                onChange={(e) => setLocal({ ...local, tiingo: { ...local.tiingo, apiKey: e.target.value } })}
                placeholder="tiingo_api_key_here"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Dapatkan dari{' '}
                <a
                  href="https://api.tiingo.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-info underline inline-flex items-center gap-0.5"
                >
                  api.tiingo.com <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </p>
            </div>
            {testing.tiingo?.result && (
              <div
                className={cn(
                  'rounded-md border p-2 text-[10px]',
                  testing.tiingo.result.ok ? 'border-bull/40 bg-bull/10 text-bull' : 'border-bear/40 bg-bear/10 text-bear',
                )}
              >
                <strong>{testing.tiingo.result.ok ? 'OK' : 'FAIL'}</strong>: {testing.tiingo.result.message}
                {'latency_ms' in testing.tiingo.result && testing.tiingo.result.latency_ms !== undefined && ` (${testing.tiingo.result.latency_ms}ms)`}
              </div>
            )}
          </div>
        </PanelCard>

        {/* Telegram Settings */}
        <PanelCard
          title="Telegram Notifications"
          subtitle="Alert kill switch, cooldown, margin warning"
          icon={Send}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => runTest('telegram', testTelegram)}
              disabled={testing.telegram?.loading}
            >
              {testing.telegram?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              Test
            </Button>
          }
        >
          <div className="pt-3 space-y-3">
            <div>
              <Label className="text-xs">Bot Token</Label>
              <Input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Buat bot via{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                  className="text-info underline"
                >
                  @BotFather
                </a>
                , lalu set <code className="font-mono">TELEGRAM_BOT_TOKEN</code> di Python backend .env
              </p>
            </div>
            <div>
              <Label className="text-xs">Chat ID</Label>
              <Input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="50384721"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Chat ID kamu — cek via{' '}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noreferrer"
                  className="text-info underline"
                >
                  @userinfobot
                </a>
              </p>
            </div>
            {testing.telegram?.result && (
              <div
                className={cn(
                  'rounded-md border p-2 text-[10px]',
                  testing.telegram.result.ok ? 'border-bull/40 bg-bull/10 text-bull' : 'border-bear/40 bg-bear/10 text-bear',
                )}
              >
                <strong>{testing.telegram.result.ok ? 'OK' : 'FAIL'}</strong>: {testing.telegram.result.message}
              </div>
            )}
          </div>
        </PanelCard>

        {/* Bot Mode */}
        <PanelCard
          title="Bot Mode"
          subtitle="LIVE / PAPER / DRY — execution policy"
          icon={ToggleLeft}
        >
          <div className="pt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(['LIVE', 'PAPER', 'DRY'] as BotMode[]).map((m) => {
                const isActive = botMode === m;
                const isLive = m === 'LIVE';
                return (
                  <button
                    key={m}
                    onClick={() => handleModeSwitch(m)}
                    className={cn(
                      'rounded-md border p-3 text-center transition-colors',
                      isActive
                        ? isLive
                          ? 'border-bear bg-bear/10'
                          : 'border-primary bg-accent'
                        : 'hover:bg-accent/50',
                    )}
                  >
                    <div className="text-sm font-bold">{m}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {m === 'LIVE'
                        ? 'Real MT5'
                        : m === 'PAPER'
                        ? 'Virtual'
                        : 'No exec'}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {dryRun ? (
                    <ToggleRight className="h-5 w-5 text-warn" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <div className="text-sm font-medium">Dry Run Mode</div>
                    <div className="text-[10px] text-muted-foreground">
                      Generate signals tanpa eksekusi (audit log tetap)
                    </div>
                  </div>
                </div>
                <Switch checked={dryRun} onCheckedChange={handleDryRunToggle} />
              </div>
            </div>

            {botMode === 'LIVE' && (
              <div className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[10px] text-bear">
                <strong>PERINGATAN LIVE MODE:</strong> Eksekusi real di MT5 aktif. Pastikan
                pre-live check sudah PASS dan modal sudah diuji di PAPER mode minimal 3 bulan.
              </div>
            )}
            {botMode === 'PAPER' && (
              <div className="rounded-md border border-info/30 bg-info/5 p-2 text-[10px] text-info">
                <strong>PAPER MODE:</strong> Order dikirim ke virtual account MT5 (no real money).
                Ideal untuk forward demo F3 (roadmap 9 bulan).
              </div>
            )}
            {dryRun && (
              <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn">
                <strong>DRY RUN:</strong> Signals di-generate & audit-logged, tapi tidak ada order
                yang dikirim. Cocok untuk validasi strategy tanpa exposure.
              </div>
            )}
          </div>
        </PanelCard>

        {/* Risk Management */}
        <PanelCard
          title="Risk Management V2"
          subtitle="Tiered stop & position sizing"
          icon={Shield}
        >
          <div className="pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Risk per Trade (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={(local.risk.riskPctPerTrade * 100).toFixed(1)}
                  onChange={(e) => setLocal({
                    ...local,
                    risk: { ...local.risk, riskPctPerTrade: parseFloat(e.target.value) / 100 }
                  })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">RR Net Min</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={local.risk.rrNetMin}
                  onChange={(e) => setLocal({
                    ...local,
                    risk: { ...local.risk, rrNetMin: parseFloat(e.target.value) }
                  })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Max Positions</Label>
                <Input
                  type="number"
                  value={local.risk.maxPositions}
                  onChange={(e) => setLocal({
                    ...local,
                    risk: { ...local.risk, maxPositions: parseInt(e.target.value) }
                  })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Max Daily Trades</Label>
                <Input
                  type="number"
                  value={local.risk.maxDailyTrades}
                  onChange={(e) => setLocal({
                    ...local,
                    risk: { ...local.risk, maxDailyTrades: parseInt(e.target.value) }
                  })}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="text-xs font-medium mb-2">Tiered Stop (%)</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Soft Daily Stop</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={(local.risk.softStopPct * 100).toFixed(1)}
                    onChange={(e) => setLocal({
                      ...local,
                      risk: { ...local.risk, softStopPct: parseFloat(e.target.value) / 100 }
                    })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Hard Daily Stop</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={(local.risk.hardStopPct * 100).toFixed(1)}
                    onChange={(e) => setLocal({
                      ...local,
                      risk: { ...local.risk, hardStopPct: parseFloat(e.target.value) / 100 }
                    })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Weekly Stop</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={(local.risk.weeklyStopPct * 100).toFixed(1)}
                    onChange={(e) => setLocal({
                      ...local,
                      risk: { ...local.risk, weeklyStopPct: parseFloat(e.target.value) / 100 }
                    })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Overall Stop</Label>
                  <Input
                    type="number"
                    step="1"
                    value={(local.risk.overallStopPct * 100).toFixed(0)}
                    onChange={(e) => setLocal({
                      ...local,
                      risk: { ...local.risk, overallStopPct: parseFloat(e.target.value) / 100 }
                    })}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </PanelCard>

        {/* Pre-Live Checklist */}
        <PanelCard
          title="Pre-Live Checklist"
          subtitle="Verify MT5, Ollama, Tiingo, DB, time-sync sebelum start bot"
          icon={CheckCircle2}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={handlePreLiveCheck}
              disabled={preLiveLoading}
            >
              {preLiveLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              Run Check
            </Button>
          }
        >
          <div className="pt-3 space-y-1">
            {preLive ? (
              <>
                <StatusCheck ok={preLive.mt5.ok} label="MT5" value={preLive.mt5.ok ? `login ${preLive.mt5.login}` : 'not connected'} />
                <StatusCheck ok={preLive.ollama.ok} label="Ollama AI" value={preLive.ollama.ok ? preLive.ollama.model : 'model unavailable'} />
                <StatusCheck ok={preLive.tiingo.ok} label="Tiingo Calendar" value={preLive.tiingo.ok ? `${preLive.tiingo.events_cached} events` : 'no events'} />
                <StatusCheck ok={preLive.config.ok} label="Config" value={preLive.config.warnings.length > 0 ? `${preLive.config.warnings.length} warnings` : 'OK'} />
                <StatusCheck ok={preLive.db.ok} label="Database" value={preLive.db.ok ? `${preLive.db.trade_count} trades` : 'error'} />
                <StatusCheck ok={preLive.time_sync.ok} label="Time Sync (NTP)" value={preLive.time_sync.ok ? `${preLive.time_sync.drift_seconds?.toFixed(2)}s drift` : 'drift excessive'} />

                {preLive.blocking_issues.length > 0 && (
                  <div className="mt-3 rounded-md border border-bear/40 bg-bear/10 p-2 text-[10px] text-bear">
                    <strong>Blocking issues:</strong>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {preLive.blocking_issues.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={canStartBot ? 'default' : 'outline'}
                    disabled={!canStartBot}
                    className="gap-1.5"
                  >
                    {canStartBot ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {canStartBot ? 'Start Bot Allowed' : 'Cannot Start — Pre-Live Failed'}
                  </Button>
                  {preLive.overall_ready && (
                    <Badge variant="outline" className="text-[10px] text-bull border-bull">
                      READY
                    </Badge>
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">
                Klik "Run Check" untuk probe semua sistem.
              </div>
            )}
          </div>
        </PanelCard>

        {/* Time Sync */}
        <PanelCard
          title="Time Sync (NTP)"
          subtitle="Drift detection — critical untuk order timing"
          icon={Clock}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => {
                setTimeSyncLoading(true);
                getTimeSync()
                  .then(setTimeSync)
                  .finally(() => setTimeSyncLoading(false));
              }}
              disabled={timeSyncLoading}
            >
              {timeSyncLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              Refresh
            </Button>
          }
        >
          <div className="pt-3 space-y-2">
            {timeSync ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Server Time</span>
                  <span className="font-mono tabular-nums">
                    {new Date(timeSync.server_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">NTP Time</span>
                  <span className="font-mono tabular-nums">
                    {timeSync.ntp_time
                      ? new Date(timeSync.ntp_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Drift</span>
                  <span
                    className={cn(
                      'font-mono tabular-nums font-semibold',
                      timeSync.drift_seconds > 1 ? 'text-bear' : timeSync.drift_seconds > 0.5 ? 'text-warn' : 'text-bull',
                    )}
                  >
                    {timeSync.drift_seconds.toFixed(3)}s
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Status</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      timeSync.ok ? 'text-bull border-bull' : 'text-bear border-bear',
                    )}
                  >
                    {timeSync.ok ? 'OK' : 'DRIFT EXCESSIVE'}
                  </Badge>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground py-4 text-center">
                {timeSyncLoading ? 'Memeriksa NTP…' : 'Belum ada data time sync.'}
              </div>
            )}
          </div>
        </PanelCard>

        {/* Database Backup / Restore */}
        <PanelCard
          title="Database Backup / Restore"
          subtitle="SQLite file export & import"
          icon={Database}
        >
          <div className="pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleBackup}>
                <Download className="h-3.5 w-3.5" />
                Download Backup
              </Button>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".db,.sqlite,.sqlite3"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleRestore(f);
                  }}
                />
                <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-transparent h-8 px-3 text-xs hover:bg-accent">
                  {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Restore from File
                </span>
              </label>
            </div>
            <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn">
              <strong>Restore akan:</strong> Stop engine jika running → backup current DB → overwrite
              dari file upload. Pastikan file backup berasal dari sistem yang sama (schema match).
            </div>
          </div>
        </PanelCard>
      </div>

      {/* Pair monitor */}
      <PanelCard title="Pair Monitor" subtitle="Pasangan yang di-scan bot" icon={SettingsIcon}>
        <div className="pt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {TRADING_PAIRS.map((p) => {
              const enabled = local.pairs.includes(p.symbol);
              return (
                <div
                  key={p.symbol}
                  className={cn(
                    'rounded-md border p-3 transition-colors',
                    enabled ? 'border-bull/40 bg-bull/5' : 'opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-sm font-semibold">{p.name}</span>
                      <Badge variant="outline" className="text-[9px]">#{p.rank}</Badge>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) => {
                        setLocal({
                          ...local,
                          pairs: checked
                            ? [...local.pairs, p.symbol]
                            : local.pairs.filter((s) => s !== p.symbol),
                        });
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {p.spreadEcn} ECN · ADR {p.adr}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PanelCard>

      {/* Python backend URL */}
      <PanelCard title="Python Backend URL" subtitle="FastAPI server URL (Windows)" icon={Server}>
        <div className="pt-3">
          <div className="flex gap-2">
            <Input
              value={local.pythonApiUrl}
              onChange={(e) => setLocal({ ...local, pythonApiUrl: e.target.value })}
              placeholder="http://localhost:8000"
              className="flex-1"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Set <code className="font-mono">NEXT_PUBLIC_PYTHON_API_URL</code> environment variable untuk override demo mode.
            Backend Python FastAPI berjalan di port 8000 (lihat <code className="font-mono">download/python-backend/README.md</code>).
            WebSocket auto-connect ke <code className="font-mono">ws://&lt;host&gt;:8000/ws</code>.
          </p>
        </div>
      </PanelCard>

      {/* Save button */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background pt-3">
        <Button variant="outline" onClick={() => setLocal(settings)}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? 'Menyimpan...' : 'Simpan Settings'}
        </Button>
      </div>
    </div>
  );
}
