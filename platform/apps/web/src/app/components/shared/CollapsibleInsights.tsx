// CollapsibleInsights — the ONE collapsible insights section of the shell-v2 page structure
// (user spec 2026-07-07): selected filter chips (only when filters are active) + the horizontal
// dashboard/analytics row, as a single unit under the toolbar. Controlled: the toggle arrow
// lives in StandardToolbar (insightsExpanded / onToggleInsights), NOT here. Default expanded.
// Collapse is plain CSS (grid-template-rows 1fr↔0fr) — no motion dependency.
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FilterChipsRow, type ActiveFilter } from './FilterChipsRow';
import { DashboardRow, type DashboardMetric } from './DashboardRow';

export function CollapsibleInsights({
  expanded,
  filters = [],
  onRemoveFilter,
  onClearFilters,
  metrics = [],
  onToggle,
}: {
  expanded: boolean;
  filters?: ActiveFilter[];
  onRemoveFilter?: (id: string) => void;
  onClearFilters?: () => void;
  metrics?: DashboardMetric[];
  /** Supplied by a Page that has no toolbar of its own. The chevron then lives
   * HERE, at the section's top right, instead of as a labelled "Hide insights"
   * button in a header bar above it. */
  onToggle?: () => void;
}) {
  // Nothing to show either way — render nothing rather than an empty band (real-data policy:
  // DashboardRow already renders nothing for zero metrics; same principle for the section).
  if (filters.length === 0 && metrics.length === 0) return null;
  return (
    <div className="shrink-0">
      {onToggle && (
        // Outside the collapsing grid on purpose: a control inside it would
        // collapse to zero height along with the cards, leaving no way back.
        <div className="flex justify-end px-4 pt-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide insights' : 'Show insights'}
            title={expanded ? 'Hide insights' : 'Show insights'}
            onClick={onToggle}
            className="rounded p-1 opacity-60 transition-opacity hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>
      )}
      <div
        style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 200ms ease' }}
      >
        <div className="overflow-hidden min-h-0">
          <FilterChipsRow
            filters={filters}
            onRemove={onRemoveFilter ?? (() => {})}
            onClearAll={onClearFilters ?? (() => {})}
          />
          <DashboardRow metrics={metrics} />
        </div>
      </div>
    </div>
  );
}
