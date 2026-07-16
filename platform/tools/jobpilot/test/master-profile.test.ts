import { test } from "node:test";
import assert from "node:assert/strict";
import { compileProfile } from "../src/master-profile.js";
import type { ParsedSource } from "../src/master-profile.js";

// Minimal helpers — per CLAUDE.md dummy policy, these are unavoidable test fixtures.
// Tracked in docs/dummy.md (to be filed): test-only resume data; removal condition = real user
// documents available for integration testing.

function src(id: string, resume: ParsedSource["resume"]): ParsedSource {
  return { sourceId: id, parsedAt: "2026-07-15T00:00:00.000Z", resume };
}

// ── Single-source compilation ────────────────────────────────────────────────

test("compileProfile: single source — preserves all fields", () => {
  const s = src("resume-a.pdf", {
    basics: { name: "Ada Lovelace", email: "ada@example.com" },
    work: [{ name: "Acme", position: "Engineer", startDate: "2020-01" }],
    education: [{ institution: "MIT", studyType: "Bachelor" }],
    skills: [{ name: "Python", keywords: ["async"] }],
  });
  const profile = compileProfile([s]);
  assert.equal(profile.sourceIds.length, 1);
  assert.equal(profile.resume.basics?.name, "Ada Lovelace");
  assert.equal(profile.resume.work?.length, 1);
  assert.equal(profile.resume.education?.length, 1);
  assert.equal(profile.resume.skills?.length, 1);
  assert.equal(profile.needsHumanCount, 0);
});

// ── Multi-source: agreeing scalar fields ─────────────────────────────────────

test("compileProfile: two sources with same name → resolved, no pending fields", () => {
  const s1 = src("cv-2023.pdf", { basics: { name: "Ada Lovelace", email: "ada@example.com" } });
  const s2 = src("cv-2024.pdf", { basics: { name: "Ada Lovelace", email: "ada@example.com" } });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.basics?.name, "Ada Lovelace");
  assert.equal(profile.needsHumanCount, 0);
});

// ── Multi-source: conflicting scalar fields ──────────────────────────────────

test("compileProfile: two sources with conflicting name → NeedsHuman, name omitted from resume", () => {
  const s1 = src("cv.pdf", { basics: { name: "Ada Lovelace" } });
  const s2 = src("linkedin.pdf", { basics: { name: "A. Lovelace" } });
  const profile = compileProfile([s1, s2]);
  // name field omitted when conflicted
  assert.equal(profile.resume.basics?.name, undefined);
  assert.equal(profile.needsHumanCount, 1);
  const pending = profile.pendingFields[0];
  assert.ok(pending !== undefined);
  assert.equal(pending.needsHuman, true);
  assert.equal(pending.reason, "conflict");
  assert.equal(pending.fieldPath, "basics.name");
  assert.ok(pending.conflictingValues?.includes("Ada Lovelace"));
  assert.ok(pending.conflictingValues?.includes("A. Lovelace"));
});

test("compileProfile: conflicting email → NeedsHuman for email, other agreed fields still resolve", () => {
  const s1 = src("a.pdf", { basics: { name: "Ada", email: "ada@old.com" } });
  const s2 = src("b.pdf", { basics: { name: "Ada", email: "ada@new.com" } });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.basics?.name, "Ada"); // agreed
  assert.equal(profile.resume.basics?.email, undefined); // conflicted
  assert.equal(profile.needsHumanCount, 1);
  assert.equal(profile.pendingFields[0]?.fieldPath, "basics.email");
});

test("compileProfile: two conflicting fields → needsHumanCount = 2", () => {
  const s1 = src("a.pdf", { basics: { name: "Ada Lovelace", email: "ada@old.com" } });
  const s2 = src("b.pdf", { basics: { name: "A. Lovelace", email: "ada@new.com" } });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.needsHumanCount, 2);
});

// ── Work entry deduplification ────────────────────────────────────────────────

test("compileProfile: same work entry in two sources → deduped to one", () => {
  const entry = { name: "Acme Corp", position: "Engineer", startDate: "2021-01", summary: "Built things." };
  const s1 = src("a.pdf", { work: [entry] });
  const s2 = src("b.pdf", { work: [entry] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.work?.length, 1);
});

test("compileProfile: same job key, richer entry in second source → keeps richer", () => {
  const sparse = { name: "Acme", position: "Engineer", startDate: "2021-01" };
  const rich = { name: "Acme", position: "Engineer", startDate: "2021-01", summary: "Led team.", endDate: "2024-01", highlights: ["a", "b"] };
  const s1 = src("a.pdf", { work: [sparse] });
  const s2 = src("b.pdf", { work: [rich] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.work?.length, 1);
  assert.equal(profile.resume.work?.[0]?.summary, "Led team.");
  assert.equal(profile.resume.work?.[0]?.endDate, "2024-01");
});

test("compileProfile: different jobs → both kept", () => {
  const s1 = src("a.pdf", { work: [{ name: "Acme", position: "Engineer", startDate: "2020-01" }] });
  const s2 = src("b.pdf", { work: [{ name: "BridgeCo", position: "Staff Eng", startDate: "2022-06" }] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.work?.length, 2);
});

// ── Skill deduplication + keyword merge ──────────────────────────────────────

test("compileProfile: same skill name in two sources → deduped, keywords merged", () => {
  const s1 = src("a.pdf", { skills: [{ name: "TypeScript", keywords: ["generics"] }] });
  const s2 = src("b.pdf", { skills: [{ name: "TypeScript", keywords: ["decorators"] }] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.skills?.length, 1);
  const ts = profile.resume.skills?.[0];
  assert.ok(ts?.keywords?.includes("generics"));
  assert.ok(ts?.keywords?.includes("decorators"));
});

test("compileProfile: skill name case-insensitive dedupe (TypeScript vs typescript)", () => {
  const s1 = src("a.pdf", { skills: [{ name: "TypeScript", level: "Expert" }] });
  const s2 = src("b.pdf", { skills: [{ name: "typescript", keywords: ["zod"] }] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.skills?.length, 1);
  assert.equal(profile.resume.skills?.[0]?.name, "TypeScript"); // original casing preserved
  assert.equal(profile.resume.skills?.[0]?.level, "Expert");
  assert.ok(profile.resume.skills?.[0]?.keywords?.includes("zod"));
});

test("compileProfile: distinct skills → all kept", () => {
  const s1 = src("a.pdf", { skills: [{ name: "Python" }] });
  const s2 = src("b.pdf", { skills: [{ name: "Rust" }] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.skills?.length, 2);
});

// ── Invariants ────────────────────────────────────────────────────────────────

test("compileProfile: throws on empty sources array", () => {
  assert.throws(() => compileProfile([]), /at least one ParsedSource/);
});

test("compileProfile: compiledAt is an ISO timestamp", () => {
  const profile = compileProfile([src("a.pdf", {})]);
  assert.ok(!isNaN(Date.parse(profile.compiledAt)));
});

test("compileProfile: sourceIds matches input order", () => {
  const s1 = src("first.pdf", {});
  const s2 = src("second.pdf", {});
  const profile = compileProfile([s1, s2]);
  assert.deepEqual([...profile.sourceIds], ["first.pdf", "second.pdf"]);
});

test("compileProfile: different education entries → both kept", () => {
  const s1 = src("a.pdf", { education: [{ institution: "MIT" }] });
  const s2 = src("b.pdf", { education: [{ institution: "Stanford" }] });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.resume.education?.length, 2);
});

test("compileProfile: needsHumanCount equals pendingFields.length", () => {
  const s1 = src("a.pdf", { basics: { name: "Ada" } });
  const s2 = src("b.pdf", { basics: { name: "Different" } });
  const profile = compileProfile([s1, s2]);
  assert.equal(profile.needsHumanCount, profile.pendingFields.length);
});

test("compileProfile: duplicate profile links across sources → deduped to one", () => {
  const link = { network: "GitHub", username: "ada" };
  const s1 = src("a.pdf", { basics: { profiles: [link] } });
  const s2 = src("b.pdf", { basics: { profiles: [link, { network: "LinkedIn", username: "ada-lovelace" }] } });
  const profile = compileProfile([s1, s2]);
  // GitHub|ada appears in both sources — should be deduped to one occurrence
  const profiles = profile.resume.basics?.profiles ?? [];
  const githubProfiles = profiles.filter((p) => p.network === "GitHub");
  assert.equal(githubProfiles.length, 1);
  assert.equal(profiles.length, 2); // GitHub + LinkedIn
});

// ── Education deduplification ─────────────────────────────────────────────────

test("compileProfile: same education entry in two sources → deduped to one", () => {
  const entry = { institution: "MIT", studyType: "Bachelor", startDate: "2014-09" };
  const profile = compileProfile([src("a.pdf", { education: [entry] }), src("b.pdf", { education: [entry] })]);
  assert.equal(profile.resume.education?.length, 1);
});

test("compileProfile: same education key, richer entry in second source → keeps richer", () => {
  const sparse = { institution: "MIT", studyType: "Bachelor", startDate: "2014-09" };
  const rich = { institution: "MIT", studyType: "Bachelor", startDate: "2014-09", endDate: "2018-06", area: "Computer Science", score: "4.0" };
  const profile = compileProfile([src("a.pdf", { education: [sparse] }), src("b.pdf", { education: [rich] })]);
  assert.equal(profile.resume.education?.length, 1);
  assert.equal(profile.resume.education?.[0]?.area, "Computer Science");
  assert.equal(profile.resume.education?.[0]?.endDate, "2018-06");
});
