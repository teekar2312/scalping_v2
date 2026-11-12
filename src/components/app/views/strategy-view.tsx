'use client';

import { useState } from 'react';
import {
  FileText,
  BookOpen,
  Target,
  Shield,
  Activity,
  Clock,
  Brain,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { PanelCard } from '../shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  STRATEGY_OVERVIEW,
  V1_V2_COMPARISON,
  STRATEGY_COMPONENTS,
  ADX_REGIME_TABLE,
  SL_ADAPTIVE_TABLE,
  ENTRY_RULES_BUY,
  ENTRY_RULES_SELL,
  EXIT_LEVELS,
  TIERED_STOP_TABLE,
  BACKTEST_PHASES,
  SESSION_DETAILED_TABLE,
  FINAL_NOTES,
  PAIR_DETAILED_ANALYSIS,
  TRADE_LOG_EXAMPLES,
  WEEKLY_TRADE_LESSON,
} from '@/lib/strategy-content';
import {
  PRE_TRADE_CHECKLIST,
  POST_TRADE_CHECKLIST,
  ATR_PER_SESSION,
  GOLDEN_RULES,
  SCALPER_ENEMIES,
  ROADMAP_9_MONTHS,
  RR_NET_SCENARIOS,
} from '@/lib/constants';
import { cn } from '@/lib/utils';

export function StrategyView() {
  const [tab, setTab] = useState('overview');

  return (
    <div className="flex flex-col gap-3 p-3">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 xl:grid-cols-8 h-auto">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="components" className="text-xs">Indikator</TabsTrigger>
          <TabsTrigger value="regime" className="text-xs">ADX Regime</TabsTrigger>
          <TabsTrigger value="sl-tp" className="text-xs">SL & TP</TabsTrigger>
          <TabsTrigger value="entry-exit" className="text-xs">Entry/Exit</TabsTrigger>
          <TabsTrigger value="risk" className="text-xs">Risk Mgmt</TabsTrigger>
          <TabsTrigger value="backtest" className="text-xs">Validasi</TabsTrigger>
          <TabsTrigger value="pairs" className="text-xs">Pairs</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-3">
          <div className="flex flex-col gap-3">
            <PanelCard title={STRATEGY_OVERVIEW.title} subtitle={STRATEGY_OVERVIEW.revision} icon={BookOpen}>
              <div className="pt-3 space-y-3">
                <p className="text-sm leading-relaxed">{STRATEGY_OVERVIEW.tagline}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <div className="rounded-md border p-3">
                    <div className="text-[10px] text-muted-foreground uppercase">Target RR Net</div>
                    <div className="text-lg font-bold text-bull tabular-nums">{STRATEGY_OVERVIEW.targetRRNet}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-[10px] text-muted-foreground uppercase">Revisi dari</div>
                    <div className="text-lg font-bold">V1 (Okt 2026)</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-[10px] text-muted-foreground uppercase">Diterbitkan</div>
                    <div className="text-lg font-bold">Nov 2026</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-[10px] text-muted-foreground uppercase">Win Rate Target</div>
                    <div className="text-lg font-bold tabular-nums">45%</div>
                  </div>
                </div>
                <blockquote className="border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">
                  {STRATEGY_OVERVIEW.philosophy}
                </blockquote>
              </div>
            </PanelCard>

            <PanelCard title="Apa yang Berubah dari V1 dan Kenapa" subtitle="7 Perbaikan Major" icon={TrendingUp}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium w-1/3">Kelemahan V1</th>
                        <th className="text-left font-medium w-1/3">Perbaikan V2</th>
                        <th className="text-left font-medium w-1/3">Justifikasi Berbasis Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {V1_V2_COMPARISON.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 px-2 text-bear">{row.weakness}</td>
                          <td className="py-2 px-2 text-bull">{row.fix}</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.justification}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>

            <PanelCard title="10 Aturan Emas V2" subtitle="Pegang teguh, tidak ada pengecualian" icon={CheckCircle2}>
              <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {GOLDEN_RULES.map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <span className="font-mono font-bold text-primary shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <span>{rule}</span>
                  </div>
                ))}
              </div>
            </PanelCard>

            <PanelCard title="Final Note" subtitle="Pesan penutup" icon={Brain}>
              <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {FINAL_NOTES.map((note, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <span className="font-mono text-muted-foreground shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <span className="italic">{note}</span>
                  </div>
                ))}
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Components */}
        <TabsContent value="components" className="mt-3">
          <PanelCard title="3 Indikator Core + 2 Konfirmator" subtitle="Pendekatan minimalis V2 — dimensi berbeda per indikator" icon={Activity}>
            <div className="pt-3">
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 px-2 font-medium">Indikator</th>
                      <th className="text-left font-medium">Periode</th>
                      <th className="text-left font-medium">Dimensi</th>
                      <th className="text-left font-medium">Core?</th>
                      <th className="text-left font-medium">Peran & Sinyal Kunci</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STRATEGY_COMPONENTS.map((c) => (
                      <tr key={c.indicator} className="border-b last:border-0">
                        <td className="py-2 px-2 font-semibold">{c.indicator}</td>
                        <td className="py-2 px-2 font-mono tabular-nums">{c.period}</td>
                        <td className="py-2 px-2">{c.dimension}</td>
                        <td className="py-2 px-2">
                          {c.core ? (
                            <Badge variant="outline" className="text-[10px] text-bull border-bull">CORE</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">OPTIONAL</Badge>
                          )}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground">{c.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 rounded-md border border-info/30 bg-info/5 p-3 text-xs">
                <strong className="text-info">Catatan:</strong> Price Action (candle pattern, swing high/low) bukan indikator terpisah — itu bahasa baca chart yang harus selalu dipakai bersama ketiga indikator core. Order Flow umumnya tidak tersedia di broker forex retail; V2 tidak menyertakannya.
              </div>
            </div>
          </PanelCard>
        </TabsContent>

        {/* ADX Regime */}
        <TabsContent value="regime" className="mt-3">
          <div className="flex flex-col gap-3">
            <PanelCard title="Kapan Trade, Kapan Skip" subtitle="Filter regime paling penting di V2" icon={Activity}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">ADX(14)</th>
                        <th className="text-left font-medium">Regime</th>
                        <th className="text-left font-medium">Karakteristik</th>
                        <th className="text-left font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ADX_REGIME_TABLE.map((row) => (
                        <tr key={row.adx} className="border-b last:border-0">
                          <td className="py-2 px-2 font-mono font-semibold">{row.adx}</td>
                          <td className="py-2 px-2 font-medium">{row.regime}</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.characteristic}</td>
                          <td className={cn('py-2 px-2 font-medium',
                            row.action.startsWith('TRADE') && 'text-bull',
                            row.action.startsWith('SKIP') && 'text-bear',
                            row.action.startsWith('WAIT') && 'text-warn',
                            row.action.startsWith('Hati-hati') && 'text-warn'
                          )}>
                            {row.action}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>

            <PanelCard title="Aturan Wajib ADX" subtitle="Cek di 15M sebelum 5M" icon={AlertTriangle}>
              <div className="pt-3">
                <div className="rounded-md border border-bear/30 bg-bear/5 p-3 text-sm">
                  Cek ADX(14) di timeframe <strong>15M</strong> sebelum melihat chart 5M. Bila ADX 15M &lt; 20, <strong>tutup platform</strong> atau lakukan hal lain hari itu. Banyak trader pemula mencoba "memaksa" trading di pasar ranging karena bosan — ini penyebab utama kerugian beruntun.
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  EUR/USD di 5M hanya trending ~30% waktu, ranging ~70%. ADX filter mengeliminasi ~70% waktu pasar yang merugikan.
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* SL & TP */}
        <TabsContent value="sl-tp" className="mt-3">
          <div className="flex flex-col gap-3">
            <PanelCard title="Stop Loss Adaptif" subtitle="SL = 1.5×ATR(14) + 2 pip buffer di luar swing" icon={Shield}>
              <div className="pt-3 space-y-3">
                <div className="rounded-md border p-3 font-mono text-sm">
                  <div className="text-muted-foreground text-xs mb-1">Rumus:</div>
                  SL (pip) = ATR(14) × 1.5 + 2 pip buffer
                  <div className="mt-2 text-xs text-muted-foreground">Buffer ditempatkan di luar swing high/low terdekat</div>
                </div>
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Sesi (WIB)</th>
                        <th className="text-right font-medium">ATR Tipikal</th>
                        <th className="text-right font-medium">SL V2</th>
                        <th className="text-right font-medium">SL V1 (Fixed)</th>
                        <th className="text-left font-medium">Masalah V1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SL_ADAPTIVE_TABLE.map((row) => (
                        <tr key={row.session} className="border-b last:border-0">
                          <td className="py-2 px-2 font-medium">{row.session}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.atrTipikal}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-bull font-semibold">{row.slV2}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-bear">{row.slV1}</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.masalahV1}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>

            <PanelCard title="RR Net Setelah Biaya" subtitle="RR Net = (TP brutto − biaya) / (SL brutto + biaya)" icon={Target}>
              <div className="pt-3 space-y-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Skenario</th>
                        <th className="text-right font-medium">TP brutto</th>
                        <th className="text-right font-medium">SL brutto</th>
                        <th className="text-right font-medium">Biaya (pip)</th>
                        <th className="text-right font-medium">RR Net</th>
                        <th className="text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RR_NET_SCENARIOS.map((row) => (
                        <tr key={row.scenario} className="border-b last:border-0">
                          <td className="py-2 px-2">{row.scenario}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.tpBrutto}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.slBrutto}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.cost}</td>
                          <td className={cn('py-2 px-2 text-right tabular-nums font-semibold',
                            row.rrNet >= 2.0 ? 'text-bull' : row.rrNet >= 1.3 ? 'text-warn' : 'text-bear'
                          )}>
                            {(row?.rrNet ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-md border border-bull/30 bg-bull/5 p-3 text-sm">
                  <strong className="text-bull">Aturan RR Net V2:</strong> Hanya entry bila RR net ≥ 2.0. Artinya TP brutto harus ~2.5× SL brutto. Dengan SL rata-rata 10 pip (ATR sesi London), TP harus ≥ 25 pip. Bila setup tidak menjanjikan ruang 25 pip, lewati.
                </div>
              </div>
            </PanelCard>

            <PanelCard title="Take Profit Bertingkat & Trailing ATR" subtitle="TP1 = 2×SL, TP2 = 4×SL, trailing 2×ATR" icon={TrendingUp}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Level</th>
                        <th className="text-left font-medium">Target</th>
                        <th className="text-left font-medium">Ilustrasi</th>
                        <th className="text-left font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXIT_LEVELS.map((row) => (
                        <tr key={row.level} className="border-b last:border-0">
                          <td className="py-2 px-2 font-semibold">{row.level}</td>
                          <td className="py-2 px-2 font-mono">{row.target}</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.ilustrasi}</td>
                          <td className="py-2 px-2">{row.aksi}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Entry / Exit */}
        <TabsContent value="entry-exit" className="mt-3">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <PanelCard title="BUY · LONG Setup Bullish" subtitle="7 kondisi entry" icon={TrendingUp}>
                <div className="pt-3">
                  <ol className="space-y-2 text-xs">
                    {ENTRY_RULES_BUY.map((rule, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-mono font-bold text-bull shrink-0">{i + 1}.</span>
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </PanelCard>
              <PanelCard title="SELL · SHORT Setup Bearish" subtitle="7 kondisi entry" icon={TrendingUp}>
                <div className="pt-3">
                  <ol className="space-y-2 text-xs">
                    {ENTRY_RULES_SELL.map((rule, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-mono font-bold text-bear shrink-0">{i + 1}.</span>
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </PanelCard>
            </div>

            <PanelCard title="Pre-Trade Checklist V2 (8 Pertanyaan)" subtitle="Wajib semua tercentang" icon={CheckCircle2}>
              <div className="pt-3">
                <ol className="space-y-2">
                  {PRE_TRADE_CHECKLIST.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 text-xs">
                      <span className="font-mono font-bold text-primary shrink-0">
                        {String(item.id).padStart(2, '0')}
                      </span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </PanelCard>

            <PanelCard title="Post-Trade Evaluasi" subtitle="5 pertanyaan setelah trade" icon={Brain}>
              <div className="pt-3">
                <ol className="space-y-2">
                  {POST_TRADE_CHECKLIST.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 text-xs">
                      <span className="font-mono font-bold text-muted-foreground shrink-0">
                        {String(item.id).padStart(2, '0')}
                      </span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </PanelCard>

            <PanelCard title="Contoh Trade Log V2" subtitle="5 trade mingguan dengan ATR & RR Net" icon={BookOpen}>
              <div className="pt-3">
                <div className="flex flex-col gap-2">
                  {TRADE_LOG_EXAMPLES.map((t, i) => (
                    <div key={i} className="rounded-md border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{t.date}</Badge>
                          <span className="text-xs font-semibold">{t.pair}</span>
                          <span className="text-xs text-muted-foreground">{t.session}</span>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]',
                            t.result.startsWith('+') ? 'text-bull border-bull' :
                            t.result === 'SKIP' ? 'text-warn border-warn' : 'text-bear border-bear'
                          )}
                        >
                          {t.result}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">{t.details}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-md border border-info/30 bg-info/5 p-3 text-xs">
                  <strong className="text-info">Pelajaran Kunci:</strong> {WEEKLY_TRADE_LESSON}
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Risk Management */}
        <TabsContent value="risk" className="mt-3">
          <div className="flex flex-col gap-3">
            <PanelCard title="Tiered Stop Loss" subtitle="Soft / Hard / Weekly / Overall" icon={Shield}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Tier</th>
                        <th className="text-left font-medium">Limit</th>
                        <th className="text-left font-medium">Trigger</th>
                        <th className="text-left font-medium">Aksi Wajib</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TIERED_STOP_TABLE.map((row) => (
                        <tr key={row.tier} className="border-b last:border-0">
                          <td className="py-2 px-2 font-medium">{row.tier}</td>
                          <td className="py-2 px-2 font-mono font-semibold text-bear">{row.limit}</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.trigger}</td>
                          <td className="py-2 px-2">{row.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>

            <PanelCard title="5 Musuh Scalper V2" subtitle="Mitigasi operasional, bukan sekadar nasihat" icon={Brain}>
              <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {SCALPER_ENEMIES.map((enemy) => (
                  <div key={enemy.name} className="rounded-md border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-[10px] text-bear border-bear">
                        {enemy.name}
                      </Badge>
                    </div>
                    <div className="text-xs">
                      <div className="text-muted-foreground mb-1">Mitigasi Sistem:</div>
                      <div>{enemy.mitigation}</div>
                    </div>
                  </div>
                ))}
              </div>
            </PanelCard>

            <PanelCard title="Sesi Trading WIB" subtitle="Jam emas vs blacklist" icon={Clock}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Waktu (WIB)</th>
                        <th className="text-left font-medium">Kondisi</th>
                        <th className="text-left font-medium">Rekomendasi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SESSION_DETAILED_TABLE.map((row) => (
                        <tr key={row.waktu} className="border-b last:border-0">
                          <td className="py-2 px-2 font-mono">{row.waktu}</td>
                          <td className="py-2 px-2">{row.kondisi}</td>
                          <td className={cn('py-2 px-2',
                            row.rekomendasi.startsWith('Skip') || row.rekomendasi.startsWith('Blacklist') ? 'text-bear' :
                            row.rekomendasi.startsWith('Sesi terbaik') || row.rekomendasi.startsWith('Jam emas') ? 'text-bull' : 'text-muted-foreground'
                          )}>
                            {row.rekomendasi}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Backtest / Validation */}
        <TabsContent value="backtest" className="mt-3">
          <div className="flex flex-col gap-3">
            <PanelCard title="Kerangka Backtest 300 Trade + Forward Demo" subtitle="Statistical significance untuk expectancy ±0.1R" icon={Target}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Fase</th>
                        <th className="text-left font-medium">Durasi</th>
                        <th className="text-left font-medium">Min Trade</th>
                        <th className="text-left font-medium">Tujuan</th>
                        <th className="text-left font-medium">Lolos Bila</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BACKTEST_PHASES.map((row) => (
                        <tr key={row.phase} className="border-b last:border-0">
                          <td className="py-2 px-2 font-semibold">{row.phase}</td>
                          <td className="py-2 px-2 font-mono">{row.duration}</td>
                          <td className="py-2 px-2 font-mono tabular-nums">{row.minTrades}</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.tujuan}</td>
                          <td className="py-2 px-2 text-bull">{row.lolos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-md border border-warn/30 bg-warn/5 p-3 text-xs">
                  <strong>Total waktu sebelum trading dengan ukuran lot normal: 9 bulan.</strong> Mungkin terasa lama, tapi bandingkan dengan alternatif: kehilangan modal $2,000 dalam 2 minggu karena tidak teruji. Belajar dari data lebih murah daripada belajar dari kerugian.
                </div>
              </div>
            </PanelCard>

            <PanelCard title="Roadmap 9 Bulan V2" subtitle="Belajar → Backtest → Demo → Live → Scale" icon={TrendingUp}>
              <div className="pt-3">
                <div className="flex flex-col gap-3">
                  {ROADMAP_9_MONTHS.map((phase) => (
                    <div key={phase.phase} className="flex items-start gap-3 rounded-md border p-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-xs">
                        {phase.months.split('-')[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{phase.phase}</span>
                          <Badge variant="outline" className="text-[10px]">{phase.months}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mb-1">{phase.activity}</div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Target: </span>
                          <span className="text-bull">{phase.target}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </PanelCard>

            <PanelCard title="ATR Tipikal per Sesi" subtitle="EUR/USD 5M historical estimate" icon={Activity}>
              <div className="pt-3">
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Sesi</th>
                        <th className="text-right font-medium">ATR Tipikal</th>
                        <th className="text-right font-medium">SL V2</th>
                        <th className="text-right font-medium">SL V1</th>
                        <th className="text-left font-medium">Masalah V1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ATR_PER_SESSION.map((row) => (
                        <tr key={row.session} className="border-b last:border-0">
                          <td className="py-2 px-2">{row.session}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.atrPip} pip</td>
                          <td className="py-2 px-2 text-right tabular-nums text-bull font-semibold">{row.slV2} pip</td>
                          <td className="py-2 px-2 text-right tabular-nums text-bear">{row.slV1} pip</td>
                          <td className="py-2 px-2 text-muted-foreground">{row.problem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>

        {/* Pairs */}
        <TabsContent value="pairs" className="mt-3">
          <div className="flex flex-col gap-3">
            {PAIR_DETAILED_ANALYSIS.map((pair) => (
              <PanelCard
                key={pair.rank}
                title={`#${pair.rank} ${pair.name}`}
                subtitle={pair.title}
                icon={Target}
              >
                <div className="pt-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {pair.metrics.map((m) => (
                      <div key={m.kriteria} className="rounded-md border p-2">
                        <div className="text-[10px] text-muted-foreground">{m.kriteria}</div>
                        <div className="text-xs font-semibold">{m.nilai}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs">
                    <strong className="text-info">Kenapa #{pair.rank}:</strong> {pair.why}
                  </div>
                </div>
              </PanelCard>
            ))}

            <PanelCard title="Rekomendasi Praktis V2" subtitle="Untuk pemula dengan akun kecil" icon={CheckCircle2}>
              <div className="pt-3 space-y-2 text-xs">
                <div className="rounded-md border p-2">
                  <strong className="text-bull">Akun $500-2,000:</strong> Mulai dengan EUR/USD saja selama 3 bulan pertama — kuasai satu pair sebelum pindah. Setelah konsisten, tambah GBP/USD sebagai pair kedua (perilaku mirip, skill transferable).
                </div>
                <div className="rounded-md border p-2">
                  <strong className="text-warn">Hindari:</strong> Trading 2 pair sekaligus di awal — fokus dan kenali satu "kepribadian" pair dulu. Pasang alert hanya pada 1-2 pair.
                </div>
                <div className="rounded-md border border-bear/30 bg-bear/5 p-2">
                  <strong className="text-bear">Broker Penting:</strong> Spread di atas adalah angka realistis untuk broker ECN. Di broker retail, spread bisa 2-3x lebih lebar → RR net target 2.0 tidak tercapai. Pilih broker ECN/RAW spread (Finex Indonesia direkomendasikan), walaupun ada komisi $7/lot.
                </div>
              </div>
            </PanelCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
