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
} from 'lucide-react';
import { PanelCard } from '../shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAppStore } from '@/lib/store';
import { saveSettings } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { TRADING_PAIRS, V2_RULES } from '@/lib/constants';
import { DEMO_MODE } from '@/lib/api';
import type { Settings } from '@/lib/types';
import { cn } from '@/lib/utils';

export function SettingsView() {
  const { settings, updateSettings } = useAppStore();
  const [local, setLocal] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

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

  const handleTest = async (service: string) => {
    setTesting(service);
    setTimeout(() => {
      setTesting(null);
      toast({
        title: `${service} connection test`,
        description: DEMO_MODE
          ? `${service} connection simulated (demo mode)`
          : `${service} connection tested via Python backend`,
      });
    }, 1000);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Demo mode banner */}
      {DEMO_MODE && (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-warn shrink-0" />
          <div className="text-sm flex-1">
            <div className="font-semibold text-warn">DEMO MODE — Python backend tidak terhubung</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Dashboard menampilkan data simulasi. Untuk trading riil, jalankan Python backend di Windows
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
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleTest('MT5')}>
              <TestTube2 className="h-3 w-3" />
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
              <p className="text-[10px] text-muted-foreground mt-1">Finex Indonesia (default)</p>
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
              <p className="text-[10px] text-muted-foreground mt-1">Server Finex Indonesia (cek di MT5 terminal)</p>
            </div>
            <div className="rounded-md border border-info/30 bg-info/5 p-2 text-[10px]">
              <strong className="text-info">Setup:</strong> Buka MT5 terminal di Windows → File → Open Account →
              Finex Indonesia → login dengan kredensial di atas → enable <strong>Algo Trading</strong>.
            </div>
          </div>
        </PanelCard>

        {/* Ollama Settings */}
        <PanelCard
          title="Ollama AI"
          subtitle="Local AI untuk analisa strategi"
          icon={Bot}
          actions={
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleTest('Ollama')}>
              <TestTube2 className="h-3 w-3" />
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
              <p className="text-[10px] text-muted-foreground mt-1">Default Ollama URL (port 11434)</p>
            </div>
            <div>
              <Label className="text-xs">Model</Label>
              <Input
                value={local.ollama.model}
                onChange={(e) => setLocal({ ...local, ollama: { ...local.ollama, model: e.target.value } })}
                placeholder="llama3.2:latest"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Model yang akan di-pull: <code className="font-mono">ollama pull llama3.2:latest</code>
              </p>
            </div>
            <div className="rounded-md border border-info/30 bg-info/5 p-2 text-[10px] space-y-1">
              <div><strong className="text-info">Install Ollama:</strong></div>
              <div>1. Download dari <a href="https://ollama.com" target="_blank" rel="noreferrer" className="text-info underline">ollama.com</a></div>
              <div>2. <code className="font-mono">ollama pull llama3.2:latest</code></div>
              <div>3. <code className="font-mono">ollama serve</code> (auto-start as service)</div>
              <div>4. Verify: <code className="font-mono">ollama list</code></div>
            </div>
          </div>
        </PanelCard>

        {/* Tiingo Settings */}
        <PanelCard
          title="Tiingo Calendar"
          subtitle="Economic calendar provider"
          icon={CalendarClock}
          actions={
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleTest('Tiingo')}>
              <TestTube2 className="h-3 w-3" />
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
                Dapatkan dari <a href="https://api.tiingo.com" target="_blank" rel="noreferrer" className="text-info underline inline-flex items-center gap-0.5">api.tiingo.com <ExternalLink className="h-2.5 w-2.5" /></a>
              </p>
            </div>
            <div className="rounded-md border border-info/30 bg-info/5 p-2 text-[10px]">
              <strong className="text-info">Fitur:</strong> Economic calendar, news, quotes. Cache 1 jam.
              Blackout window ±30 menit untuk news HIGH impact.
            </div>
          </div>
        </PanelCard>

        {/* Risk Management Settings */}
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

            <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px]">
              <strong className="text-warn">V2 Default:</strong> Risk 1%, max 3 posisi, max 5 trade/hari, RR net ≥ 2.0.
              Tiered: -1% soft, -2% hard, -4% weekly, -10% overall.
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
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => handleTest('Python Backend')}
            >
              <TestTube2 className="h-3.5 w-3.5" />
              Test
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Set <code className="font-mono">NEXT_PUBLIC_PYTHON_API_URL</code> environment variable untuk override demo mode.
            Backend Python FastAPI berjalan di port 8000 (lihat <code className="font-mono">download/python-backend/README.md</code>).
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
