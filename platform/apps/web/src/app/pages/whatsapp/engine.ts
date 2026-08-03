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
  haltSending,
  hideSession,
  isDesktopShell,
  isOpRefused,
  openSession,
  positionSession,
  rearmSending,
  rectOf,
  reloadSession,
  resetSession,
  runReadOp,
  sendCeilingStatus,
  sendMessage,
  sessionStatus,
  type PnLidPair,
  type RawContact,
  type RawGroup,
  type SendCeilingStatus,
  type SendMessageResult,
  type SessionRect,
  type SessionResetReport,
  type WhatsAppStatus,
} from "./whatsapp-shell";
import { decideManualSend } from "./compose";
import { tauriListen } from "../../avatar/tauri-internals";
import { trpc } from "../../lib/trpc";
import { performAutomatedSend, type OutboundOutcome, type SendPort } from "@bridge/whatsapp";
import type { RecipientApproval, SendPolicyContext, SendRequest } from "@bridge/whatsapp";
import type { RawChatSummary, RawMessage } from "@bridge/whatsapp";

export type {
  OutboundOutcome,
  PnLidPair,
  RawChatSummary,
  RawContact,
  RawGroup,
  RawMessage,
  SendCeilingStatus,
  SendMessageResult,
  SessionRect,
  SessionResetReport,
  WhatsAppStatus,
};
export { rectOf, isOpRefused };

/**
 * Where the session window is parked when it is running as the ENGINE rather
 * than as a visible surface.
 *
 * Far off any display and one logical pixel: the window still exists, still
 * holds the linked session, and still answers `eval`, but it is never
 * composited anywhere the user can see. The spike (2026-08-02) measured a
 * never-ordered-in WKWebView keeping a long-lived server-push connection open
 * and answering host `evaluateJavaScript` for the full run, with timer
 * throttling no worse than an ordered-in but occluded window - so hiding costs
 * nothing the app was not already paying whenever the user left the Page.
 */
const PARKED_RECT: SessionRect = { x: -20_000, y: -20_000, width: 1, height: 1 };

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

  // ── Message capture ───────────────────────────────────────────────────────
  /**
   * The thread inventory: ids, labels, and last-activity times. NO bodies —
   * scheduling sync must not become a way to stream every conversation.
   */
  listChatSummaries(): Promise<RawChatSummary[]>;
  /**
   * One thread's messages newer than `since` (epoch SECONDS, exclusive).
   *
   * The three arguments are packed into the shell's single op argument and
   * re-validated in Rust before they touch a script; nothing here can widen
   * that, because nothing here supplies an expression.
   */
  listMessages(chatId: string, since: number, limit: number): Promise<RawMessage[]>;
  /**
   * Whether this build of the desktop shell can read messages at all.
   *
   * Probed, not assumed: the ops above live behind a shell allowlist this app
   * cannot inspect, so the only honest answer comes from asking. Returns
   * `false` when the shell refuses the op by name, and REJECTS on any other
   * failure — "the shell cannot do this" and "the read broke" are different
   * facts and the surface says different things about them.
   */
  canReadMessages(): Promise<boolean>;

  // ── The session surface ───────────────────────────────────────────────────
  /**
   * Start the session and leave it INVISIBLE, running as the engine.
   *
   * This is the normal path. The user never sees the WhatsApp window; chats are
   * rendered by Bridge from the Local Plane store. `showSession` exists only for
   * device linking, where a QR code genuinely has to be looked at.
   */
  ensureHiddenSession(): Promise<void>;
  /** Show the contained session webview pinned to a viewport-relative rect. */
  showSession(rect: SessionRect): Promise<void>;
  /** Re-pin the session webview after the anchor moved or resized. */
  positionSession(rect: SessionRect): Promise<void>;
  hideSession(): Promise<void>;

  // ── Recovery (TASK-030 shell fixes) ───────────────────────────────────────
  /**
   * Reload the session page — same store, fresh load. The cheap first thing to
   * try when WhatsApp Web wedges. `false` means there was no window to reload.
   */
  reloadSession(): Promise<boolean>;
  /**
   * The escape hatch for invalidated session storage: closes the session
   * window, moves the WKWebView data store aside (never deletes), and clears
   * the persisted store id so the next session start shows a QR. The device
   * must be re-linked afterwards — the surface confirms before calling this.
   */
  resetSession(): Promise<SessionResetReport | undefined>;

  // ── Write ─────────────────────────────────────────────────────────────────
  /**
   * The whole outbound gate for an AGENT-initiated send, in the one order that
   * is safe (ADR-158, TASK-030):
   *
   *   policy refusals → `decideSend` → the Rust ceiling → send.
   *
   * The first two run here, in `@bridge/whatsapp`. Refusals come first so a
   * first-contact message or a send during a halt is never turned into an
   * approval prompt — asking a human to approve what the system will refuse
   * anyway is how people learn to click through prompts, and the consent gate
   * is precisely the prompt that must stay deliberate.
   *
   * The third runs in the shell, against DURABLE state, and it is the one that
   * binds: the daily cap, the per-recipient cooldown and the kill switch all
   * survive an app restart, because a cap that a relaunch resets is not a cap.
   * A caller that somehow reached the shell without passing the steps above
   * still hits it.
   */
  sendAutomatedMessage(
    request: SendRequest,
    approvals: readonly RecipientApproval[],
    context: SendPolicyContext,
  ): Promise<OutboundOutcome>;

  /**
   * A send a HUMAN typed and pressed Send on (ADR-160).
   *
   * Policied differently from an Agent's send, and deliberately so: the
   * automation discipline in `@bridge/whatsapp`'s `evaluateSendPolicy` is
   * anti-bulk-outreach protection (consent gate, business hours, near-identical
   * bodies, jitter) and describes nothing a person replying in a conversation
   * is doing. `decideManualSend` keeps the validation every send needs and
   * drops the scheduling advice no human send wants.
   *
   * It is NOT a second write path. It reaches the wire through the SAME
   * `sendPort` as `sendAutomatedMessage`, therefore the same shell command,
   * therefore the same DURABLE Rust ceiling — the cap, the per-recipient
   * cooldown and the sticky kill switch all still bind, and nothing here can
   * raise them. Refusals come back as values, never as throws.
   */
  sendManualMessage(request: SendRequest): Promise<OutboundOutcome>;

  /** What the shell's ceiling currently allows. `undefined` off the desktop. */
  sendCeiling(): Promise<SendCeilingStatus | undefined>;
  /** Halt automated sending. Nothing lifts this but `rearmAutomatedSending`. */
  haltAutomatedSending(reason: string): Promise<SendCeilingStatus | undefined>;
  /** Re-arm. Takes the name of a HUMAN; never call it from an Agent or a timer. */
  rearmAutomatedSending(rearmedBy: string): Promise<SendCeilingStatus | undefined>;

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

/**
 * Hand one send outcome to the audit log (`whatsapp.recordSendOutcome`).
 *
 * The procedure is a seam, not a send: it writes what the gate ALREADY decided
 * into the Local Plane audit namespace the analytics panels read, and touches
 * no transport. Failures are logged rather than thrown — the outcome stands
 * whether or not its row landed, and a caller retrying a send because the
 * bookkeeping hiccuped would be worse than a gap in the log.
 */
async function recordOutcomeInAudit(request: SendRequest, outcome: OutboundOutcome): Promise<void> {
  try {
    await trpc.whatsapp.recordSendOutcome.mutate({
      recipientKey: request.recipientKey,
      status: outcome.status,
      ...(outcome.status === "sent"
        ? { delaySeconds: Math.min(86_400, Math.max(0, Math.round(outcome.delaySeconds))) }
        : { reason: outcome.reason }),
      ...(outcome.status === "refused" || outcome.status === "deferred"
        ? outcome.code !== undefined
          ? { code: outcome.code }
          : {}
        : {}),
      ...(outcome.status === "deferred" && outcome.earliestAtMs !== undefined
        ? { earliestAtMs: outcome.earliestAtMs }
        : {}),
    });
  } catch (failure) {
    console.warn("[whatsapp] a send outcome could not be recorded in the audit log", failure);
  }
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

  listChatSummaries(): Promise<RawChatSummary[]> {
    return runReadOp<RawChatSummary[]>("list_chats");
  }

  listMessages(chatId: string, since: number, limit: number): Promise<RawMessage[]> {
    // Packed into the shell's one op argument. Every field is re-parsed and
    // shape-checked in Rust; this side only has to not mangle it.
    const argument = `${chatId}|${Math.max(0, Math.floor(since))}|${Math.max(1, Math.floor(limit))}`;
    return runReadOp<RawMessage[]>("list_messages", argument);
  }

  async canReadMessages(): Promise<boolean> {
    if (!isDesktopShell()) return false;
    try {
      await this.listChatSummaries();
      return true;
    } catch (failure) {
      if (isOpRefused(failure)) return false;
      throw failure;
    }
  }

  async ensureHiddenSession(): Promise<void> {
    if (!isDesktopShell()) return;
    // Open parked rather than opening and then moving: the window is created at
    // a rect no display contains, so there is no frame in which it appears over
    // the app. `hide()` afterwards is what actually makes it invisible; the
    // parked rect only removes the flash before that lands.
    await openSession(PARKED_RECT);
    await hideSession();
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

  reloadSession(): Promise<boolean> {
    return reloadSession();
  }

  resetSession(): Promise<SessionResetReport | undefined> {
    return resetSession();
  }

  /**
   * The shell end of the outbound path. Nothing calls this but
   * `performAutomatedSend`, and it is only reached with a grant that module
   * minted — so a body that never passed the gate has no route to the wire.
   */
  private readonly sendPort: SendPort = async (request) => {
    const result = await sendMessage(request.targetId, request.recipientKey, request.body);
    if (result.status === "sent") {
      return result.messageId ? { status: "sent", messageId: result.messageId } : { status: "sent" };
    }
    return {
      status: "refused",
      code: result.code,
      reason: result.reason,
      ...(result.earliestAtMs !== undefined ? { earliestAtMs: result.earliestAtMs } : {}),
    };
  };

  async sendAutomatedMessage(
    request: SendRequest,
    approvals: readonly RecipientApproval[],
    context: SendPolicyContext,
  ): Promise<OutboundOutcome> {
    const outcome = await performAutomatedSend(request, approvals, context, this.sendPort);
    // The audit seam (TASK-030): every outcome the gate produced becomes a row
    // in the Local Plane audit log the panels read. Recording only — the gate
    // above is the ONLY send path, and it has already decided by the time this
    // runs. Fire-and-forget with a warning: an audit write failing must not
    // turn a decided outcome into a thrown error, but it must not be silent
    // either.
    void recordOutcomeInAudit(request, outcome);
    return outcome;
  }

  async sendManualMessage(request: SendRequest): Promise<OutboundOutcome> {
    const decision = decideManualSend(request);
    if (decision.status === "refused") {
      const outcome: OutboundOutcome = { status: "refused", reason: decision.reason };
      void recordOutcomeInAudit(request, outcome);
      return outcome;
    }

    // The one transport, shared with the automated path. Everything the shell
    // decides from here — cap, cooldown, kill switch — is the durable answer,
    // and it is reported, not swallowed.
    const result = await this.sendPort(decision.request, decision.grant);
    const outcome: OutboundOutcome =
      result.status === "sent"
        ? {
            status: "sent",
            request: decision.request,
            messageId: result.messageId,
            // A person is already pacing this by typing it. There is no
            // scheduler delay to carry.
            delaySeconds: 0,
          }
        : result.earliestAtMs !== undefined
          ? {
              status: "deferred",
              reason: result.reason ?? "The desktop shell's send ceiling refused this message.",
              code: result.code,
              earliestAtMs: result.earliestAtMs,
            }
          : {
              status: "refused",
              reason: result.reason ?? "The desktop shell's send ceiling refused this message.",
              code: result.code,
            };
    void recordOutcomeInAudit(decision.request, outcome);
    return outcome;
  }

  sendCeiling(): Promise<SendCeilingStatus | undefined> {
    return sendCeilingStatus();
  }

  haltAutomatedSending(reason: string): Promise<SendCeilingStatus | undefined> {
    return haltSending(reason);
  }

  rearmAutomatedSending(rearmedBy: string): Promise<SendCeilingStatus | undefined> {
    return rearmSending(rearmedBy);
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
