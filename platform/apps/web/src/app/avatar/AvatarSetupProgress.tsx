/** Progress tied directly to real Onboarding state, never a timer. */
import { useEffect, useState } from "react";
import type { AvatarStyle } from "./avatar-store";

export type AvatarSetupState = "starting" | "answering" | "reviewing" | "saving" | "ready";

export interface AvatarSetupProgressProps {
  progress: number;
  state: AvatarSetupState;
  avatarStyle: AvatarStyle;
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

export function AvatarSetupProgress({
  progress,
  state,
  avatarStyle,
  statusText,
}: AvatarSetupProgressProps) {
  const reducedMotion = usePrefersReducedMotion();
  const boundedProgress = Math.min(1, Math.max(0, progress));
  const circumference = 2 * Math.PI * 27;
  const offset = circumference * (1 - boundedProgress);
  const complete = state === "ready";

  return (
    <div className="flex flex-col items-center gap-2 py-2" aria-live="polite">
      <div
        className="relative"
        style={{ width: 72, height: 72 }}
        role="img"
        aria-label={complete ? `Avatar ready with ${avatarStyle} style` : `Avatar setup: ${statusText}`}
      >
        <svg viewBox="0 0 72 72" width="100%" height="100%">
          <circle cx="36" cy="36" r="27" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="4" />
          <circle
            cx="36"
            cy="36"
            r="27"
            fill="none"
            stroke="var(--color-steel)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 36 36)"
            style={reducedMotion ? undefined : { transition: "stroke-dashoffset 300ms ease-out" }}
          />
          <text x="36" y="41" textAnchor="middle" fontSize="14" fill="var(--color-navy)">
            {complete ? "✓" : `${Math.round(boundedProgress * 100)}%`}
          </text>
        </svg>
      </div>
      <p className="text-xs text-muted-foreground text-center min-h-[1rem]">{statusText}</p>
    </div>
  );
}
