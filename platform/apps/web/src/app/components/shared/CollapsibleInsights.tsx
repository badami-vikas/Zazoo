// CollapsibleInsights — the ONE collapsible insights section of the shell-v2 page structure
// (user spec 2026-07-07): selected filter chips (only when filters are active) + the horizontal
// dashboard/analytics row, as a single unit under the toolbar. Controlled: the toggle arrow
// lives in StandardToolbar (insightsExpanded / onToggleInsights), NOT here. Default expanded.
// Collapse is plain CSS (grid-template-rows 1fr↔0fr) — no motion dependency.
import { FilterChipsRow, type ActiveFilter } from './FilterChipsRow';
import { DashboardRow, type DashboardMetric } from './DashboardRow';

export function CollapsibleInsights({
  expanded,
  filters = [],
  onRemoveFilter,
  onClearFilters,
  metrics = [],
}: {
  expanded: boolean;
  filters?: ActiveFilter[];
  onRemoveFilter?: (id: string) => void;
  onClearFilters?: () => void;
  metrics?: DashboardMetric[];
}) {
  // Nothing to show either way — render nothing rather than an empty band (real-data policy:
  // DashboardRow already renders nothing for zero metrics; same principle for the section).
  if (filters.length === 0 && metrics.length === 0) return null;
  return (
    <div
      className="shrink-0"
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
  );
}
