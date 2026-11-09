// Auth helpers (Sprint 5) — Bearer-token based, no localStorage for the key.
'use client';

import { useSyncExternalStore } from 'react';
import { configureAuthAccessor } from './api';
import { useAppStore } from './store';
import { login as apiLogin, getAuthMe } from './api';
import type { AuthUser } from './types';

let configured = false;

/**
 * Wire the auth accessor so `api.ts` can attach the Bearer header to every
 * fetch and trigger a logout on 401. Safe to call multiple times.
 */
export function initAuthBridge(): void {
  if (configured) return;
  configured = true;
  configureAuthAccessor(
    () => useAppStore.getState().authApiKey,
    () => {
      // 401 from backend → clear session + send user back to login.
      useAppStore.getState().clearAuth();
    },
  );
}

/** Login against POST /api/auth/login and store the API key in memory. */
export async function login(username: string, password: string): Promise<AuthUser> {
  initAuthBridge();
  const res = await apiLogin(username, password);
  useAppStore.getState().setAuth(res.api_key, {
    ...res.user,
    login_at: new Date().toISOString(),
    ip: typeof window !== 'undefined' ? 'client' : undefined,
  });
  return res.user;
}

/** Demo-mode auto-login (used by the login view's "Enter demo mode" button). */
export function demoLogin(): void {
  initAuthBridge();
  const demoKey = `sk_demo_${Math.random().toString(36).slice(2, 12)}_${Math.random()
    .toString(36)
    .slice(2, 24)}`;
  useAppStore.getState().setAuth(demoKey, {
    username: 'demo',
    role: 'admin',
    login_at: new Date().toISOString(),
  });
}

/** Clear the in-memory session (does NOT touch localStorage — nothing was stored there). */
export function logout(): void {
  useAppStore.getState().clearAuth();
}

/** Return the current Bearer token (or null when not authenticated). */
export function getApiKey(): string | null {
  return useAppStore.getState().authApiKey;
}

/** True when an API key is present in the in-memory store. */
export function isAuthenticated(): boolean {
  return useAppStore.getState().isAuthenticated;
}

/**
 * Hydrate the user profile from `/api/auth/me` on app boot. Useful after a
 * page refresh when the key is set (server-side hydration path) or for verifying
 * that the key is still valid. Returns null if the key is missing or rejected.
 */
export async function refreshAuthUser(): Promise<AuthUser | null> {
  initAuthBridge();
  const { authApiKey, setAuth } = useAppStore.getState();
  if (!authApiKey) return null;
  try {
    const me = await getAuthMe();
    setAuth(authApiKey, me.user);
    return me.user;
  } catch {
    useAppStore.getState().clearAuth();
    return null;
  }
}

/**
 * React hook for components that need to react to auth changes. Reads the
 * underlying Zustand store so it triggers re-renders on login/logout.
 *
 * Also eagerly wires the api.ts auth bridge so the very first fetch from any
 * view attaches the Bearer header. The bridge is idempotent.
 */
export function useAuth(): {
  apiKey: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
} {
  const apiKey = useAppStore((s) => s.authApiKey);
  const user = useAppStore((s) => s.authUser);
  const isAuth = useAppStore((s) => s.isAuthenticated);
  // Eagerly wire the bridge. Idempotent so safe on every render.
  initAuthBridge();
  return { apiKey, user, isAuthenticated: isAuth };
}

const emptySubscribe = () => () => {};

/**
 * Tracks whether the component has mounted on the client. Useful when reading
 * localStorage-backed Zustand state (settings, density) so SSR doesn't flash
 * mismatched UI. Uses `useSyncExternalStore` to avoid the
 * `react-hooks/set-state-in-effect` warning.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
