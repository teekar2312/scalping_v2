'use client';

import { useEffect, useState } from 'react';
import { wsClient } from '@/lib/api';
import type { WSEvent, WSEventType } from '@/lib/types';

export interface UseWebSocketResult {
  /** True when the underlying socket is in OPEN state. */
  connected: boolean;
  /** True while attempting to (re)connect. */
  connecting: boolean;
  /** Last event received (any type), useful for debugging. */
  lastEvent: WSEvent | null;
  /** Force a reconnect attempt. */
  reconnect: () => void;
}

/**
 * Subscribe a component to WebSocket connection-state changes.
 *
 * For event-specific subscriptions, prefer `wsClient.subscribe(type, cb)` in
 * an effect. This hook only tracks connection state and the last received
 * event (for surfacing in a debug pill).
 */
export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);

  useEffect(() => {
    const unsubState = wsClient.onStateChange((s) => {
      setConnected(s === 'connected');
      setConnecting(s === 'connecting' || s === 'reconnecting');
    });
    const unsubEvents = wsClient.subscribe('*', (event: WSEvent) => {
      setLastEvent(event);
    });

    // Ensure the client is connected (no-op if already open or in demo mode)
    wsClient.enableAutoReconnect();
    wsClient.connect();

    return () => {
      unsubState();
      unsubEvents();
    };
  }, []);

  return {
    connected,
    connecting,
    lastEvent,
    reconnect: () => {
      wsClient.enableAutoReconnect();
      wsClient.connect();
    },
  };
}

/** Subscribe to a specific WebSocket event type with a strongly-typed callback. */
export function useWSSubscription<T = unknown>(
  eventType: WSEventType,
  callback: (event: WSEvent<T>) => void,
): void {
  useEffect(() => {
    const unsub = wsClient.subscribe<T>(eventType, callback);
    return unsub;
  }, [eventType]);
}
