import { useState, type ComponentType, type ReactNode } from 'react';
import { Search, Filter, ArrowUpDown, ChevronDown, Check, MoreVertical } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export interface ToolbarView { id: string; label: string; icon: ComponentType<any> }

// The ONE toolbar shape every tool page uses, standardized off IntelligencePage's original
// inline JSX: view dropdown -> search -> filter/sort -> tool-specific custom actions -> 3-dot
// menu. Sits directly under a ListPillRow (the "Lists" row) per the platform-wide tool-page
// layout: title -> Lists -> this toolbar. Never hand-roll a bespoke toolbar in a tool page again.
export function StandardToolbar({
  view, views, onViewChange, search, onSearchChange, onFilterClick, filterCount = 0,
  filterOpen, filterPanel, onSortClick, customActions, moreMenu,
}: {
  view: string;
  views: ToolbarView[];
  onViewChange: (id: string) => void;
  search?: string;
  onSearchChange?: (v: string) => void;
  onFilterClick?: () => void;
  filterCount?: number;
  filterOpen?: boolean;
  filterPanel?: ReactNode; // rendered under the Filter button when filterOpen — for tools with richer filter UI than a plain toggle
  onSortClick?: () => void;
  customActions?: ReactNode;
  moreMenu?: ReactNode;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const activeView = views.find((v) => v.id === view) ?? views[0];
  const ActiveIcon = activeView.icon;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-white shrink-0 shadow-sm z-20 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
      <div className="relative shrink-0">
        <button onClick={() => setViewOpen((o) => !o)} className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
          <ActiveIcon className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
          {activeView.label} <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
        </button>
        {viewOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setViewOpen(false)} />
            <div className="absolute top-full left-0 mt-1 w-40 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white" style={{ borderColor: 'var(--color-border)' }}>
              {views.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => { onViewChange(id); setViewOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium" style={{ backgroundColor: view === id ? 'var(--color-surface)' : 'transparent', color: view === id ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                  <Icon className="w-4 h-4" style={{ color: view === id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} /> {label}
                  {view === id && <Check className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {onSearchChange && (
        <div className="relative shrink min-w-[100px] max-w-[280px] flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
          <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search…" className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm outline-none shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }} />
        </div>
      )}

      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        {onFilterClick && (
          <div className="relative shrink-0">
            <button onClick={onFilterClick} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border rounded-lg shadow-sm" style={{ backgroundColor: filterCount ? 'color-mix(in srgb, var(--color-steel) 8%, white)' : 'white', borderColor: 'var(--color-border)', color: filterCount ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
              <Filter className="w-3.5 h-3.5" /> Filter
              {filterCount > 0 && <span className="text-[10px] font-bold px-1.5 rounded-full text-white" style={{ backgroundColor: 'var(--color-steel)' }}>{filterCount}</span>}
            </button>
            {filterOpen && filterPanel}
          </div>
        )}
        {onSortClick && (
          <button onClick={onSortClick} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border rounded-lg shadow-sm bg-white" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
            <ArrowUpDown className="w-3.5 h-3.5" /> Sort
          </button>
        )}
        {customActions}
        {moreMenu && (
          <>
            <div className="w-px h-6 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1.5 rounded-lg border border-transparent" style={{ color: 'var(--color-warm-gray)' }}>
                  <MoreVertical className="w-5 h-5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="w-48 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                  {moreMenu}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        )}
      </div>
    </div>
  );
}
