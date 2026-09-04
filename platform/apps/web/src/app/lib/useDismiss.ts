import { useEffect } from "react";

/**
 * Close a floating menu on any pointerdown or Escape while `active`. The
 * pointerdown is observed, never swallowed: the click still reaches whatever
 * was under it (the full-screen-overlay approach this replaced ate the first
 * click, user report 2026-08-10). Gate with `active` while a nested dialog owns
 * the interaction.
 */
export function useDismiss(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, onClose]);
}
