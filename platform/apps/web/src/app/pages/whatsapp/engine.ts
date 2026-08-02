/**
 * `WhatsAppEngine` — the single adapter every WhatsApp surface consumes.
 *
 * ADR-158: one WhatsApp account, one authenticated profile, one wa-js runtime,
 * many application surfaces consuming it. All `WPP` access sits behind a
 * TWO-LAYER adapter:
 *
 *   1. This TypeScript layer NAMES an operation (`"list_groups"`, …).
 *   2. The Rust allowlist in `whatsapp_webview.rs` OWNS the script that name
 *      resolves to, and refuses every name it does not recognise.
 *
 * The web app therefore cannot supply JavaScript, a selector, or any other
 * expression — and no method here accepts one. `groupParticipants` takes a
 * group id, which Rust validates with `is_group_id` before interpolating it;
 * that is the only caller-supplied value that reaches a script, and it is
 * shape-checked on the trusted side of the boundary.
 *
 * The boundary is structural, not conventional (ADR-158 consequences): the
 * session webview is a different origin in a different process and is
 * deliberately absent from Tauri capabilities, so nothing outside this adapter
 * *can* reach `window.WPP` even if it tried. This interface must never grow an
 * API that would re-open that hole.
 *
 * Everything degrades honestly off the desktop shell: `web.whatsapp.com`
 * refuses framing and no page may inject into another origin, so a browser or
 * mobile client gets `available === false` and an empty/unavailable state
 * rather than an exception.
 */
import {
  hideSession,
  isDesktopShell,
  openSession,
  positionSession,
  rectOf,
  runReadOp,
  sessionStatus,
  type PnLidPair,
  type RawContact,
  type RawGroup,
  type SessionRect,
  type WhatsAppStatus,
} from "./whatsapp-shell";
import { tauriListen } from "../../avatar/tauri-internals";

export type { PnLidPair, RawContact, RawGroup, SessionRect, WhatsAppStatus };
export { rectOf };

/** Connection/sync state of the one linked session. */
export type ConnectionState = WhatsAppStatus;

/**
 * One coalesced event from the session.
 *
 * The payload is intentionally an inert envelope: a `type` string plus opaque
 * `data`. It carries no code and nothing here evaluates it.
 */
export interface WhatsAppEngineEvent {
  /** e.g. `"active-chat-changed"`. Producer-defined; unknown types are ignored. */
  type: string;
  /** ISO-8601 time the shell observed it, when the producer supplies one. */
  at?: string;
  /** Opaque, producer-defined detail. Treated as untrusted data. */
  data?: unknown;
}

export type WhatsAppEventListener = (event: WhatsAppEngineEvent) => void;
export type Unsubscribe = () => void;

/**
 * The batched push channel from the session (ADR-158: "the event channel needs
 * batching" — one cancelled-navigation per `WPP` event will not survive a busy
 * account, so the injected listener coalesces and flushes on interval or
 * buffer size).
 *
 * TODO(TASK-030, Track A): the Rust emitter for this channel is owned by the
 * sibling agent building the injected batching listener. Until it lands no
 * events arrive; `subscribe()` below is a live listener that simply never
 * fires, and every surface must keep working without it. Naming follows the
 * shell's existing convention (`annotate:marks`, `sensor:capture`).
 */
export const WHATSAPP_EVENT_CHANNEL = "whatsapp:session-events";

export interface WhatsAppEngine {
  /** True only inside the Bridge desktop shell, where the session can exist. */
  isAvailable(): boolean;

  // ── Reads ─────────────────────────────────────────────────────────────────
  getConnectionState(): Promise<ConnectionState>;
  listContacts(): Promise<RawContact[]>;
  listGroups(): Promise<RawGroup[]>;
  groupParticipants(groupId: string): Promise<RawContact[]>;
  /**
   * Ids of the direct chats the owner actually has. v1's allowlisted op
   * returns ids only — not chat models — so the type says so rather than
   * promising a richer shape the engine cannot deliver.
   */
  listDirectChatIds(): Promise<string[]>;
  /** WhatsApp's OWN phone ↔ LID mapping. Never inferred by us. */
  pnLidMap(): Promise<PnLidPair[]>;

  // ── The session surface ───────────────────────────────────────────────────
  /** Show the contained session webview pinned to a viewport-relative rect. */
  showSession(rect: SessionRect): Promise<void>;
  /** Re-pin the session webview after the anchor moved or resized. */
  positionSession(rect: SessionRect): Promise<void>;
  hideSession(): Promise<void>;

  // ── Events ────────────────────────────────────────────────────────────────
  /**
   * Listen to the batched session channel. Returns synchronously so callers
   * can unsubscribe from a React cleanup without awaiting; if the channel does
   * not exist yet the result is a no-op unsubscribe and no error is raised.
   */
  subscribe(listener: WhatsAppEventListener): Unsubscribe;
}

/** Normalise whatever the channel delivers into a flat list of events. */
function toEvents(payload: unknown): WhatsAppEngineEvent[] {
  const batch = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && Array.isArray((payload as { events?: unknown }).events)
      ? ((payload as { events: unknown[] }).events)
      : [];
  return batch.filter(
    (entry): entry is WhatsAppEngineEvent =>
      typeof entry === "object" && entry !== null && typeof (entry as { type?: unknown }).type === "string",
  );
}

class DesktopWhatsAppEngine implements WhatsAppEngine {
  isAvailable(): boolean {
    return isDesktopShell();
  }

  getConnectionState(): Promise<ConnectionState> {
    return sessionStatus();
  }

  listContacts(): Promise<RawContact[]> {
    return runReadOp<RawContact[]>("list_contacts");
  }

  listGroups(): Promise<RawGroup[]> {
    return runReadOp<RawGroup[]>("list_groups");
  }

  groupParticipants(groupId: string): Promise<RawContact[]> {
    return runReadOp<RawContact[]>("group_participants", groupId);
  }

  listDirectChatIds(): Promise<string[]> {
    return runReadOp<string[]>("list_direct_chats");
  }

  pnLidMap(): Promise<PnLidPair[]> {
    return runReadOp<PnLidPair[]>("pn_lid_map");
  }

  showSession(rect: SessionRect): Promise<void> {
    return openSession(rect);
  }

  positionSession(rect: SessionRect): Promise<void> {
    return positionSession(rect);
  }

  hideSession(): Promise<void> {
    return hideSession();
  }

  subscribe(listener: WhatsAppEventListener): Unsubscribe {
    if (!isDesktopShell()) return () => undefined;

    let stopped = false;
    let dispose: Unsubscribe | null = null;

    void tauriListen<unknown>(WHATSAPP_EVENT_CHANNEL, (payload) => {
      if (stopped) return;
      for (const event of toEvents(payload)) listener(event);
    })
      .then((unlisten) => {
        if (stopped) unlisten();
        else dispose = unlisten;
      })
      .catch(() => {
        // The channel does not exist yet (see the TODO above). A surface
        // without live events polls or renders its last known state; it must
        // never fail because a push channel is missing.
      });

    return () => {
      stopped = true;
      dispose?.();
      dispose = null;
    };
  }
}

/** The one engine instance every WhatsApp surface consumes. */
export const whatsAppEngine: WhatsAppEngine = new DesktopWhatsAppEngine();
