/**
 * The outbound path, end to end — the one place the send ORDER is written down.
 *
 * ADR-158 puts the ceiling in Rust because a renderer-side cap is bypassable.
 * That makes the full path four steps, and the order of all four is load-bearing:
 *
 *   1. **Policy refusals** (`evaluateSendPolicy`, inside `decideAutomatedSend`).
 *      A first contact, or a send during a halt, is refused BEFORE anything
 *      asks a human anything. Track C's reasoning, kept verbatim in
 *      `decideAutomatedSend`'s doc comment: asking someone to approve what the
 *      system will refuse anyway is how people learn to click through prompts,
 *      and the consent gate is exactly the prompt that must never become
 *      reflexive.
 *   2. **`decideSend`.** A human approval that has been withdrawn outranks any
 *      amount of good behaviour, so consent speaks after refusals and before
 *      timing.
 *   3. **The Rust ceiling.** The daily cap, the per-recipient cooldown and the
 *      kill switch are re-checked on the trusted side of the IPC boundary
 *      against DURABLE state. Everything above this line is advisory: it exists
 *      to explain and to schedule. This is the line that binds, and it binds
 *      even if a caller skipped steps 1 and 2 entirely.
 *   4. **The send.**
 *
 * This module owns 1–2 and the sequencing. 3 and 4 live behind `SendPort`,
 * which is the shell. Injecting the port keeps this file pure and testable, and
 * keeps the Module free of any transport.
 */
import { decideAutomatedSend, type AutomatedSendDecision, type SendPolicyContext } from "./policy.js";
import type { RecipientApproval, SendGrant, SendRequest } from "./send.js";

/**
 * What the shell reports back. The `code` values mirror the Rust ceiling's
 * refusal codes so a caller can distinguish "the cap is full, try later" from
 * "automation is halted and a person must re-arm it".
 */
export interface SendPortResult {
  status: "sent" | "refused";
  /** WhatsApp's id for the delivered message, when it sent. */
  messageId?: string;
  /** Stable refusal code from the shell, e.g. `WHATSAPP_SEND_DAILY_CAP`. */
  code?: string;
  reason?: string;
  /** Epoch milliseconds. Absent for a halt — a halt never clears on its own. */
  earliestAtMs?: number;
}

/**
 * The shell's send command. Takes a grant as well as the request: the grant is
 * proof this exact body was cleared for this exact recipient, so a caller
 * cannot reach the port with a request that never passed steps 1–2.
 */
export type SendPort = (request: SendRequest, grant: SendGrant) => Promise<SendPortResult>;

export type OutboundOutcome =
  | { status: "sent"; request: SendRequest; messageId?: string | undefined; delaySeconds: number }
  /** A human must approve this recipient before anything is attempted. */
  | { status: "needs_approval"; request: SendRequest; reason: string }
  /** Refused by policy, by consent, or by the Rust ceiling. Never a prompt. */
  | { status: "refused"; reason: string; code?: string | undefined }
  /** Not now. `earliestAtMs` is when it becomes worth retrying. */
  | { status: "deferred"; reason: string; code?: string | undefined; earliestAtMs?: number | undefined };

function msFrom(iso: string): number | undefined {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Run the whole gate for one AGENT-initiated send.
 *
 * A `deferred` decision from step 1 never reaches the port: the message is
 * genuinely sendable, just not yet, and attempting it would spend a cap slot
 * on a send the discipline already said to wait on.
 *
 * `delaySeconds` is returned rather than slept on. This module has no clock,
 * and pacing is the scheduler's job — but the number must survive to it, or the
 * jitter that makes automated sending look paced rather than fired is lost.
 */
export async function performAutomatedSend(
  request: SendRequest,
  approvals: readonly RecipientApproval[],
  context: SendPolicyContext,
  port: SendPort,
): Promise<OutboundOutcome> {
  const decision: AutomatedSendDecision = decideAutomatedSend(request, approvals, context);

  if (decision.status === "refused") {
    return { status: "refused", reason: decision.reason, code: decision.rule };
  }
  if (decision.status === "needs_approval") {
    return {
      status: "needs_approval",
      request: decision.request,
      reason: decision.reason,
    };
  }
  if (decision.status === "deferred") {
    return {
      status: "deferred",
      reason: decision.reason,
      code: decision.rule,
      earliestAtMs: msFrom(decision.earliestAt),
    };
  }

  // Only an `allowed` decision reaches the shell — and the shell checks again.
  const result = await port(decision.request, decision.grant);
  if (result.status === "sent") {
    return {
      status: "sent",
      request: decision.request,
      messageId: result.messageId,
      delaySeconds: decision.delaySeconds,
    };
  }

  // The ceiling refused something the renderer's advisory copy thought was
  // fine. That is not an error condition — it is the design working. The two
  // legitimately disagree whenever the renderer's history is stale, and when
  // they disagree the durable one wins.
  const retryable = result.earliestAtMs !== undefined;
  return retryable
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
}
