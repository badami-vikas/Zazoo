import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addNote,
  addTags,
  annotationsFor,
  emptyAnnotationState,
  listAnnotations,
  normalizeTag,
  readAnnotationState,
  removeNote,
  removeTag,
  subjectKeyOf,
  subjectsWithTag,
  tagCounts,
  MAX_TAG_LENGTH,
  type AnnotationSubject,
} from "../src/annotations.js";

const CHAT: AnnotationSubject = { kind: "chat", id: "919876543210@c.us" };
const PERSON: AnnotationSubject = { kind: "person", id: "whatsapp:+919876543210" };
const T0 = "2026-08-01T10:00:00.000Z";
const T1 = "2026-08-01T11:00:00.000Z";

// ── The honest empty state ───────────────────────────────────────────────────

test("empty state lists nothing at all", () => {
  const state = emptyAnnotationState();
  assert.deepEqual(listAnnotations(state), []);
  assert.deepEqual(tagCounts(state), []);
  assert.deepEqual(subjectsWithTag(state, "investor"), []);
});

test("a subject with no annotations reports null, never a blank stand-in", () => {
  assert.equal(annotationsFor(emptyAnnotationState(), CHAT), null);
});

// ── Subject keys keep identity spaces apart ──────────────────────────────────

test("a chat and a person with related ids are different subjects", () => {
  assert.notEqual(subjectKeyOf(CHAT), subjectKeyOf(PERSON));
  const state = addTags(emptyAnnotationState(), CHAT, ["vip"], T0);
  assert.equal(annotationsFor(state, PERSON), null);
});

// ── Tags ─────────────────────────────────────────────────────────────────────

test("tags are case-folded and whitespace-collapsed so near-duplicates merge", () => {
  assert.equal(normalizeTag("  Investor "), "investor");
  assert.equal(normalizeTag("Warm   Lead"), "warm lead");
  const state = addTags(emptyAnnotationState(), CHAT, ["Investor", "investor", "  INVESTOR"], T0);
  assert.deepEqual(annotationsFor(state, CHAT)?.tags, ["investor"]);
});

test("a tag longer than the cap is truncated rather than refused", () => {
  const tag = normalizeTag("x".repeat(MAX_TAG_LENGTH + 50));
  assert.equal(tag.length, MAX_TAG_LENGTH);
});

test("tags that normalize to nothing are not stored", () => {
  const state = addTags(emptyAnnotationState(), CHAT, ["   ", ""], T0);
  assert.deepEqual(listAnnotations(state), []);
});

test("adding an existing tag changes nothing, including the timestamp", () => {
  const first = addTags(emptyAnnotationState(), CHAT, ["vip"], T0);
  const second = addTags(first, CHAT, ["vip"], T1);
  assert.equal(second, first, "an idempotent add returned a new state");
  assert.equal(annotationsFor(second, CHAT)?.updatedAt, T0);
});

test("tags come back sorted regardless of insertion order", () => {
  const state = addTags(emptyAnnotationState(), CHAT, ["zeta", "alpha", "mid"], T0);
  assert.deepEqual(annotationsFor(state, CHAT)?.tags, ["alpha", "mid", "zeta"]);
});

test("removing the last tag drops the subject rather than leaving an empty shell", () => {
  const state = removeTag(addTags(emptyAnnotationState(), CHAT, ["vip"], T0), CHAT, "vip", T1);
  assert.deepEqual(listAnnotations(state), []);
});

test("removing an absent tag is a no-op, not an error", () => {
  const before = addTags(emptyAnnotationState(), CHAT, ["vip"], T0);
  assert.equal(removeTag(before, CHAT, "nope", T1), before);
});

test("a tag is removable by any casing that normalizes to it", () => {
  const state = removeTag(addTags(emptyAnnotationState(), CHAT, ["vip"], T0), CHAT, "VIP", T1);
  assert.deepEqual(listAnnotations(state), []);
});

// ── Notes ────────────────────────────────────────────────────────────────────

test("notes are newest first", () => {
  let state = addNote(emptyAnnotationState(), CHAT, { id: "n1", body: "first", authorId: "u1" }, T0);
  state = addNote(state, CHAT, { id: "n2", body: "second", authorId: "u1" }, T1);
  assert.deepEqual(annotationsFor(state, CHAT)?.notes.map((note) => note.id), ["n2", "n1"]);
});

test("a blank note is refused rather than stored", () => {
  assert.throws(
    () => addNote(emptyAnnotationState(), CHAT, { id: "n1", body: "   ", authorId: "u1" }, T0),
    /needs a body/,
  );
});

test("a note needs the person who wrote it", () => {
  assert.throws(
    () => addNote(emptyAnnotationState(), CHAT, { id: "n1", body: "hi", authorId: " " }, T0),
    /needs the person who wrote it/,
  );
});

test("re-adding the same note id is a no-op, so a retry cannot duplicate it", () => {
  const first = addNote(emptyAnnotationState(), CHAT, { id: "n1", body: "hi", authorId: "u1" }, T0);
  assert.equal(addNote(first, CHAT, { id: "n1", body: "different", authorId: "u1" }, T1), first);
});

test("note bodies are trimmed but otherwise kept verbatim", () => {
  const state = addNote(
    emptyAnnotationState(),
    CHAT,
    { id: "n1", body: "  Owes me a reply re: Series B  ", authorId: "u1" },
    T0,
  );
  assert.equal(annotationsFor(state, CHAT)?.notes[0]?.body, "Owes me a reply re: Series B");
});

test("removing the last note drops the subject", () => {
  const state = removeNote(
    addNote(emptyAnnotationState(), CHAT, { id: "n1", body: "hi", authorId: "u1" }, T0),
    CHAT,
    "n1",
    T1,
  );
  assert.deepEqual(listAnnotations(state), []);
});

test("a subject keeps its tags when its last note is removed", () => {
  let state = addTags(emptyAnnotationState(), CHAT, ["vip"], T0);
  state = addNote(state, CHAT, { id: "n1", body: "hi", authorId: "u1" }, T0);
  state = removeNote(state, CHAT, "n1", T1);
  assert.deepEqual(annotationsFor(state, CHAT)?.tags, ["vip"]);
});

// ── Rollups ──────────────────────────────────────────────────────────────────

test("tag counts report how many subjects carry each tag, most used first", () => {
  let state = addTags(emptyAnnotationState(), CHAT, ["vip", "investor"], T0);
  state = addTags(state, PERSON, ["vip"], T0);
  assert.deepEqual(tagCounts(state), [
    { tag: "vip", subjects: 2 },
    { tag: "investor", subjects: 1 },
  ]);
});

test("subjectsWithTag selects the subjects carrying it", () => {
  let state = addTags(emptyAnnotationState(), CHAT, ["vip"], T0);
  state = addTags(state, PERSON, ["other"], T0);
  assert.deepEqual(
    subjectsWithTag(state, "VIP").map((entry) => entry.subjectId),
    [CHAT.id],
  );
});

test("an empty tag query selects nothing rather than everything", () => {
  const state = addTags(emptyAnnotationState(), CHAT, ["vip"], T0);
  assert.deepEqual(subjectsWithTag(state, "   "), []);
});

test("annotations list most recently touched first", () => {
  let state = addTags(emptyAnnotationState(), CHAT, ["a"], T0);
  state = addTags(state, PERSON, ["b"], T1);
  assert.deepEqual(
    listAnnotations(state).map((entry) => entry.subjectId),
    [PERSON.id, CHAT.id],
  );
});

// ── Persistence round-trip ───────────────────────────────────────────────────

test("state survives a JSON round trip, which is what restart means here", () => {
  let state = addTags(emptyAnnotationState(), CHAT, ["Investor"], T0);
  state = addNote(state, CHAT, { id: "n1", body: "Met at the summit", authorId: "u1" }, T1);

  const reloaded = readAnnotationState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded, state);
  assert.deepEqual(annotationsFor(reloaded, CHAT)?.tags, ["investor"]);
  assert.equal(annotationsFor(reloaded, CHAT)?.notes[0]?.body, "Met at the summit");
});

test("an unrecognised persisted value yields empty state rather than throwing", () => {
  assert.deepEqual(readAnnotationState(null), emptyAnnotationState());
  assert.deepEqual(readAnnotationState("nonsense"), emptyAnnotationState());
  assert.deepEqual(readAnnotationState({ version: 99 }), emptyAnnotationState());
  assert.deepEqual(readAnnotationState({ version: 1, subjects: null }), emptyAnnotationState());
});

test("one malformed subject is skipped and the rest of the state survives", () => {
  const reloaded = readAnnotationState({
    version: 1,
    subjects: {
      "chat:good@c.us": {
        kind: "chat",
        subjectId: "good@c.us",
        tags: ["vip"],
        notes: [],
        updatedAt: T0,
      },
      "chat:bad": { kind: "not-a-kind", subjectId: "bad" },
      "chat:alsobad": null,
    },
  });
  assert.deepEqual(
    listAnnotations(reloaded).map((entry) => entry.subjectId),
    ["good@c.us"],
  );
});

test("a malformed note inside a good subject is skipped, keeping the good ones", () => {
  const reloaded = readAnnotationState({
    version: 1,
    subjects: {
      "chat:c@c.us": {
        kind: "chat",
        subjectId: "c@c.us",
        tags: [],
        notes: [
          { id: "n1", body: "kept", authorId: "u1", createdAt: T0 },
          { id: "", body: "no id", authorId: "u1", createdAt: T0 },
          { body: "missing id entirely", authorId: "u1", createdAt: T0 },
          null,
        ],
        updatedAt: T0,
      },
    },
  });
  assert.deepEqual(annotationsFor(reloaded, { kind: "chat", id: "c@c.us" })?.notes.map((n) => n.id), [
    "n1",
  ]);
});

test("persisted tags are re-normalized on read, so old casing cannot resurface", () => {
  const reloaded = readAnnotationState({
    version: 1,
    subjects: {
      "chat:c@c.us": {
        kind: "chat",
        subjectId: "c@c.us",
        tags: ["VIP", "vip", "  Investor  "],
        notes: [],
        updatedAt: T0,
      },
    },
  });
  assert.deepEqual(annotationsFor(reloaded, { kind: "chat", id: "c@c.us" })?.tags, [
    "investor",
    "vip",
  ]);
});
