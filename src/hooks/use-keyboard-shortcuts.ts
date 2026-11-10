'use client';

import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
  /** Combo, e.g. "mod+k" or "g d". `mod` = Cmd on macOS, Ctrl elsewhere. */
  combo: string;
  description: string;
  /** Group label for help dialog. */
  group: 'Navigation' | 'Actions' | 'Bot' | 'Theme' | 'Help' | 'Custom';
  /** Invoked when combo matches. Receives the original KeyboardEvent. */
  handler: (event: KeyboardEvent) => void;
  /** When true, prevent default browser behaviour even if handler is async. */
  preventDefault?: boolean;
  /** When true, do not call event.stopPropagation(). */
  allowPropagation?: boolean;
}

export interface ShortcutRegistration {
  id: number;
  shortcut: KeyboardShortcut;
}

const SHORTCUTS_KEY = 'scalping-v2-shortcuts';
const RECENT_KEY = 'scalping-v2-shortcut-history';

let nextId = 1;

interface ShortcutStore {
  subscriptions: Map<number, KeyboardShortcut>;
}

const store: ShortcutStore = {
  subscriptions: new Map<number, KeyboardShortcut>(),
};

const comboListeners = new Set<() => void>();

function emitChange() {
  comboListeners.forEach((l) => l());
}

/** Parse "mod+k" / "g d" into a comparison key. */
function normalizeCombo(combo: string): string {
  return combo
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => {
      if (part === 'mod') return 'mod';
      if (part === 'shift') return 'shift';
      if (part === 'alt' || part === 'option' || part === 'opt') return 'alt';
      if (part === 'ctrl' || part === 'control') return 'ctrl';
      if (part === 'cmd' || part === 'meta' || part === 'command') return 'cmd';
      return part;
    })
    .join(' ');
}

function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  const isMac =
    typeof navigator !== 'undefined' &&
    (/Mac|iPhone|iPad/.test(navigator.userAgent) ||
      /Mac|iPhone|iPad/.test(navigator.platform || ''));
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  if (!isMac && e.metaKey) parts.push('cmd');
  const key = e.key.toLowerCase();
  // Skip pure modifier keys on their own.
  if (['shift', 'alt', 'control', 'ctrl', 'meta', 'cmd'].includes(key)) return parts.join(' ');
  parts.push(key);
  return parts.join(' ');
}

/**
 * Two-phase combos like "g d": we track the first key with a short timeout
 * and only fire when the second key matches. Single-key combos match
 * immediately.
 */
const sequenceState: { first: string | null; timer: ReturnType<typeof setTimeout> | null } = {
  first: null,
  timer: null,
};

function matchEventToShortcuts(e: KeyboardEvent): KeyboardShortcut | null {
  const current = eventToCombo(e);
  // Find single-key / single-combo matches first.
  for (const s of store.subscriptions.values()) {
    const parts = s.combo.trim().split(/\s+/);
    if (parts.length === 1 && normalizeCombo(s.combo) === current) {
      return s;
    }
  }
  // Sequence combos (g d, g c, ...)
  const sequenceCombos = Array.from(store.subscriptions.values()).filter(
    (s) => s.combo.trim().split(/\s+/).length === 2
  );
  if (sequenceCombos.length === 0) return null;

  if (sequenceState.first === null) {
    const firstKey = current.split(' ').pop() ?? '';
    const matchingFirst = sequenceCombos.some((s) => {
      const parts = s.combo.trim().split(/\s+/);
      return normalizeCombo(parts[0]) === current || parts[0] === firstKey;
    });
    if (matchingFirst) {
      sequenceState.first = current;
      if (sequenceState.timer) clearTimeout(sequenceState.timer);
      sequenceState.timer = setTimeout(() => {
        sequenceState.first = null;
      }, 700);
    }
    return null;
  }
  // Second key — check sequence.
  const matchingSecond = sequenceCombos.find((s) => {
    const parts = s.combo.trim().split(/\s+/);
    const firstNorm = normalizeCombo(parts[0]);
    const secondNorm = normalizeCombo(parts[1]);
    return sequenceState.first === firstNorm && current === secondNorm;
  });
  if (matchingSecond) {
    sequenceState.first = null;
    if (sequenceState.timer) clearTimeout(sequenceState.timer);
    return matchingSecond;
  }
  return null;
}

function handleKeyDown(e: KeyboardEvent) {
  // Ignore when typing in input / textarea / contenteditable (unless combo is mod+...)
  const target = e.target as HTMLElement | null;
  const isTypingTarget =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable);
  const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
  if (isTypingTarget && !hasModifier) {
    // Allow Esc inside inputs to blur.
    if (e.key === 'Escape') {
      (target as HTMLElement).blur();
    }
    return;
  }

  const match = matchEventToShortcuts(e);
  if (!match) return;
  if (match.preventDefault !== false) e.preventDefault();
  if (match.allowPropagation !== true) e.stopPropagation();
  match.handler(e);

  // Record in recent history.
  recordRecent(match.combo);
}

const RECENT_MAX = 8;
function recordRecent(combo: string) {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const filtered = list.filter((c) => c !== combo);
    filtered.unshift(combo);
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

export function getRecentShortcuts(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * useKeyboardShortcuts hook — registers/unregisters a set of shortcuts.
 * Pass an array of `KeyboardShortcut` objects; they auto-update on change.
 *
 * Returns `{ registerShortcut, unregisterShortcut }` so components can add
 * runtime shortcuts outside the initial list.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[] = []) {
  const idsRef = useRef<number[]>([]);
  // Store shortcuts in a ref so we can compare content without re-running effect
  const shortcutsRef = useRef<KeyboardShortcut[]>(shortcuts);
  const prevSigRef = useRef<string>('');

  const registerShortcut = useCallback((s: KeyboardShortcut): (() => void) => {
    const id = nextId++;
    store.subscriptions.set(id, s);
    idsRef.current.push(id);
    emitChange();
    return () => {
      store.subscriptions.delete(id);
      emitChange();
    };
  }, []);

  const unregisterShortcut = useCallback((id: number) => {
    store.subscriptions.delete(id);
    emitChange();
  }, []);

  // Update ref on every render so effect can read latest
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    // Only re-register if the actual content changed (not just array identity)
    const sig = JSON.stringify(shortcuts.map((s) => ({ combo: s.combo, description: s.description, group: s.group })));
    if (sig === prevSigRef.current) return;
    prevSigRef.current = sig;

    // Clean up old registrations
    for (const id of idsRef.current) {
      store.subscriptions.delete(id);
    }
    // Register new shortcuts
    const newIds: number[] = [];
    for (const s of shortcuts) {
      const id = nextId++;
      store.subscriptions.set(id, s);
      newIds.push(id);
    }
    idsRef.current = newIds;
    emitChange();
    return () => {
      for (const id of newIds) {
        store.subscriptions.delete(id);
      }
    };
  }, [shortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return { registerShortcut, unregisterShortcut };
}

/** Subscribe to shortcut registry changes (for command palette live listing). */
export function subscribeShortcuts(listener: () => void): () => void {
  comboListeners.add(listener);
  return () => comboListeners.delete(listener);
}

/** Return all currently-registered shortcuts (snapshot). */
export function listRegisteredShortcuts(): KeyboardShortcut[] {
  return Array.from(store.subscriptions.values());
}

export { SHORTCUTS_KEY };
