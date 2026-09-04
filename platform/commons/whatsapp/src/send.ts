/**
 * v2 — outbound messages, and the gate in front of them.
 *
 * An outbound WhatsApp message is egress to a real third party from the owner's
 * personal number. The approval model the owner chose (2026-08-01) is
 * **approve per recipient, then trusted**: the first message to a given
 * recipient requires an explicit human approval; afterwards an approved Agent
 * may send to that same recipient without stopping.
 *
 * Everything here is pure. It decides WHETHER a send is permitted and what the
 * request looks like; the desktop shell performs it, and only when handed a
 * grant this module minted.
 *
 * The asymmetry with v1 is deliberate: a read that goes wrong shows the owner
 * their own data, while a send that goes wrong is a message a client actually
 * receives and cannot be recalled.
 */
import { dedupeKeyFor, isLidId, toE164 } from "./normalize.js";
import type { WhatsAppContact } from "./types.js";

/** Where a message is going. Communities are groups; People are direct chats. */
export type SendTargetKind = "person" | "community";

export interface SendRequest {
  targetKind: SendTargetKind;
  /** The WhatsApp id to deliver to (`…@c.us`, `…@lid`, or `…@g.us`). */
  targetId: string;
  /** Recipient identity key — what "approved for this recipient" is keyed on. */
  recipientKey: string;
  body: string;
}

/** A recorded human approval for one recipient. */
export interface RecipientApproval {
  recipientKey: string;
  /** Who approved, for the audit trail. Never an Agent. */
  approvedBy: string;
  approvedAt: string;
  /** Set when the approval has been withdrawn — revocation beats trust. */
  revokedAt?: string;
}

export type SendDecision =
  /** Permitted now. `grant` is what the shell demands before it will send. */
  | { status: "allowed"; request: SendRequest; grant: SendGrant }
  /** A human must approve this recipient first. */
  | { status: "needs_approval"; request: SendRequest; reason: string }
  /** Not sendable at all — never a prompt, because approving cannot fix it. */
  | { status: "refused"; reason: string };

/**
 * Proof that a specific message to a specific recipient may be sent. Bound to
 * the body, not just the recipient: standing trust for a recipient must not
 * become a blank cheque to send them arbitrary text later.
 */
export interface SendGrant {
  recipientKey: string;
  targetId: string;
  /** Stable digest of the exact body this grant covers. */
  bodyDigest: string;
}

/** Hard ceiling on one message. WhatsApp's own limit is ~65,536 characters. */
export const MAX_BODY_LENGTH = 4096;

/**
 * Digest bound into a grant. Not a security primitive against a determined
 * attacker — it is a mismatch detector, so an edited body cannot ride an
 * existing grant. Deliberately dependency-free and deterministic.
 */
export function bodyDigest(body: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Recipient key for a contact — the same identity space v1 matching uses. */
export function recipientKeyFor(contact: WhatsAppContact): string | undefined {
  return dedupeKeyFor(contact);
}

/** Recipient key for a group target. */
export function communityRecipientKey(groupId: string): string {
  return `whatsapp-group:${groupId}`;
}

function isSendableTargetId(targetId: string, kind: SendTargetKind): boolean {
  const [user, suffix] = targetId.split("@");
  if (!user || !suffix) return false;
  if (kind === "community") return suffix === "g.us";
  // A direct message may go to a phone id or a LID — both address one human.
  if (suffix !== "c.us" && suffix !== "lid") return false;
  return isLidId(targetId) || toE164(targetId) !== undefined;
}

/**
 * The whole gate. Given a request and the recorded approvals, decide.
 *
 * Refusals are separated from `needs_approval` on purpose: an empty body or a
 * malformed target is not something the owner should be asked to approve, and
 * showing a consent prompt for it would train them to click through prompts.
 */
export function decideSend(
  request: SendRequest,
  approvals: readonly RecipientApproval[],
): SendDecision {
  const body = request.body.trim();
  if (body.length === 0) {
    return { status: "refused", reason: "The message is empty." };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return {
      status: "refused",
      reason: `The message is ${body.length} characters; the limit is ${MAX_BODY_LENGTH}.`,
    };
  }
  if (!isSendableTargetId(request.targetId, request.targetKind)) {
    return {
      status: "refused",
      reason: `"${request.targetId}" is not a valid WhatsApp ${request.targetKind} target.`,
    };
  }
  if (!request.recipientKey) {
    return {
      status: "refused",
      reason: "The recipient has no identity key, so approval could not be recorded against them.",
    };
  }

  const matching = approvals.filter(
    (approval) => approval.recipientKey === request.recipientKey,
  );
  // Revocation beats trust: any revoked approval sends this back to the human,
  // regardless of other live approvals for the same recipient.
  const revoked = matching.find((approval) => approval.revokedAt);
  if (revoked) {
    return {
      status: "needs_approval",
      request: { ...request, body },
      reason: "Approval for this recipient was withdrawn and must be given again.",
    };
  }
  if (matching.length === 0) {
    return {
      status: "needs_approval",
      request: { ...request, body },
      reason: "This is the first message to this recipient, so it needs your approval.",
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

/**
 * Re-check a grant against the message about to be sent. The shell calls the
 * equivalent of this before it will run a write op, so a grant minted for one
 * body cannot carry a different one.
 */
export function grantCovers(grant: SendGrant, request: SendRequest): boolean {
  return (
    grant.recipientKey === request.recipientKey &&
    grant.targetId === request.targetId &&
    grant.bodyDigest === bodyDigest(request.body.trim())
  );
}
