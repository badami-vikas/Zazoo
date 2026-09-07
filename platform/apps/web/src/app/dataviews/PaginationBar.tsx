/**
 * ONE pagination control, in the shell (TASK-110).
 *
 * There were two before and neither was reusable: `ModulePage` fetched a
 * silent first page and offered no way to reach a second, `RelationshipPage`
 * hand-rolled Previous/Next at fifty. A per-page control is a per-page bug,
 * so this lives in `<DataViews>` where every surface already renders.
 *
 * The count is the count the shell actually filtered — never an estimate and
 * never the fetch limit dressed up as a total.
 */
import { PAGE_SIZES } from "./pagination.js";

export interface PaginationBarProps {
  /** Rows after search and filters — the honest denominator. */
  total: number;
  pageSize: number;
  /** Zero-based index of the first row on screen. */
  offset: number;
  onOffsetChange: (offset: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function PaginationBar({
  total,
  pageSize,
  offset,
  onOffsetChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + pageSize, total);
  return (
    <div className="flex flex-none items-center gap-2 text-xs text-muted-foreground">
      <span>
        {total === 0 ? "No rows" : `Showing ${first} to ${last} of ${total}`}
      </span>
      <select
        aria-label="Rows per page"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        className="ml-auto h-7 rounded-lg border px-1.5"
        style={{ borderColor: "var(--color-border)" }}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size} per page
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Previous page"
        disabled={offset === 0}
        className="rounded border px-2 py-1 disabled:opacity-40"
        style={{ borderColor: "var(--color-border)" }}
        onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
      >
        Previous
      </button>
      <button
        type="button"
        aria-label="Next page"
        disabled={last >= total}
        className="rounded border px-2 py-1 disabled:opacity-40"
        style={{ borderColor: "var(--color-border)" }}
        onClick={() => onOffsetChange(offset + pageSize)}
      >
        Next
      </button>
    </div>
  );
}
