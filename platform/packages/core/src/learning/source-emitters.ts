/**
 * Local-store capture emitters (AI Harness K2, ADR-210 — "chat threads +
 * WhatsApp store → learning signals, per-source toggles").
 *
 * Pure envelope→signal mappers for the two K2 sources. The consent gate
 * (capture-consent.ts) decides WHETHER an emission point may emit; these
 * decide WHAT a signal says when it may. Same discipline as the K1 ledger
 * miner, adapted to capture:
 *
 *  - **Envelope fields only, structurally.** A chat turn's `content` and a
 *    WhatsApp message's `body` are private text. The mappers receive
 *    pre-narrowed envelope types that cannot express those fields — there
 *    is no code path from message text to a signal row.
 *  - **The user's own acts only.** A WhatsApp INBOUND message is someone
 *    else's act; learning the owner's behavior from it would attribute
 *    another person's rhythm to the owner, so inbound maps to null (the
 *    message store still holds it — K3's knowledge substrate reads it as
 *    knowledge, not behavior). The chat mapper takes the USER turn — the
 *    assistant's reply is machine output, and the K1 rule against learning
 *    from the machine's own calibration applies unchanged.
 *  - **Local Plane only.** A cloud-plane chat thread maps to null before
 *    any consent check happens — raw capture never leaves the Local Plane,
 *    and a capture signal ABOUT a cloud thread parked on the local store
 *    would still be a use the consent surface never named.
 *  - **Low-cardinality attributes with a downstream consumer.** `timeOfDay`
 *    is the one envelope facet with a genuine use (K6's brief and rhythm
 *    recommendations); `surface` (chat) and `chatKind` (WhatsApp) are the
 *    honest structural facets. High-cardinality identifiers (thread ids,
 *    chat JIDs, person keys) are deliberately NOT attributes — they cannot
 *    generalize into a pattern, and the digest would drown in them. The
 *    source record id lives in `recordId` for evidence linkage, exactly
 *    like K1.
 */
import type { TaintLabel } from "../taint.js";
import type { ObservedSignal } from "./observation.js";

/** Capture is always OWNER-scoped: signals about the owner's behavior,
 * written as the owner's private Memory. Narrower than `MemoryAuthScope`
 * (whose userId is optional) because an ownerless capture signal cannot
 * exist. */
export interface CaptureScope {
  organizationId: string;
  userId: string;
}

export const CHAT_CAPTURE_MODULE_ID = "chat";
export const WHATSAPP_CAPTURE_MODULE_ID = "whatsapp";

export type TimeOfDayBucket = "morning" | "afternoon" | "evening" | "night";

/** Bucket an ISO timestamp's LOCAL hour into the four coarse day parts the
 * brief/rhythm rungs consume. Deliberately coarse: four values can pattern
 * at digest thresholds; twenty-four cannot. */
export function timeOfDayBucket(iso: string, hourOverride?: number): TimeOfDayBucket {
  const hour = hourOverride ?? new Date(iso).getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** The slice of a user chat turn capture may see. `content` is structurally
 * inexpressible — adding it here is the mutation the privacy tests catch. */
export interface ChatTurnCaptureEnvelope {
  turnId: string;
  threadId: string;
  plane: "local" | "cloud";
  surface: string;
  sentAt: string;
  /** The turn's own taint label, carried onto the signal at source. */
  taintLabel?: TaintLabel;
}

export function chatTurnCaptureSignal(
  envelope: ChatTurnCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  if (envelope.plane !== "local") return null;
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: CHAT_CAPTURE_MODULE_ID,
    recordKind: "turn",
    recordId: envelope.turnId,
    action: "converse",
    attributes: {
      surface: envelope.surface,
      timeOfDay: timeOfDayBucket(envelope.sentAt),
    },
    observedAt: envelope.sentAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}

/** The slice of a captured WhatsApp message capture may see. `body` and the
 * attachment are structurally inexpressible. */
export interface WhatsAppMessageCaptureEnvelope {
  messageId: string;
  chatId: string;
  direction: "inbound" | "outbound";
  isGroup: boolean;
  /** The message's own sent time; null when the source did not carry one. */
  sentAt: string | null;
  capturedAt: string;
  taintLabel?: TaintLabel;
}

export function whatsAppMessageCaptureSignal(
  envelope: WhatsAppMessageCaptureEnvelope,
  scope: CaptureScope,
  signalId: string,
): ObservedSignal | null {
  if (envelope.direction !== "outbound") return null;
  const observedAt = envelope.sentAt ?? envelope.capturedAt;
  return {
    id: signalId,
    organizationId: scope.organizationId,
    ownerUserId: scope.userId,
    moduleId: WHATSAPP_CAPTURE_MODULE_ID,
    recordKind: "message",
    recordId: envelope.messageId,
    action: "send",
    attributes: {
      chatKind: envelope.isGroup ? "group" : "direct",
      timeOfDay: timeOfDayBucket(observedAt),
    },
    observedAt,
    ...(envelope.taintLabel ? { taintLabel: envelope.taintLabel } : {}),
  };
}
