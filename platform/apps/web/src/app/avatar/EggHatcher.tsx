/**
 * Onboarding egg — visual progress artifact for OnboardingDialog.tsx
 * (docs/raw/spec-consolidation-2026-07.md section 4: "Onboarding Egg —
 * Ceremony Under 60s, Hatches on First Usable Workspace").
 *
 * Progress maps to REAL setup state, not a fake timer:
 *   questions answered  -> egg grows (non-linear: faster early, slower mid)
 *   preview reached      -> ~90% (blueprint compiled, about to be proposed)
 *   activated/submitted  -> 100% + hatch animation (<3s), avatar reveals
 *
 * No lottie/three — pure SVG + CSS transitions, matching the "no new heavy
 * deps" constraint. The hatch sequence is capped at ~1.6s and NEVER blocks the
 * "Done" button — `onHatchComplete` fires on a timer but the caller already
 * has everything it needs (prefs) the instant activation succeeds.
 */
import { useEffect, useState } from "react";
import type { SpiritAnimal } from "./avatar-store";

export type EggStage = "incubating" | "growing" | "ready" | "hatching" | "hatched";

export interface EggHatcherProps {
  /** 0-1 fractional progress from real setup state (see mapping above). */
  progress: number;
  stage: EggStage;
  animal: SpiritAnimal;
  statusText: string;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// Non-linear growth easing: fast early, slow mid, fast finish (spec: "Growth:
// Non-linear — faster early, slower mid, fast finish"). Maps linear progress
// (0-1) to a visual scale (0.55-1.0) via an ease-out-in-out-ish curve.
function eggScale(progress: number): number {
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  return 0.55 + eased * 0.45;
}

export function EggHatcher({ progress, stage, animal, statusText }: EggHatcherProps) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = eggScale(Math.min(1, Math.max(0, progress)));
  const hatching = stage === "hatching";
  const hatched = stage === "hatched";

  return (
    <div className="flex flex-col items-center gap-2 py-2" aria-live="polite">
      <div
        className="relative"
        style={{ width: 72, height: 72 }}
        role="img"
        aria-label={hatched ? `Egg hatched — ${animal} avatar revealed` : `Egg incubating: ${statusText}`}
      >
        <svg viewBox="0 0 72 72" width="100%" height="100%">
          {/* incubating glow */}
          {!hatched && (
            <ellipse
              cx="36"
              cy="40"
              rx={22 * scale}
              ry={28 * scale}
              fill="var(--color-amber-soft)"
              opacity="0.18"
            />
          )}
          {!hatched && (
            <g
              style={
                reducedMotion
                  ? undefined
                  : {
                      transformOrigin: "36px 40px",
                      transition: "transform 500ms ease-out",
                      transform: hatching ? "scale(1.05)" : "scale(1)",
                    }
              }
            >
              <ellipse
                cx="36"
                cy="40"
                rx={18 * scale}
                ry={24 * scale}
                fill="var(--color-background)"
                stroke="var(--color-amber-soft)"
                strokeWidth="2"
              />
              {/* crack lines appear only while hatching */}
              {hatching && (
                <>
                  <path d="M28 24 L34 34 L26 40" stroke="var(--color-navy)" strokeWidth="1.4" fill="none" />
                  <path d="M44 26 L38 36 L46 42" stroke="var(--color-navy)" strokeWidth="1.4" fill="none" />
                </>
              )}
            </g>
          )}
          {hatched && (
            <g role="img" aria-label={`${animal} avatar`}>
              <circle cx="36" cy="36" r="20" fill="var(--color-surface)" stroke="var(--color-navy)" strokeWidth="1.5" />
              <circle cx="30" cy="34" r="2.6" fill="var(--color-navy)" />
              <circle cx="42" cy="34" r="2.6" fill="var(--color-navy)" />
              <circle cx="36" cy="12" r="30" fill="var(--color-steel)" opacity="0.08" />
            </g>
          )}
        </svg>
      </div>
      <p className="text-xs text-muted-foreground text-center min-h-[1rem]">{statusText}</p>
    </div>
  );
}
