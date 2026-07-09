import type { ReactNode } from 'react';

// Generic compact list view — the standardized third view (alongside card/gallery + kanban) any
// tool can offer. One row per item; the tool supplies the row content, this supplies the
// consistent divider/hover/click chrome.
export function ListView<T>({ items, renderRow, keyFor, onOpen }: { items: T[]; renderRow: (item: T) => ReactNode; keyFor: (item: T) => string; onOpen?: (item: T) => void }) {
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: 'var(--color-border)' }}>
      {items.map((item) => (
        <div
          key={keyFor(item)}
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={onOpen ? () => onOpen(item) : undefined}
          className="flex items-center gap-3 px-4 py-2.5 transition-colors"
          style={{ borderColor: 'var(--color-border)', cursor: onOpen ? 'pointer' : 'default' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--color-surface)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
        >
          {renderRow(item)}
        </div>
      ))}
    </div>
  );
}
