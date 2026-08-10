import type { ComponentType } from "react";

export interface DashboardMetric {
  id: string;
  label: string;
  value: string;
  hint?: string;
  /**
   * Optional leading glyph. This is CONTENT, not structure — §3a's standing
   * rule bars a page from deciding whether a control exists, not from choosing
   * a metric's icon. DealPilot's bespoke `StatCard` existed only for this and
   * for `tone`, which is why it is folded in here instead: one insights row for
   * every Module, differing only in the data it carries (user directive
   * 2026-08-10, "I want the UI elements same for all modules and only the data
   * displayed should be different").
   */
  icon?: ComponentType<{ className?: string }>;
  /** `warn` tints the glyph for a metric that wants attention. Never a bare
   *  colour-only signal — the label and value still say what it is (AP-023). */
  tone?: "default" | "warn";
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
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <div
            key={m.id}
            className="flex min-w-0 w-full items-center gap-3 rounded-lg border px-3 py-2 sm:w-auto sm:min-w-[120px] sm:shrink-0"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
          >
            {Icon && (
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                  m.tone === "warn" ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-[var(--color-steel)]"
                }`}
              >
                <Icon className="size-4" />
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
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
          </div>
        );
      })}
    </div>
  );
}
