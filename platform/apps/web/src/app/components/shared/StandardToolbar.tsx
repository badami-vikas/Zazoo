import type { ReactNode } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, MoreVertical } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ListDropdown, type ListOption } from './ListDropdown';

// Shared controls for non-Database Pages. Database View selection belongs only
// to DataViews, where registered renderers and metadata eligibility are enforced.
export function StandardToolbar({
  search, onSearchChange, onFilterClick, filterCount = 0,
  filterOpen, filterPanel, customActions, moreMenu,
  lists, activeListId, onListSelect, onAddList, insightsExpanded, onToggleInsights,
}: {
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
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-white shrink-0 shadow-sm z-20 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
      {lists && onListSelect && (
        <ListDropdown lists={lists} activeId={activeListId ?? null} onSelect={onListSelect} onAddList={onAddList} />
      )}
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
