'use client';

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
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { DEMO_MODE } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chart', label: 'Chart & Indikator', icon: CandlestickChart },
  { id: 'signals', label: 'Sinyal V2', icon: Zap },
  { id: 'positions', label: 'Posisi & Trade', icon: Briefcase },
  { id: 'journal', label: 'Trade Journal', icon: BookOpen },
  { id: 'ai', label: 'AI Analisa', icon: Bot },
  { id: 'news', label: 'Kalender Ekonomi', icon: CalendarClock },
  { id: 'strategy', label: 'Strategi V2 Ref', icon: FileText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
] as const;

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-sidebar text-sidebar-foreground shrink-0">
      <div className="flex flex-col items-center justify-center gap-1 border-b px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold">Scalping V2</span>
            <span className="text-[10px] text-muted-foreground">Finex · MT5</span>
          </div>
        </div>
        {DEMO_MODE && (
          <Badge variant="outline" className="mt-1 text-[9px] px-1.5 py-0 border-warn text-warn">
            DEMO MODE
          </Badge>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scroll-thin py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-primary'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t px-4 py-3 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Strategy V2 · 2026</span>
          <span className="font-mono">v2.0.0</span>
        </div>
        <div className="mt-1">Z.ai · Edisi Scalping</div>
      </div>
    </aside>
  );
}
