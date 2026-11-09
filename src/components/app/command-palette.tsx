'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { useAppStore, type AppView } from '@/lib/store';
import {
  useKeyboardShortcuts,
  type KeyboardShortcut,
  subscribeShortcuts,
  listRegisteredShortcuts,
  getRecentShortcuts,
} from '@/hooks/use-keyboard-shortcuts';
import { controlBot } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  LayoutDashboard,
  CandlestickChart,
  Zap,
  Briefcase,
  BookOpen,
  Bot,
  CalendarClock,
  FileText,
  Settings as SettingsIcon,
  TrendingDown,
  BarChart3,
  ScrollText,
  Play,
  Square,
  Octagon,
  Sun,
  Moon,
  Keyboard,
  Globe,
  Activity,
  Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavTarget {
  id: AppView;
  label: string;
  icon: typeof LayoutDashboard;
  group: 'Navigation';
}

const NAV_TARGETS: NavTarget[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Navigation' },
  { id: 'chart', label: 'Chart & Indikator', icon: CandlestickChart, group: 'Navigation' },
  { id: 'signals', label: 'Sinyal V2', icon: Zap, group: 'Navigation' },
  { id: 'positions', label: 'Posisi & Trade', icon: Briefcase, group: 'Navigation' },
  { id: 'journal', label: 'Trade Journal', icon: BookOpen, group: 'Navigation' },
  { id: 'ai', label: 'AI Analisa', icon: Bot, group: 'Navigation' },
  { id: 'news', label: 'Kalender Ekonomi', icon: CalendarClock, group: 'Navigation' },
  { id: 'strategy', label: 'Strategi V2 Ref', icon: FileText, group: 'Navigation' },
  { id: 'backtest', label: 'Backtest · MC · WF', icon: BarChart3, group: 'Navigation' },
  { id: 'stress-test', label: 'Stress Test', icon: TrendingDown, group: 'Navigation' },
  { id: 'analytics', label: 'Slippage · Latency · Kelly', icon: BarChart3, group: 'Navigation' },
  { id: 'audit', label: 'Audit Log', icon: ScrollText, group: 'Navigation' },
  { id: 'alerts', label: 'Price & Indicator Alerts', icon: Bell, group: 'Navigation' },
  { id: 'market', label: 'Market Analysis', icon: Globe, group: 'Navigation' },
  { id: 'system', label: 'System Health', icon: Activity, group: 'Navigation' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'Navigation' },
];

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
}

let paletteOpenSetter: ((v: boolean) => void) | null = null;

/** Programmatically toggle the palette from anywhere. */
export function openCommandPalette(): void {
  paletteOpenSetter?.(true);
}
export function closeCommandPalette(): void {
  paletteOpenSetter?.(false);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [registered, setRegistered] = useState<KeyboardShortcut[]>([]);
  const { theme, setTheme } = useTheme();
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setKillSwitchOpen = useAppStore((s) => s.setKillSwitchOpen);
  const density = useAppStore((s) => s.density);
  const setDensity = useAppStore((s) => s.setDensity);

  // Expose setter so other modules can open the palette programmatically.
  useEffect(() => {
    paletteOpenSetter = setOpen;
    return () => {
      paletteOpenSetter = null;
    };
  }, []);

  // Track the live shortcut registry so the help dialog stays in sync.
  useEffect(() => {
    const update = () => {
      setRegistered(listRegisteredShortcuts());
      setRecent(getRecentShortcuts());
    };
    update();
    return subscribeShortcuts(update);
  }, [open]);

  // Global shortcuts that also drive the palette UI itself.
  const globalShortcuts: KeyboardShortcut[] = [
    {
      combo: 'mod+k',
      description: 'Open command palette',
      group: 'Help',
      handler: () => setOpen((v) => !v),
    },
    {
      combo: '?',
      description: 'Show keyboard shortcuts help',
      group: 'Help',
      handler: () => {
        // Trigger the help dialog via a synthetic custom event so the
        // ShortcutsHelp component (mounted separately) can pick it up.
        window.dispatchEvent(new CustomEvent('scalping-v2:shortcuts-help'));
      },
    },
    {
      combo: 'Escape',
      description: 'Close dialog / palette',
      group: 'Help',
      handler: () => {
        setOpen(false);
      },
      allowPropagation: true,
    },
  ];

  useKeyboardShortcuts(globalShortcuts);

  // Navigation shortcuts: g d, g c, g s, g p, g j, g a, g n
  const navShortcuts: KeyboardShortcut[] = NAV_TARGETS.slice(0, 7).map((t, idx) => {
    const seqMap = ['d', 'c', 's', 'p', 'j', 'a', 'n'];
    const second = seqMap[idx] ?? t.id[0];
    return {
      combo: `g ${second}`,
      description: `Go to ${t.label}`,
      group: 'Navigation',
      handler: () => setActiveView(t.id),
    } satisfies KeyboardShortcut;
  });
  useKeyboardShortcuts(navShortcuts);

  // Refresh recent list whenever palette closes (so user sees latest history).
  useEffect(() => {
    if (!open) {
      // Defer to microtask to avoid synchronous setState in effect.
      Promise.resolve().then(() => setRecent(getRecentShortcuts()));
    }
  }, [open]);

  const runNav = useCallback(
    (target: AppView) => {
      setActiveView(target);
      setOpen(false);
    },
    [setActiveView]
  );

  const runBotAction = useCallback(
    async (action: 'start' | 'stop' | 'kill') => {
      setOpen(false);
      try {
        const r = await controlBot(action);
        toast({ title: r.message });
      } catch (e) {
        toast({ title: 'Bot action failed', description: String(e), variant: 'destructive' });
      }
    },
    []
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
    setOpen(false);
    toast({ title: `Theme: ${theme === 'dark' ? 'Light' : 'Dark'}` });
  }, [setTheme, theme, setOpen]);

  const toggleDensity = useCallback(() => {
    const order = ['minimal', 'compact', 'dense'] as const;
    const next = order[(order.indexOf(density) + 1) % order.length];
    setDensity(next);
    setOpen(false);
    toast({ title: `Density: ${next}` });
  }, [density, setDensity, setOpen]);

  const recentLabels = recent
    .map((combo) => {
      const all = [...globalShortcuts, ...navShortcuts, ...registered];
      const found = all.find((s) => s.combo === combo);
      return found ? { combo, label: found.description } : null;
    })
    .filter((x): x is { combo: string; label: string } => x !== null);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search commands or jump to a view. Esc to close."
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching command.</CommandEmpty>

        {recentLabels.length > 0 && (
          <CommandGroup heading="Recent">
            {recentLabels.map(({ combo, label }) => (
              <CommandItem
                key={`recent-${combo}`}
                value={`recent ${label} ${combo}`}
                onSelect={() => {
                  const all = [...globalShortcuts, ...navShortcuts, ...registered];
                  const found = all.find((s) => s.combo === combo);
                  found?.handler(new KeyboardEvent('keydown'));
                  setOpen(false);
                }}
              >
                <Keyboard className="h-4 w-4 text-muted-foreground" />
                <span>{label}</span>
                <CommandShortcut>{formatCombo(combo)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Navigation">
          {NAV_TARGETS.map((t) => {
            const Icon = t.icon;
            return (
              <CommandItem
                key={t.id}
                value={`nav ${t.label}`}
                onSelect={() => runNav(t.id)}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{t.label}</span>
                <CommandShortcut>
                  {navShortcuts.find((s) => s.description === `Go to ${t.label}`)
                    ? formatCombo(navShortcuts.find((s) => s.description === `Go to ${t.label}`)!.combo)
                    : ''}
                </CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Bot Actions">
          <CommandItem value="bot start" onSelect={() => runBotAction('start')}>
            <Play className="h-4 w-4 text-bull" />
            <span>Start Bot</span>
          </CommandItem>
          <CommandItem value="bot stop" onSelect={() => runBotAction('stop')}>
            <Square className="h-4 w-4 text-warn" />
            <span>Stop Bot</span>
          </CommandItem>
          <CommandItem value="bot kill" onSelect={() => { setKillSwitchOpen(true); setOpen(false); }}>
            <Octagon className="h-4 w-4 text-bear" />
            <span>Kill Switch (emergency close all)</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Display">
          <CommandItem value="theme toggle" onSelect={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span>Toggle Theme ({theme === 'dark' ? '→ Light' : '→ Dark'})</span>
          </CommandItem>
          <CommandItem value="density toggle" onSelect={toggleDensity}>
            <LayoutDashboard className="h-4 w-4" />
            <span>Cycle Density ({density} → next)</span>
          </CommandItem>
        </CommandGroup>

        {registered.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="All Registered Shortcuts">
              {registered
                .filter((s) => !['mod+k', '?', 'Escape'].includes(s.combo))
                .map((s, idx) => (
                  <CommandItem
                    key={`${s.combo}-${idx}`}
                    value={`shortcut ${s.description} ${s.combo}`}
                    onSelect={() => {
                      s.handler(new KeyboardEvent('keydown'));
                      setOpen(false);
                    }}
                  >
                    <Keyboard className="h-4 w-4 text-muted-foreground" />
                    <span>{s.description}</span>
                    <CommandShortcut>{formatCombo(s.combo)}</CommandShortcut>
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Help">
          <CommandItem
            value="help shortcuts"
            onSelect={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent('scalping-v2:shortcuts-help'));
            }}
          >
            <Keyboard className="h-4 w-4" />
            <span>Show all keyboard shortcuts</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** Format "mod+k" → "⌘K" (mac) / "Ctrl+K" (other). "g d" → "G then D". */
export function formatCombo(combo: string): string {
  const isMac =
    typeof navigator !== 'undefined' &&
    (/Mac|iPhone|iPad/.test(navigator.userAgent) ||
      /Mac|iPhone|iPad/.test(navigator.platform || ''));
  const parts = combo.trim().split(/\s+/);
  if (parts.length === 2) {
    return `${formatKey(parts[0], isMac)} then ${formatKey(parts[1], isMac)}`;
  }
  return parts.map((p) => formatKey(p, isMac)).join(isMac ? '' : '+');
}

function formatKey(key: string, isMac: boolean): string {
  if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
  if (key === 'shift') return isMac ? '⇧' : 'Shift';
  if (key === 'alt' || key === 'option') return isMac ? '⌥' : 'Alt';
  if (key === 'cmd' || key === 'meta') return '⌘';
  if (key === 'ctrl' || key === 'control') return isMac ? '⌃' : 'Ctrl';
  if (key.length === 1) return key.toUpperCase();
  return key;
}
