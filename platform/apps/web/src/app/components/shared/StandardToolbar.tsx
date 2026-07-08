import { useState, type ComponentType, type ReactNode } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, Check, MoreVertical, Settings2 } from 'lucide-react';
import { Link } from 'react-router';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ListDropdown, type ListOption } from './ListDropdown';

export interface ToolbarView { id: string; label: string; icon: ComponentType<any> }

// The ONE toolbar shape every tool page uses (shell-v2, user spec 2026-07-07): List dropdown →
// view dropdown → search → filter → tool-specific custom actions → 3-dot menu → collapse/expand
// arrow for the insights section (filter chips + dashboard row). Sits directly under the
// centered Header toggle. Never hand-roll a bespoke toolbar in a tool page again.
export function StandardToolbar({
  view, views, onViewChange, search, onSearchChange, onFilterClick, filterCount = 0,
  filterOpen, filterPanel, customActions, moreMenu,
  lists, activeListId, onListSelect, onAddList, insightsExpanded, onToggleInsights, controlPanelTo,
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
  customActions?: ReactNode;
  moreMenu?: ReactNode;
  // List dropdown slot (first in the row) — omit on pages with no lists concept.
  lists?: ListOption[];
  activeListId?: string | null;
  onListSelect?: (id: string) => void;
  onAddList?: () => void;
  // Insights toggle arrow — renders immediately after the 3-dots menu; controls the page's
  // CollapsibleInsights section (expanded by default at the page level).
  insightsExpanded?: boolean;
  onToggleInsights?: () => void;
  // Control Panel icon — always sits between the Filter button and the 3-dot menu. Only
  // Initiative-scoped pages pass a route (/initiative/:id/control-panel); omitted = no icon.
  controlPanelTo?: string;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const activeView = views.find((v) => v.id === view) ?? views[0];
  const ActiveIcon = activeView.icon;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-white shrink-0 shadow-sm z-20 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
      {lists && onListSelect && (
        <ListDropdown lists={lists} activeId={activeListId ?? null} onSelect={onListSelect} onAddList={onAddList} />
      )}
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
        {customActions}
        {controlPanelTo && (
          <Link to={controlPanelTo} title="Control Panel" className="p-1.5 rounded-lg border border-transparent" style={{ color: 'var(--color-warm-gray)' }}>
            <Settings2 className="w-5 h-5" />
          </Link>
        )}
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
        {onToggleInsights && (
          <button
            onClick={onToggleInsights}
            title={insightsExpanded ? 'Collapse insights' : 'Expand insights'}
            aria-expanded={insightsExpanded}
            className="p-1.5 rounded-lg border border-transparent"
            style={{ color: 'var(--color-warm-gray)' }}
          >
            {insightsExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        )}
      </div>
    </div>
  );
}
