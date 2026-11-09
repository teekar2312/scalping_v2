'use client';

/**
 * Web Push Notifications library
 *
 * Provides three primitives:
 *  - `requestNotificationPermission()` — request browser permission
 *  - `subscribeToPush()` — generate subscription, send to backend (demo: localStorage)
 *  - `showLocalNotification(title, body, options)` — display notification immediately
 *
 * Also exposes `isPushSupported()` and `getPushPermissionState()` for UI gating.
 *
 * In production, the subscription endpoint would POST to `/api/notifications/subscribe`
 * on the Python backend; in demo mode (sandbox) the subscription is persisted to
 * localStorage so the operator can verify the flow.
 */

import type { WSEvent, WSEventType } from './types';

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

const LOCAL_STORAGE_KEY = 'scalping-v2-push-subscription';
const LOCAL_STORAGE_ENABLED = 'scalping-v2-push-enabled';

/** Check if the browser supports the Web Notifications + Push APIs. */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

/** Get the current permission state (default / granted / denied). */
export function getPushPermissionState(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission as NotificationPermissionState;
}

/** Whether the operator has opted-in to local notifications (UI toggle). */
export function isPushEnabledInStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LOCAL_STORAGE_ENABLED) === '1';
  } catch {
    return false;
  }
}

/** Persist the user's opt-in toggle. */
export function setPushEnabledInStorage(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_ENABLED, enabled ? '1' : '0');
  } catch {
    // ignore storage failures
  }
}

/** Request browser permission to display notifications. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isPushSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return 'denied';
  }
}

/** Convert a base64 VAPID public key to Uint8Array (for PushManager.subscribe). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * Subscribe to push notifications.
 * In production this would POST the subscription to the backend; in demo mode
 * the subscription is stored in localStorage and a confirmation notification
 * is shown.
 *
 * @param vapidPublicKey Optional VAPID public key (production). In demo mode
 *   the subscription is still created locally with an empty key set so the
 *   UI flow works end-to-end.
 */
export async function subscribeToPush(vapidPublicKey?: string): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const perm = await requestNotificationPermission();
  if (perm !== 'granted') return null;

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      persistSubscription(existing);
      return existing;
    }

    let subscription: PushSubscription;
    if (vapidPublicKey) {
      const key = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as BufferSource,
      });
    } else {
      // Demo mode: use an empty-key subscription that the local notification
      // path can still trigger. The browser may still surface this as a valid
      // subscription locally.
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
      });
    }

    persistSubscription(subscription);

    // In production we would POST this to the backend:
    //   fetch('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify(subscription) })
    // In demo mode we just persist locally and emit a confirmation.
    await showLocalNotification(
      'Scalping V2 — Push Aktif',
      'Notifikasi kill switch, cooldown, TP/SL, dan margin warning akan dikirim ke perangkat ini.',
      { tag: 'push-enabled', icon: '/icon-192.png' }
    );
    return subscription;
  } catch {
    return null;
  }
}

/** Unsubscribe and clear local storage. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    setPushEnabledInStorage(false);
    return true;
  } catch {
    return false;
  }
}

function persistSubscription(sub: PushSubscription): void {
  if (typeof window === 'undefined') return;
  try {
    const json = JSON.stringify(sub);
    localStorage.setItem(LOCAL_STORAGE_KEY, json);
    setPushEnabledInStorage(true);
  } catch {
    // ignore
  }
}

/** Show a local notification immediately (no server push needed). */
export async function showLocalNotification(
  title: string,
  body: string,
  options: NotificationOptions = {},
): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  if (!isPushEnabledInStorage()) return false;

  try {
    // Prefer Service Worker notifications (so they work when tab is hidden).
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: title,
        ...options,
      });
    } else {
      new Notification(title, { body, icon: '/icon-192.png', ...options });
    }
    return true;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------- //
// WebSocket → notification mapping
// --------------------------------------------------------------------------- //

interface WSEventNotificationSpec {
  title: string;
  body: (event: WSEvent) => string;
  tag: string;
}

const WS_NOTIFICATION_MAP: Record<WSEventType, WSEventNotificationSpec> = {
  kill_switch_engaged: {
    title: '🔴 Kill Switch Activated',
    body: (e) => `All positions closed. Reason: ${e.reason ?? 'manual trigger'}`,
    tag: 'kill-switch',
  },
  hard_stop: {
    title: '🔴 Hard Stop Triggered',
    body: (e) => `Hard stop reached. Reason: ${e.reason ?? 'daily loss limit hit'}`,
    tag: 'hard-stop',
  },
  cooldown_engaged: {
    title: '⚠️ Cooldown Active',
    body: (e) =>
      `Recovery window until ${
        e.until ? new Date(e.until).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : '—'
      } WIB · ${e.reason ?? 'recovery'}`,
    tag: 'cooldown',
  },
  margin_warning: {
    title: '⚠️ Margin Level Low',
    body: (e) => `Margin level: ${e.level ?? 'low'}% — reduce exposure immediately.`,
    tag: 'margin',
  },
  tp1_hit: {
    title: '✅ TP1 Hit',
    body: (e) => `Ticket ${e.ticket ?? ''} · ${e.symbol ?? ''} — SL moved to break-even.`,
    tag: 'tp1',
  },
  tp2_hit: {
    title: '✅ TP2 Hit',
    body: (e) => `Ticket ${e.ticket ?? ''} · ${e.symbol ?? ''} — full close.`,
    tag: 'tp2',
  },
  sl_hit: {
    title: '❌ SL Hit',
    body: (e) => `Ticket ${e.ticket ?? ''} · ${e.symbol ?? ''} — stop loss triggered.`,
    tag: 'sl',
  },
  // Events that don't trigger notifications.
  status: { title: '', body: () => '', tag: '' },
  signal: { title: '', body: () => '', tag: '' },
  order_placed: { title: '', body: () => '', tag: '' },
  position_closed: { title: '', body: () => '', tag: '' },
  risk_gate_blocked: { title: '', body: () => '', tag: '' },
  alert_triggered: { title: '', body: () => '', tag: '' },
  tick: { title: '', body: () => '', tag: '' },
  pong: { title: '', body: () => '', tag: '' },
};

/** Map a WS event to a local notification (skips if not configured). */
export async function notifyOnWSEvent(event: WSEvent): Promise<void> {
  // Special case: hard-stop events on closed positions can also represent SL.
  if (event.type === 'position_closed') {
    const data = event.data as { reason?: string; symbol?: string; ticket?: number } | undefined;
    if (data?.reason === 'SL') {
      const spec = WS_NOTIFICATION_MAP.sl_hit;
      await showLocalNotification(spec.title, spec.body(event), { tag: spec.tag });
      return;
    }
  }
  const spec = WS_NOTIFICATION_MAP[event.type];
  if (!spec || !spec.title) return;
  await showLocalNotification(spec.title, spec.body(event), {
    tag: spec.tag,
    requireInteraction: event.type === 'kill_switch_engaged' || event.type === 'margin_warning',
  });
}
