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
import { loadAvatarPrefs } from "../../avatar/avatar-store";
import { ChatView } from "../../chat/ChatView";
import {
  usePanelControl,
  ResizeHandle,
  CollapseToggleButton,
  ExtendToggleButton,
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

  const avatarPrefs = loadAvatarPrefs(true);
  const avatarStyle = avatarPrefs.style;
  const agentName = avatarPrefs.avatarName || "Chief of Staff";

  if (collapsed && !mobile) {
    return (
      <aside
        id="panel-right"
        aria-label="Collapsed chat panel"
        className="w-12 shrink-0 border-l flex flex-col items-center gap-1.5 pt-3"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
      >
        <AvatarIcon style={avatarStyle} size={28} />
        <CollapseToggleButton
          side="right"
          collapsed
          onClick={() => setCollapsedPersisted(false)}
        />
      </aside>
    );
  }

  return (
    <aside
      id="panel-right"
      aria-label="Chat panel"
      style={{ width: mobile ? "min(100vw, 360px)" : dragWidth ?? panelWidth, borderColor: "var(--color-border)" }}
      className={`shrink-0 border-l flex flex-col h-full overflow-hidden bg-white relative ${dragWidth === null ? "transition-[width] duration-75" : ""}`}
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
        />
      )}
      <div className="h-14 flex items-center justify-between px-4 border-b shrink-0" style={{ borderColor: "var(--color-border)" }}>
        {/* Shared CollapseToggleButton (§5b). */}
        <div className="flex items-center">
          {!mobile && (
            <ExtendToggleButton
              side="right"
              extended={panel.mode === "extended"}
              onClick={panel.toggleExtended}
            />
          )}
          <CollapseToggleButton
            side="right"
            collapsed={false}
            onClick={collapse}
          />
        </div>
        <div className="font-bold text-lg tracking-tight flex items-center gap-2">
          <AvatarIcon style={avatarStyle} size={24} />
          <span style={{ color: "var(--color-navy)" }}>{agentName}</span>
        </div>
        <div className="w-9" />
      </div>

      <ChatView surface="chat_panel" compact />
    </aside>
  );
}
