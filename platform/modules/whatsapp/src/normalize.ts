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
 * Reduce any WhatsApp-supplied number to E.164-shaped digits with a leading
 * `+`. Accepts a raw phone field or a WhatsApp id ("919876543210@c.us"), since
 * a contact may report either.
 *
 * This deliberately does NOT validate country codes or length — WhatsApp has
 * already established the number is real and reachable, and a stricter parse
 * would drop valid international numbers rather than improve matching.
 */
export function toE164(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
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
  return toE164(contact.phone) ?? toE164(contact.id) ?? contact.id;
}

/**
 * Stable matching key for a contact, or `undefined` when no identity can be
 * derived at all (in which case the contact cannot be safely matched or
 * proposed, and the caller must skip it rather than invent a key).
 */
export function dedupeKeyFor(contact: WhatsAppContact): string | undefined {
  const e164 = toE164(contact.phone) ?? toE164(contact.id);
  return e164 ? `whatsapp:${e164}` : undefined;
}

/** Stable matching key for a WhatsApp group, used for its Community. */
export function groupDedupeKeyFor(groupId: string): string {
  return `whatsapp-group:${groupId}`;
}
