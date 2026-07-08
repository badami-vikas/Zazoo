import { X } from "lucide-react";

export interface ActiveFilter {
  id: string;
  label: string;
}

/**
 * Row of removable chips for currently-selected filters — renders directly under
 * StandardToolbar, only when at least one filter is active. Part of the standard
 * page shell (user spec 2026-07-07): toolbar -> filter chips (conditional) -> dashboard -> content.
 */
export function FilterChipsRow({
  filters,
  onRemove,
  onClearAll,
}: {
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div
      className="flex items-center gap-1.5 px-4 py-2 border-b flex-wrap"
      style={{ borderColor: "var(--color-border)", backgroundColor: "color-mix(in srgb, var(--color-steel) 4%, white)" }}
    >
      {filters.map((f) => (
        <span
          key={f.id}
          className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium border"
          style={{ backgroundColor: "white", borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}
        >
          {f.label}
          <button onClick={() => onRemove(f.id)} aria-label={`Remove filter ${f.label}`} className="rounded-full p-0.5 hover:bg-black/5">
            <X className="w-3 h-3" style={{ color: "var(--color-warm-gray)" }} />
          </button>
        </span>
      ))}
      <button onClick={onClearAll} className="text-xs font-medium underline ml-1" style={{ color: "var(--color-warm-gray)" }}>
        Clear all
      </button>
    </div>
  );
}
