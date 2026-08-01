import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dedupeKeyFor, displayNameFor, toE164 } from "../src/normalize.js";
import type { WhatsAppContact } from "../src/types.js";

function contact(overrides: Partial<WhatsAppContact> = {}): WhatsAppContact {
  return {
    id: "919876543210@c.us",
    isMyContact: true,
    isGroup: false,
    ...overrides,
  };
}

test("toE164 prefixes + and strips formatting", () => {
  assert.equal(toE164("919876543210"), "+919876543210");
  assert.equal(toE164("+91 98765-43210"), "+919876543210");
  assert.equal(toE164("(919) 876 543210"), "+919876543210");
});

test("toE164 returns undefined when there are no digits", () => {
  assert.equal(toE164(""), undefined);
  assert.equal(toE164("   "), undefined);
  assert.equal(toE164("not-a-number"), undefined);
  assert.equal(toE164(undefined), undefined);
});

test("toE164 reads the number out of a WhatsApp id", () => {
  assert.equal(toE164("919876543210@c.us"), "+919876543210");
});

test("displayNameFor prefers the owner's saved name over the contact's own", () => {
  const resolved = displayNameFor(contact({ name: "Asha Rao", pushname: "ashaaa 🌸" }));
  assert.equal(resolved, "Asha Rao");
});

test("displayNameFor falls back to pushname, then to the number", () => {
  assert.equal(displayNameFor(contact({ pushname: "ashaaa" })), "ashaaa");
  assert.equal(displayNameFor(contact({})), "+919876543210");
});

test("displayNameFor ignores blank names rather than rendering an empty label", () => {
  assert.equal(displayNameFor(contact({ name: "   ", pushname: "ashaaa" })), "ashaaa");
});

test("dedupeKeyFor is stable across formatting of the same number", () => {
  const a = dedupeKeyFor(contact({ phone: "+91 98765 43210" }));
  const b = dedupeKeyFor(contact({ phone: "919876543210" }));
  assert.equal(a, b);
  assert.equal(a, "whatsapp:+919876543210");
});

test("dedupeKeyFor falls back to the WhatsApp id when no phone is reported", () => {
  assert.equal(dedupeKeyFor(contact({})), "whatsapp:+919876543210");
});

test("dedupeKeyFor returns undefined when no identity can be derived", () => {
  assert.equal(dedupeKeyFor(contact({ id: "unknown" })), undefined);
});
