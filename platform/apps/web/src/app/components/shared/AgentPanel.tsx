/**
 * AI chat — persistent right panel, mounted once in <Layout> alongside the
 * main content Outlet (nav | content | AI chat, matching the reference UI at
 * bridge-ai-1ay.pages.dev). Ported from the prototype's AgentPanel.tsx.
 *
 * TASK-001 §5b: refactored to use shared PanelControl hooks/components so the
 * right panel and left sidebar share identical collapse/expand/resize/ARIA
 * behaviour. Chat persistence is server-owned and shared with the full page
 * and Avatar overlay.
 */
import { PILOT_ORGANIZATION } from "../../lib/trpc";
import { AvatarIcon } from "../../avatar/AvatarOverlay";
import { useAvatarPrefs } from "../../avatar/avatar-store";
import { ChatView } from "../../chat/ChatView";
import {
  usePanelControl,
  ResizeHandle,
  CollapseToggleButton,
} from "./PanelControl";

// PANEL_DEFAULT_WIDTH = 1.3× the rail's default EXPANDED width (220*1.3≈286).
const PANEL_DEFAULT_WIDTH = 286;
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 520;
const WIDTH_KEY = `bridge.${PILOT_ORGANIZATION}.chatPanel.width.v3`;
const COLLAPSE_KEY = `bridge.${PILOT_ORGANIZATION}.chatPanel.collapsed.v3`;

export function AgentPanel({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  // §5b: shared usePanelControl — same semantics as the left sidebar but
  // continuous width (no snap), right-side drag direction.
  const panel = usePanelControl({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
    storageKeyWidth: WIDTH_KEY,
    storageKeyCollapsed: COLLAPSE_KEY,
    snap: false,
  });
  const { collapsed, setCollapsedPersisted, panelWidth, dragWidth } = panel;
  function collapse() {
    if (mobile) {
      onClose?.();
    } else {
      setCollapsedPersisted(true);
    }
  }

  const avatarPrefs = useAvatarPrefs(true);
  const avatarStyle = avatarPrefs.style;
  const agentName = avatarPrefs.avatarName || "Chief of Staff";

  if (collapsed && !mobile) {
    // Collapsed strip: no extra chevron icons — the inner-edge double-arrow is
    // the resize affordance, and clicking the empty strip expands the panel
    // (user request 2026-07-27).
    return (
      <aside
        id="panel-right"
        aria-label="Collapsed chat panel"
        className="w-12 shrink-0 flex flex-col items-center gap-1.5 pt-3 relative cursor-pointer"
        style={{ boxShadow: "var(--shadow-shell-left)", backgroundColor: "var(--color-surface)" }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("a, button, [role='separator']")) {
            setCollapsedPersisted(false);
          }
        }}
        title="Expand chat panel"
      >
        <ResizeHandle
          side="right"
          onMouseDown={(e) => panel.startDrag(e, "right")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "Enter") setCollapsedPersisted(false);
          }}
          label="Expand chat panel"
          value={PANEL_MIN_WIDTH}
          min={PANEL_MIN_WIDTH}
          max={PANEL_MAX_WIDTH}
          isDragging={panel.isDragging}
        />
        <AvatarIcon style={avatarStyle} size={28} />
      </aside>
    );
  }

  return (
    <aside
      id="panel-right"
      aria-label="Chat panel"
      style={{
        width: mobile ? "min(100vw, 360px)" : dragWidth ?? panelWidth,
        // Shell-boundary separation is a soft shadow, not a hard rule
        // (ADR-187) — mobile keeps its own overlay border, drawn separately.
        boxShadow: mobile ? undefined : "var(--shadow-shell-left)",
        borderColor: "var(--color-border)",
      }}
      className={`shrink-0 flex flex-col h-full overflow-hidden bg-white relative ${mobile ? "border-l" : ""} ${dragWidth === null ? "transition-[width] duration-75" : ""}`}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (mobile) collapse();
        else panel.handleEscape();
      }}
    >
      {/* Resize handle — shared ResizeHandle component (§5b), left edge. */}
      {!mobile && (
        <ResizeHandle
          side="right"
          onMouseDown={(e) => panel.startDrag(e, "right")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") panel.resizeBy(16);
            if (e.key === "ArrowRight") panel.resizeBy(-16);
          }}
          label="Drag to resize chat panel"
          value={dragWidth ?? panelWidth}
          min={PANEL_MIN_WIDTH}
          max={PANEL_MAX_WIDTH}
          isDragging={panel.isDragging}
        />
      )}
      <div className="h-14 flex items-center justify-between px-4 border-b shrink-0" style={{ borderColor: "var(--color-border)" }}>
        {/* Single collapse toggle — the extend/full-screen control was removed
            per user request; width is set via the inner-edge double-arrow handle. */}
        <div className="flex items-center">
          <CollapseToggleButton
            side="right"
            collapsed={false}
            onClick={collapse}
          />
        </div>
        <div className="font-bold text-lg tracking-tight flex items-center gap-2">
          {/* 32 in a 56px header row: big enough to read as a character now
              that the badge actually fits its box, small enough to leave the
              title its baseline. */}
          <AvatarIcon style={avatarStyle} size={32} />
          <span style={{ color: "var(--color-navy)" }}>{agentName}</span>
        </div>
        <div className="w-9" />
      </div>

      <ChatView surface="chat_panel" compact />
    </aside>
  );
}
