import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSkills, proposeCategories, buildCandidateProfile } from "../src/onboarding.js";

const resumeText = "Senior Data Engineer with 8 years building Python and SQL pipelines on Kubernetes. Based in Austin, TX.";

test("extractSkills: only skills present in the resume text are returned", () => {
  const skills = extractSkills(resumeText, ["Python", "SQL", "Kubernetes", "Rust", "Go"]);
  assert.deepEqual(skills, ["Python", "SQL", "Kubernetes"]);
});

test("proposeCategories: category proposed only when one of its keywords appears in the text", () => {
  const categories = proposeCategories(resumeText, {
    "data engineer": ["data pipeline", "sql pipelines"],
    "frontend engineer": ["react", "css"],
  });
  assert.deepEqual(categories, ["data engineer"]);
});

test("buildCandidateProfile: composes proposed categories + extracted skills + optional constraints", () => {
  const profile = buildCandidateProfile({
    resumeText,
    knownSkills: ["Python", "SQL", "React"],
    categoryKeywords: { "data engineer": ["pipelines"] },
    minSalary: 140000,
    locations: ["Austin", "Remote"],
  });
  assert.deepEqual(profile.categories, ["data engineer"]);
  assert.deepEqual(profile.skills, ["Python", "SQL"]);
  assert.equal(profile.minSalary, 140000);
  assert.deepEqual(profile.locations, ["Austin", "Remote"]);
});

test("buildCandidateProfile: omits minSalary/locations entirely when not provided (no undefined leakage)", () => {
  const profile = buildCandidateProfile({ resumeText, knownSkills: [], categoryKeywords: {} });
  assert.ok(!("minSalary" in profile));
  assert.ok(!("locations" in profile));
});
