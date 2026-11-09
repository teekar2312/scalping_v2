'use client';

import { useEffect } from 'react';
import { wsClient } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/hooks/use-toast';
import type {
  WSEvent,
  WSEventType,
  TickPrice,
  Trade,
  Signal,
  BotState,
} from '@/lib/types';

/**
 * WebSocketProvider
 *
 * Mounts once at the root of the authenticated app. It opens the WebSocket
 * connection (or skips in demo mode) and wires every incoming event into the
 * Zustand store. Critical events (kill switch / cooldown / margin warning)
 * also surface a toast so the operator notices them immediately.
 */
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const updateLivePrice = useAppStore((s) => s.updateLivePrice);
  const onTradeUpdate = useAppStore((s) => s.onTradeUpdate);
  const onPositionClosed = useAppStore((s) => s.onPositionClosed);
  const onSignalUpdate = useAppStore((s) => s.onSignalUpdate);
  const setCooldown = useAppStore((s) => s.setCooldown);
  const bumpAuditLog = useAppStore((s) => s.bumpAuditLog);
  const setMarginWarning = useAppStore((s) => s.setMarginWarning);
  const setWsState = useAppStore((s) => s.setWsState);
  const resetRealtime = useAppStore((s) => s.resetRealtime);

  useEffect(() => {
    // Subscribe to connection-state changes and mirror into the store.
    const unsubState = wsClient.onStateChange((s) => {
      setWsState(s === 'connected', s === 'connecting' || s === 'reconnecting');
      if (s === 'disconnected') {
        // Lightweight: keep state but mark as offline. Don't wipe livePrices
        // so the UI doesn't flicker on transient drops.
      }
    });

    // Subscribe to the wildcard event stream so every event bumps the
    // audit-log refresh counter (the AuditLogView re-fetches on change).
    const unsubWildcard = wsClient.subscribe('*', (event: WSEvent) => {
      bumpAuditLog();
      switch (event.type) {
        case 'tick': {
          if (event.symbol && typeof event.bid === 'number' && typeof event.ask === 'number') {
            const price: TickPrice = {
              bid: event.bid,
              ask: event.ask,
              spread: event.spread ?? 0,
              timestamp: event.ts || new Date().toISOString(),
            };
            updateLivePrice(event.symbol, price);
          }
          break;
        }
        case 'status': {
          // Status payload is the engine snapshot; we use it to refresh
          // streak counters and cooldown flags if present.
          const data = event.data as Partial<BotState> & {
            consecutive_losses?: number;
            consecutive_wins?: number;
            cooldown_active?: boolean;
            cooldown_until?: string | null;
            cooldown_reason?: string | null;
            margin_level?: number;
          } | undefined;
          if (data) {
            useAppStore.setState({
              consecutiveLosses: data.consecutive_losses ?? 0,
              consecutiveWins: data.consecutive_wins ?? 0,
            });
            if (typeof data.cooldown_active === 'boolean') {
              setCooldown(
                data.cooldown_active,
                data.cooldown_until ?? null,
                data.cooldown_reason ?? null,
              );
            }
            if (typeof data.margin_level === 'number' && data.margin_level < 200) {
              setMarginWarning(data.margin_level);
            } else {
              setMarginWarning(null);
            }
          }
          break;
        }
        case 'signal': {
          const sig = event.data as Signal | undefined;
          if (sig) onSignalUpdate(sig);
          break;
        }
        case 'order_placed': {
          const trade = event.data as Trade | undefined;
          if (trade) onTradeUpdate(trade);
          toast({
            title: 'Order placed',
            description: `${trade?.direction ?? ''} ${trade?.symbol ?? ''} · vol ${trade?.volume ?? ''}`,
          });
          break;
        }
        case 'position_closed': {
          const data = event.data as { ticket?: number; symbol?: string; profit?: number } | undefined;
          if (data?.ticket) onPositionClosed(data.ticket);
          toast({
            title: 'Position closed',
            description: `${data?.symbol ?? ''} · ticket ${data?.ticket ?? ''} · P&L ${data?.profit ?? ''}`,
          });
          break;
        }
        case 'tp1_hit': {
          toast({
            title: 'TP1 hit',
            description: `Ticket ${event.ticket ?? ''} · ${event.symbol ?? ''} — SL → break-even`,
          });
          break;
        }
        case 'tp2_hit': {
          toast({
            title: 'TP2 hit',
            description: `Ticket ${event.ticket ?? ''} · ${event.symbol ?? ''} — full close`,
          });
          break;
        }
        case 'kill_switch_engaged': {
          toast({
            title: 'KILL SWITCH ENGAGED',
            description: event.reason ?? 'Manual trigger — all positions closed',
            variant: 'destructive',
          });
          useAppStore.setState({ killSwitchOpen: false });
          break;
        }
        case 'risk_gate_blocked': {
          toast({
            title: 'Risk gate blocked entry',
            description: event.reason ?? 'Setup rejected by risk manager',
          });
          break;
        }
        case 'cooldown_engaged': {
          setCooldown(true, event.until ?? null, event.reason ?? null);
          toast({
            title: 'Cooldown engaged',
            description: `${event.reason ?? 'Recovery window'} until ${
              event.until ? new Date(event.until).toLocaleTimeString('id-ID') : '—'
            }`,
          });
          break;
        }
        case 'margin_warning': {
          setMarginWarning(event.level ?? null);
          toast({
            title: 'Margin warning',
            description: `Margin level: ${event.level ?? 'low'}% — reduce exposure`,
            variant: 'destructive',
          });
          break;
        }
        default:
          // Other events (pong) are ignored here.
          break;
      }
    });

    // Kick off the connection (no-op in demo mode).
    wsClient.enableAutoReconnect();
    wsClient.connect();

    return () => {
      unsubState();
      unsubWildcard();
      // We intentionally do NOT disconnect on unmount of the provider so
      // hot-reloads during dev don't churn the socket. The browser closes
      // the socket on page unload anyway.
    };
  }, [
    bumpAuditLog,
    onPositionClosed,
    onSignalUpdate,
    onTradeUpdate,
    resetRealtime,
    setCooldown,
    setMarginWarning,
    setWsState,
    updateLivePrice,
  ]);

  return <>{children}</>;
}
