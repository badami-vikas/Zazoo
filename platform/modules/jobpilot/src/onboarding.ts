import type { CandidateProfile } from "./types.js";

// Onboarding (architecture doc M1 / vision doc F1-F2: "upload resumes... LLM extracts profile +
// proposes job categories (editable)"). This is the deterministic-heuristic half — keyword
// presence against a known vocabulary, open-resume-style — not a real PDF/NLP parser and not an
// LLM extraction call (no `llm` module to bind to yet, same deliberate omission as scoring.ts).
// A cheap-LLM fallback for resumes this heuristic can't confidently parse is a later concern;
// this function must never be mistaken for that fallback.

// Extracts skills present in the resume text against a caller-supplied vocabulary — the
// vocabulary is caller-owned (not hardcoded here) because it varies by persona/category and this
// module shouldn't own a skills taxonomy.
export function extractSkills(resumeText: string, knownSkills: string[]): string[] {
  const lower = resumeText.toLowerCase();
  return knownSkills.filter((skill) => lower.includes(skill.toLowerCase()));
}

// Proposes category chips by testing each category's keyword set against the resume text — the
// UI's "editable chips" (vision doc F2) are the caller's concern; this only proposes.
export function proposeCategories(resumeText: string, categoryKeywords: Record<string, string[]>): string[] {
  const lower = resumeText.toLowerCase();
  return Object.entries(categoryKeywords)
    .filter(([, keywords]) => keywords.some((k) => lower.includes(k.toLowerCase())))
    .map(([category]) => category);
}

export interface OnboardingInput {
  resumeText: string;
  knownSkills: string[];
  categoryKeywords: Record<string, string[]>;
  minSalary?: number;
  locations?: string[];
}

// Builds the CandidateProfile the rest of JobPilot (scoreJobFit, matching) consumes — the
// onboarding-to-scoring seam. Categories/skills are proposals; a human editing them afterward is
// just calling this again (or constructing a CandidateProfile by hand) with adjusted inputs.
export function buildCandidateProfile(input: OnboardingInput): CandidateProfile {
  const profile: CandidateProfile = {
    categories: proposeCategories(input.resumeText, input.categoryKeywords),
    skills: extractSkills(input.resumeText, input.knownSkills),
  };
  if (input.minSalary != null) profile.minSalary = input.minSalary;
  if (input.locations) profile.locations = input.locations;
  return profile;
}
