/**
 * The identity guard in front of the Local Plane message store.
 *
 * A stored message carries its sender as a source-scoped key in the SAME space
 * as `LocalPerson.dedupeKey`. Two of those spaces exist for WhatsApp and they
 * are DISJOINT:
 *
 *   `whatsapp:+<E164>`   a real, disclosed phone number
 *   `whatsapp-lid:<id>`  an opaque Linked-ID account handle
 *
 * A LID is digits, but it is NOT a phone number. On the live account measured
 * 2026-08-01, 4,203 of 8,384 contacts reported `@lid` ids, and an earlier
 * implementation minted a fabricated phone number for every one of them. That
 * bug survived a guard on the id suffix alone, because the extraction layer had
 * already stripped the suffix and written the LID digits into a phone-shaped
 * field — by the time the identity code saw it, it looked like a phone number.
 *
 * So this guard checks the KEY PREFIX and the declared kind against each other,
 * at the storage boundary, where a laundered value has to pass through no matter
 * which caller produced it. The two spaces are never inferred into one another:
 * a LID sender and a phone sender may well be the same human, but that is a
 * merge a person decides, not something to derive from an opaque handle.
 *
 * Kept in its own module (no pglite import) so both the in-memory and the
 * persisted adapter enforce exactly the same rule.
 */
import type { LocalMessage, LocalMessageSenderKind } from "./ports.js";

const PHONE_KEY_PREFIX = "whatsapp:";
const LID_KEY_PREFIX = "whatsapp-lid:";

/** Kinds that must carry a sender key, and kinds that must not. */
const KINDS_REQUIRING_KEY: readonly LocalMessageSenderKind[] = ["phone", "lid"];

function describe(message: LocalMessage): string {
  return `${message.source}:${message.messageId}`;
}

/**
 * Throw unless the message's sender key and declared kind agree.
 *
 * Deliberately a throw, not a coercion or a dropped field: silently "fixing" an
 * inconsistent sender is how the fabricated-number bug stayed invisible. A
 * caller that cannot attribute a sender must say so with `unknown` and no key.
 */
export function assertSenderIdentity(message: LocalMessage): void {
  const key = message.senderKey;
  const kind = message.senderKind;

  if (KINDS_REQUIRING_KEY.includes(kind) && !key) {
    throw new Error(
      `Message ${describe(message)} declares sender kind "${kind}" but carries no sender key`,
    );
  }
  if (!key) {
    if (kind !== "self" && kind !== "unknown") {
      throw new Error(
        `Message ${describe(message)} has no sender key, so its kind must be "self" or "unknown"`,
      );
    }
    return;
  }

  // Order matters: "whatsapp-lid:" does not start with "whatsapp:", but check
  // the LID prefix first anyway so a future prefix change cannot silently make
  // a LID key match the phone branch.
  if (key.startsWith(LID_KEY_PREFIX)) {
    if (kind !== "lid") {
      throw new Error(
        `Message ${describe(message)} carries a Linked-ID sender key but declares kind "${kind}"; ` +
          `a Linked ID is an opaque handle and is never a phone identity`,
      );
    }
    return;
  }
  if (key.startsWith(PHONE_KEY_PREFIX)) {
    if (kind !== "phone") {
      throw new Error(
        `Message ${describe(message)} carries a phone sender key but declares kind "${kind}"`,
      );
    }
    // A phone key whose value still contains a WhatsApp id suffix means the
    // digits were taken off an id rather than off a disclosed number — the exact
    // laundering path that produced 4,203 fabricated numbers.
    if (key.includes("@")) {
      throw new Error(
        `Message ${describe(message)} has phone sender key "${key}" containing a WhatsApp id suffix; ` +
          `a phone identity must be E.164 digits, not an id with the suffix stripped`,
      );
    }
    if (!/^whatsapp:\+\d+$/.test(key)) {
      throw new Error(
        `Message ${describe(message)} has malformed phone sender key "${key}"; expected "whatsapp:+<digits>"`,
      );
    }
    return;
  }

  throw new Error(
    `Message ${describe(message)} has sender key "${key}" in no recognized identity space`,
  );
}

/** Reject direction/ack values the schema does not model, before they persist. */
export function assertMessageShape(message: LocalMessage): void {
  if (!message.messageId || !message.chatId || !message.source) {
    throw new Error(
      `Message ${describe(message)} needs a source, a message id, and a chat id`,
    );
  }
  if (message.direction !== "inbound" && message.direction !== "outbound") {
    throw new Error(
      `Message ${describe(message)} has unknown direction "${message.direction}"`,
    );
  }
  assertSenderIdentity(message);
}
