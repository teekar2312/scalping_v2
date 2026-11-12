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
  Bell,
  ToggleLeft,
  ToggleRight,
  Database,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Upload,
  KeyRound,
  Lock,
  Gavel,
  Gauge,
  Plus,
  Trash2,
  FileText,
  Eye,
  EyeOff,
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
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listSecrets,
  setSecret,
  getRiskDisclosureStatus,
  acknowledgeRiskDisclosure,
  getBappebtiStatus,
  getEncryptionStatus,
  changePassword,
  downloadTax,
} from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { TRADING_PAIRS, V2_RULES } from '@/lib/constants';
import { DEMO_MODE } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  isPushSupported,
  getPushPermissionState,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  showLocalNotification,
  isPushEnabledInStorage,
  setPushEnabledInStorage,
} from '@/lib/push-notifications';
import type {
  Settings,
  ServiceTestResult,
  PreLiveCheck,
  TimeSyncResponse,
  BotMode,
  RestoreResponse,
  ApiKeyInfo,
  SecretMetadata,
  RiskDisclosureStatus,
  BappebtiStatus,
  EncryptionStatus,
  PositionSizingMode,
} from '@/lib/types';
import { RiskDisclosureModal } from '../risk-disclosure-modal';

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
  const { user, isAuthenticated } = useAuth();
  const positionSizing = useAppStore((s) => s.positionSizing);
  const setPositionSizing = useAppStore((s) => s.setPositionSizing);
  const varConfidence = useAppStore((s) => s.varConfidence);
  const setVarConfidence = useAppStore((s) => s.setVarConfidence);
  const useKelly = useAppStore((s) => s.useKelly);
  const setUseKelly = useAppStore((s) => s.setUseKelly);
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

  // --- Sprint 5-8 new state --- //
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [secrets, setSecrets] = useState<SecretMetadata[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [showSecretValue, setShowSecretValue] = useState(false);
  const [riskStatus, setRiskStatus] = useState<RiskDisclosureStatus | null>(null);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [bappebti, setBappebti] = useState<BappebtiStatus | null>(null);
  const [encryption, setEncryption] = useState<EncryptionStatus | null>(null);
  const [changePwd, setChangePwd] = useState({ current: '', next: '', confirm: '' });
  const [changingPwd, setChangingPwd] = useState(false);

  // --- PWA push notification state --- //
  const pushSupported = typeof window !== 'undefined' && isPushSupported();
  const [pushPermState, setPushPermState] = useState<'default' | 'granted' | 'denied'>('default');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    setPushPermState(getPushPermissionState());
    setPushEnabled(isPushEnabledInStorage());
  }, [pushSupported]);

  const handlePushToggle = async (checked: boolean) => {
    setPushBusy(true);
    try {
      if (checked) {
        const perm = await requestNotificationPermission();
        setPushPermState(perm);
        if (perm !== 'granted') {
          toast({
            title: 'Push permission denied',
            description: 'Izinkan notifications di browser untuk mengaktifkan alert.',
            variant: 'destructive',
          });
          return;
        }
        const sub = await subscribeToPush();
        if (sub) {
          setPushEnabled(true);
          setPushEnabledInStorage(true);
          toast({
            title: 'Push notifications aktif',
            description: 'Kill switch / cooldown / TP / SL alerts akan dikirim ke perangkat ini.',
          });
        } else {
          toast({
            title: 'Push subscription gagal',
            description: 'Coba refresh dan pastikan service worker terdaftar.',
            variant: 'destructive',
          });
        }
      } else {
        const ok = await unsubscribeFromPush();
        setPushEnabled(false);
        if (ok) {
          toast({ title: 'Push notifications dimatikan' });
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

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

  // Sprint 5-8: fetch auth keys, secrets, regulatory status, encryption on mount
  useEffect(() => {
    let mounted = true;
    Promise.all([
      listApiKeys(),
      listSecrets(),
      getRiskDisclosureStatus(),
      getBappebtiStatus(),
      getEncryptionStatus(),
    ])
      .then(([k, s, r, b, e]) => {
        if (!mounted) return;
        setApiKeys(k.keys);
        setSecrets(Array.isArray(s?.secrets) ? s.secrets : []);
        setRiskStatus(r);
        setBappebti(b);
        setEncryption(e);
      })
      .catch((e) => {
        // Silent — these are non-blocking.
      });
    return () => {
      mounted = false;
    };
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

      {/* ===================== Sprint 5-8 new sections ===================== */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* Authentication & Security */}
        <PanelCard
          title="Authentication & Security"
          subtitle="Sprint 5 — Bearer token auth + API key management"
          icon={KeyRound}
        >
          <div className="pt-3 space-y-3">
            {/* Current user */}
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium mb-2 flex items-center gap-1">
                <Lock className="h-3.5 w-3.5 text-info" />
                Current Session
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] text-muted-foreground">Username</div>
                  <div className="font-semibold">{user?.username ?? (isAuthenticated ? 'unknown' : '—')}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Role</div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      user?.role === 'admin' ? 'text-bull border-bull' : 'text-info border-info',
                    )}
                  >
                    {user?.role ?? '—'}
                  </Badge>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Login time</div>
                  <div className="font-mono tabular-nums text-[10px]">
                    {user?.login_at
                      ? new Date(user.login_at).toLocaleString('id-ID', {
                          timeZone: 'Asia/Jakarta',
                        })
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">IP</div>
                  <div className="font-mono tabular-nums text-[10px]">{user?.ip ?? '—'}</div>
                </div>
              </div>
            </div>

            {/* Change password (admin only) */}
            {user?.role === 'admin' && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-medium">Change Password</div>
                <Input
                  type="password"
                  placeholder="Current password"
                  value={changePwd.current}
                  onChange={(e) => setChangePwd({ ...changePwd, current: e.target.value })}
                  className="h-8 text-xs"
                />
                <Input
                  type="password"
                  placeholder="New password"
                  value={changePwd.next}
                  onChange={(e) => setChangePwd({ ...changePwd, next: e.target.value })}
                  className="h-8 text-xs"
                />
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={changePwd.confirm}
                  onChange={(e) => setChangePwd({ ...changePwd, confirm: e.target.value })}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-xs gap-1"
                  disabled={changingPwd || !changePwd.current || !changePwd.next || changePwd.next !== changePwd.confirm}
                  onClick={async () => {
                    setChangingPwd(true);
                    try {
                      const r = await changePassword(changePwd.current, changePwd.next);
                      toast({ title: 'Password changed', description: r.message });
                      setChangePwd({ current: '', next: '', confirm: '' });
                    } catch (e) {
                      toast({
                        title: 'Change password gagal',
                        description: String(e),
                        variant: 'destructive',
                      });
                    } finally {
                      setChangingPwd(false);
                    }
                  }}
                >
                  {changingPwd ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                  Update Password
                </Button>
              </div>
            )}

            {/* API keys */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-xs font-medium flex items-center justify-between">
                <span>API Keys</span>
                <Badge variant="outline" className="text-[10px]">
                  {apiKeys.length} active
                </Badge>
              </div>
              <div className="space-y-1">
                {apiKeys.map((k) => (
                  <div key={k.id} className="flex items-center gap-2 text-[10px] py-1 border-b last:border-0">
                    <KeyRound className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{k.label}</div>
                      <div className="text-muted-foreground font-mono tabular-nums">
                        {k.prefix}…
                        {k.last_used && (
                          <span className="ml-1">
                            · last used {new Date(k.last_used).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Jakarta' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-bear"
                      onClick={async () => {
                        try {
                          await revokeApiKey(k.id);
                          setApiKeys((prev) => prev.filter((x) => x.id !== k.id));
                          toast({ title: 'API key revoked', description: k.label });
                        } catch (e) {
                          toast({
                            title: 'Revoke gagal',
                            description: String(e),
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              {/* Generate new key */}
              <div className="flex gap-1">
                <Input
                  placeholder="Key label (e.g. Mobile App)"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  className="h-7 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={!newKeyLabel}
                  onClick={async () => {
                    try {
                      const r = await createApiKey(newKeyLabel);
                      setApiKeys((prev) => [
                        ...prev,
                        {
                          id: r.id,
                          label: r.label,
                          prefix: r.key.slice(0, 12),
                          created_at: r.created_at,
                          last_used: null,
                          expires_at: null,
                        },
                      ]);
                      setNewKeyLabel('');
                      toast({
                        title: 'API key generated',
                        description: `${r.label}: ${r.key.slice(0, 16)}… (copy now — only shown once)`,
                      });
                    } catch (e) {
                      toast({
                        title: 'Generate key gagal',
                        description: String(e),
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Generate
                </Button>
              </div>
            </div>

            {/* Secrets */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-xs font-medium flex items-center justify-between">
                <span>Secrets Vault</span>
                <Badge variant="outline" className="text-[10px]">
                  {secrets.length} stored
                </Badge>
              </div>
              <div className="space-y-1">
                {secrets.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-[10px] py-1 border-b last:border-0">
                    <Lock className="h-2.5 w-2.5 text-bull shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono font-medium">{s.name}</div>
                      <div className="text-muted-foreground">
                        updated {new Date(s.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' })} · {s.set_by ?? 'unknown'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Add secret */}
              <div className="space-y-1">
                <Input
                  placeholder="SECRET_NAME (UPPER_SNAKE)"
                  value={newSecretName}
                  onChange={(e) => setNewSecretName(e.target.value.toUpperCase())}
                  className="h-7 text-xs font-mono"
                />
                <div className="relative">
                  <Input
                    type={showSecretValue ? 'text' : 'password'}
                    placeholder="secret value"
                    value={newSecretValue}
                    onChange={(e) => setNewSecretValue(e.target.value)}
                    className="h-7 text-xs pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretValue((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showSecretValue ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-7 text-xs gap-1"
                  disabled={!newSecretName || !newSecretValue}
                  onClick={async () => {
                    try {
                      await setSecret(newSecretName, newSecretValue);
                      setSecrets((prev) => [
                        ...prev,
                        {
                          name: newSecretName,
                          updated_at: new Date().toISOString(),
                          set_by: user?.username ?? 'unknown',
                        },
                      ]);
                      setNewSecretName('');
                      setNewSecretValue('');
                      toast({ title: 'Secret stored', description: newSecretName });
                    } catch (e) {
                      toast({
                        title: 'Store secret gagal',
                        description: String(e),
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Store Secret
                </Button>
              </div>
            </div>
          </div>
        </PanelCard>

        {/* Regulatory Compliance */}
        <PanelCard
          title="Regulatory Compliance"
          subtitle="Sprint 6 — BAPPEBTI + risk disclosure + tax export"
          icon={Gavel}
        >
          <div className="pt-3 space-y-3">
            {/* BAPPEBTI */}
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium mb-2 flex items-center gap-1">
                <Gavel className="h-3.5 w-3.5 text-info" />
                BAPPEBTI Broker Status
              </div>
              {bappebti ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Broker</span>
                    <span className="font-medium text-right text-[11px]">{bappebti.broker_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">License</span>
                    <span className="font-mono tabular-nums">{bappebti.bappebti_license ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        bappebti.status === 'REGISTERED' && 'text-bull border-bull',
                        bappebti.status === 'PENDING' && 'text-warn border-warn',
                        bappebti.status === 'NOT_REGISTERED' && 'text-bear border-bear',
                        bappebti.status === 'UNKNOWN' && 'text-muted-foreground',
                      )}
                    >
                      {bappebti.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last checked</span>
                    <span className="font-mono tabular-nums text-[10px]">
                      {new Date(bappebti.last_checked).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                    </span>
                  </div>
                  {bappebti.warnings.length > 0 && (
                    <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
                      {bappebti.warnings.join(' · ')}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Memuat…</div>
              )}
            </div>

            {/* Risk Disclosure */}
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium mb-2 flex items-center gap-1">
                <Shield className="h-3.5 w-3.5 text-info" />
                Risk Disclosure Acknowledgment
              </div>
              {riskStatus ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Acknowledged</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        riskStatus.acknowledged ? 'text-bull border-bull' : 'text-bear border-bear',
                      )}
                    >
                      {riskStatus.acknowledged ? 'YES' : 'NO'}
                    </Badge>
                  </div>
                  {riskStatus.acknowledged_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Acked at</span>
                      <span className="font-mono tabular-nums text-[10px]">
                        {new Date(riskStatus.acknowledged_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Jakarta' })}
                      </span>
                    </div>
                  )}
                  {riskStatus.expires_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expires</span>
                      <span
                        className={cn(
                          'font-mono tabular-nums text-[10px]',
                          riskStatus.requires_reack && 'text-warn',
                        )}
                      >
                        {new Date(riskStatus.expires_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Jakarta' })}{' '}
                        ({riskStatus.days_remaining}d)
                      </span>
                    </div>
                  )}
                  {(riskStatus.requires_reack || !riskStatus.acknowledged) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-xs mt-2 gap-1"
                      onClick={() => setRiskModalOpen(true)}
                    >
                      <Shield className="h-3 w-3" />
                      {riskStatus.acknowledged ? 'Re-Acknowledge (expiring)' : 'Acknowledge Now'}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Memuat…</div>
              )}
            </div>

            {/* Tax export (SPT) */}
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium mb-2 flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-info" />
                Tax Export (SPT Format)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 flex-1"
                  onClick={async () => {
                    try {
                      const blob = await downloadTax(new Date().getFullYear(), 'spt');
                      triggerDownload(blob, `spt_export_${new Date().getFullYear()}.csv`);
                      toast({
                        title: 'SPT exported',
                        description: `Year ${new Date().getFullYear()} · ${blob.size} bytes`,
                      });
                    } catch (e) {
                      toast({
                        title: 'SPT export gagal',
                        description: String(e),
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  <Download className="h-3 w-3" />
                  Export SPT {new Date().getFullYear()}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Format CSV SPT untuk pelaporan pajak forex tahunan (Indonesia DJP).
              </p>
            </div>
          </div>
        </PanelCard>

        {/* Advanced Risk */}
        <PanelCard
          title="Advanced Risk"
          subtitle="Sprint 7 — position sizing + VaR confidence + stress test info"
          icon={Gauge}
        >
          <div className="pt-3 space-y-3">
            {/* Position sizing mode */}
            <div>
              <Label className="text-xs">Position Sizing Mode</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {(['FIXED_1PCT', 'KELLY_QUARTER', 'CUSTOM'] as PositionSizingMode[]).map((m) => {
                  const isActive = positionSizing === m;
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        setPositionSizing(m);
                        setUseKelly(m === 'KELLY_QUARTER');
                        toast({
                          title: `Sizing: ${m === 'FIXED_1PCT' ? 'Fixed 1%' : m === 'KELLY_QUARTER' ? 'Quarter-Kelly' : 'Custom'}`,
                          description: m === 'KELLY_QUARTER'
                            ? 'Will apply quarter-Kelly fraction on next signal.'
                            : m === 'FIXED_1PCT'
                            ? 'V2 default — 1% per trade regardless of win rate.'
                            : 'Custom — adjust riskPctPerTrade manually below.',
                        });
                      }}
                      className={cn(
                        'rounded-md border p-2 text-center transition-colors text-[10px]',
                        isActive ? 'border-primary bg-accent font-medium' : 'hover:bg-accent/50',
                      )}
                    >
                      {m === 'FIXED_1PCT' ? 'Fixed 1%' : m === 'KELLY_QUARTER' ? 'Quarter-Kelly' : 'Custom'}
                    </button>
                  );
                })}
              </div>
              {useKelly && (
                <div className="mt-2 rounded-md border border-info/30 bg-info/5 p-2 text-[10px] text-info">
                  Kelly sizing aktif. Hitung dari win rate + avg win/loss · lihat Analytics tab untuk detail.
                </div>
              )}
            </div>

            {/* VaR confidence */}
            <div>
              <Label className="text-xs">VaR Confidence Level</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  onClick={() => setVarConfidence(0.95)}
                  className={cn(
                    'rounded-md border p-2 text-center transition-colors text-[10px]',
                    varConfidence === 0.95 ? 'border-primary bg-accent font-medium' : 'hover:bg-accent/50',
                  )}
                >
                  95% (VaR 95)
                </button>
                <button
                  onClick={() => setVarConfidence(0.99)}
                  className={cn(
                    'rounded-md border p-2 text-center transition-colors text-[10px]',
                    varConfidence === 0.99 ? 'border-primary bg-accent font-medium' : 'hover:bg-accent/50',
                  )}
                >
                  99% (VaR 99)
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Higher confidence = wider tail-risk estimate. 99% recommended for tail-sensitive setups.
              </p>
            </div>

            {/* Stress test reference */}
            <div className="rounded-md border border-info/30 bg-info/5 p-2 text-[11px]">
              <div className="font-semibold text-info mb-1">Stress Test Scenarios</div>
              <p className="text-muted-foreground">
                4 historical black-swan events are pre-loaded: SNB Unpeg 2015 (×8.5),
                Brexit 2016 (×4.2), COVID Crash 2020 (×3.5), GFC 2008 (×5.0).
                Run them in the <strong>Stress Test</strong> tab to verify your strategy
                survives tail regimes.
              </p>
            </div>
          </div>
        </PanelCard>

        {/* Encryption Status (under Database Backup) */}
        <PanelCard
          title="Encryption Status"
          subtitle="SQLCipher at-rest encryption indicator"
          icon={Lock}
        >
          <div className="pt-3 space-y-2">
            {encryption ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Encryption</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] gap-1',
                      encryption.enabled ? 'text-bull border-bull' : 'text-bear border-bear',
                    )}
                  >
                    {encryption.enabled ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" /> ENABLED
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3" /> DISABLED
                      </>
                    )}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Cipher</span>
                  <span className="font-mono tabular-nums">{encryption.cipher ?? 'none'}</span>
                </div>
                {(encryption.kdf_iters != null) && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">KDF iterations</span>
                    <span className="font-mono tabular-nums">{(encryption.kdf_iters ?? 0).toLocaleString()}</span>
                  </div>
                )}
                {encryption.page_size !== undefined && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Page size</span>
                    <span className="font-mono tabular-nums">{encryption.page_size} bytes</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Last tested</span>
                  <span className="font-mono tabular-nums text-[10px]">
                    {new Date(encryption.tested_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                  </span>
                </div>
                {!encryption.enabled && (
                  <div className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[10px] text-bear">
                    <strong>WARNING:</strong> Encryption disabled. Set <code className="font-mono">DB_ENCRYPTION_KEY</code> in Python backend .env to enable SQLCipher.
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Memuat…</div>
            )}
          </div>
        </PanelCard>
      </div>

      {/* ===================== Existing settings grid ===================== */}
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

        {/* Browser Push Notifications (PWA) */}
        <PanelCard
          title="Browser Push Notifications"
          subtitle="Local notifications for kill switch, cooldown, TP/SL, margin"
          icon={Bell}
          actions={
            pushPermState === 'denied' ? (
              <Badge variant="outline" className="text-[10px] text-bear border-bear">
                Blocked
              </Badge>
            ) : pushPermState === 'granted' ? (
              <Badge variant="outline" className="text-[10px] text-bull border-bull">
                Granted
              </Badge>
            ) : null
          }
        >
          <div className="pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {pushEnabled ? (
                  <ToggleRight className="h-5 w-5 text-bull" />
                ) : (
                  <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <div className="text-sm font-medium">Enable Browser Push</div>
                  <div className="text-[10px] text-muted-foreground">
                    Tampilkan notifikasi desktop / mobile saat event WS penting.
                  </div>
                </div>
              </div>
              <Switch
                checked={pushEnabled}
                disabled={!pushSupported || pushPermState === 'denied' || pushBusy}
                onCheckedChange={handlePushToggle}
              />
            </div>

            {!pushSupported && (
              <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn">
                Browser ini tidak mendukung Web Notifications + Push API. Gunakan Chrome / Edge /
                Firefox terbaru dengan HTTPS.
              </div>
            )}

            {pushSupported && pushPermState === 'denied' && (
              <div className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[10px] text-bear">
                Permission notification diblokir. Buka Site Settings → Notifications → Allow.
              </div>
            )}

            {pushEnabled && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={async () => {
                  await showLocalNotification(
                    '🔔 Test Notification — Scalping V2',
                    'Kill switch / cooldown / TP / SL alerts aktif. Tutup tab ini untuk verifikasi background notification.',
                    { tag: 'test-push' }
                  );
                  toast({ title: 'Test notification dispatched' });
                }}
              >
                <TestTube2 className="h-3 w-3" />
                Send Test Notification
              </Button>
            )}

            <div className="text-[10px] text-muted-foreground">
              Event yang dipicu: <strong>kill_switch_engaged</strong>,{' '}
              <strong>cooldown_engaged</strong>, <strong>margin_warning</strong>,{' '}
              <strong>tp1_hit</strong>, <strong>tp2_hit</strong>, <strong>sl_hit</strong>.
              Subscription disimpan lokal — service worker (`/sw.js`) menangani display saat tab
              tertutup.
            </div>
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
                <StatusCheck ok={preLive.time_sync?.ok} label="Time Sync (NTP)" value={preLive.time_sync?.ok ? `${preLive.time_sync?.drift_seconds?.toFixed(2)}s drift` : 'drift excessive'} />

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
                      (timeSync.drift_seconds ?? 0) > 1 ? 'text-bear' : (timeSync.drift_seconds ?? 0) > 0.5 ? 'text-warn' : 'text-bull',
                    )}
                  >
                    {(timeSync.drift_seconds ?? 0).toFixed(3)}s
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
          subtitle={`SQLite file export & import · ${encryption?.enabled ? 'encrypted (SQLCipher)' : 'unencrypted'}`}
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
            <div className={cn(
              'rounded-md border p-2 text-[10px] flex items-start gap-2',
              encryption?.enabled
                ? 'border-bull/30 bg-bull/5 text-bull'
                : 'border-bear/30 bg-bear/5 text-bear',
            )}>
              <Lock className="h-3 w-3 shrink-0 mt-0.5" />
              <div>
                <strong>{encryption?.enabled ? 'ENCRYPTED' : 'NOT ENCRYPTED'}:</strong>{' '}
                {encryption?.enabled
                  ? `Backups are SQLCipher-encrypted (${encryption.cipher}). The same DB_ENCRYPTION_KEY is required to restore.`
                  : 'Backups are plain SQLite. Enable DB_ENCRYPTION_KEY in backend .env to encrypt at-rest.'}
              </div>
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

      <RiskDisclosureModal
        open={riskModalOpen}
        onOpenChange={setRiskModalOpen}
        onAcknowledged={async () => {
          // Refresh status after the modal acknowledges.
          try {
            const s = await getRiskDisclosureStatus();
            setRiskStatus(s);
          } catch {
            // silent
          }
        }}
      />
    </div>
  );
}
