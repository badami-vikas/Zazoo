import clsx from "clsx";
import { useEffect, useRef, useState, type ComponentType } from "react";

export interface HeaderTab {
  id: string;
  icon: ComponentType<any>;
  /** Optional display copy; falls back to `id`. Lets UI vocabulary differ from logic ids. */
  label?: string;
}

interface HeaderProps {
  tabs: HeaderTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

/**
 * The centered segmented toggle every non-Home/non-Settings page mounts directly under
 * PageHeader (ported from the prototype's Header.tsx — same shape, no `motion` dependency:
 * apps/web doesn't have the `motion` module, so the active-tab underline is a plain CSS
 * transition instead of a shared layoutId animation).
 *
 * Responsive icons-only mode (user ask 2026-07-10): NEVER wrap to a second
 * line — when the pill doesn't fit at full (icon+label) width, drop to
 * icon-only rather than wrapping. A `ResizeObserver` on the pill's
 * container compares available width against a per-tab width heuristic
 * (roughly measured: ~112px/tab labeled, ~44px/tab icon-only, plus the
 * container's own padding) rather than trying to pre-measure the labeled
 * layout's natural width (which would require an invisible measurement
 * pass) — simpler and good enough since tab counts here are small (2-6).
 */
const LABELED_PX_PER_TAB = 112;

export function Header({ tabs, activeTab, onTabChange }: HeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const labeledThreshold = tabs.length * LABELED_PX_PER_TAB;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setCompact(width > 0 && width < labeledThreshold);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabs.length]);

  // Single-section pages get a plain centered Title-case name — no toggle
  // chrome around a one-item group (user spec 2026-07-07, requests.md R-013).
  const only = tabs.length === 1 ? tabs[0] : undefined;
  if (only) {
    const Icon = only.icon;
    return (
      <header
        className="h-14 flex items-center justify-center px-6 border-b shrink-0 z-10 w-full shadow-sm"
        style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: "var(--color-warm-gray)" }} />
          <span className="text-base font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>
            {only.label ?? only.id}
          </span>
        </div>
      </header>
    );
  }
  return (
    <header
      ref={containerRef}
      className="h-14 flex items-center justify-center px-6 border-b shrink-0 z-10 w-full shadow-sm overflow-hidden"
      style={{ backgroundColor: "white", borderColor: "var(--color-border)" }}
    >
      <div
        className="flex items-center p-1 rounded-lg border shadow-inner shrink-0"
        style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        {tabs.map((seg) => {
          const active = seg.id === activeTab;
          const Icon = seg.icon;
          return (
            <button
              key={seg.id}
              onClick={() => onTabChange(seg.id)}
              title={compact ? (seg.label ?? seg.id) : undefined}
              className={clsx(
                "py-1.5 text-xs uppercase tracking-wider font-semibold rounded-md transition-all relative flex items-center whitespace-nowrap",
                compact ? "px-3 justify-center" : "px-6 gap-2",
                active ? "border" : "border border-transparent hover:bg-white/40",
              )}
              style={
                active
                  ? {
                      backgroundColor: "white",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                      color: "var(--color-navy)",
                      borderColor: "rgba(0,0,0,0.08)",
                    }
                  : { color: "var(--color-warm-gray)" }
              }
            >
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
              {!compact && (
                <span style={{ color: active ? "var(--color-navy)" : "var(--color-warm-gray)" }}>{seg.label ?? seg.id}</span>
              )}
              {active && (
                <div
                  className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-12 h-[2px] rounded-t-full transition-all"
                  style={{ backgroundColor: "var(--color-steel)", boxShadow: "0 0 8px rgb(from var(--color-steel) r g b / 0.5)" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </header>
  );
}
