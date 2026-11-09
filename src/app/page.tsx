'use client';

import { Sidebar } from '@/components/app/sidebar';
import { Header } from '@/components/app/header';
import { WebSocketProvider } from '@/components/app/ws-provider';
import { DashboardView } from '@/components/app/views/dashboard-view';
import { ChartView } from '@/components/app/views/chart-view';
import { SignalsView } from '@/components/app/views/signals-view';
import { PositionsView } from '@/components/app/views/positions-view';
import { JournalView } from '@/components/app/views/journal-view';
import { AiChatView } from '@/components/app/views/ai-chat-view';
import { NewsView } from '@/components/app/views/news-view';
import { StrategyView } from '@/components/app/views/strategy-view';
import { SettingsView } from '@/components/app/views/settings-view';
import { BacktestView } from '@/components/app/views/backtest-view';
import { AuditLogView } from '@/components/app/views/audit-log-view';
import { StressTestView } from '@/components/app/views/stress-test-view';
import { AnalyticsView } from '@/components/app/views/analytics-view';
import { LoginView } from '@/components/app/login-view';
import { useAppStore } from '@/lib/store';
import { initAuthBridge, useMounted, useAuth } from '@/lib/auth';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const mounted = useMounted();
  // Derive authed state directly from the auth hook + mounted flag.
  // No useEffect/setState needed — when `mounted` is true we trust the
  // store; before mount we show a placeholder to avoid hydration mismatch.
  const authed: boolean | null = !mounted ? null : isAuthenticated;

  if (authed === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading Scalping V2…</div>
      </div>
    );
  }

  if (!authed) {
    // The login view calls `login()` / `demoLogin()` which writes to the
    // Zustand store; useAuth() re-renders AuthGate automatically.
    return <LoginView />;
  }

  return <>{children}</>;
}

export default function Home() {
  const activeView = useAppStore((s) => s.activeView);
  // Wire the auth bridge so the api.ts module can attach Bearer headers
  // from the very first fetch this component triggers.
  initAuthBridge();

  return (
    <AuthGate>
      <WebSocketProvider>
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
              {activeView === 'backtest' && <BacktestView />}
              {activeView === 'stress-test' && <StressTestView />}
              {activeView === 'analytics' && <AnalyticsView />}
              {activeView === 'audit' && <AuditLogView />}
              {activeView === 'ai' && <AiChatView />}
              {activeView === 'news' && <NewsView />}
              {activeView === 'strategy' && <StrategyView />}
              {activeView === 'settings' && <SettingsView />}
            </main>
          </div>
        </div>
      </WebSocketProvider>
    </AuthGate>
  );
}
