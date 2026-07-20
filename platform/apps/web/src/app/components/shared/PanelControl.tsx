/**
 * PanelControl — shared collapse/expand/resize contract for the left Sidebar
 * and right Chat Panel (§5b, UI-RULES-1, TASK-001).
 *
 * Both panels use EXACTLY the same states, icon family, keyboard shortcut,
 * ARIA labels, and drag-resize pattern. The only parametric differences are:
 *   - side: "left" | "right" — affects drag direction and resize-handle position
 *   - storage key prefix — ensures each panel persists its own state
 *   - icon-slot content — caller decides what icon(s) sit in the header
 *
 * State machine:
 *   collapsed (icon strip) ──click/kbd──→ expanded (normal width)
 *   expanded ──drag──→ extended (wider width, same as expanded but user-sized)
 *   expanded/extended ──Escape──→ collapsed (does not discard chat/nav state)
 *
 * Width persistence: collapsed = 0 (hidden to CSS), expanded = persisted px.
 * Drag is continuous on "right" panel (chat needs a range); snaps on "left"
 * (rail has two semantic states, not a continuous range).
 */
import { useState, type ReactNode } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";

export type PanelSide = "left" | "right";
export type PanelMode = "collapsed" | "expanded" | "extended";

export interface PanelControlProps {
  side: PanelSide;
  /** Width when expanded/extended (px). Persisted in localStorage. */
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** localStorage key for width. */
  storageKeyWidth: string;
  /** localStorage key for collapsed state. */
  storageKeyCollapsed: string;
  /** Snap-to-two-states on drag release (true = left rail; false = right chat). */
  snap?: boolean;
  /** The pixel midpoint at which snap switches from collapsed→expanded. */
  snapMidpoint?: number;
  /** Whether collapsed state is a full hide (overlay-safe) vs. an icon strip. */
  collapsedStrip?: boolean;
  /** Aria label for the panel as a whole. */
  ariaLabel: string;
  /** Content rendered inside the panel when expanded. */
  children: ReactNode;
  /** Slot rendered in the collapsed strip (icon, avatar, etc.). */
  collapsedContent?: ReactNode;
  /** Additional CSS classes on the outer wrapper. */
  className?: string;
  /** Extra inline styles on the outer wrapper. */
  style?: React.CSSProperties;
}

export interface PanelState {
  collapsed: boolean;
  mode: PanelMode;
  setCollapsed: (v: boolean) => void;
  width: number;
}

/**
 * usePanelControl — pure state hook for outside consumers who want state
 * without the rendered wrapper (e.g. Layout.tsx which owns the sidebar JSX).
 */
export function usePanelControl({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKeyWidth,
  storageKeyCollapsed,
  snap,
  snapMidpoint,
}: Pick<
  PanelControlProps,
  "defaultWidth" | "minWidth" | "maxWidth" | "storageKeyWidth" | "storageKeyCollapsed" | "snap" | "snapMidpoint"
>): {
  collapsed: boolean;
  mode: PanelMode;
  setCollapsedPersisted: (v: boolean) => void;
  panelWidth: number;
  setPanelWidthPersisted: (v: number) => void;
  resizeBy: (delta: number) => void;
  toggleExtended: () => void;
  handleEscape: () => void;
  dragWidth: number | null;
  startDrag: (e: React.MouseEvent, side: PanelSide) => void;
  isDragging: boolean;
} {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKeyCollapsed) === "1";
  });
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = Number(window.localStorage.getItem(storageKeyWidth));
    return stored >= minWidth && stored <= maxWidth ? stored : defaultWidth;
  });
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const mode: PanelMode = collapsed
    ? "collapsed"
    : panelWidth > defaultWidth
      ? "extended"
      : "expanded";

  function setCollapsedPersisted(v: boolean) {
    setCollapsed(v);
    try {
      window.localStorage.setItem(storageKeyCollapsed, v ? "1" : "0");
    } catch { /* cosmetic preference — safe no-op */ }
  }

  function setPanelWidthPersisted(v: number) {
    const clamped = Math.min(maxWidth, Math.max(minWidth, v));
    setPanelWidth(clamped);
    try {
      window.localStorage.setItem(storageKeyWidth, String(clamped));
    } catch { /* cosmetic preference — safe no-op */ }
  }

  function startDrag(e: React.MouseEvent, side: PanelSide) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    function onMove(ev: MouseEvent) {
      const dx = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
      setDragWidth(next);
    }
    function onUp(ev: MouseEvent) {
      const dx = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      const finalWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
      setDragWidth(null);
      if (snap && snapMidpoint !== undefined) {
        if (finalWidth < snapMidpoint) {
          setCollapsedPersisted(true);
        } else {
          setCollapsedPersisted(false);
          setPanelWidthPersisted(Math.max(defaultWidth, finalWidth));
        }
      } else {
        setPanelWidthPersisted(finalWidth);
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function resizeBy(delta: number) {
    setCollapsedPersisted(false);
    setPanelWidthPersisted(panelWidth + delta);
  }

  function toggleExtended() {
    setCollapsedPersisted(false);
    setPanelWidthPersisted(mode === "extended" ? defaultWidth : maxWidth);
  }

  function handleEscape() {
    if (mode === "extended") {
      setPanelWidthPersisted(defaultWidth);
      return;
    }
    if (mode === "expanded") setCollapsedPersisted(true);
  }

  return {
    collapsed,
    mode,
    setCollapsedPersisted,
    panelWidth,
    setPanelWidthPersisted,
    resizeBy,
    toggleExtended,
    handleEscape,
    dragWidth,
    startDrag,
    isDragging: dragWidth !== null,
  };
}

export function ExtendToggleButton({
  side,
  extended,
  onClick,
}: {
  side: PanelSide;
  extended: boolean;
  onClick: () => void;
}) {
  const target = side === "left" ? "sidebar" : "chat panel";
  const label = extended ? `Restore ${target} width` : `Extend ${target}`;
  const Icon = extended ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={extended}
      aria-controls={`panel-${side}`}
      onClick={onClick}
      className="p-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors shrink-0"
      style={{ color: "var(--color-warm-gray)" }}
      title={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

/**
 * CollapseToggleButton — the standardised icon-button both panels use to
 * expand/collapse. Appears at the top of the panel or in the collapsed strip.
 */
export function CollapseToggleButton({
  side,
  collapsed,
  onClick,
  title,
}: {
  side: PanelSide;
  collapsed: boolean;
  onClick: () => void;
  title?: string;
}) {
  // Collapsed state = expand (show double-chevron pointing inward to expand).
  // Expanded state = collapse (show PanelClose pointing away to collapse).
  let Icon: typeof ChevronsLeft;
  if (collapsed) {
    Icon = side === "left" ? ChevronsRight : ChevronsLeft;
  } else {
    Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  }
  const defaultTitle = collapsed
    ? `Expand ${side === "left" ? "sidebar" : "panel"}`
    : `Collapse ${side === "left" ? "sidebar" : "panel"}`;
  return (
    <button
      type="button"
      aria-label={title ?? defaultTitle}
      aria-expanded={!collapsed}
      aria-controls={`panel-${side}`}
      onClick={onClick}
      className="p-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors shrink-0"
      style={{ color: "var(--color-warm-gray)" }}
      title={title ?? defaultTitle}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

/**
 * ResizeHandle — the 6px invisible drag target on each panel's inner edge.
 * Renders a visible 1px line on hover so the affordance is discoverable.
 */
export function ResizeHandle({
  side,
  onMouseDown,
  onKeyDown,
  label,
}: {
  side: PanelSide;
  onMouseDown: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  label?: string;
}) {
  return (
    <div
      role="separator"
      aria-label={label ?? `Drag to resize ${side} panel`}
      aria-orientation="vertical"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      className={`absolute top-0 ${side === "left" ? "right-0" : "left-0"} h-full w-1.5 cursor-col-resize z-10 group focus:outline-none focus:bg-[var(--color-steel-light)] ${side === "right" ? "-ml-0.5" : ""}`}
      title={label ?? "Drag to resize"}
    >
      <div className="w-px h-full mx-auto bg-transparent group-hover:bg-[var(--color-steel-light)] transition-colors" />
    </div>
  );
}
