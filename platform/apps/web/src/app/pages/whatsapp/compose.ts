/**
 * The MANUAL send path's pure parts, and the sentences the Chats surface says
 * about an outcome.
 *
 * ── Why a manual policy exists at all (ADR-160) ──────────────────────────────
 *
 * `@bridge/whatsapp`'s `evaluateSendPolicy` is anti-ban discipline for BULK
 * OUTREACH: a consent gate so automation never opens a conversation, a
 * near-identical-body limit, recipient-local business hours, a seven-day
 * per-recipient cooldown, and human-pacing jitter. Every one of those rules is
 * about a machine deciding to message someone. None of them describes a person
 * typing one reply into the conversation they are looking at — applied there
 * they would refuse an ordinary reply as a "first contact", refuse a second
 * reply for a week, and refuse anything after 9pm.
 *
 * So a manual send is policied DIFFERENTLY. It is not policied LESS in the
 * place that binds:
 *
 *   - It converges on the SAME shell command as an automated send
 *     (`whatsapp_send_start`), so there is exactly one transport.
 *   - The Rust ceiling — durable daily cap, per-recipient cooldown, sticky kill
 *     switch — still runs, on the trusted side of the IPC boundary, and its
 *     answer still binds. Nothing here can raise it, and this module passes no
 *     count of any kind.
 *   - Every outcome still goes through the audit seam.
 *
 * What this module drops is the ADVISORY renderer-side automation policy, which
 * exists to explain and to schedule an Agent's behaviour. What it keeps is the
 * validation `send.ts` does for every send — empty body, over-length body,
 * malformed target, missing recipient key — because those are refusals no
 * approval and no waiting can fix.
 *
 * The honest consequence, recorded rather than hidden: because the shell cannot
 * yet tell a manual send from an automated one, the durable cooldown and cap
 * apply to both. A human's second message to the same person inside the cooldown
 * window WILL be refused by the ceiling. That refusal is rendered here as a
 * value with its reason and its clearing time — never a silent no-op — and the
 * fix (teaching the shell a manual origin with its own limits against the same
 * ledger) is a shell change tracked in ADR-160.
 *
 * Nothing in this file touches the transport, and nothing in it can supply
 * JavaScript: it produces a target id, a recipient key and a body, which is the
 * entire vocabulary the renderer is allowed.
 */
import {
  MAX_BODY_LENGTH,
  bodyDigest,
  groupDedupeKeyFor,
  isLidId,
  toE164,
  type OutboundOutcome,
  type SendGrant,
  type SendRequest,
} from "@bridge/whatsapp";

/** A thread as the Chats surface knows it, before it is a send target. */
export interface ChatTarget {
  chatId: string;
  isGroup?: boolean | undefined;
}

/**
 * Turn a synced thread into a send target.
 *
 * The recipient key uses the SAME identity spaces as v1 matching
 * (`whatsapp:+…`, `whatsapp-lid:…`, `whatsapp-group:…`) so a manual send is
 * counted against the same recipient the rest of the Module means. Deriving a
 * phone number from a `@lid` id is exactly the laundering `toE164` refuses, so
 * a Linked-ID chat gets a LID key rather than an invented number.
 *
 * `undefined` means the chat id names no recipient we can key an outcome
 * against — the surface refuses rather than sending to something it cannot
 * later account for.
 */
export function recipientKeyForChat(target: ChatTarget): string | undefined {
  const { chatId } = target;
  if (!chatId) return undefined;
  if (target.isGroup === true || chatId.endsWith("@g.us")) return groupDedupeKeyFor(chatId);
  if (isLidId(chatId)) return `whatsapp-lid:${chatId}`;
  const e164 = toE164(chatId);
  return e164 ? `whatsapp:${e164}` : undefined;
}

/** Build the send request for a thread, or say why the thread cannot take one. */
export function manualSendRequest(
  target: ChatTarget,
  body: string,
): { request: SendRequest } | { refusal: string } {
  const recipientKey = recipientKeyForChat(target);
  if (!recipientKey) {
    return {
      refusal:
        `“${target.chatId}” is not an address Bridge can key a send against, so nothing was sent.`,
    };
  }
  const isGroup = target.isGroup === true || target.chatId.endsWith("@g.us");
  return {
    request: {
      targetKind: isGroup ? "community" : "person",
      targetId: target.chatId,
      recipientKey,
      body,
    },
  };
}

export type ManualSendDecision =
  | { status: "allowed"; request: SendRequest; grant: SendGrant }
  /** Not sendable. Waiting does not fix it, and no approval would either. */
  | { status: "refused"; reason: string };

function isSendableTargetId(targetId: string, kind: SendRequest["targetKind"]): boolean {
  const [user, suffix] = targetId.split("@");
  if (!user || !suffix) return false;
  if (kind === "community") return suffix === "g.us";
  if (suffix !== "c.us" && suffix !== "lid") return false;
  return isLidId(targetId) || toE164(targetId) !== undefined;
}

/**
 * The renderer's whole manual gate: validity, and nothing else.
 *
 * Deliberately NOT `decideSend`. That function's per-recipient human approval
 * exists because an AGENT is about to message someone on the owner's behalf and
 * a human has to say yes first. Here the human IS the sender — they chose the
 * conversation, typed the words and pressed the button. Putting a consent
 * dialog in front of that would train the owner to click through the one prompt
 * in this system that must stay deliberate, which is the same reasoning
 * `outbound.ts` uses to put refusals before prompts.
 *
 * The grant is minted the same way `decideSend` mints one — bound to the exact
 * body — so an edited draft cannot ride a grant issued for different text.
 */
export function decideManualSend(request: SendRequest): ManualSendDecision {
  const body = request.body.trim();
  if (body.length === 0) {
    return { status: "refused", reason: "There is nothing to send — the message is empty." };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return {
      status: "refused",
      reason: `That message is ${body.length} characters; WhatsApp sends at most ${MAX_BODY_LENGTH}.`,
    };
  }
  if (!isSendableTargetId(request.targetId, request.targetKind)) {
    return {
      status: "refused",
      reason: `“${request.targetId}” is not a valid WhatsApp ${request.targetKind} target.`,
    };
  }
  if (!request.recipientKey) {
    return {
      status: "refused",
      reason: "This chat has no identity key, so the send could not be recorded against a recipient.",
    };
  }
  return {
    status: "allowed",
    request: { ...request, body },
    grant: {
      recipientKey: request.recipientKey,
      targetId: request.targetId,
      bodyDigest: bodyDigest(body),
    },
  };
}

// ── Rendering an outcome ─────────────────────────────────────────────────────

/**
 * Refusal codes raised by the shell BEFORE anything reached WhatsApp.
 *
 * The distinction is the point of this list. A ceiling refusal is a decision:
 * no message left the machine and the user can act on the reason. Anything
 * else that goes wrong happens after the ceiling admitted the send and the
 * script was already on its way, so whether WhatsApp received it is genuinely
 * unknown — and "unknown" must never be rendered as "refused", or the user
 * re-sends a message their recipient already has.
 */
const DECIDED_BEFORE_SENDING = new Set([
  "WHATSAPP_SEND_HALTED",
  "WHATSAPP_SEND_COOLDOWN",
  "WHATSAPP_SEND_DAILY_CAP",
  "WHATSAPP_SEND_REFUSED",
  "WHATSAPP_SEND_STATE",
  "WHATSAPP_NOT_OPEN",
  "WHATSAPP_UNAVAILABLE",
]);

export type OutcomeTone = "sent" | "refused" | "deferred" | "unknown";

export interface OutcomeNotice {
  tone: OutcomeTone;
  text: string;
}

function whenText(atMs: number | undefined): string {
  if (atMs === undefined || !Number.isFinite(atMs)) return "";
  const at = new Date(atMs);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString();
}

/**
 * One honest sentence per outcome, in the three states the user must be able to
 * tell apart: it was sent, it was refused and here is why, or we do not know.
 *
 * Never returns an empty string, and never throws: an outcome the surface
 * cannot classify still gets the "we do not know" sentence, because a blank
 * status bar after pressing Send is indistinguishable from a silent no-op.
 */
export function describeSendOutcome(outcome: OutboundOutcome): OutcomeNotice {
  switch (outcome.status) {
    case "sent":
      return { tone: "sent", text: "Sent." };
    case "deferred": {
      const when = whenText(outcome.earliestAtMs);
      return {
        tone: "deferred",
        text: when
          ? `Not sent — ${outcome.reason} Bridge can send this again after ${when}.`
          : `Not sent — ${outcome.reason}`,
      };
    }
    case "needs_approval":
      return {
        tone: "refused",
        text: `Not sent — ${outcome.reason}`,
      };
    case "refused": {
      if (outcome.code && !DECIDED_BEFORE_SENDING.has(outcome.code)) {
        return {
          tone: "unknown",
          text:
            `Bridge could not confirm what happened (${outcome.reason}). The message may or may ` +
            `not have reached WhatsApp — check the conversation before sending it again.`,
        };
      }
      return { tone: "refused", text: `Not sent — ${outcome.reason}` };
    }
    default:
      return {
        tone: "unknown",
        text:
          "Bridge could not confirm what happened. Check the conversation before sending again.",
      };
  }
}

/** The same sentence for a thrown failure, which is also an unknown, not a no. */
export function describeSendFailure(failure: unknown): OutcomeNotice {
  const detail =
    failure instanceof Error
      ? failure.message
      : typeof failure === "object" && failure !== null && "message" in failure
        ? String((failure as { message?: unknown }).message)
        : String(failure);
  return {
    tone: "unknown",
    text:
      `Bridge could not confirm what happened (${detail}). The message may or may not have ` +
      `reached WhatsApp — check the conversation before sending it again.`,
  };
}

// ── Annotation scoping ───────────────────────────────────────────────────────

export type AnnotationSubjectKind = "chat" | "person" | "community";

export interface AnnotationSubject {
  kind: AnnotationSubjectKind;
  id: string;
  label: string;
}

/**
 * The subject key tags and notes attach to, derived from the SELECTED thread.
 *
 * The same derivation `AnnotationsPanel` uses for its picker — a group is a
 * Community, a direct chat is a `chat` — so annotations written from the Chats
 * header and annotations written from the Tools Page land on one subject rather
 * than on two keys that look the same to a human and different to the store.
 */
export function annotationSubjectFor(
  thread: { chatId: string; name?: string | undefined; isGroup?: boolean | undefined } | null,
): AnnotationSubject | null {
  if (!thread?.chatId) return null;
  const isGroup = thread.isGroup === true || thread.chatId.endsWith("@g.us");
  return {
    kind: isGroup ? "community" : "chat",
    id: thread.chatId,
    label: thread.name?.trim() || thread.chatId,
  };
}

export function subjectKeyOf(subject: { kind: string; id: string }): string {
  return `${subject.kind}:${subject.id}`;
}
