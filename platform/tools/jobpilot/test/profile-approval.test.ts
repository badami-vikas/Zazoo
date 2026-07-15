import { test } from "node:test";
import assert from "node:assert/strict";
import { approveProfile, isApprovedProfile, assertApprovedProfile } from "../src/profile-approval.js";
import { compileProfile } from "../src/master-profile.js";
import type { ParsedSource } from "../src/master-profile.js";

function src(id: string, resume: ParsedSource["resume"]): ParsedSource {
  return { sourceId: id, parsedAt: "2026-07-15T00:00:00.000Z", resume };
}

// Build a clean profile with no pending fields
function cleanProfile() {
  return compileProfile([src("resume.pdf", { basics: { name: "Ada", email: "ada@example.com" } })]);
}

// Build a profile with pending (conflicting) fields
function conflictedProfile() {
  const s1 = src("a.pdf", { basics: { name: "Ada Lovelace" } });
  const s2 = src("b.pdf", { basics: { name: "A. Lovelace" } });
  return compileProfile([s1, s2]);
}

// ── approveProfile ───────────────────────────────────────────────────────────

test("approveProfile: clean profile → returns ApprovedProfile with correct fields", () => {
  const profile = cleanProfile();
  const approved = approveProfile(profile, "human@example.com", "2026-07-15T12:00:00.000Z");
  assert.equal(approved._type, "approved-profile" as const);
  assert.equal(approved.approvedBy, "human@example.com");
  assert.equal(approved.approvedAt, "2026-07-15T12:00:00.000Z");
  assert.ok(approved.profile === profile);
});

test("approveProfile: throws when profile has unresolved NeedsHuman fields", () => {
  const profile = conflictedProfile();
  assert.throws(
    () => approveProfile(profile, "human@example.com", new Date().toISOString()),
    /unresolved NeedsHuman/,
  );
});

test("approveProfile: throws when approvedBy is empty string", () => {
  const profile = cleanProfile();
  assert.throws(() => approveProfile(profile, "", new Date().toISOString()), /non-empty human identity/);
});

test("approveProfile: throws when approvedBy is whitespace-only", () => {
  const profile = cleanProfile();
  assert.throws(() => approveProfile(profile, "   ", new Date().toISOString()), /non-empty human identity/);
});

// ── isApprovedProfile ────────────────────────────────────────────────────────

test("isApprovedProfile: returns true for an ApprovedProfile", () => {
  const approved = approveProfile(cleanProfile(), "human", new Date().toISOString());
  assert.equal(isApprovedProfile(approved), true);
});

test("isApprovedProfile: returns false for a raw MasterProfile", () => {
  assert.equal(isApprovedProfile(cleanProfile()), false);
});

test("isApprovedProfile: returns false for null, undefined, plain objects", () => {
  assert.equal(isApprovedProfile(null), false);
  assert.equal(isApprovedProfile(undefined), false);
  assert.equal(isApprovedProfile({ _type: "something-else" }), false);
  assert.equal(isApprovedProfile(42), false);
});

// ── assertApprovedProfile ────────────────────────────────────────────────────

test("assertApprovedProfile: does not throw for a valid ApprovedProfile", () => {
  const approved = approveProfile(cleanProfile(), "human", new Date().toISOString());
  assert.doesNotThrow(() => assertApprovedProfile(approved));
});

test("assertApprovedProfile: throws for a raw MasterProfile", () => {
  assert.throws(() => assertApprovedProfile(cleanProfile()), /has not been human-approved/);
});

test("assertApprovedProfile: throws for arbitrary values", () => {
  assert.throws(() => assertApprovedProfile({ profile: {} }), /has not been human-approved/);
  assert.throws(() => assertApprovedProfile(null), /has not been human-approved/);
});

// ── Poisoned-profile guard integration ───────────────────────────────────────

test("downstream skill cannot receive a non-approved profile (guard integration pattern)", () => {
  const profile = cleanProfile();

  // Simulate a downstream skill that calls assertApprovedProfile at its entry point
  function consumeProfile(value: unknown): string {
    assertApprovedProfile(value);
    return value.profile.resume.basics?.name ?? "(no name)";
  }

  // Un-approved profile → blocked
  assert.throws(() => consumeProfile(profile), /has not been human-approved/);

  // Approved profile → passes through
  const approved = approveProfile(profile, "human", new Date().toISOString());
  const result = consumeProfile(approved);
  assert.equal(result, "Ada");
});
