'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Eye,
  EyeOff,
  RotateCcw,
  Layout,
  Save,
  Settings2,
} from 'lucide-react';
import { PanelCard } from './shared';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

export interface WidgetConfig {
  id: string;
  /** Stable label for the customize UI. */
  label: string;
  visible: boolean;
  /** Sort order — 0 = first. */
  order: number;
  /** When true, this widget cannot be hidden (e.g. account stat row). */
  locked?: boolean;
}

export type WidgetId =
  | 'account-stats'
  | 'equity-curve'
  | 'risk-metrics'
  | 'system-status'
  | 'risk-tier-tracker'
  | 'streak-cooldown'
  | 'pair-monitor'
  | 'open-positions'
  | 'active-signals'
  | 'session-timeline'
  | 'news-mini';

export type LayoutPresetId = 'default' | 'trader-pro' | 'risk-focus' | 'minimal';

const STORAGE_KEY = 'dashboard-layout';

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'account-stats', label: 'Account Stats (top row)', visible: true, order: 0, locked: true },
  { id: 'equity-curve', label: 'Equity Curve (24h)', visible: true, order: 1 },
  { id: 'risk-metrics', label: 'VaR / CVaR Risk Metrics', visible: true, order: 2 },
  { id: 'system-status', label: 'System Status + Bot Control', visible: true, order: 3 },
  { id: 'risk-tier-tracker', label: 'Tiered Stop Tracker', visible: true, order: 4 },
  { id: 'streak-cooldown', label: 'Streak & Cooldown', visible: true, order: 5 },
  { id: 'pair-monitor', label: 'Pair Monitor + News HIGH', visible: true, order: 6 },
  { id: 'open-positions', label: 'Open Positions', visible: true, order: 7 },
  { id: 'active-signals', label: 'Active Signals V2', visible: true, order: 8 },
  { id: 'session-timeline', label: 'Session Timeline', visible: true, order: 9 },
  { id: 'news-calendar', label: 'News Calendar Mini', visible: true, order: 10 },
  { id: 'risk-disclosure', label: 'Risk Disclosure Banner', visible: true, order: 11 },
];

const PRESETS: Record<LayoutPresetId, { label: string; description: string; visible: string[] }> = {
  default: {
    label: 'Default',
    description: 'Semua widget tampil — full overview.',
    visible: DEFAULT_WIDGETS.map((w) => w.id),
  },
  'trader-pro': {
    label: 'Trader Pro',
    description: 'Fokus eksekusi: positions, signals, pair monitor, session.',
    visible: [
      'account-stats',
      'equity-curve',
      'pair-monitor',
      'open-positions',
      'active-signals',
      'session-timeline',
    ],
  },
  'risk-focus': {
    label: 'Risk Focus',
    description: 'Fokus risiko: VaR, tiered stop, streak, system status.',
    visible: [
      'account-stats',
      'risk-metrics',
      'risk-tier-tracker',
      'streak-cooldown',
      'system-status',
      'equity-curve',
    ],
  },
  minimal: {
    label: 'Minimal',
    description: 'Hanya essential: account + equity + system status.',
    visible: ['account-stats', 'equity-curve', 'system-status', 'risk-disclosure'],
  },
};

interface DashboardLayoutContextValue {
  widgets: WidgetConfig[];
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  reorder: (activeId: string, overId: string) => void;
  toggleVisible: (id: string) => void;
  applyPreset: (preset: LayoutPresetId) => void;
  resetToDefault: () => void;
}

const DashboardLayoutContext = createContext<DashboardLayoutContextValue | null>(null);

export function useDashboardLayout(): DashboardLayoutContextValue {
  const ctx = useContext(DashboardLayoutContext);
  if (!ctx) {
    throw new Error('useDashboardLayout must be used inside <DashboardLayoutProvider>');
  }
  return ctx;
}

function loadFromStorage(): WidgetConfig[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WidgetConfig[];
    if (!Array.isArray(parsed)) return null;
    // Reconcile with DEFAULT_WIDGETS so new widget IDs default to visible.
    const known = new Map(DEFAULT_WIDGETS.map((w) => [w.id, w]));
    const merged = parsed.map((w) => {
      const def = known.get(w.id);
      if (!def) return null;
      known.delete(w.id);
      return { ...def, ...w } as WidgetConfig;
    }).filter((x): x is WidgetConfig => x !== null);
    // Append any newly-added widgets (not yet persisted).
    for (const def of known.values()) {
      merged.push({ ...def });
    }
    // Sort by order.
    merged.sort((a, b) => a.order - b.order);
    return merged;
  } catch {
    return null;
  }
}

function persist(widgets: WidgetConfig[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch {
    // ignore
  }
}

export function DashboardLayoutProvider({ children }: { children: ReactNode }) {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    // Defer the setState to a microtask so React doesn't flag the
    // synchronous call inside the effect body (cascading-render guard).
    Promise.resolve().then(() => {
      const loaded = loadFromStorage();
      if (loaded) setWidgets(loaded);
    });
  }, []);

  const reorder = useCallback((activeId: string, overId: string) => {
    setWidgets((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const oldIndex = sorted.findIndex((w) => w.id === activeId);
      const newIndex = sorted.findIndex((w) => w.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
      const next = arrayMove(sorted, oldIndex, newIndex);
      // Re-assign order.
      next.forEach((w, idx) => {
        w.order = idx;
      });
      persist(next);
      return [...next];
    });
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setWidgets((prev) => {
      const next = prev.map((w) =>
        w.id === id && !w.locked ? { ...w, visible: !w.visible } : w
      );
      persist(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: LayoutPresetId) => {
    setWidgets((prev) => {
      const visibleSet = new Set(PRESETS[preset].visible);
      const next = prev.map((w) => ({
        ...w,
        visible: visibleSet.has(w.id) || w.locked === true,
      }));
      persist(next);
      return next;
    });
    toast({ title: `Preset applied: ${PRESETS[preset].label}` });
  }, []);

  const resetToDefault = useCallback(() => {
    const fresh = DEFAULT_WIDGETS.map((w) => ({ ...w }));
    setWidgets(fresh);
    persist(fresh);
    toast({ title: 'Dashboard layout reset to default' });
  }, []);

  const value = useMemo<DashboardLayoutContextValue>(
    () => ({
      widgets,
      editMode,
      setEditMode,
      reorder,
      toggleVisible,
      applyPreset,
      resetToDefault,
    }),
    [widgets, editMode, reorder, toggleVisible, applyPreset, resetToDefault]
  );

  return (
    <DashboardLayoutContext.Provider value={value}>{children}</DashboardLayoutContext.Provider>
  );
}

/** Visible-and-ordered widgets (the consumer uses this to render). */
export function useVisibleWidgets(): WidgetConfig[] {
  const { widgets } = useDashboardLayout();
  return useMemo(
    () => widgets.filter((w) => w.visible).sort((a, b) => a.order - b.order),
    [widgets]
  );
}

// --------------------------------------------------------------------------- //
// SortableWidget + customization toolbar
// --------------------------------------------------------------------------- //

interface SortableWidgetProps {
  widget: WidgetConfig;
  children: ReactNode;
  className?: string;
}

export function SortableWidget({ widget, children, className }: SortableWidgetProps) {
  const { editMode } = useDashboardLayout();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (!editMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div ref={setNodeRef} style={style} className={cn('relative', className)}>
      {/* Drag handle overlay */}
      <div className="absolute -top-2 left-3 z-10 flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 shadow-sm">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label={`Drag ${widget.label}`}
          title="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] font-medium">{widget.label}</span>
        {widget.locked && (
          <Badge variant="outline" className="text-[8px] px-1 py-0">
            locked
          </Badge>
        )}
      </div>
      <div className="rounded-md border-2 border-dashed border-primary/40 p-1">
        {children}
      </div>
    </div>
  );
}

/** Renders the customize toolbar (preset selector + reset + done button). */
export function DashboardCustomizeToolbar() {
  const ctx = useDashboardLayout();
  const { editMode, setEditMode, widgets, toggleVisible, applyPreset, resetToDefault, reorder } = ctx;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  if (!editMode) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1"
        onClick={() => setEditMode(true)}
      >
        <Settings2 className="h-3 w-3" />
        Customize
      </Button>
    );
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorder(String(active.id), String(over.id));
  };

  return (
    <CustomizeToolbarInner
      sensors={sensors}
      onDragEnd={onDragEnd}
      widgets={widgets}
      toggleVisible={toggleVisible}
      applyPreset={applyPreset}
      resetToDefault={resetToDefault}
      setEditMode={setEditMode}
    />
  );
}

// Wrap the inner toolbar with DndContext so drag events work even when
// the parent doesn't wrap the dashboard body.
function CustomizeToolbarInner({
  sensors,
  onDragEnd,
  widgets,
  toggleVisible,
  applyPreset,
  resetToDefault,
  setEditMode,
}: {
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (e: DragEndEvent) => void;
  widgets: WidgetConfig[];
  toggleVisible: (id: string) => void;
  applyPreset: (preset: LayoutPresetId) => void;
  resetToDefault: () => void;
  setEditMode: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layout className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Customize Dashboard</span>
          <Badge variant="outline" className="text-[10px]">Drag to reorder</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={resetToDefault}>
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs gap-1"
            onClick={() => setEditMode(false)}
          >
            <Save className="h-3 w-3" />
            Done
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Preset:</span>
        {(Object.keys(PRESETS) as LayoutPresetId[]).map((presetId) => (
          <button
            key={presetId}
            onClick={() => applyPreset(presetId)}
            title={PRESETS[presetId].description}
            className={cn(
              'rounded-md border px-2 py-1 text-[10px] transition-colors hover:bg-accent'
            )}
          >
            {PRESETS[presetId].label}
          </button>
        ))}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={widgets.sort((a, b) => a.order - b.order).map((w) => w.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
            {widgets
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((w) => (
                <SortableWidgetItem
                  key={w.id}
                  widget={w}
                  toggleVisible={toggleVisible}
                />
              ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableWidgetItem({
  widget,
  toggleVisible,
}: {
  widget: WidgetConfig;
  toggleVisible: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background px-2 py-1.5',
        widget.visible ? '' : 'opacity-60'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground"
        aria-label="Drag"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <span className="flex-1 text-[11px] truncate" title={widget.label}>
        {widget.label}
      </span>
      <Switch
        checked={widget.visible}
        disabled={widget.locked}
        onCheckedChange={() => toggleVisible(widget.id)}
        className="scale-75"
      />
      {widget.locked ? (
        <Eye className="h-3 w-3 text-muted-foreground" />
      ) : widget.visible ? (
        <Eye className="h-3 w-3 text-bull" />
      ) : (
        <EyeOff className="h-3 w-3 text-muted-foreground" />
      )}
    </div>
  );
}

// Internal reorder that uses context — separated for clarity.
// (The actual reorder is provided by DashboardLayoutContext in the toolbar above.)

// --------------------------------------------------------------------------- //
// DashboardDragContainer — wraps the dashboard body so SortableWidget works.
// Provides a DndContext + SortableContext with all widget IDs as items.
// In non-edit mode drag listeners are disabled (via SortableWidget.disabled),
// so no reordering can occur even though the providers are mounted.
// --------------------------------------------------------------------------- //

export function DashboardDragContainer({ children }: { children: ReactNode }) {
  const { widgets, reorder, editMode } = useDashboardLayout();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const sortedIds = useMemo(
    () =>
      widgets
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((w) => w.id),
    [widgets]
  );

  const onDragEnd = (event: DragEndEvent) => {
    if (!editMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorder(String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// --------------------------------------------------------------------------- //
// WidgetBlock — convenience wrapper for views: looks up widget by id,
// hides if not visible, and applies SortableWidget styling in edit mode.
// --------------------------------------------------------------------------- //

interface WidgetBlockProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function WidgetBlock({ id, children, className }: WidgetBlockProps) {
  const { widgets } = useDashboardLayout();
  const widget = widgets.find((w) => w.id === id);
  if (!widget || !widget.visible) return null;
  return (
    <SortableWidget widget={widget} className={className}>
      {children}
    </SortableWidget>
  );
}

export { PRESETS, DEFAULT_WIDGETS };
