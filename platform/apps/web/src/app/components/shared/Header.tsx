import clsx from "clsx";
import type { ComponentType } from "react";

export interface HeaderTab {
  id: string;
  icon: ComponentType<any>;
}

interface HeaderProps {
  tabs: HeaderTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

/**
 * The centered segmented toggle every non-Home/non-Settings page mounts directly under
 * ToolPageHeader (ported from the prototype's Header.tsx — same shape, no `motion` dependency:
 * apps/web doesn't have the `motion` package, so the active-tab underline is a plain CSS
 * transition instead of a shared layoutId animation).
 */
export function Header({ tabs, activeTab, onTabChange }: HeaderProps) {
  // Single-section pages get a plain centered Title-case name — no toggle
  // chrome around a one-item group (user spec 2026-07-07, requests.md R-013).
  const only = tabs.length === 1 ? tabs[0] : undefined;
  if (only) {
    const Icon = only.icon;
    return (
      <header
        className="h-14 flex items-center justify-center px-6 border-b shrink-0 z-10 w-full shadow-sm"
        style={{ backgroundColor: "white", borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: "var(--color-steel)" }} />
          <span className="text-base font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>
            {only.id}
          </span>
        </div>
      </header>
    );
  }
  return (
    <header
      className="h-14 flex items-center justify-center px-6 border-b shrink-0 z-10 w-full shadow-sm"
      style={{ backgroundColor: "white", borderColor: "var(--color-border)" }}
    >
      <div
        className="flex items-center p-1 rounded-lg border shadow-inner"
        style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        {tabs.map((seg) => {
          const active = seg.id === activeTab;
          const Icon = seg.icon;
          return (
            <button
              key={seg.id}
              onClick={() => onTabChange(seg.id)}
              className={clsx(
                "px-6 py-1.5 text-xs uppercase tracking-wider font-semibold rounded-md transition-all relative flex items-center gap-2",
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
              <Icon className="w-3.5 h-3.5" style={{ color: active ? "var(--color-steel)" : "var(--color-warm-gray)" }} />
              <span style={{ color: active ? "var(--color-navy)" : "var(--color-warm-gray)" }}>{seg.id}</span>
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
