/**
 * ModuleSurfaceLayout — the ONE place the Module surface's scroll architecture
 * is written down. Every data-shape Module Page (Tasks, Signals, JobPilot,
 * DealPilot, Relationship) is the same shape: a table that owns the first
 * screen, with the Files Section and the Intelligence Section waiting BELOW the
 * fold.
 *
 * WHY THIS EXISTS: each of those Pages previously put the table AND the
 * below-fold Sections inside one `flex-1 overflow-auto` div. That has two
 * consequences, both wrong: (1) the table never gets a definite height, so it
 * sizes to its content and can never "cover the entire screen"; (2) there is
 * only ONE scroller, so the very first wheel tick scrolls the Sections into
 * view instead of scrolling the table's own rows. Encoding the fix in nine
 * Pages would have made nine chances to diverge — it is encoded here once.
 *
 * THE ARCHITECTURE, in three boxes:
 *
 *   1. THE PAGE SCROLLER (this component's root). Owns the whole Page's
 *      vertical scroll. Its height is definite because every caller mounts it
 *      as the flex-1 child of a `flex h-full flex-col` Page shell.
 *   2. THE FIRST SCREEN (`h-full` — exactly 100% of the scroller's own box, so
 *      one screenful by construction). A flex column: `above` and `footer`
 *      take their natural height, and the table region takes `min-h-0 flex-1`,
 *      i.e. every pixel that is left. THIS is what gives the table a definite
 *      height, which is what lets `<DataViews>` and the canvas grid inside it
 *      resolve `height: 100%` to something other than zero.
 *   3. THE BELOW-FOLD STACK (`below`). Ordinary flow content after the first
 *      screen, so it exists only for a reader who has scrolled past the table.
 *
 * SCROLL HANDOFF IS NATIVE, DELIBERATELY. The table keeps its own inner
 * scroller; when its rows bottom out the browser's standard scroll chaining
 * carries the remaining wheel/touch delta out to the page scroller above, which
 * is what brings Files and Intelligence up. No wheel handler, no scroll
 * hijacking, and — critically — NO `overscroll-behavior` anywhere on this path:
 * `contain` is exactly the property that would sever the handoff and strand the
 * user inside the table forever.
 *
 * PADDING IS THE SLOT'S OWN BUSINESS. Only the table region is padded here.
 * `above`/`footer`/`below` bring their own chrome, because several Pages use
 * full-bleed bordered bars (search rows, pagination footers) that must NOT be
 * inset.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/utils";

export interface ModuleSurfaceLayoutProps {
  /** Optional chrome pinned above the table INSIDE the first screen (stat
   * cards, a search bar, an honest "no Database connected" banner). It shrinks
   * the table rather than pushing it off-screen. */
  above?: ReactNode;
  /** The table region. Receives a definite height: whatever the first screen
   * has left over. Normally a `<DataViews>`. */
  table: ReactNode;
  /** Optional chrome pinned below the table but still INSIDE the first screen
   * (pagination, a selection detail strip). Same shrink behaviour as `above`. */
  footer?: ReactNode;
  /** Everything that lives past the fold — Files Section, Intelligence
   * Section, supplementary Sections. Reached only by scrolling the table to its
   * end and letting the scroll chain out. */
  below?: ReactNode;
  /** Extra classes for the page scroller (background, etc.). */
  className?: string;
}

export function ModuleSurfaceLayout({
  above,
  table,
  footer,
  below,
  className,
}: ModuleSurfaceLayoutProps) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div className="flex h-full min-h-0 flex-col">
        {above}
        <div className="min-h-0 flex-1 p-3 sm:p-4">{table}</div>
        {footer}
      </div>
      {below ? <div className="space-y-6 p-3 sm:p-4">{below}</div> : null}
    </div>
  );
}

export default ModuleSurfaceLayout;
