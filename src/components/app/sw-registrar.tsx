'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegistrar
 *
 * Mounts once at the root of the app (server-component layout can't register
 * the SW directly). Registers `/sw.js`, handles controller updates, and
 * surfaces a toast when a new version is ready so the operator can refresh.
 *
 * In demo mode (Next.js sandbox) registration still succeeds — `sw.js` is in
 * `public/` and is served at the origin root regardless of backend mode.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Only register on http(s) origins — never on file:// or unsupported schemes.
    if (!window.location.protocol.startsWith('http')) return;

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'all',
        });
        // Listen for updates.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // New version ready — skipWaiting so the next reload uses it.
              installing.postMessage('SKIP_WAITING');
            }
          });
        });
      } catch {
        // Silent fail — PWA features degrade gracefully.
      }
    };

    register();

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
