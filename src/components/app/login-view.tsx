'use client';

import { useState } from 'react';
import { TrendingUp, Lock, User, Loader2, ShieldAlert, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { demoLogin, login } from '@/lib/auth';
import { DEMO_MODE } from '@/lib/api';
import { cn } from '@/lib/utils';

interface LoginViewProps {
  onAuthenticated?: () => void;
}

/**
 * LoginView — Sprint 5 auth entry point.
 *
 * - In demo mode (no NEXT_PUBLIC_PYTHON_API_URL) the user can skip the form
 *   entirely via the "Enter demo mode" button (auto-authenticated with a
 *   synthetic demo key that lives only in memory).
 * - In production a real username + password form calls POST /api/auth/login.
 */
export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<'login' | 'demo' | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast({ title: 'Username & password wajib diisi', variant: 'destructive' });
      return;
    }
    setLoading('login');
    try {
      const user = await login(username, password);
      toast({
        title: `Welcome, ${user.username}`,
        description: `Role: ${user.role} · Bearer token disimpan di memory (not localStorage)`,
      });
      onAuthenticated?.();
    } catch (err) {
      toast({
        title: 'Login gagal',
        description: String(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(null);
    }
  };

  const handleDemo = () => {
    setLoading('demo');
    demoLogin();
    toast({
      title: 'Demo mode aktif',
      description: 'Auto-authenticated with demo token. API key lives in memory only.',
    });
    setLoading(null);
    onAuthenticated?.();
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Scalping V2 Trading System</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Finex Indonesia · MT5 · Ollama llama3.2 · Tiingo
          </p>
          <div className="mt-2 flex items-center gap-2">
            {DEMO_MODE ? (
              <Badge variant="outline" className="border-warn text-warn text-[10px]">
                DEMO MODE
              </Badge>
            ) : (
              <Badge variant="outline" className="border-bull text-bull text-[10px]">
                LIVE BACKEND
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              v2.0.0
            </Badge>
          </div>
        </div>

        {/* Login card */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs flex items-center gap-1">
                <User className="h-3 w-3" />
                Username
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                className={cn(loading === 'login' && 'opacity-60')}
                disabled={loading !== null}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-10"
                  disabled={loading !== null}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full gap-1.5"
              disabled={loading !== null}
            >
              {loading === 'login' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {loading === 'login' ? 'Authenticating…' : 'Sign In'}
            </Button>
          </form>

          {DEMO_MODE && (
            <div className="mt-4 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleDemo}
                disabled={loading !== null}
              >
                {loading === 'demo' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                Enter Demo Mode (skip login)
              </Button>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Demo mode auto-authenticates with a synthetic token. All data is mocked.
              </p>
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="mt-4 rounded-md border border-info/30 bg-info/5 p-3 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2">
            <Lock className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />
            <div>
              <strong className="text-info">Security:</strong> API key disimpan di memory
              (Zustand) saja — tidak ke <code>localStorage</code>. Setiap request
              otomatis menyertakan header <code>Authorization: Bearer &lt;apiKey&gt;</code>{' '}
              dan WebSocket menambahkan <code>?token=&lt;apiKey&gt;</code> pada URL.
              401 response memicu auto-logout.
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[10px] text-muted-foreground">
          Strategi Scalping V2 · BAPPEBTI Registered · © 2026
        </div>
      </div>
    </div>
  );
}
