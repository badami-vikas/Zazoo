import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonResumeSchema, WorkEntrySchema, EducationEntrySchema, SkillSchema, BasicsSchema } from "../src/resume-schema.js";

// ── BasicsSchema ──────────────────────────────────────────────────────────────

test("BasicsSchema: empty object is valid (all fields optional)", () => {
  const result = BasicsSchema.safeParse({});
  assert.equal(result.success, true);
});

test("BasicsSchema: parses a well-formed basics block", () => {
  const result = BasicsSchema.safeParse({
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1-555-0100",
    label: "Software Engineer",
    summary: "Pioneering engineer.",
    url: "https://example.com",
    location: { city: "London", countryCode: "GB" },
    profiles: [{ network: "GitHub", username: "ada" }],
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.name, "Ada Lovelace");
  assert.equal(result.data.location?.city, "London");
  assert.equal(result.data.profiles?.[0]?.network, "GitHub");
});

// ── WorkEntrySchema ──────────────────────────────────────────────────────────

test("WorkEntrySchema: requires name and position", () => {
  const result = WorkEntrySchema.safeParse({ summary: "Did stuff" });
  assert.equal(result.success, false);
});

test("WorkEntrySchema: minimal valid work entry (name + position only)", () => {
  const result = WorkEntrySchema.safeParse({ name: "Acme Inc", position: "Engineer" });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.name, "Acme Inc");
  assert.equal(result.data.position, "Engineer");
});

test("WorkEntrySchema: full work entry parses correctly", () => {
  const result = WorkEntrySchema.safeParse({
    name: "Bridge Systems",
    position: "Staff Engineer",
    startDate: "2021-01",
    endDate: "2024-06",
    summary: "Built the kernel.",
    highlights: ["Shipped JP0", "Shipped JP1"],
    url: "https://bridgesystems.io",
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.highlights, ["Shipped JP0", "Shipped JP1"]);
});

// ── EducationEntrySchema ──────────────────────────────────────────────────────

test("EducationEntrySchema: requires institution", () => {
  const result = EducationEntrySchema.safeParse({ studyType: "Bachelor" });
  assert.equal(result.success, false);
});

test("EducationEntrySchema: minimal valid education entry", () => {
  const result = EducationEntrySchema.safeParse({ institution: "MIT" });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.institution, "MIT");
});

// ── SkillSchema ───────────────────────────────────────────────────────────────

test("SkillSchema: requires name", () => {
  const result = SkillSchema.safeParse({ keywords: ["React"] });
  assert.equal(result.success, false);
});

test("SkillSchema: parses skill with name, level, and keywords", () => {
  const result = SkillSchema.safeParse({ name: "TypeScript", level: "Expert", keywords: ["generics", "zod"] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.name, "TypeScript");
  assert.deepEqual(result.data.keywords, ["generics", "zod"]);
});

// ── JsonResumeSchema (top-level) ─────────────────────────────────────────────

test("JsonResumeSchema: empty object is valid (all sections optional)", () => {
  const result = JsonResumeSchema.safeParse({});
  assert.equal(result.success, true);
});

test("JsonResumeSchema: full canonical resume round-trips correctly", () => {
  const resume = {
    basics: { name: "Ada", email: "ada@example.com" },
    work: [{ name: "Acme", position: "Engineer", startDate: "2020-01" }],
    education: [{ institution: "MIT", studyType: "Bachelor" }],
    skills: [{ name: "Python", keywords: ["async", "typing"] }],
    projects: [{ name: "Project X", description: "A thing." }],
    certificates: [{ name: "AWS SAA", issuer: "Amazon", date: "2023-04" }],
    languages: [{ language: "English", fluency: "Native" }],
  };
  const result = JsonResumeSchema.safeParse(resume);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.basics?.name, "Ada");
  assert.equal(result.data.work?.[0]?.name, "Acme");
  assert.equal(result.data.education?.[0]?.institution, "MIT");
  assert.deepEqual(result.data.skills?.[0]?.keywords, ["async", "typing"]);
});

test("JsonResumeSchema: rejects work entry missing required 'name' field", () => {
  const result = JsonResumeSchema.safeParse({
    work: [{ position: "Engineer" }], // name missing → invalid
  });
  assert.equal(result.success, false);
});

test("JsonResumeSchema: $schema field is allowed and optional", () => {
  const result = JsonResumeSchema.safeParse({ $schema: "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json" });
  assert.equal(result.success, true);
});
