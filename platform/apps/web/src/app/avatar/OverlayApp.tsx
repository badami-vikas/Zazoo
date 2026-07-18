/**
 * OverlayApp — frontend of the FLOATING desktop companion window (R-002).
 *
 * Rendered by the separate Vite entry `overlay.html` inside the Tauri
 * "overlay" window (apps/desktop src-tauri/src/overlay.rs): ~96×96,
 * transparent, undecorated, always-on-top, anchored bottom-right. Reuses the
 * exact same Creature + avatar-store as the in-page AvatarOverlay so the two
 * surfaces can never drift apart visually.
 *
 * State machine (adopted Invoko spec; v1 minimal-egg subset implemented):
 *   collapsed → hover → expanded_idle → working → result_ready → error
 *     → dismissing → collapsed
 * v1 ships collapsed / hover / expanded_idle / working (+ error passthrough
 * from avatar status). result_ready and dismissing are declared in the type
 * so the vocabulary is stable, but nothing drives them yet — honest gap, not
 * a fake animation.
 *
 * The WINDOW resizes with the state (Rust `overlay_resize` command keeps the
 * bottom-right corner pinned) — the panel is real OS chrome, not a div
 * overflowing a fixed window.
 *
 * **Drag (TASK-003)**: The collapsed avatar uses Tauri's native drag-region
 * hook. Rust debounces the resulting native move events and saves the
 * reconciled position. `overlay_get_position` is called on mount to confirm
 * the Rust-side restore succeeded.
 *
 * On macOS the Rust window is an NSPanel configured for all Spaces and
 * fullscreen auxiliary presence.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Creature } from "./AvatarOverlay";
import {
  CAPTURE_EVENT,
  STATUS_LABEL,
  loadAvatarPrefs,
  setAvatarStatus,
  useAvatarStatus,
} from "./avatar-store";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

interface AvatarPointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragStarted: boolean;
}

const AVATAR_DRAG_THRESHOLD_PX = 4;

/** Full Invoko-spec vocabulary; v1 drives the first four (+ error). */
export type CompanionState =
  | "collapsed"
  | "hover"
  | "expanded_idle"
  | "working"
  | "result_ready"
  | "error"
  | "dismissing";

/** Window sizes per companion state (logical px) — must match what the Rust
 * side created the window with (COLLAPSED_SIZE in overlay.rs). The window
 * always grows/shrinks BEFORE its content changes (overlay_resize keeps the
 * bottom-right corner pinned) — an undecorated Tauri window clips its
 * webview to its own bounds, so anything rendered past the current size
 * (the status panel, the chat panel, the right-click menu) would be
 * invisible if the resize didn't happen first. */
const WINDOW_SIZE: Record<"collapsed" | "hover" | "expanded" | "chat" | "menu", { w: number; h: number }> = {
  collapsed: { w: 96, h: 96 },
  hover: { w: 260, h: 96 },
  expanded: { w: 320, h: 400 },
  chat: { w: 320, h: 420 },
  menu: { w: 200, h: 150 },
};

function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const internals = typeof window !== "undefined" ? window.__TAURI_INTERNALS__ : undefined;
  if (!internals?.invoke) return Promise.resolve(undefined);
  return internals.invoke(cmd, args).catch((err: unknown) => {
    // Never let a window-chrome failure break the avatar itself.
    console.error("[companion] invoke failed", cmd, err);
    return undefined;
  });
}

export function OverlayApp() {
  // localStorage is shared with the main window (same origin), so the
  // companion always shows the same hatched animal/name. `true`: by the time
  // the desktop shell exists, this install is an existing user.
  const [prefs] = useState(() => loadAvatarPrefs(true));
  const status = useAvatarStatus();
  // "status" = the existing pending-approvals panel (click the avatar).
  // "chat" = the hover chat bubble's compact inline chat.
  const [panel, setPanel] = useState<"none" | "status" | "chat">("none");
  const [hovering, setHovering] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const blinkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarPointerGesture = useRef<AvatarPointerGesture | null>(null);
  const suppressAvatarClick = useRef(false);

  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingError, setPendingError] = useState(false);

  // Right-click menu (Hide / Meditate / Observe).
  const [menuOpen, setMenuOpen] = useState(false);
  const [observing, setObserving] = useState(false);

  // Compact inline chat — same trpc.chiefOfStaff.converse contract
  // AgentPanel.tsx uses in the main window, condensed for the overlay.
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatChainDepth, setChatChainDepth] = useState(0);

  const expanded = panel !== "none";

  // Derived companion state (the machine's read model).
  const working =
    status === "listening" || status === "reading_context" || status === "drafting";
  const state: CompanionState = expanded
    ? status === "error"
      ? "error"
      : working
        ? "working"
        : "expanded_idle"
    : hovering
      ? "hover"
      : "collapsed";

  // Blink tell — same window-event contract as the in-page overlay. Events
  // are per-webview, so this only fires for captures announced IN this
  // window; kernel-driven blink wiring across windows is a follow-up.
  useEffect(() => {
    function onCapture() {
      setBlinking(true);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      blinkTimeout.current = setTimeout(() => setBlinking(false), 200);
    }
    window.addEventListener(CAPTURE_EVENT, onCapture);
    return () => {
      window.removeEventListener(CAPTURE_EVENT, onCapture);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
    };
  }, []);

  // On mount: ask Rust to confirm the restored position is valid. This is
  // informational only — the actual restoration happens in Rust during window
  // creation (create_overlay_windows → reconcile_saved_position). We log here
  // so the pattern is visible for future position-dependent JS state.
  useEffect(() => {
    tauriInvoke("overlay_get_position").then((pos) => {
      if (pos) {
        // Position was reconciled and restored by Rust; nothing more to do.
      }
    });
  }, []);

  // Window chrome follows the state machine. The right-click menu takes
  // priority over everything else — it's a modal-ish overlay on top of
  // whatever panel state was active, and always gets its own (smallest)
  // window size.
  useEffect(() => {
    const size = menuOpen
      ? WINDOW_SIZE.menu
      : panel === "chat"
        ? WINDOW_SIZE.chat
        : panel === "status"
          ? WINDOW_SIZE.expanded
          : hovering
            ? WINDOW_SIZE.hover
            : WINDOW_SIZE.collapsed;
    void tauriInvoke("overlay_resize", { width: size.w, height: size.h });
  }, [panel, hovering, menuOpen]);

  function openStatusPanel() {
    if (panel === "status") {
      setPanel("none");
      return;
    }
    setPanel("status");
    // Same call the in-page overlay's wake() makes — one source of truth
    // for "how many actions await approval".
    setPendingError(false);
    trpc.action.listPending
      .query({ workspaceId: PILOT_WORKSPACE, limit: 1, offset: 0 })
      .then((res) => setPendingCount(res.total))
      .catch(() => {
        setPendingCount(null);
        setPendingError(true);
      });
  }

  function beginAvatarPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressAvatarClick.current = false;
    avatarPointerGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragStarted: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueAvatarPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = avatarPointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.dragStarted) return;
    if (
      Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <
      AVATAR_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    gesture.dragStarted = true;
    suppressAvatarClick.current = true;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void tauriInvoke("overlay_start_dragging");
  }

  function endAvatarPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    avatarPointerGesture.current = null;
  }

  function activateAvatar() {
    if (suppressAvatarClick.current) {
      suppressAvatarClick.current = false;
      return;
    }
    openStatusPanel();
  }

  function openChatPanel() {
    setPanel((prev) => (prev === "chat" ? "none" : "chat"));
  }

  async function sendChat() {
    const message = chatDraft.trim();
    if (!message) return;
    setChatDraft("");
    setChatSending(true);
    setChatTurns((prev) => [...prev, { role: "user", text: message }]);
    try {
      const result = await trpc.chiefOfStaff.converse.mutate({
        workspaceId: PILOT_WORKSPACE,
        message,
        chainDepth: chatChainDepth,
        animal: prefs.animal,
      });
      setChatTurns((prev) => [...prev, { role: "assistant", text: result.reply }]);
      setChatChainDepth(result.decision.kind === "route" ? chatChainDepth + 1 : 0);
    } catch (e) {
      setChatTurns((prev) => [...prev, { role: "assistant", text: `Couldn't reach Bridge: ${String(e)}` }]);
    } finally {
      setChatSending(false);
    }
  }

  // Right-click menu actions.
  function handleHide() {
    setMenuOpen(false);
    void tauriInvoke("overlay_hide");
  }

  function handleMeditate() {
    setMenuOpen(false);
    setPanel("none");
    setAvatarStatus("idle");
  }

  function handleObserve() {
    setMenuOpen(false);
    setObserving(true);
    setAvatarStatus("reading_context");
    void tauriInvoke("capture_screenshot_on_demand").finally(() => {
      setObserving(false);
      setAvatarStatus("idle");
    });
  }

  const name = prefs.avatarName || prefs.animal[0]!.toUpperCase() + prefs.animal.slice(1);
  const label = STATUS_LABEL[status];

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-end",
        background: "transparent",
        overflow: "hidden",
        position: "relative",
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {menuOpen && (
        <>
          {/* Click-outside catcher — a right-click menu with no native OS
           * chrome needs its own dismiss surface. */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            role="menu"
            aria-label={`${name} — companion menu`}
            className="w-full mb-2 rounded-[var(--radius-card)] border border-border bg-background shadow-lg py-1 text-sm"
            style={{ flex: "1 1 auto", minHeight: 0, position: "relative", zIndex: 11 }}
          >
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-navy)" }}
              onClick={handleHide}
            >
              Hide
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-navy)" }}
              onClick={handleMeditate}
            >
              Meditate
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-navy)" }}
              onClick={handleObserve}
            >
              Observe — what am I looking at?
            </button>
          </div>
        </>
      )}

      {!menuOpen && panel === "status" && (
        <div
          role="dialog"
          aria-label={`${name} — companion panel`}
          className="w-full mb-2 rounded-[var(--radius-card)] border border-border bg-background shadow-lg p-4 text-sm"
          style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-[var(--color-navy)]">{name}</p>
            <button
              type="button"
              aria-label="Close"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => setPanel("none")}
            >
              ×
            </button>
          </div>
          <div className="space-y-1.5 text-[var(--color-navy-mid)]">
            <p>
              <span className="text-muted-foreground">Status: </span>
              {observing ? "Observing your screen…" : label}
            </p>
            <p>
              <span className="text-muted-foreground">Pending approvals: </span>
              {pendingError
                ? "not reachable yet"
                : pendingCount === null
                  ? "checking…"
                  : pendingCount}
            </p>
            <button
              type="button"
              className="mt-3 w-full rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-2 hover:opacity-90"
              onClick={() => void tauriInvoke("focus_main_window")}
            >
              Open Bridge
            </button>
          </div>
        </div>
      )}

      {!menuOpen && panel === "chat" && (
        <div
          role="dialog"
          aria-label={`Chat with ${name}`}
          className="w-full mb-2 rounded-[var(--radius-card)] border border-border bg-background shadow-lg text-sm flex flex-col"
          style={{ flex: "1 1 auto", minHeight: 0 }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
            <p className="font-medium text-[var(--color-navy)]">{name}</p>
            <button
              type="button"
              aria-label="Close chat"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => setPanel("none")}
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 space-y-2" style={{ minHeight: 0 }}>
            {chatTurns.length === 0 && (
              <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
                Ask {name} anything — I'll route it or draft a reply.
              </p>
            )}
            {chatTurns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
                <div
                  className="inline-block max-w-[85%] rounded-md px-2.5 py-1.5 text-xs"
                  style={{
                    backgroundColor: t.role === "user" ? "var(--color-steel)" : "var(--color-surface)",
                    color: t.role === "user" ? "white" : "var(--color-navy)",
                  }}
                >
                  {t.text}
                </div>
              </div>
            ))}
          </div>
          <form
            className="flex gap-1.5 p-2 border-t"
            style={{ borderColor: "var(--color-border)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void sendChat();
            }}
          >
            <input
              type="text"
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              disabled={chatSending}
              placeholder={`Ask ${name}…`}
              aria-label="Chat message"
              className="flex-1 min-w-0 rounded-[var(--radius-button)] border border-border px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={chatSending || !chatDraft.trim()}
              className="rounded-[var(--radius-button)] bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-2.5 py-1.5 hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {!menuOpen && (
        <div className="flex items-center justify-end gap-2" style={{ flex: "0 0 auto" }}>
          {state === "hover" && (
            <>
              <button
                type="button"
                onClick={openChatPanel}
                aria-label={`Chat with ${name}`}
                title="Chat"
                className="rounded-full bg-background border border-border shadow-md w-8 h-8 flex items-center justify-center hover:opacity-90"
              >
                <span aria-hidden="true" style={{ fontSize: "14px" }}>
                  💬
                </span>
              </button>
              <div className="whitespace-nowrap rounded-[var(--radius-button)] bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-2 py-1">
                {label}
              </div>
            </>
          )}
          {/* Avatar button + drag handle wrapper.
           *
           * Layout: the outer div stacks the drag handle ABOVE the avatar button
           * so the two hit areas are non-overlapping — the drag handle is for
           * moving the window; the button is for opening the status panel.
           *
           * Tauri's drag-region hook starts the native drag; Rust saves the
           * final position from the resulting debounced window-move events.
           *
           * The handle is hidden while a panel is expanded — the window is
           * larger then and the user is interacting with content, not dragging.
           */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
            {!expanded && (
              <div
                data-tauri-drag-region
                role="button"
                tabIndex={0}
                aria-label={`Drag to move ${name}`}
                title="Drag to move"
                style={{
                  width: 56,
                  height: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "grab",
                  borderRadius: "4px 4px 0 0",
                  // Subtle visual affordance: three dots visible on hover via CSS.
                }}
                className="companion-drag-handle"
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "block",
                    width: 20,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: "rgba(0,0,0,0.20)",
                    transition: "background-color 0.15s",
                  }}
                  className="companion-drag-indicator"
                />
              </div>
            )}
            <button
              type="button"
              onPointerDown={beginAvatarPointerGesture}
              onPointerMove={continueAvatarPointerGesture}
              onPointerUp={endAvatarPointerGesture}
              onPointerCancel={endAvatarPointerGesture}
              onClick={activateAvatar}
              aria-label={`${name}, ${label}`}
              title={`${label} — drag to move`}
              className="w-14 h-14 rounded-full bg-background border border-border shadow-md flex items-center justify-center focus:outline-none focus-visible:ring-2"
              style={{
                cursor: "grab",
                touchAction: "none",
                animation:
                  status === "idle" ? "bridge-companion-breathe 3.2s ease-in-out infinite" : undefined,
              }}
            >
              <div className="w-11 h-11" role="img" aria-label={`Avatar state: ${label}`}>
                <Creature animal={prefs.animal} status={status} blinking={blinking} reducedMotion={false} />
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {name} is {label.toLowerCase()}.
      </div>

      <style>{`
        @keyframes bridge-companion-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        html, body, #overlay-root { background: transparent !important; }
        .companion-drag-handle:hover .companion-drag-indicator {
          background-color: rgba(0,0,0,0.40) !important;
        }
        .companion-drag-handle:active { cursor: grabbing !important; }
      `}</style>
    </div>
  );
}
