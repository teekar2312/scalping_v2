'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { formatCombo } from './command-palette';
import {
  listRegisteredShortcuts,
  subscribeShortcuts,
  type KeyboardShortcut,
} from '@/hooks/use-keyboard-shortcuts';
import { cn } from '@/lib/utils';

const GROUP_ORDER: KeyboardShortcut['group'][] = [
  'Navigation',
  'Actions',
  'Bot',
  'Theme',
  'Help',
  'Custom',
];

const GROUP_DESCRIPTIONS: Record<KeyboardShortcut['group'], string> = {
  Navigation: 'Jump to a specific view in the app.',
  Actions: 'Trigger common bot / trade / alert actions.',
  Bot: 'Start, stop, or kill the trading engine.',
  Theme: 'Toggle dark/light mode and density.',
  Help: 'Palette and help dialog shortcuts.',
  Custom: 'Shortcuts registered by mounted views.',
};

/**
 * ShortcutsHelp
 *
 * Modal that lists every keyboard shortcut currently registered. Listens to
 * a `scalping-v2:shortcuts-help` CustomEvent so the `?` key (registered in
 * CommandPalette) and the help command can both open it without prop-drilling.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>([]);

  useEffect(() => {
    const refresh = () => setShortcuts(listRegisteredShortcuts());
    refresh();
    const unsub = subscribeShortcuts(refresh);
    const onEvent = () => setOpen(true);
    window.addEventListener('scalping-v2:shortcuts-help', onEvent);
    return () => {
      unsub();
      window.removeEventListener('scalping-v2:shortcuts-help', onEvent);
    };
  }, []);

  // Group by group label.
  const grouped: Record<KeyboardShortcut['group'], KeyboardShortcut[]> = {
    Navigation: [],
    Actions: [],
    Bot: [],
    Theme: [],
    Help: [],
    Custom: [],
  };
  for (const s of shortcuts) {
    grouped[s.group].push(s);
  }

  // De-dup by combo (keep first occurrence).
  const seen = new Set<string>();
  for (const g of GROUP_ORDER) {
    grouped[g] = grouped[g].filter((s) => {
      if (seen.has(s.combo)) return false;
      seen.add(s.combo);
      return true;
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            All shortcuts currently registered. Type the combo anywhere outside an input field
            to fire the action.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="flex flex-col gap-4">
            {GROUP_ORDER.map((g) => {
              const items = grouped[g];
              if (items.length === 0) return null;
              return (
                <section key={g} className="rounded-md border">
                  <div className="border-b bg-muted/40 px-3 py-2">
                    <div className="text-xs font-semibold">{g}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {GROUP_DESCRIPTIONS[g]}
                    </div>
                  </div>
                  <div className="divide-y">
                    {items.map((s, idx) => (
                      <div
                        key={`${s.combo}-${idx}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                      >
                        <span className="flex-1 truncate">{s.description}</span>
                        <kbd
                          className={cn(
                            'rounded border bg-muted px-2 py-1 font-mono text-[10px] tabular-nums'
                          )}
                        >
                          {formatCombo(s.combo)}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            <div className="rounded-md border border-info/30 bg-info/5 p-3 text-[11px]">
              <Badge variant="outline" className="text-[10px] mb-1 text-info border-info">
                TIP
              </Badge>
              <div className="text-muted-foreground">
                Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd> /
                <kbd className="ml-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Ctrl+K</kbd>
                {' '}anywhere to open the command palette. Sequence shortcuts (e.g.
                {' '}<kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">g d</kbd>)
                {' '}require the two keys pressed within 700ms.
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
