export interface DashboardMetric {
  id: string;
  label: string;
  value: string;
  hint?: string;
}

/**
 * One horizontal layer of at-a-glance analytics — sits between the filter chips row and the
 * content view in the standard page shell (user spec 2026-07-07). Always derived from the same
 * real data the content view renders (counts/aggregates computed by the caller), never a
 * separate fetch and never placeholder numbers — an empty `metrics` array renders nothing rather
 * than a fake zero-state.
 */
export function DashboardRow({ metrics }: { metrics: DashboardMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div
      className="grid grid-cols-1 items-stretch gap-3 border-b px-4 py-3 sm:flex sm:flex-nowrap sm:overflow-x-auto"
      style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
    >
      {metrics.map((m) => (
        <div
          key={m.id}
          className="flex min-w-0 w-full flex-col gap-0.5 rounded-lg border px-3 py-2 sm:w-auto sm:min-w-[120px] sm:shrink-0"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>
            {m.label}
          </span>
          <span className="text-lg font-bold tabular-nums" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>
            {m.value}
          </span>
          {m.hint && (
            <span className="text-[10px]" style={{ color: "var(--color-warm-gray)" }}>
              {m.hint}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
