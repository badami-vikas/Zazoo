import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  chatSubjectKey,
  chatsLinkedToPerson,
  duplicateSignalId,
  identityKindOfDedupeKey,
  possibleDuplicatePayload,
  resolveChatLink,
} from "../src/link.js";
import { personIndexFrom, emptyPersonIndex } from "../src/extract.js";
import type { DuplicateSignal } from "../src/types.js";

const PHONE_CHAT = "919876543210@c.us";
const LID_CHAT = "112233445566@lid";
const GROUP_CHAT = "120363000000000000@g.us";

// ── Subject key derivation ───────────────────────────────────────────────────

test("a phone chat id derives the phone-space key", () => {
  assert.deepEqual(chatSubjectKey(PHONE_CHAT), {
    subject: "person",
    dedupeKey: "whatsapp:+919876543210",
    identityKind: "phone",
  });
});

test("a LID chat id derives the LID-space key and never a phone number", () => {
  const key = chatSubjectKey(LID_CHAT);
  assert.deepEqual(key, {
    subject: "person",
    dedupeKey: "whatsapp-lid:112233445566@lid",
    identityKind: "lid",
  });
  // The digits are plausible as a phone number. They must not be read as one.
  assert.ok(!key?.dedupeKey.startsWith("whatsapp:+"));
  assert.ok(!key?.dedupeKey.includes("+112233445566"));
});

test("a group chat id derives a Community key, not a Person key", () => {
  assert.deepEqual(chatSubjectKey(GROUP_CHAT), {
    subject: "community",
    dedupeKey: `whatsapp-group:${GROUP_CHAT}`,
  });
});

test("broadcasts, newsletters, blanks and unknown suffixes address no subject", () => {
  for (const id of ["status@broadcast", "1234@newsletter", "", "   ", "nonsense", "x@unknown"]) {
    assert.equal(chatSubjectKey(id), undefined, id);
  }
});

// ── Resolution ───────────────────────────────────────────────────────────────

test("exactly one match links the chat to that Person", () => {
  const index = personIndexFrom([{ personId: "p1", dedupeKey: "whatsapp:+919876543210" }]);
  assert.deepEqual(resolveChatLink(PHONE_CHAT, index), {
    state: "linked",
    subject: "person",
    personId: "p1",
    dedupeKey: "whatsapp:+919876543210",
    identityKind: "phone",
  });
});

test("two matches produce ambiguity with both candidates, and no link", () => {
  const index = personIndexFrom([
    { personId: "p1", dedupeKey: "whatsapp:+919876543210" },
    { personId: "p2", dedupeKey: "whatsapp:+919876543210" },
  ]);
  const link = resolveChatLink(PHONE_CHAT, index);
  assert.equal(link.state, "ambiguous");
  assert.ok(!("personId" in link), "an ambiguous chat must not carry a chosen Person");
  assert.deepEqual(link.state === "ambiguous" ? link.candidatePersonIds : [], ["p1", "p2"]);
});

test("no match is unlinked, never a fabricated Person", () => {
  const link = resolveChatLink(PHONE_CHAT, emptyPersonIndex());
  assert.equal(link.state, "unlinked");
  assert.equal(link.state === "unlinked" ? link.dedupeKey : "", "whatsapp:+919876543210");
});

test("a LID chat does NOT match a Person known only by phone", () => {
  // The same human, plausibly. The LID digits even equal the phone digits here.
  const index = personIndexFrom([{ personId: "p1", dedupeKey: "whatsapp:+112233445566" }]);
  const link = resolveChatLink(LID_CHAT, index);
  assert.equal(link.state, "unlinked");
  assert.equal(link.state === "unlinked" ? link.identityKind : "", "lid");
});

test("a LID chat links only to a Person carrying the same LID key", () => {
  const index = personIndexFrom([{ personId: "p9", dedupeKey: "whatsapp-lid:112233445566@lid" }]);
  const link = resolveChatLink(LID_CHAT, index);
  assert.equal(link.state, "linked");
  assert.equal(link.state === "linked" ? link.personId : "", "p9");
});

test("a phone chat does NOT match a Person known only by a LID key", () => {
  const index = personIndexFrom([{ personId: "p1", dedupeKey: "whatsapp-lid:919876543210@lid" }]);
  assert.equal(resolveChatLink(PHONE_CHAT, index).state, "unlinked");
});

test("a group chat reports the Community gap rather than a failed Person match", () => {
  const link = resolveChatLink(GROUP_CHAT, emptyPersonIndex());
  assert.equal(link.state, "community_unsupported");
  assert.equal(link.subject, "community");
});

test("an unaddressable chat resolves to no subject at all", () => {
  assert.deepEqual(resolveChatLink("status@broadcast", emptyPersonIndex()), {
    state: "unaddressable",
    subject: "none",
  });
});

test("a chat and the Contact Extractor agree on the same human", () => {
  // The extractor writes `whatsapp:+E164` for a `@c.us` contact; the chat for
  // that contact must resolve to the very same key.
  const index = personIndexFrom([{ personId: "p1", dedupeKey: "whatsapp:+919876543210" }]);
  assert.equal(chatSubjectKey(PHONE_CHAT)?.dedupeKey, "whatsapp:+919876543210");
  assert.equal(resolveChatLink(PHONE_CHAT, index).state, "linked");
});

// ── Inverse: a Person's chats ────────────────────────────────────────────────

test("only linked chats are attributed to a Person", () => {
  const index = personIndexFrom([
    { personId: "p1", dedupeKey: "whatsapp:+919876543210" },
    // Two rows share this key, so the chat for it is ambiguous.
    { personId: "p1", dedupeKey: "whatsapp:+14155550100" },
    { personId: "p2", dedupeKey: "whatsapp:+14155550100" },
  ]);
  const chats = [PHONE_CHAT, "14155550100@c.us", LID_CHAT, GROUP_CHAT, "status@broadcast"];

  // The ambiguous chat is withheld even though p1 is one of its candidates.
  assert.deepEqual(chatsLinkedToPerson("p1", chats, index), [PHONE_CHAT]);
  assert.deepEqual(chatsLinkedToPerson("p2", chats, index), []);
});

test("a Person with no chats gets an empty list, not every unlinked chat", () => {
  assert.deepEqual(
    chatsLinkedToPerson("nobody", [PHONE_CHAT, LID_CHAT, GROUP_CHAT], emptyPersonIndex()),
    [],
  );
});

// ── Signal shape ─────────────────────────────────────────────────────────────

test("the duplicate Signal id is deterministic, so re-runs do not flood review", () => {
  assert.equal(
    duplicateSignalId("whatsapp:+919876543210"),
    duplicateSignalId("whatsapp:+919876543210"),
  );
  assert.notEqual(
    duplicateSignalId("whatsapp:+919876543210"),
    duplicateSignalId("whatsapp-lid:919876543210@lid"),
  );
});

test("the Signal payload uses the possible_duplicate vocabulary and keeps every candidate", () => {
  const signal: DuplicateSignal = {
    kind: "possible_duplicate",
    dedupeKey: "whatsapp:+919876543210",
    displayName: "Asha",
    candidatePersonIds: ["p1", "p2"],
    runId: "run-1",
  };
  const payload = possibleDuplicatePayload(signal, "phone");
  assert.equal(payload.type, "possible_duplicate");
  assert.equal(payload.source, "whatsapp");
  assert.deepEqual(payload.candidatePersonIds, ["p1", "p2"]);
  assert.equal(payload.identityKind, "phone");
  // Defensive copy: mutating the payload must not reach back into the Signal.
  payload.candidatePersonIds.push("p3");
  assert.deepEqual(signal.candidatePersonIds, ["p1", "p2"]);
});

test("identity kind is read off the key prefix, never off its digits", () => {
  assert.equal(identityKindOfDedupeKey("whatsapp:+919876543210"), "phone");
  assert.equal(identityKindOfDedupeKey("whatsapp-lid:919876543210@lid"), "lid");
});
