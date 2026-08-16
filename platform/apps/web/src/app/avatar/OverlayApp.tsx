/**
 * OverlayApp — frontend of the FLOATING desktop companion window (R-002).
 *
 * Rendered by the separate Vite entry `overlay.html` inside the Tauri
 * "overlay" window (apps/desktop src-tauri/src/overlay.rs): ~96×96,
 * transparent, undecorated, always-on-top, anchored bottom-right. Reuses the
 * exact same AvatarFigure + avatar-store as the in-page AvatarOverlay so the two
 * surfaces can never drift apart visually.
 *
 * State machine (adopted Invoko spec; v1 operational subset implemented):
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChatView } from "../chat/ChatView";
import { CompanionAsk } from "./CompanionAsk";
import { CompanionComposer } from "./CompanionComposer";
import { CompanionZazooFace } from "./zazoo/CompanionZazooFace";
import { ZazooDirector } from "./zazoo/director";
import {
  ANSWERED_PERFORMANCE,
  CAPTURE_PERFORMANCE,
  CHASE_CAUGHT_PERFORMANCE,
  CHASE_FLEEING_PERFORMANCE,
  MEDITATE_PERFORMANCE,
  PET_PERFORMANCE,
  PTT_PRESSED_PERFORMANCE,
  statusToPerformance,
} from "./zazoo/status-performance";
import type { ZazooEmotion } from "./zazoo/director";

const VALID_EMOTIONS = new Set<string>(["calm","curious","thinking","listening","happy","proud","unsure","concerned","comforting","celebrating","sleepy"]);
function emotionPerformance(emotion: string | undefined) {
  if (!emotion || !VALID_EMOTIONS.has(emotion)) return ANSWERED_PERFORMANCE;
  return { emotion: emotion as ZazooEmotion, warmth: 0.85, energy: 0.55, duration: 3.0 };
}
import { tauriInvoke, tauriListen } from "./tauri-internals";
import { NotchHome, type NotchPose } from "./NotchHome";
import type { NotchGeometry } from "./notch-home";
import {
  CAPTURE_EVENT,
  STATUS_LABEL,
  dispatchCaptureEvent,
  loadAvatarPrefs,
  setAvatarStatus,
  useAvatarStatus,
} from "./avatar-store";

interface AvatarPointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragStarted: boolean;
}

const AVATAR_DRAG_THRESHOLD_PX = 4;
/** Fills the 96px collapsed window minus the 10px drag handle above it, so
 * the whole animal is visible rather than a head cropped into a chip. */
const AVATAR_RENDER_SIZE = 84;
const AVATAR_SESSION_READY_EVENT = "bridge:avatar-session-ready";
const COMPANION_PTT_EVENT = "bridge:companion-ptt";
const NOTCH_HOVER_EVENT = "bridge:notch-hover";
const CURSOR_EVENT = "bridge:cursor";
const OBSERVE_QUESTION = "What am I looking at?";
/** Screen distance at which the gaze channel saturates — roughly a third of a
 * laptop display, so ordinary mousing across the screen sweeps the pupils end
 * to end instead of pinning them at the limit the whole time. */
const GAZE_SATURATION_PX = 520;
/** macOS `say` runs near 175 wpm. The mouth flap is a performance, not a
 * lip-sync, so an estimate from the word count is indistinguishable from a real
 * end-of-speech callback — and costs no Rust-side child-process watcher.
 * ponytail: swap for a spoken-finished event if visemes ever matter. */
const SPEECH_WORDS_PER_SECOND = 175 / 60;

/** Which home Zazoo currently lives in. Persisted, because dragging him out of
 * the notch is a deliberate choice that must survive a restart — waking to find
 * him back in the notch would silently undo the gesture. */
type AvatarHome = "notch" | "free";
const HOME_STORAGE_KEY = "bridge.avatar.home.v1";

function loadHome(): AvatarHome {
  try {
    return window.localStorage.getItem(HOME_STORAGE_KEY) === "free" ? "free" : "notch";
  } catch {
    return "notch";
  }
}

function saveHome(home: AvatarHome) {
  try {
    window.localStorage.setItem(HOME_STORAGE_KEY, home);
  } catch {
    // A companion that cannot persist its home still works; it just forgets.
  }
}

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
const WINDOW_SIZE: Record<
  "collapsed" | "hover" | "expanded" | "chat" | "ask" | "menu",
  { w: number; h: number }
> = {
  collapsed: { w: 96, h: 96 },
  // Taller, not wider: the hover chat bar renders ABOVE the avatar (user
  // directive) so the window grows upward from the pinned bottom-right
  // corner instead of stretching leftward across the Dock.
  hover: { w: 300, h: 150 },
  expanded: { w: 320, h: 400 },
  chat: { w: 320, h: 420 },
  ask: { w: 380, h: 500 },
  // Four items now — an undecorated window clips its webview to its own
  // bounds, so a menu taller than this is a menu with an invisible last item.
  menu: { w: 220, h: 230 },
};

export function OverlayApp() {
  // Persisted visual preferences carry the deliberate "owl" default, so the
  // companion has a face before onboarding has ever run. The native shell owns
  // the session-scoped readiness gate (app running / signed in), which is now
  // the ONLY gate on the companion window appearing.
  const [prefs, setPrefs] = useState(() => loadAvatarPrefs(false));
  const [sessionReady, setSessionReady] = useState(false);
  const status = useAvatarStatus();
  // "status" = the existing pending-approvals panel (click the avatar).
  // "chat" = the hover chat bubble's compact inline chat.
  // "ask" = the screen-aware companion ask panel (TASK-027).
  const [panel, setPanel] = useState<"none" | "status" | "chat" | "ask">("none");
  // User-adjustable chat window size (logical px). The window is undecorated,
  // so the OS gives no resize border of its own — these invisible edge handles
  // are the only way to stretch it, and the size they produce is what the
  // `overlay_resize` effects below send to Rust.
  const [chatW, setChatW] = useState(WINDOW_SIZE.chat.w);
  const [chatH, setChatH] = useState(WINDOW_SIZE.chat.h);
  const resizeDrag = useRef<
    { edge: string; startX: number; startY: number; startW: number; startH: number } | null
  >(null);
  const resizeRaf = useRef<number | null>(null);

  const startResize = useCallback(
    (edge: string, event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Pointer capture keeps the drag live once the cursor leaves the window
      // — which it does immediately, since dragging an edge outward moves the
      // pointer outside the current bounds.
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeDrag.current = {
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startW: chatW,
        startH: chatH,
      };
    },
    [chatW, chatH],
  );

  const onResizeMove = useCallback((event: ReactPointerEvent) => {
    const drag = resizeDrag.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // The window pins its bottom-right corner, so the left/top edges are the
    // ones that grow it: dragging them outward (negative delta) means wider.
    const w = Math.round(
      Math.max(260, Math.min(700, drag.edge.includes("left") ? drag.startW - dx : drag.startW)),
    );
    const h = Math.round(
      Math.max(300, Math.min(900, drag.edge.includes("top") ? drag.startH - dy : drag.startH)),
    );
    if (resizeRaf.current !== null) cancelAnimationFrame(resizeRaf.current);
    resizeRaf.current = requestAnimationFrame(() => {
      setChatW(w);
      setChatH(h);
    });
  }, []);

  const endResize = useCallback(() => {
    resizeDrag.current = null;
  }, []);

  /** The invisible 6px drag edges, shared by both homes' chat panels. */
  const resizeHandles = (
    <>
      <div
        onPointerDown={(event) => startResize("left", event)}
        style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 6, cursor: "ew-resize", zIndex: 10 }}
      />
      <div
        onPointerDown={(event) => startResize("top", event)}
        style={{ position: "absolute", top: 0, left: 8, right: 8, height: 6, cursor: "ns-resize", zIndex: 10 }}
      />
      <div
        onPointerDown={(event) => startResize("top-left", event)}
        style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12, cursor: "nwse-resize", zIndex: 11 }}
      />
    </>
  );

  // True while the global push-to-talk shortcut is held (drives CompanionAsk
  // recording).
  const [pttActive, setPttActive] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [blinking, setBlinking] = useState(false);
  // Zazoo is the companion's face (desktop-companion wiki, Zazoo v1). The
  // director instance must be stable — ZazooAvatar's rAF effect depends on it.
  const director = useMemo(() => new ZazooDirector(), []);

  // The rig is a pure rendering of AvatarStatus: every status change replays
  // the derived pose. No emotion is stored anywhere; delete this effect and
  // only pixels change.
  useEffect(() => {
    director.perform(statusToPerformance(status));
  }, [director, status]);
  const blinkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stops the mouth flapping when the estimated speech duration is up. */
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (speechTimer.current) clearTimeout(speechTimer.current);
      director.setTalking(false);
    },
    [director],
  );
  const avatarPointerGesture = useRef<AvatarPointerGesture | null>(null);
  const suppressAvatarClick = useRef(false);

  // Right-click menu (Hide / Meditate / Observe).
  const [menuOpen, setMenuOpen] = useState(false);

  // Hover chat input (replaces the old hover status label — typing there and
  // pressing Enter opens the full chat panel with the message already sent).
  // The input itself is the shared CompanionComposer, which owns its own
  // draft. `pinned` keeps the hover bar visible after a click even when the
  // cursor leaves — clicked again (or panel opened) to unpin.
  const [chatSeed, setChatSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [askSeed, setAskSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [pinned, setPinned] = useState(false);

  // --- Notch home (roadmap Z1) -------------------------------------------
  const [home, setHome] = useState<AvatarHome>(() =>
    typeof window === "undefined" ? "notch" : loadHome(),
  );
  const [notchGeometry, setNotchGeometry] = useState<NotchGeometry | null>(null);
  const [notchHover, setNotchHover] = useState(false);
  // The Rust cursor poll only tests a small fixed rect around the cutout — it
  // has no idea the bed it just woke actually extends further down. Once the
  // window is real, its OWN DOM hover is a second, more accurate signal; the
  // two are OR'd below so the window stays up for as long as the cursor is
  // anywhere over the actual rendered content, not just the narrow wake zone.
  const [notchDomHover, setNotchDomHover] = useState(false);
  const [notchPose, setNotchPose] = useState<NotchPose>("bed");

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Retried, not fetched once. Without geometry this component falls through
    // to the free-floating overlay, so a single miss at startup — when the main
    // thread is busiest and the read is most likely to time out — parks the
    // companion away from the cutout for the entire session with nothing to
    // recover it. Backs off rather than hammering the main-thread hop.
    const attempt = (delayMs: number) => {
      void tauriInvoke("notch_geometry").then((geo) => {
        if (!active) return;
        if (geo) {
          setNotchGeometry(geo as NotchGeometry);
          return;
        }
        if (delayMs > 8000) {
          console.error("[companion] notch geometry never became available");
          return;
        }
        timer = setTimeout(() => attempt(delayMs * 2), delayMs);
      });
    };
    attempt(500);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // The Rust cursor poll is the only way to know the pointer reached the notch:
  // at rest the window is concealed, so it has no hit area of its own.
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void (async () => {
      unlisten = await tauriListen<{ inside: boolean }>(NOTCH_HOVER_EVENT, (payload) => {
        setNotchHover(Boolean(payload?.inside));
      });
    })().catch((error: unknown) => {
      console.error("[companion] notch hover listener failed", error);
    });
    return () => unlisten();
  }, []);

  // GAZE — Zazoo watches the real pointer. The overlay window is ~96px and the
  // cursor is almost always outside it, so DOM pointer events see nothing: the
  // Rust `mouseLocation` poll (the one the notch hover check already runs) is
  // the only source of gaze on the desktop. Screen point → offset from this
  // window's centre → the director's -1..1 cursor channel, which the rig turns
  // into pupil travel with the head lagging behind it.
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void (async () => {
      unlisten = await tauriListen<{ x: number; y: number }>(CURSOR_EVENT, (payload) => {
        if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
        const cx = window.screenX + window.innerWidth / 2;
        const cy = window.screenY + window.innerHeight / 2;
        // Saturates about a screen-third away: past that it is a held look in
        // one direction, and pushing the pupils further only makes them squint.
        const clamp = (v: number) => Math.max(-1, Math.min(1, v / GAZE_SATURATION_PX));
        director.setCursor({ x: clamp(payload.x - cx), y: clamp(payload.y - cy) });
      });
    })().catch((error: unknown) => {
      console.error("[companion] cursor listener failed", error);
    });
    return () => {
      unlisten();
      director.setCursor(null);
    };
  }, [director]);

  // Dragging the free avatar back up to the notch re-docks it (Rust's
  // drag-end check emits this when the window is released with its centre in
  // the notch hot zone). NotchHome's mount slide-in plays the "pull the bed
  // out and settle onto it" beat.
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void (async () => {
      unlisten = await tauriListen("bridge:notch-return", () => {
        setNotchPose("bed");
        setHome("notch");
        saveHome("notch");
      });
    })().catch((error: unknown) => {
      console.error("[companion] notch-return listener failed", error);
    });
    return () => unlisten();
  }, []);

  // In the notch the window is on screen only while it is wanted — hovering
  // the cutout (Rust signal), hovering the revealed bed/composer itself (DOM
  // signal — the geometric wake zone is intentionally too small to cover
  // that), or holding an open composer. Anything else conceals it, so a
  // sleeping Zazoo costs the desktop nothing.
  //
  // GEOMETRY IS PART OF THE CONTRACT. NotchHome renders only once the cutout is
  // known, so without geometry the free-floating overlay is what is on screen —
  // but the visibility effect below used to follow the stored `home` preference
  // instead, keeping the window concealed and waiting for a notch-hover signal
  // that Rust only ever emits when it HAS geometry. That combination is a
  // companion that never appears at all (2026-08-12: "the avatar is missing as
  // Desktop overlay"). One derived flag now drives presentation and rendering
  // alike, so the two can no longer disagree about which surface is live.
  const inNotchHome = home === "notch" && notchGeometry !== null;
  const notchVisible =
    inNotchHome &&
    (notchHover || notchDomHover || notchPose === "chat" || panel === "ask" || panel === "chat");
  useEffect(() => {
    if (!inNotchHome || !sessionReady) return;
    void tauriInvoke(notchVisible ? "overlay_present" : "overlay_conceal");
    // Once concealed, the window's own hover has nothing to report — clear it
    // so a stale `true` doesn't pin the window open forever the next wake.
    if (!notchVisible) setNotchDomHover(false);
  }, [inNotchHome, sessionReady, notchVisible]);

  const expanded = panel !== "none";

  useEffect(() => {
    let active = true;
    const refreshPreferences = () => {
      if (active) setPrefs(loadAvatarPrefs(false));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "bridge.avatar.v2") refreshPreferences();
    };
    window.addEventListener("storage", onStorage);
    refreshPreferences();
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let eventGeneration = 0;
    let unlisten: () => void = () => undefined;

    const applyReadiness = (ready: boolean) => {
      if (!active) return;
      setSessionReady(ready);
      setPrefs(loadAvatarPrefs(false));
      if (!ready) {
        setPanel("none");
        setHovering(false);
        setMenuOpen(false);
      }
    };

    void (async () => {
      unlisten = await tauriListen<boolean>(AVATAR_SESSION_READY_EVENT, (ready) => {
        eventGeneration += 1;
        applyReadiness(ready);
      });
      if (!active) {
        unlisten();
        return;
      }
      const generationBeforeRead = eventGeneration;
      const ready = await tauriInvoke("overlay_get_session_ready");
      if (
        active &&
        eventGeneration === generationBeforeRead &&
        typeof ready === "boolean"
      ) {
        applyReadiness(ready);
      }
    })().catch((error: unknown) => {
      console.error("[companion] readiness handshake failed", error);
    });

    return () => {
      active = false;
      unlisten();
    };
  }, []);

  // The OS-level window follows the same single gate as the render above:
  // session readiness only, never onboarding completion (user directive
  // 2026-08-05). Without this the companion window would stay concealed even
  // though the component was willing to render.
  useEffect(() => {
    // In the notch home, visibility is the hover contract's to decide (the
    // window is concealed at rest so the desktop is untouched). Presenting
    // here too would race that effect for control of one window.
    if (inNotchHome) return;
    void tauriInvoke(sessionReady ? "overlay_present" : "overlay_conceal");
  }, [sessionReady, inNotchHome]);

  // Derived companion state (the machine's read model).
  const working =
    status === "listening" || status === "reading_context" || status === "drafting";
  const state: CompanionState = expanded
    ? status === "error"
      ? "error"
      : working
        ? "working"
        : "expanded_idle"
    : hovering || pinned
      ? "hover"
      : "collapsed";

  // Blink tell — same window-event contract as the in-page overlay, PLUS a
  // bridge from the Rust-originated `sensor:capture` Tauri event so captures
  // announced by the shell (screenshots, provider drains) blink this avatar
  // regardless of which webview initiated them.
  useEffect(() => {
    function onCapture() {
      setBlinking(true);
      // The blink tell, performed: a one-shot curious lift that auto-reverts
      // to the status pose (director `duration`), alongside the 200ms flag
      // the aria/live-region path still uses.
      director.perform(CAPTURE_PERFORMANCE);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      blinkTimeout.current = setTimeout(() => setBlinking(false), 200);
    }
    window.addEventListener(CAPTURE_EVENT, onCapture);
    let unlisten: () => void = () => undefined;
    void (async () => {
      unlisten = await tauriListen("sensor:capture", () => {
        dispatchCaptureEvent();
      });
    })().catch((error: unknown) => {
      console.error("[companion] sensor:capture listener failed", error);
    });
    return () => {
      window.removeEventListener(CAPTURE_EVENT, onCapture);
      if (blinkTimeout.current) clearTimeout(blinkTimeout.current);
      unlisten();
    };
  }, [director]);

  // Chase game ("let's play a game" in Chat, `chase.rs`): the Rust flee loop
  // owns the window's position, this just owns the FACE — sneaking while
  // fleeing, a startled beat when the real cursor catches it (the loop
  // itself already snaps the window back home on capture).
  useEffect(() => {
    let unlistenStarted: () => void = () => undefined;
    let unlistenCaught: () => void = () => undefined;
    let unlistenStopped: () => void = () => undefined;
    void (async () => {
      unlistenStarted = await tauriListen("bridge:chase-started", () => {
        // The avatar itself never moves for this game (chase.rs drives a
        // separate pointer glyph on the annotate overlay) — this just plays
        // the "watching its pointer dart around" face.
        director.perform(CHASE_FLEEING_PERFORMANCE);
      });
      unlistenCaught = await tauriListen("bridge:chase-caught", () => {
        director.perform(CHASE_CAUGHT_PERFORMANCE);
      });
      unlistenStopped = await tauriListen("bridge:chase-stopped", () => {
        director.perform(statusToPerformance(status));
      });
    })().catch((error: unknown) => {
      console.error("[companion] chase game listener failed", error);
    });
    return () => {
      unlistenStarted();
      unlistenCaught();
      unlistenStopped();
    };
  }, [director, status]);

  // Point-at ("point at the settings button" in Chat, `point.rs`): Rust
  // does the locating, spotlighting, and window-glide — this just plays a
  // "looking at the screen, not you" beat while it works, same vocabulary
  // `reading_context` already uses (`statusToPerformance`), then reverts.
  useEffect(() => {
    let unlistenStarted: () => void = () => undefined;
    let unlistenDone: () => void = () => undefined;
    void (async () => {
      unlistenStarted = await tauriListen("bridge:point-started", () => {
        // Rust may have force-undocked the window to glide to the target
        // (same reasoning as chase-started above).
        setHome("free");
        saveHome("free");
        director.perform({ emotion: "curious", attention: "away" });
      });
      unlistenDone = await tauriListen("bridge:point-done", () => {
        director.perform(statusToPerformance(status));
      });
    })().catch((error: unknown) => {
      console.error("[companion] point-at listener failed", error);
    });
    return () => {
      unlistenStarted();
      unlistenDone();
    };
  }, [director, status]);

  // Global push-to-talk (⌘⇧Space, registered Rust-side): pressing summons
  // the ask panel and starts voice capture; releasing stops it. Only the
  // session-ready overlay reacts — a concealed avatar stays concealed.
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void (async () => {
      unlisten = await tauriListen<string>(COMPANION_PTT_EVENT, (state) => {
        if (!sessionReady) return;
        if (state === "pressed") {
          // Perk the ears on the keypress itself, ahead of mic-open — the
          // listening status pose follows once CompanionAsk starts recording.
          director.perform(PTT_PRESSED_PERFORMANCE);
          setMenuOpen(false);
          setAskSeed(null);
          setPanel("ask");
          setPttActive(true);
        } else {
          setPttActive(false);
        }
      });
    })().catch((error: unknown) => {
      console.error("[companion] push-to-talk listener failed", error);
    });
    return () => unlisten();
  }, [sessionReady, director]);

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
    // In the notch, NotchHome owns the window box (it must stay centred on the
    // cutout, which `overlay_resize` knows nothing about). Two effects sizing
    // one window would fight every frame.
    if (home !== "free") return;
    const size = menuOpen
      ? WINDOW_SIZE.menu
      : panel === "ask"
        ? WINDOW_SIZE.ask
        : panel === "chat"
          ? { w: chatW, h: chatH }
          : hovering || pinned
            ? WINDOW_SIZE.hover
            : WINDOW_SIZE.collapsed;
    void tauriInvoke("overlay_resize", { width: size.w, height: size.h });
  }, [panel, hovering, pinned, menuOpen, home, chatW, chatH]);

  // Docked in the notch, the ask/chat panels replace NotchHome outright (see
  // the render below) rather than being a variant of it, so they need their
  // own window box too. Deliberately NOT `overlay_dock_notch` (NotchHome's own
  // command, which raises the panel to PanelLevel::PopUpMenu): a panel this
  // size at that level crashed the app (uncatchable NSApplication objc2
  // exception — see decisions-log). `overlay_present_docked_panel` keeps the
  // SAME Status level the free-floating home already runs at safely.
  useEffect(() => {
    if (home !== "notch") return;
    if (panel !== "ask" && panel !== "chat") return;
    const size = panel === "ask" ? WINDOW_SIZE.ask : { w: chatW, h: chatH };
    void tauriInvoke("overlay_present_docked_panel", { width: size.w, height: size.h });
  }, [home, panel, chatW, chatH]);

  // Close panel/unpin when the overlay window loses focus (user clicks elsewhere
  // on the desktop or another app). This is what "clicking elsewhere closes it" means
  // in a Tauri always-on-top window — the OS blur event is the only signal available.
  useEffect(() => {
    function onBlur() {
      if (panel !== "none") setPanel("none");
      setPinned(false);
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [panel]);

  // Free-floating Zazoo: idle but breathing — no meditation (eyes-open = visible
  // breath and blink). The meditate action is still available via right-click menu.
  useEffect(() => {
    if (home !== "free" || status !== "idle") return;
    director.perform(
      hovering || expanded
        ? { emotion: "calm", action: "idle", attention: "user", energy: 0.4 }
        : { emotion: "calm", action: "idle", attention: "cursor", energy: 0.2, warmth: 0.8 },
    );
  }, [home, hovering, expanded, status, director]);

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
    director.perform(PET_PERFORMANCE);
    // Toggle pinned: clicking the avatar pins the hover bar visible; clicking
    // again (or opening a panel) unpins.
    if (panel !== "none") {
      setPanel("none");
      setPinned(false);
    } else {
      setPinned((prev) => !prev);
    }
  }

  // TALKING — the director has had a syllable-envelope `talk` channel since
  // Zazoo v1, and until now nothing outside the lab ever switched it on, so the
  // companion answered aloud with a closed mouth. `spoke` is the honest signal:
  // it is true only when Rust actually handed the text to `say`.
  function stopTalking() {
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = null;
    director.setTalking(false);
  }

  function handleAnswered(text: string, emotion?: string, spoke?: boolean) {
    director.perform(emotionPerformance(emotion));
    stopTalking();
    if (!spoke) return;
    director.setTalking(true);
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    speechTimer.current = setTimeout(
      () => director.setTalking(false),
      Math.min(90_000, (words / SPEECH_WORDS_PER_SECOND) * 1000 + 400),
    );
  }

  /** The single path from "typed at the companion" to "said in the chat".
   * Both homes' composers land here, so a message from the notch and a
   * message from the hover bar are the same act on the same thread — the one
   * the app's side panel and the Chief of Staff Page are already showing. */
  function openChatWith(text: string) {
    setChatSeed({ text, nonce: Date.now() });
    setPinned(false);
    setPanel("chat");
  }

  function openAskPanel() {
    setMenuOpen(false);
    setPinned(false);
    setAskSeed(null);
    setPanel((prev) => (prev === "ask" ? "none" : "ask"));
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
    // Meditating is a felt state + whole-body action layered on top of idle
    // status, not a new AvatarStatus — it persists until the next status
    // change (e.g. listening) naturally overrides it.
    director.perform(MEDITATE_PERFORMANCE);
  }

  // The companion's pointer only ever appeared as a side effect of an answer
  // that happened to place a mark, so "I can't see the pointer" had no way to
  // be checked. This is the direct trigger: fifteen seconds of pointer, on
  // demand, independent of whether any model said anything.
  function handleShowPointer() {
    setMenuOpen(false);
    void tauriInvoke("companion_demo_pointer", { durationSecs: 15 });
  }

  function handleObserve() {
    setMenuOpen(false);
    setPinned(false);
    setAskSeed({ text: OBSERVE_QUESTION, nonce: Date.now() });
    setPanel("ask");
  }

  const name = prefs.avatarName || "Bridge Avatar";
  const label = STATUS_LABEL[status];
  // User directive 2026-08-05: "Irrespective of onboarding, I want the avatar
  // to appear." The onboarding-completion gate (`prefs.avatarReady`) is gone;
  // the native shell's session gate stays, because a companion window with no
  // app session behind it could not act on anything at all.
  if (!sessionReady) return null;

  // Notch home: a wholly different surface, not a variant of the free overlay
  // — EXCEPT for the ask/chat panels, which are the same governed surfaces
  // regardless of where the avatar lives (⌘⇧Space push-to-talk sets `panel`
  // the same way in both homes; a docked avatar should not lose voice,
  // screen-pointing, Research Runs, or the ability to actually send a chat
  // message just because it is parked in the notch). NotchHome only owns the
  // idle/resting surface — it only renders once geometry is known, since
  // placing a notch panel from guessed coordinates would put it somewhere
  // arbitrary on the display.
  if (inNotchHome) {
    if (panel === "ask") {
      return (
        <div
          role="dialog"
          aria-label={`${name} — screen and voice`}
          style={{
            width: "100vw",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--color-background)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <p className="font-medium text-[var(--color-navy)]">{name} — Screen &amp; voice</p>
            <button
              type="button"
              aria-label="Close ask panel"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => {
                setPanel("none");
                setAskSeed(null);
              }}
            >
              ×
            </button>
          </div>
          <CompanionAsk
            name={name}
            pttActive={pttActive}
            autoQuestion={askSeed}
            onAutoQuestionConsumed={() => setAskSeed(null)}
            onAnswered={handleAnswered}
            onSpeechStopped={stopTalking}
          />
        </div>
      );
    }

    if (panel === "chat") {
      return (
        <div
          role="dialog"
          aria-label={`Chat with ${name}`}
          style={{
            width: "100vw",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--color-background)",
            borderRadius: "var(--radius-card)",
            position: "relative",
          }}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          {resizeHandles}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <p className="font-medium text-[var(--color-navy)]">{name}</p>
            <button
              type="button"
              aria-label="Close chat"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => {
                setPanel("none");
                setChatSeed(null);
                setNotchPose("bed");
              }}
            >
              ×
            </button>
          </div>
          <ChatView
            key={chatSeed?.nonce ?? "chat"}
            surface="avatar_overlay"
            compact
            initialDraft={chatSeed?.text}
            autoSend={!!chatSeed}
            onOpenTask={(taskId) => {
              void tauriInvoke("focus_main_window", {
                route: `/task-manager/${taskId}`,
              });
            }}
          />
        </div>
      );
    }

    return (
      <NotchHome
        director={director}
        geometry={notchGeometry}
        pose={notchPose}
        onPose={setNotchPose}
        onDomHoverChange={setNotchDomHover}
        visible={notchVisible}
        name={name}
        // Hand off to the real ChatView above — the same `openChatWith` the
        // free-floating hover composer calls, so both homes send into one
        // conversation. `autoSend` fires this seeded draft as soon as that
        // panel mounts.
        onSubmit={openChatWith}
        onLanded={() => {
          setHome("free");
          saveHome("free");
          setNotchPose("bed");
          // Landing is an arrival, not a state: the settle performance is over,
          // so hand back to the resting meditation the free home defaults to.
          director.perform({ emotion: "calm", action: "idle", attention: "cursor", energy: 0.2, warmth: 0.8 });
        }}
      />
    );
  }

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
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-navy)" }}
              onClick={handleShowPointer}
            >
              Show pointer (15s)
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-navy)" }}
              onClick={openAskPanel}
            >
              Ask about my screen
            </button>
          </div>
        </>
      )}

      {!menuOpen && panel === "ask" && (
        <div
          role="dialog"
          aria-label={`${name} — screen and voice`}
          className="w-full mb-2 rounded-[var(--radius-card)] border border-border bg-background shadow-lg text-sm flex flex-col"
          style={{ flex: "1 1 auto", minHeight: 0 }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <p className="font-medium text-[var(--color-navy)]">{name} — Screen &amp; voice</p>
            <button
              type="button"
              aria-label="Close ask panel"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => {
                setPanel("none");
                setAskSeed(null);
              }}
            >
              ×
            </button>
          </div>
          <CompanionAsk
            name={name}
            pttActive={pttActive}
            autoQuestion={askSeed}
            onAutoQuestionConsumed={() => setAskSeed(null)}
            onAnswered={handleAnswered}
            onSpeechStopped={stopTalking}
          />
        </div>
      )}

      {!menuOpen && panel === "chat" && (
        <div
          role="dialog"
          aria-label={`Chat with ${name}`}
          className="w-full mb-2 rounded-[var(--radius-card)] border border-border bg-background shadow-lg text-sm flex flex-col"
          style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          {resizeHandles}
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
            <p className="font-medium text-[var(--color-navy)]">{name}</p>
            <button
              type="button"
              aria-label="Close chat"
              className="text-muted-foreground hover:text-[var(--color-steel)]"
              onClick={() => {
                setPanel("none");
                setChatSeed(null);
              }}
            >
              ×
            </button>
          </div>
          <ChatView
            key={chatSeed?.nonce ?? "chat"}
            surface="avatar_overlay"
            compact
            initialDraft={chatSeed?.text}
            autoSend={!!chatSeed}
            onOpenTask={(taskId) => {
              void tauriInvoke("focus_main_window", {
                route: `/task-manager/${taskId}`,
              });
            }}
          />
        </div>
      )}

      {!menuOpen && (
        <div
          className="flex flex-col items-end justify-end gap-1.5"
          style={{ flex: "0 0 auto" }}
        >
          {/* The chat bar sits ABOVE the avatar (user directive), never
           * beside it — beside pushed the row leftward over the Dock. */}
          {state === "hover" && (
            <div className="flex items-center gap-1.5 w-full">
              <button
                type="button"
                onClick={openAskPanel}
                aria-label={`Ask ${name} about your screen`}
                title="Ask about my screen (⌘⇧Space)"
                className="rounded-full bg-background border border-border shadow-md w-8 h-8 flex items-center justify-center hover:opacity-90 flex-shrink-0"
              >
                <span aria-hidden="true" style={{ fontSize: "14px" }}>
                  ✨
                </span>
              </button>
              {/* The SAME composer the notch renders (CompanionComposer):
               * typing here and hitting Enter opens the chat panel with this
               * message already sent (ChatView's autoSend). */}
              <CompanionComposer
                name={name}
                variant="hover"
                onSubmit={openChatWith}
                onFocus={() => setHovering(true)}
                onDismiss={() => setPinned(false)}
              />
            </div>
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
              className="flex items-center justify-center focus:outline-none focus-visible:ring-2 rounded-md"
              style={{
                cursor: "grab",
                touchAction: "none",
                // No plate behind the companion: the transparent overlay
                // window shows the animal itself, not a chip with a face in it.
                background: "transparent",
                border: "none",
                padding: 0,
                width: AVATAR_RENDER_SIZE,
                height: AVATAR_RENDER_SIZE,
              }}
            >
              <CompanionZazooFace
                director={director}
                size={AVATAR_RENDER_SIZE}
                crop={false}
                label={`Avatar state: ${label}${blinking ? " (capturing)" : ""}`}
              />
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
