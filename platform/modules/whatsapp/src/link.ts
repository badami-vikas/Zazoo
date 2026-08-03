/**
 * The seam between the WhatsApp Module and the Relationship Module.
 *
 * A WhatsApp chat is a thread of messages. A Person is a Relationship Record.
 * This file answers exactly one question — "whose chat is this?" — and it is
 * allowed to answer "I don't know", which is the point.
 *
 * Pure: no clock, no id generation, no I/O. Resolution is a lookup against an
 * index the caller built from `local_people`, so this file cannot write a link
 * and cannot decide to create a Person.
 *
 * ── Why this works at all ────────────────────────────────────────────────────
 * `local_people.dedupe_key` and `local_messages.sender_key` are already the SAME
 * key space (`whatsapp:+E164` / `whatsapp-lid:<id>`). A chat id is drawn from
 * that same space, so the link is a key derivation plus an exact lookup. There
 * is no fuzzy matching here, deliberately: every heuristic that could be added
 * would be a guess about somebody's identity.
 *
 * ── The two rules that are load-bearing ──────────────────────────────────────
 * 1. LID and phone are DISJOINT. A `@lid` chat resolves only against LID keys.
 *    It is never compared to a phone key, so a LID chat whose human is sitting
 *    in the graph under their phone number reads as UNLINKED. That is the
 *    honest answer: WhatsApp deliberately hid the number, and matching them
 *    would be inference, not knowledge.
 * 2. Two matches is not a match. Ambiguity produces a reviewable Signal for a
 *    person to resolve, never a silently-picked winner — the same discipline
 *    the Google intake path applies to an email that hits two People.
 */
import { isLidId, toE164 } from "./normalize.js";
import type { DuplicateSignal, ExistingPersonIndex, IdentityKind } from "./types.js";

/**
 * WhatsApp thread suffixes that address no single human. A chat with one of
 * these is not a Person's chat and must not be resolved to one.
 *
 * `@g.us` is a group: it maps to a Community subject instead. The others are
 * one-way channels with no counterparty at all.
 */
const GROUP_SUFFIX = "@g.us";
const NON_SUBJECT_SUFFIXES = ["@broadcast", "@newsletter"];

/**
 * The Relationship subject a chat id addresses, in the shared key space —
 * before any lookup. `undefined` means the chat addresses no subject that
 * Bridge models (a broadcast list, a newsletter, an unrecognised suffix).
 */
export type ChatSubjectKey =
  | { subject: "person"; dedupeKey: string; identityKind: IdentityKind }
  | { subject: "community"; dedupeKey: string };

/**
 * Derive the subject key for a chat id.
 *
 * The suffix decides which key space applies, exactly as `senderOf` does for a
 * message author — an id is not a number with decoration, and only WhatsApp's
 * phone-addressed `@c.us` space is ever read as a phone number.
 */
export function chatSubjectKey(chatId: string): ChatSubjectKey | undefined {
  const id = chatId.trim();
  if (!id) return undefined;

  if (id.endsWith(GROUP_SUFFIX)) {
    return { subject: "community", dedupeKey: `whatsapp-group:${id}` };
  }
  if (NON_SUBJECT_SUFFIXES.some((suffix) => id.endsWith(suffix))) return undefined;

  // Checked BEFORE the phone branch. A LID is an opaque handle whose digits
  // must never reach `toE164` — the guard that stops 4,203 fabricated numbers.
  if (isLidId(id)) {
    return { subject: "person", dedupeKey: `whatsapp-lid:${id}`, identityKind: "lid" };
  }

  if (id.endsWith("@c.us")) {
    const e164 = toE164(id);
    if (e164) return { subject: "person", dedupeKey: `whatsapp:${e164}`, identityKind: "phone" };
  }
  return undefined;
}

/**
 * What is known about a chat's Relationship subject.
 *
 * Every state except `linked` is a form of "not known", and each one is
 * distinct because the UI owes the user a different sentence for each. They are
 * never collapsed into a single empty state.
 */
export type ChatLink =
  /** Exactly one Person carries this chat's identity key. */
  | {
      state: "linked";
      subject: "person";
      personId: string;
      dedupeKey: string;
      identityKind: IdentityKind;
    }
  /**
   * Two or more People carry it. Neither is chosen; a `possible_duplicate`
   * Signal is the output, and the duplicates are a human's to resolve.
   */
  | {
      state: "ambiguous";
      subject: "person";
      dedupeKey: string;
      identityKind: IdentityKind;
      candidatePersonIds: string[];
    }
  /**
   * The key is derivable but no Person carries it. For a `lid` identity this is
   * the expected steady state, not a failure: WhatsApp withheld the number, so
   * the chat can only ever be linked by a human who recognises the name.
   */
  | {
      state: "unlinked";
      subject: "person";
      dedupeKey: string;
      identityKind: IdentityKind;
    }
  /**
   * A group chat. It addresses a Community identity key, but Communities are
   * not stored on the Local Plane today, so there is nothing to look it up
   * against. Reported as its own state rather than as a Person that failed to
   * match, which is a different and misleading claim.
   */
  | { state: "community_unsupported"; subject: "community"; dedupeKey: string }
  /** A broadcast, a newsletter, or an id shape this Module does not model. */
  | { state: "unaddressable"; subject: "none" };

/**
 * Resolve one chat against the People already known locally.
 *
 * `index` is the same `ExistingPersonIndex` the Contact Extractor matches
 * against, so a chat and a contact for the same human always agree.
 */
export function resolveChatLink(chatId: string, index: ExistingPersonIndex): ChatLink {
  const key = chatSubjectKey(chatId);
  if (!key) return { state: "unaddressable", subject: "none" };
  if (key.subject === "community") {
    return { state: "community_unsupported", subject: "community", dedupeKey: key.dedupeKey };
  }

  const matches = index.byDedupeKey.get(key.dedupeKey) ?? [];
  if (matches.length > 1) {
    return {
      state: "ambiguous",
      subject: "person",
      dedupeKey: key.dedupeKey,
      identityKind: key.identityKind,
      candidatePersonIds: [...matches],
    };
  }
  const personId = matches[0];
  if (personId) {
    return {
      state: "linked",
      subject: "person",
      personId,
      dedupeKey: key.dedupeKey,
      identityKind: key.identityKind,
    };
  }
  return {
    state: "unlinked",
    subject: "person",
    dedupeKey: key.dedupeKey,
    identityKind: key.identityKind,
  };
}

/**
 * Which of these chats belong to one Person.
 *
 * The inverse of `resolveChatLink`, and deliberately built on it rather than
 * beside it: a chat appears here only in the `linked` state, so ambiguous and
 * unlinked chats can never leak onto a Person's timeline. If the two functions
 * ever disagreed, a Person's page would show somebody else's conversation.
 */
export function chatsLinkedToPerson(
  personId: string,
  chatIds: readonly string[],
  index: ExistingPersonIndex,
): string[] {
  return chatIds.filter((chatId) => {
    const link = resolveChatLink(chatId, index);
    return link.state === "linked" && link.personId === personId;
  });
}

/**
 * The stable id for the Signal raised by one ambiguous identity.
 *
 * Deterministic on the dedupe key, so re-running an extraction or re-opening a
 * chat re-commits the same id. `commitEntity` is idempotent on id, which makes
 * that a silent no-op instead of one duplicate Signal per sync pass — the
 * difference between a review queue and a flood.
 */
export function duplicateSignalId(dedupeKey: string): string {
  return `whatsapp-signal:possible_duplicate:${dedupeKey}`;
}

/**
 * The payload of a `possible_duplicate` Signal, in the shape the Google intake
 * path already files. The discriminator is `type`, matching that precedent, so
 * one review surface can read Signals from either Module.
 *
 * RESIDENCY: `dedupeKey` embeds an E.164 phone number for a phone identity, and
 * `displayName` is a name from the owner's address book. Both are Local-Plane
 * facts. This payload is committed through `LocalGraphStore.commitEntity` and
 * has no cloud destination.
 */
export interface PossibleDuplicatePayload {
  type: "possible_duplicate";
  source: "whatsapp";
  reason: string;
  dedupeKey: string;
  identityKind: IdentityKind;
  displayName: string;
  candidatePersonIds: string[];
  runId: string;
}

/** Build the committed payload for one ambiguous WhatsApp identity. */
export function possibleDuplicatePayload(
  signal: DuplicateSignal,
  identityKind: IdentityKind,
): PossibleDuplicatePayload {
  return {
    type: "possible_duplicate",
    source: "whatsapp",
    reason: "this WhatsApp identity matches more than one Person",
    dedupeKey: signal.dedupeKey,
    identityKind,
    displayName: signal.displayName,
    candidatePersonIds: [...signal.candidatePersonIds],
    runId: signal.runId,
  };
}

/**
 * The identity space a dedupe key belongs to.
 *
 * `DuplicateSignal` carries the key but not the kind, and the kind is what the
 * review surface needs in order to say "number hidden by WhatsApp" rather than
 * showing an empty phone field. Read off the key's own prefix — never inferred
 * from its digits.
 */
export function identityKindOfDedupeKey(dedupeKey: string): IdentityKind {
  return dedupeKey.startsWith("whatsapp-lid:") ? "lid" : "phone";
}
