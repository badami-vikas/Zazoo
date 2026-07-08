import type { ReactNode } from 'react';

export interface KanbanLane<T> { key: string; label: string; items: T[] }

// Generic Kanban engine — the standardized board view any tool's "tracker" becomes (JobPilot's
// application pipeline, DealPilot's triage). Lanes + card renderer are the only per-tool inputs;
// the scroll/column chrome is shared so every tool's kanban looks and behaves the same way.
export function KanbanBoard<T>({ lanes, renderCard, keyFor }: { lanes: KanbanLane<T>[]; renderCard: (item: T) => ReactNode; keyFor: (item: T) => string }) {
  return (
    <div className="flex gap-3 overflow-x-auto h-full p-4 items-start">
      {lanes.map((lane) => (
        <div key={lane.key} className="w-64 shrink-0 rounded-xl border flex flex-col max-h-full" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="px-3 py-2.5 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>{lane.label}</span>
            <span className="text-[11px] font-bold px-1.5 rounded-full" style={{ color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>{lane.items.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {lane.items.map((item) => <div key={keyFor(item)}>{renderCard(item)}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}
