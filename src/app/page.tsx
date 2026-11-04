'use client';

import { Sidebar } from '@/components/app/sidebar';
import { Header } from '@/components/app/header';
import { DashboardView } from '@/components/app/views/dashboard-view';
import { ChartView } from '@/components/app/views/chart-view';
import { SignalsView } from '@/components/app/views/signals-view';
import { PositionsView } from '@/components/app/views/positions-view';
import { JournalView } from '@/components/app/views/journal-view';
import { AiChatView } from '@/components/app/views/ai-chat-view';
import { NewsView } from '@/components/app/views/news-view';
import { StrategyView } from '@/components/app/views/strategy-view';
import { SettingsView } from '@/components/app/views/settings-view';
import { useAppStore } from '@/lib/store';

export default function Home() {
  const activeView = useAppStore((s) => s.activeView);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto scroll-thin">
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'chart' && <ChartView />}
          {activeView === 'signals' && <SignalsView />}
          {activeView === 'positions' && <PositionsView />}
          {activeView === 'journal' && <JournalView />}
          {activeView === 'ai' && <AiChatView />}
          {activeView === 'news' && <NewsView />}
          {activeView === 'strategy' && <StrategyView />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}
