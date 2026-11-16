'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Mail,
  Volume2,
  Send,
  Cpu,
  Newspaper,
  Camera,
  Users,
  Loader2,
  RefreshCw,
  Play,
  Plus,
  Trash2,
  Brain,
  Rocket,
  CheckCircle2,
  XCircle,
  Power,
  PowerOff,
  AlertCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { PanelCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import { DEMO_MODE } from '@/lib/api';
import {
  sendTestEmail,
  getDailyReport,
  testVoice,
  getVoiceStatus,
  sendTelegramCommand,
  getTelegramCommands,
  optimizeParams,
  getCurrentOptimal,
  getOptimizationHistory,
  trainML,
  getMLPredict,
  getMLFeatures,
  enableNewsTrading,
  getNewsTradingStatus,
  getNewsTradingStats,
  getScreenshot,
  listScreenshots,
  addAccount,
  listAccounts,
  removeAccount,
  startAccountBot,
  stopAccountBot,
  getAggregatedStats,
} from '@/lib/api';
import type {
  DailyReport,
  VoiceStatus,
  TelegramCommand,
  TelegramCommandResponse,
  OptimalParams,
  OptimizationResult,
  OptimizationHistoryEntry,
  MLPrediction,
  MLFeatures,
  MLTrainResult,
  NewsTradingStatus,
  NewsTradingStats,
  ScreenshotInfo,
  ScreenshotListResponse,
  MT5AccountsListResponse,
  AggregatedStats,
  AddAccountRequest,
} from '@/lib/types';

export function FeaturesView() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Advanced features — 10 fitur tambahan untuk trading bot V2.{' '}
          {DEMO_MODE ? (
            <Badge variant="outline" className="ml-2 text-[10px] text-warn border-warn">
              DEMO MODE — all features work dengan mock data
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <EmailReportsCard />
        <VoiceAlertsCard />
        <TelegramRemoteCard />
        <AutoTuneCard />
        <MLRegimeCard />
        <NewsTradingCard />
        <ScreenshotCard />
        <MultiAccountCard />
      </div>
    </div>
  );
}

// ============================================================================
// Feature Card wrapper
// ============================================================================

interface FeatureCardShellProps {
  title: string;
  subtitle: string;
  icon: typeof Mail;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  busy?: boolean;
  children: React.ReactNode;
}

function FeatureCardShell({
  title,
  subtitle,
  icon: Icon,
  enabled,
  onToggle,
  busy,
  children,
}: FeatureCardShellProps) {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md',
            enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-[11px] text-muted-foreground">{subtitle}</span>
          </div>
        </div>
        {onToggle && (
          <div className="flex items-center gap-2">
            {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Switch checked={enabled} onCheckedChange={onToggle} />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// 1. Email Reports
// ============================================================================

function EmailReportsCard() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('trader@example.com');
  const [recipient, setRecipient] = useState('trader@example.com');
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);

  const loadReport = useCallback(async () => {
    try {
      const r = await getDailyReport();
      setDailyReport(r);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleTest = async () => {
    setBusy(true);
    try {
      const res = await sendTestEmail(recipient);
      toast({
        title: res.ok ? '✅ Test email terkirim' : '❌ Gagal kirim email',
        description: res.message,
      });
    } catch (e) {
      toast({ title: 'Email gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="Email Reports"
      subtitle="Daily digest otomatis di 22:00 WIB"
      icon={Mail}
      enabled={enabled}
      onToggle={setEnabled}
      busy={busy}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">SMTP Host</Label>
          <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">SMTP Port</Label>
          <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-[11px]">SMTP User</Label>
          <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-[11px]">Test Recipient</Label>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 text-xs gap-1" onClick={handleTest} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send Test Email
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={loadReport}>
          <RefreshCw className="h-3 w-3" /> Reload Daily
        </Button>
      </div>
      {dailyReport && (
        <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Daily Report — {dailyReport.date}</span>
            <Badge variant={dailyReport.daily_pnl >= 0 ? 'default' : 'destructive'} className="text-[10px]">
              {dailyReport.daily_pnl >= 0 ? '+' : ''}{dailyReport.daily_pnl_pct.toFixed(2)}%
            </Badge>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
            <span>Trades: {dailyReport.trades_count}</span>
            <span>Wins: {dailyReport.wins}</span>
            <span>Losses: {dailyReport.losses}</span>
            <span>WR: {dailyReport.win_rate}%</span>
            <span>PF: {dailyReport.profit_factor.toFixed(2)}</span>
            <span>Compliance: {dailyReport.compliance_score}%</span>
          </div>
          {dailyReport.best_trade && (
            <div className="mt-1 text-[10px] text-bull">
              Best: #{dailyReport.best_trade.ticket} {dailyReport.best_trade.symbol} +{dailyReport.best_trade.r_multiple.toFixed(1)}R
            </div>
          )}
        </div>
      )}
    </FeatureCardShell>
  );
}

// ============================================================================
// 2. Voice Alerts
// ============================================================================

function VoiceAlertsCard() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(70);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [testText, setTestText] = useState('KILL SWITCH TEST');

  const loadStatus = useCallback(async () => {
    try {
      const s = await getVoiceStatus();
      setStatus(s);
      setEnabled(s.enabled);
      setVolume(Math.round(s.volume * 100));
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleTest = async () => {
    setBusy(true);
    try {
      const res = await testVoice(testText, volume / 100);
      toast({
        title: res.ok ? '🔊 Voice test diputar' : 'Voice gagal',
        description: `${res.engine} · ${res.duration_ms}ms · vol ${(volume / 100).toFixed(2)}`,
      });
    } catch (e) {
      toast({ title: 'Voice gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="Voice Alerts"
      subtitle="TTS untuk sinyal, kill switch & risk"
      icon={Volume2}
      enabled={enabled}
      onToggle={setEnabled}
      busy={busy}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-[11px] w-16">Volume</Label>
          <Slider
            value={[volume]}
            onValueChange={(v) => setVolume(v[0] ?? 70)}
            min={0}
            max={100}
            step={5}
            className="flex-1"
          />
          <span className="text-xs font-mono w-8 tabular-nums">{volume}%</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Test text</Label>
          <Input value={testText} onChange={(e) => setTestText(e.target.value)} className="h-8 text-xs" />
        </div>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={handleTest} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Test Voice
        </Button>
        {status && (
          <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Engine</span>
              <span className="font-mono font-semibold">{status.engine}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Alerts today</span>
              <span className="font-mono">{status.alerts_fired_today}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Voices available</span>
              <span className="font-mono">{status.available_voices}</span>
            </div>
            {status.last_alert && (
              <div className="mt-1 text-[10px] text-muted-foreground italic">{status.last_alert}</div>
            )}
            {!status.supported && (
              <div className="mt-1 text-[10px] text-warn">TTS tidak supported di environment ini</div>
            )}
          </div>
        )}
      </div>
    </FeatureCardShell>
  );
}

// ============================================================================
// 3. Telegram Remote
// ============================================================================

function TelegramRemoteCard() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [botToken, setBotToken] = useState('123456:ABC-DEF-demo-token');
  const [chatId, setChatId] = useState('-1001234567890');
  const [commands, setCommands] = useState<TelegramCommand[]>([]);
  const [lastResponse, setLastResponse] = useState<TelegramCommandResponse | null>(null);
  const [testCmd, setTestCmd] = useState('/status');

  const loadCommands = useCallback(async () => {
    try {
      const cmds = await getTelegramCommands();
      setCommands(cmds);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const handleTest = async () => {
    setBusy(true);
    try {
      const res = await sendTelegramCommand(testCmd);
      setLastResponse(res);
      toast({
        title: res.ok ? '✅ Telegram command terkirim' : 'Gagal',
        description: res.response_text.split('\n')[0],
      });
    } catch (e) {
      toast({ title: 'Telegram gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="Telegram Remote"
      subtitle="Kontrol bot via /start /stop /kill /status"
      icon={Send}
      enabled={enabled}
      onToggle={setEnabled}
      busy={busy}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-[11px]">Bot Token</Label>
          <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} className="h-8 text-xs font-mono" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-[11px]">Chat ID</Label>
          <Input value={chatId} onChange={(e) => setChatId(e.target.value)} className="h-8 text-xs font-mono" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select value={testCmd} onValueChange={setTestCmd}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {commands.map((c) => (
              <SelectItem key={c.command} value={c.command} className="text-xs">
                {c.command} — {c.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={handleTest} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send
        </Button>
      </div>

      {lastResponse && (
        <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{lastResponse.command}</span>
            <span className="text-[10px] text-muted-foreground">{lastResponse.chat_id}</span>
          </div>
          <pre className="mt-1 whitespace-pre-wrap text-[10px] text-foreground">{lastResponse.response_text}</pre>
        </div>
      )}

      <div className="rounded-md border p-2">
        <div className="text-[11px] font-semibold mb-1">Available commands</div>
        <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto scroll-thin">
          {commands.map((c) => (
            <div key={c.command} className="flex items-center justify-between text-[10px]">
              <span className="font-mono">{c.command}</span>
              <span className="text-muted-foreground truncate ml-2">{c.description}</span>
              {c.admin_only && <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1">ADMIN</Badge>}
            </div>
          ))}
        </div>
      </div>
    </FeatureCardShell>
  );
}

// ============================================================================
// 4. Auto-Parameter Tuning
// ============================================================================

function AutoTuneCard() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [intervalDays, setIntervalDays] = useState(7);
  const [optimal, setOptimal] = useState<OptimalParams | null>(null);
  const [lastResult, setLastResult] = useState<OptimizationResult | null>(null);
  const [history, setHistory] = useState<OptimizationHistoryEntry[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([
        getCurrentOptimal(),
        getOptimizationHistory(),
      ]);
      setOptimal(cur);
      setHistory(hist);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleOptimize = async () => {
    setBusy(true);
    try {
      const res = await optimizeParams();
      setLastResult(res);
      setOptimal(res.optimized_params);
      toast({
        title: `✅ Optimized (${res.status})`,
        description: `Improvement +${res.improvement_pct.toFixed(1)}% · ${res.trials} trials · Sharpe ${res.backtest_after.sharpe.toFixed(2)}`,
      });
      loadAll();
    } catch (e) {
      toast({ title: 'Optimasi gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="Auto-Parameter Tuning"
      subtitle="Bayesian optimization untuk V2 params"
      icon={Cpu}
      enabled={enabled}
      onToggle={setEnabled}
      busy={busy}
    >
      <div className="flex items-center gap-2">
        <Label className="text-[11px]">Interval</Label>
        <Select value={String(intervalDays)} onValueChange={(v) => setIntervalDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 3, 7, 14, 30].map((d) => (
              <SelectItem key={d} value={String(d)} className="text-xs">{d} days</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 text-xs gap-1 ml-auto" onClick={handleOptimize} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
          Optimize Now
        </Button>
      </div>

      {optimal && (
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[11px] font-semibold mb-1">Current Optimal Params</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
            <div className="flex justify-between"><span className="text-muted-foreground">risk_pct</span><span className="font-mono">{((optimal.risk_pct_per_trade ?? 0.01) * 100).toFixed(2)}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">max_pos</span><span className="font-mono">{optimal.max_positions ?? 3}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">rr_min</span><span className="font-mono">{(optimal.rr_net_min ?? 2.0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">tp1_mult</span><span className="font-mono">{(optimal.tp1_mult ?? 2.0).toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">tp2_mult</span><span className="font-mono">{(optimal.tp2_mult ?? 4.0).toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">sl_atr</span><span className="font-mono">{(optimal.sl_atr_mult ?? 1.5).toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">trailing_atr</span><span className="font-mono">{(optimal.trailing_atr_mult ?? 2.0).toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">adx_trend</span><span className="font-mono">{optimal.adx_trending_threshold ?? 25}</span></div>
          </div>
        </div>
      )}

      {lastResult && (
        <div className="rounded-md border bg-bull/5 p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Last run — {lastResult.run_id}</span>
            <Badge variant="default" className="text-[10px] bg-bull text-white">
              +{lastResult.improvement_pct.toFixed(1)}%
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-2 text-[10px] mt-1">
            <span>PnL: {lastResult.backtest_before.pnl_pct.toFixed(1)}% → <span className="text-bull font-semibold">{lastResult.backtest_after.pnl_pct.toFixed(1)}%</span></span>
            <span>Sharpe: {lastResult.backtest_before.sharpe.toFixed(2)} → <span className="text-bull font-semibold">{lastResult.backtest_after.sharpe.toFixed(2)}</span></span>
            <span>Max DD: {lastResult.backtest_before.max_dd_pct.toFixed(1)}% → {lastResult.backtest_after.max_dd_pct.toFixed(1)}%</span>
            <span>PF: {lastResult.backtest_before.profit_factor.toFixed(2)} → {lastResult.backtest_after.profit_factor.toFixed(2)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground italic mt-1">{lastResult.note}</p>
        </div>
      )}

      <div className="rounded-md border p-2">
        <div className="text-[11px] font-semibold mb-1">Optimization History</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] h-7">Run</TableHead>
              <TableHead className="text-[10px] h-7">When</TableHead>
              <TableHead className="text-[10px] h-7">Impr.</TableHead>
              <TableHead className="text-[10px] h-7">PnL</TableHead>
              <TableHead className="text-[10px] h-7">Sharpe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.slice(0, 5).map((h) => (
              <TableRow key={h.run_id}>
                <TableCell className="text-[10px] font-mono">{h.run_id}</TableCell>
                <TableCell className="text-[10px]">{new Date(h.finished_at).toLocaleDateString('id-ID')}</TableCell>
                <TableCell className={cn('text-[10px] font-medium', h.improvement_pct >= 0 ? 'text-bull' : 'text-bear')}>
                  {h.improvement_pct >= 0 ? '+' : ''}{h.improvement_pct.toFixed(1)}%
                </TableCell>
                <TableCell className="text-[10px] tabular-nums">{h.pnl_after_pct.toFixed(1)}%</TableCell>
                <TableCell className="text-[10px] tabular-nums">{h.sharpe_after.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </FeatureCardShell>
  );
}

// ============================================================================
// 5. ML Regime Detection
// ============================================================================

function MLRegimeCard() {
  const activeSymbol = useAppStore((s) => s.activeSymbol);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prediction, setPrediction] = useState<MLPrediction | null>(null);
  const [features, setFeatures] = useState<MLFeatures | null>(null);
  const [trainResult, setTrainResult] = useState<MLTrainResult | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [pred, feats] = await Promise.all([
        getMLPredict(activeSymbol),
        getMLFeatures(),
      ]);
      setPrediction(pred);
      setFeatures(feats);
    } catch {
      // silent
    }
  }, [activeSymbol]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleTrain = async () => {
    setBusy(true);
    try {
      const res = await trainML();
      setTrainResult(res);
      toast({
        title: `✅ Model trained — ${res.model_version}`,
        description: `Acc ${(res.accuracy * 100).toFixed(1)}% · AUC ${res.auc.toFixed(2)} · ${res.samples} samples · ${res.duration_seconds}s`,
      });
      loadAll();
    } catch (e) {
      toast({ title: 'Training gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handlePredict = async () => {
    setBusy(true);
    try {
      const p = await getMLPredict(activeSymbol);
      setPrediction(p);
      toast({
        title: `ML prediction: ${p.predicted_regime}`,
        description: `Conf ${(p.regime_confidence * 100).toFixed(0)}% · Dir ${p.predicted_direction ?? '—'} · Win prob ${(p.predicted_win_prob * 100).toFixed(0)}%`,
      });
    } catch (e) {
      toast({ title: 'Predict gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="ML Regime Detection"
      subtitle="GradientBoosting untuk regime + direction"
      icon={Brain}
      enabled={enabled}
      onToggle={setEnabled}
      busy={busy}
    >
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">Symbol: {activeSymbol}</Badge>
        <Button size="sm" className="h-8 text-xs gap-1 ml-auto" onClick={handleTrain} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
          Train Model
        </Button>
      </div>

      {prediction && (
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[11px] font-semibold mb-1">Current Prediction</div>
          <div className="grid grid-cols-2 gap-x-2 text-[10px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Regime</span><span className="font-mono font-semibold">{prediction.predicted_regime}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Confidence</span><span className="font-mono">{(prediction.regime_confidence * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Direction</span><span className="font-mono">{prediction.predicted_direction ?? 'NEUTRAL'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Win prob</span><span className="font-mono">{(prediction.predicted_win_prob * 100).toFixed(0)}%</span></div>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 mt-1 w-full" onClick={handlePredict}>
            <RefreshCw className="h-3 w-3" /> Re-predict
          </Button>
        </div>
      )}

      {trainResult && (
        <div className="rounded-md border bg-bull/5 p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Last train — {trainResult.model_version}</span>
            <span className="text-[10px] text-muted-foreground">{trainResult.samples} samples</span>
          </div>
          <div className="grid grid-cols-3 gap-x-2 text-[10px] mt-1">
            <span>Acc: {(trainResult.accuracy * 100).toFixed(1)}%</span>
            <span>F1: {trainResult.f1.toFixed(2)}</span>
            <span>AUC: {trainResult.auc.toFixed(2)}</span>
          </div>
        </div>
      )}

      {features && features.features.length > 0 && (
        <div className="rounded-md border p-2">
          <div className="text-[11px] font-semibold mb-1">Feature Importance</div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={features.features.slice(0, 8)} layout="vertical" margin={{ left: 20, right: 10 }}>
                <XAxis type="number" domain={[0, 0.25]} tick={{ fontSize: 9, fill: 'currentColor' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'currentColor' }} width={100} />
                <RTooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
                <Bar dataKey="importance" radius={[0, 3, 3, 0]}>
                  {features.features.slice(0, 8).map((f, i) => (
                    <Cell
                      key={f.name}
                      fill={
                        f.category === 'regime' ? '#10b981' :
                        f.category === 'volatility' ? '#f59e0b' :
                        f.category === 'momentum' ? '#3b82f6' :
                        f.category === 'price' ? '#8b5cf6' :
                        f.category === 'volume' ? '#ec4899' :
                        '#6b7280'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </FeatureCardShell>
  );
}

// ============================================================================
// 6. News Trading Mode
// ============================================================================

function NewsTradingCard() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [riskPct, setRiskPct] = useState(50);
  const [status, setStatus] = useState<NewsTradingStatus | null>(null);
  const [stats, setStats] = useState<NewsTradingStats | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        getNewsTradingStatus(),
        getNewsTradingStats(),
      ]);
      setStatus(s);
      setEnabled(s.enabled);
      setRiskPct(Math.round(s.risk_pct * 10000));
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 60_000);
    return () => clearInterval(id);
  }, [loadAll]);

  const handleToggle = async (v: boolean) => {
    setBusy(true);
    setEnabled(v);
    try {
      const res = await enableNewsTrading(v);
      setStatus(res);
      toast({
        title: v ? '✅ News trading enabled' : 'News trading disabled',
        description: v
          ? `Blackout ${res.blackout_minutes_before}+${res.blackout_minutes_after} min · min impact ${res.min_impact}`
          : 'Bot akan trade normal tanpa blackout',
      });
    } catch (e) {
      toast({ title: 'Toggle gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const loadStats = async () => {
    try {
      const s = await getNewsTradingStats();
      setStats(s);
    } catch (e) {
      toast({ title: 'Stats gagal', description: String(e), variant: 'destructive' });
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <FeatureCardShell
      title="News Trading Mode"
      subtitle="Blackout otomatis ±30 min HIGH impact"
      icon={Newspaper}
      enabled={enabled}
      onToggle={handleToggle}
      busy={busy}
    >
      <div className="flex items-center gap-2">
        <Label className="text-[11px] w-24">Risk during news</Label>
        <Slider
          value={[riskPct]}
          onValueChange={(v) => setRiskPct(v[0] ?? 50)}
          min={0}
          max={100}
          step={5}
          className="flex-1"
        />
        <span className="text-xs font-mono w-12 tabular-nums">{(riskPct / 100).toFixed(2)}%</span>
      </div>

      {status && status.next_event && (
        <div className="rounded-md border bg-warn/5 p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-warn" />
              Next event
            </span>
            <Badge variant={status.next_event.impact === 'HIGH' ? 'destructive' : 'secondary'} className="text-[10px]">
              {status.next_event.impact}
            </Badge>
          </div>
          <div className="text-[10px] mt-1">
            <div>{status.next_event.title} <span className="text-muted-foreground">({status.next_event.currency})</span></div>
            <div className="text-muted-foreground">{new Date(status.next_event.time).toLocaleString('id-ID')}</div>
          </div>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-muted-foreground">Active blackouts</div>
            <div className="font-mono text-base font-bold">{status.active_blackouts}</div>
          </div>
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-muted-foreground">Auto-reduce</div>
            <div className="font-mono text-base font-bold">{status.auto_reduce_positions ? 'ON' : 'OFF'}</div>
          </div>
        </div>
      )}

      {stats && (
        <div className="rounded-md border p-2">
          <div className="text-[11px] font-semibold mb-1">News Trading Stats ({stats.window_days}d)</div>
          <div className="grid grid-cols-2 gap-x-2 text-[10px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Total events</span><span className="font-mono">{stats.total_events}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Blackouts</span><span className="font-mono">{stats.blackouts_triggered}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Trades blocked</span><span className="font-mono">{stats.trades_blocked}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Positions reduced</span><span className="font-mono">{stats.positions_reduced}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">P&L during events</span><span className={cn('font-mono', stats.pnl_during_events_pct >= 0 ? 'text-bull' : 'text-bear')}>{stats.pnl_during_events_pct.toFixed(2)}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">P&L during blackout</span><span className={cn('font-mono', stats.pnl_during_blackouts_pct >= 0 ? 'text-bull' : 'text-bear')}>{stats.pnl_during_blackouts_pct.toFixed(2)}%</span></div>
          </div>
        </div>
      )}
    </FeatureCardShell>
  );
}

// ============================================================================
// 7. Trade Screenshots
// ============================================================================

function ScreenshotCard() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ticketInput, setTicketInput] = useState('50384722');
  const [latest, setLatest] = useState<ScreenshotInfo | null>(null);
  const [list, setList] = useState<ScreenshotListResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    const ticket = Number(ticketInput);
    if (!Number.isFinite(ticket)) return;
    Promise.all([getScreenshot(ticket), listScreenshots(ticket)])
      .then(([shot, lst]) => {
        if (!mounted) return;
        setLatest(shot);
        setList(lst);
      })
      .catch(() => {
        // silent — demo mode never fails
      });
    return () => {
      mounted = false;
    };
  }, [ticketInput]);

  const loadScreenshot = async () => {
    const ticket = Number(ticketInput);
    if (!Number.isFinite(ticket)) return;
    setBusy(true);
    try {
      const [shot, lst] = await Promise.all([
        getScreenshot(ticket),
        listScreenshots(ticket),
      ]);
      setLatest(shot);
      setList(lst);
    } catch (e) {
      toast({ title: 'Screenshot gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="Trade Screenshots"
      subtitle="Auto-capture chart at entry & TP1 hit"
      icon={Camera}
      enabled={enabled}
      onToggle={setEnabled}
      busy={busy}
    >
      <div className="flex items-center gap-2">
        <Label className="text-[11px]">Ticket</Label>
        <Input value={ticketInput} onChange={(e) => setTicketInput(e.target.value)} className="h-8 text-xs font-mono" />
        <Button size="sm" className="h-8 text-xs gap-1" onClick={loadScreenshot} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Load
        </Button>
      </div>

      {latest && (
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[11px] font-semibold mb-1">Last screenshot — #{latest.ticket}</div>
          <div className="aspect-video w-full rounded-md bg-gradient-to-br from-muted to-background border flex items-center justify-center text-[10px] text-muted-foreground">
            <div className="flex flex-col items-center gap-1">
              <Camera className="h-6 w-6 opacity-30" />
              <span>{latest.caption}</span>
              <span>{latest.width}×{latest.height} · {(latest.size_bytes / 1024).toFixed(0)}KB</span>
            </div>
          </div>
          <div className="text-[10px] mt-1 text-muted-foreground">
            Captured: {new Date(latest.captured_at).toLocaleString('id-ID')}
          </div>
        </div>
      )}

      {list && list.screenshots.length > 0 && (
        <div className="rounded-md border p-2">
          <div className="text-[11px] font-semibold mb-1">All screenshots ({list.total})</div>
          <div className="flex flex-col gap-1">
            {list.screenshots.map((s, i) => (
              <div key={`${s.ticket}-${i}`} className="flex items-center justify-between text-[10px]">
                <span className="truncate">{s.caption}</span>
                <span className="text-muted-foreground">{new Date(s.captured_at).toLocaleTimeString('id-ID')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </FeatureCardShell>
  );
}

// ============================================================================
// 8. Multi-Account
// ============================================================================

function MultiAccountCard() {
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<MT5AccountsListResponse | null>(null);
  const [agg, setAgg] = useState<AggregatedStats | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('scalper');
  const [newLogin, setNewLogin] = useState('50384999');
  const [newServer, setNewServer] = useState('FinexIC-Markets');
  const [newBalance, setNewBalance] = useState('5000');

  const loadAll = useCallback(async () => {
    try {
      const [accs, stats] = await Promise.all([
        listAccounts(),
        getAggregatedStats(),
      ]);
      setAccounts(accs);
      setAgg(stats);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 30_000);
    return () => clearInterval(id);
  }, [loadAll]);

  const handleAdd = async () => {
    setBusy(true);
    try {
      const body: AddAccountRequest = {
        name: newName,
        login: Number(newLogin),
        password: 'demo',
        server: newServer,
        broker: 'Finex Indonesia',
        initial_balance: Number(newBalance),
      };
      await addAccount(body);
      toast({
        title: '✅ Account added',
        description: `${body.name} (login ${body.login}) berhasil ditambahkan`,
      });
      setShowForm(false);
      loadAll();
    } catch (e) {
      toast({ title: 'Add gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async (name: string) => {
    setBusy(true);
    try {
      const res = await startAccountBot(name);
      toast({ title: '▶ Bot started', description: res.message });
      loadAll();
    } catch (e) {
      toast({ title: 'Start gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async (name: string) => {
    setBusy(true);
    try {
      const res = await stopAccountBot(name);
      toast({ title: '⏸ Bot stopped', description: res.message });
      loadAll();
    } catch (e) {
      toast({ title: 'Stop gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (name: string) => {
    setBusy(true);
    try {
      await removeAccount(name);
      toast({ title: '🗑 Account removed', description: name });
      loadAll();
    } catch (e) {
      toast({ title: 'Remove gagal', description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureCardShell
      title="Multi-Account Manager"
      subtitle="Run bot di multiple MT5 accounts simultaneously"
      icon={Users}
      enabled
      busy={busy}
    >
      {agg && (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-muted-foreground">Total balance</div>
            <div className="font-mono text-sm font-bold">${agg.total_balance.toFixed(0)}</div>
          </div>
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-muted-foreground">Equity</div>
            <div className="font-mono text-sm font-bold">${agg.total_equity.toFixed(0)}</div>
          </div>
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-muted-foreground">Today P&L</div>
            <div className={cn('font-mono text-sm font-bold', agg.total_profit >= 0 ? 'text-bull' : 'text-bear')}>
              {agg.total_profit >= 0 ? '+' : ''}${agg.total_profit.toFixed(0)}
            </div>
          </div>
        </div>
      )}

      {agg && (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="rounded-md border p-1.5 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-bull" />
            <span>{agg.connected_count} connected</span>
          </div>
          <div className="rounded-md border p-1.5 flex items-center gap-1">
            <Power className="h-3 w-3 text-bull" />
            <span>{agg.bots_running} running</span>
          </div>
          <div className="rounded-md border p-1.5 flex items-center gap-1">
            <PowerOff className="h-3 w-3 text-muted-foreground" />
            <span>{agg.bots_stopped} stopped</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3 w-3" /> Add Account
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={loadAll}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {showForm && (
        <div className="rounded-md border bg-muted/40 p-2 grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Login</Label>
            <Input value={newLogin} onChange={(e) => setNewLogin(e.target.value)} className="h-7 text-xs font-mono" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Server</Label>
            <Input value={newServer} onChange={(e) => setNewServer(e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Initial Balance</Label>
            <Input value={newBalance} onChange={(e) => setNewBalance(e.target.value)} className="h-7 text-xs font-mono" />
          </div>
          <Button size="sm" className="h-7 col-span-2 text-xs" onClick={handleAdd} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create Account
          </Button>
        </div>
      )}

      <div className="rounded-md border p-2">
        <div className="text-[11px] font-semibold mb-1">Accounts ({accounts?.total ?? 0})</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] h-7">Name</TableHead>
              <TableHead className="text-[10px] h-7">Balance</TableHead>
              <TableHead className="text-[10px] h-7">Status</TableHead>
              <TableHead className="text-[10px] h-7">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts?.accounts.map((a) => (
              <TableRow key={a.name}>
                <TableCell className="text-[10px]">
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-[9px] text-muted-foreground font-mono">{a.login}</div>
                </TableCell>
                <TableCell className="text-[10px] tabular-nums">
                  <div>${a.balance.toFixed(0)}</div>
                  <div className={cn('text-[9px]', a.profit >= 0 ? 'text-bull' : 'text-bear')}>
                    {a.profit >= 0 ? '+' : ''}{a.profit.toFixed(2)}
                  </div>
                </TableCell>
                <TableCell className="text-[10px]">
                  <div className="flex items-center gap-1">
                    {a.connected ? (
                      <CheckCircle2 className="h-3 w-3 text-bull" />
                    ) : (
                      <XCircle className="h-3 w-3 text-bear" />
                    )}
                    <span className="text-[9px]">{a.bot_status}</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground">{a.bot_mode}</div>
                </TableCell>
                <TableCell className="text-[10px]">
                  <div className="flex items-center gap-1">
                    {a.bot_status === 'RUNNING' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0"
                        onClick={() => handleStop(a.name)}
                        disabled={busy}
                        title="Stop"
                      >
                        <PowerOff className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0"
                        onClick={() => handleStart(a.name)}
                        disabled={busy}
                        title="Start"
                      >
                        <Power className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-bear"
                      onClick={() => handleRemove(a.name)}
                      disabled={busy}
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {agg?.best_account && agg?.worst_account && (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-md border bg-bull/5 p-2">
            <div className="text-muted-foreground">Best account</div>
            <div className="font-semibold">{agg.best_account.name}</div>
            <div className="text-bull font-mono">+{agg.best_account.pnl_pct.toFixed(2)}%</div>
          </div>
          <div className="rounded-md border bg-bear/5 p-2">
            <div className="text-muted-foreground">Worst account</div>
            <div className="font-semibold">{agg.worst_account.name}</div>
            <div className="text-bear font-mono">{agg.worst_account.pnl_pct.toFixed(2)}%</div>
          </div>
        </div>
      )}
    </FeatureCardShell>
  );
}
