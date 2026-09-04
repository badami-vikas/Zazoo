/**
 * Identity normalization for WhatsApp contacts.
 *
 * The phone number is the only stable identity a WhatsApp contact carries.
 * Names are not: `name` is whatever the owner typed into their address book,
 * and `pushname` is set by the contact themselves and can be changed at any
 * time by a third party. So matching keys off the number, and names are only
 * ever labels.
 */
import type { WhatsAppContact } from "./types.js";

/**
 * WhatsApp's Linked ID scheme. A `@lid` id is an OPAQUE account handle that
 * deliberately hides the phone number — it is digits, but it is NOT a phone
 * number and must never be rendered or matched as one.
 *
 * This matters at scale: in a live 8,384-contact address book (measured
 * 2026-08-01) 4,203 contacts reported `@lid` ids. Treating those digits as a
 * phone number would mint thousands of plausible-looking fake numbers and
 * match unrelated people to each other.
 */
export function isLidId(raw: string | undefined): boolean {
  return typeof raw === "string" && raw.includes("@lid");
}

/**
 * Reduce a WhatsApp-supplied PHONE identity to E.164-shaped digits with a
 * leading `+`. Accepts a raw phone field or a phone-bearing WhatsApp id
 * ("919876543210@c.us").
 *
 * Returns `undefined` for `@lid` ids: those carry no phone number, and
 * inventing one from their digits is the bug this guard exists to prevent.
 *
 * Deliberately does NOT validate country codes or length — WhatsApp has
 * already established the number is real and reachable, and a stricter parse
 * would drop valid international numbers rather than improve matching.
 */
export function toE164(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (isLidId(raw)) return undefined;
  // "@c.us" / "@g.us" suffixes and any formatting fall away together.
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  return `+${digits}`;
}

/** First non-blank of: saved name, contact's own push-name, the number. */
export function displayNameFor(contact: WhatsAppContact): string {
  const saved = contact.name?.trim();
  if (saved) return saved;
  const push = contact.pushname?.trim();
  if (push) return push;
  return phoneFor(contact) ?? contact.id;
}

/**
 * The contact's real phone number, if WhatsApp disclosed one at all.
 *
 * The `@lid` check is on the ID and short-circuits everything, including a
 * populated `phone` field. That is deliberate and load-bearing: an extraction
 * layer that derives `phone` by stripping the suffix off an id will hand this
 * function LID digits already laundered into a phone-shaped field. Guarding
 * only the id lets those through — observed doing exactly that against a live
 * address book on 2026-08-01, where all 4,203 LID contacts silently acquired
 * fabricated numbers. The identity of a LID contact is the LID, full stop.
 */
export function phoneFor(contact: WhatsAppContact): string | undefined {
  if (isLidId(contact.id)) return undefined;
  return toE164(contact.phone) ?? toE164(contact.id);
}

/**
 * Stable matching key for a contact, or `undefined` when no identity can be
 * derived at all (in which case the contact cannot be safely matched or
 * proposed, and the caller must skip it rather than invent a key).
 *
 * Two disjoint key spaces, never interchangeable:
 *   `whatsapp:+<E164>` for phone-bearing contacts
 *   `whatsapp-lid:<id>` for Linked-ID contacts whose number is hidden
 *
 * A LID contact and a phone contact are therefore never matched to each other
 * by this function. They may well be the same human — that is a merge decision
 * for a person to make, not something to infer from an opaque handle.
 */
export function dedupeKeyFor(contact: WhatsAppContact): string | undefined {
  const e164 = phoneFor(contact);
  if (e164) return `whatsapp:${e164}`;
  if (isLidId(contact.id)) return `whatsapp-lid:${contact.id}`;
  return undefined;
}

/** Stable matching key for a WhatsApp group, used for its Community. */
export function groupDedupeKeyFor(groupId: string): string {
  return `whatsapp-group:${groupId}`;
}
