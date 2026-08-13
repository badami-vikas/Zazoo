/**
 * academics.syllabusIntake (TASK-069, ADR-237) — the syllabus/material intake
 * Skill for the Academics Module's Study Steward Agent.
 *
 * DESIGN DECISION (see ADR-237 for the full rationale): a deterministic
 * heuristic parse over the syllabus PDF's extracted text, not a governed
 * model call. Syllabi are free-form prose/tables with no reliable regex
 * shape, so a model-based extractor would normally be the better fit — but
 * this repo has no existing precedent for a Skill making a structured
 * extraction call through `ModelProvider` (every `.complete()` call site is
 * inline in a tRPC procedure with request-scoped governance, not a reusable
 * Skill-level pattern), and building one is out of scope for a "syllabus
 * intake v1". A heuristic extractor ships instead, and every row it produces
 * lands with `status: "draft"` — never auto-committed to the live Assignments
 * toggle regardless of extraction confidence.
 *
 * PURE. This Skill takes already-extracted PDF text and returns structured
 * candidates — no filesystem, model, or database I/O, so it carries no
 * `executionClass` (same as `stageCapture`). The router procedure that calls
 * it does the file read (Module Files, Local Plane) and the draft DB write.
 */
import type { Skill } from "@bridge/core";

export const SYLLABUS_INTAKE_SKILL = "academics.syllabusIntake";

export type ExtractedAssignmentType = "problem_set" | "essay" | "project" | "exam" | "lab";

export interface ExtractedAssignment {
  title: string;
  type?: ExtractedAssignmentType;
  /** ISO 8601, when a date could be parsed from the line. */
  dueAt?: string;
  /** 0..100, when a "NN%" weight could be parsed from the line. */
  weight?: number;
}

const DATE_RE =
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}\b/i;
const WEIGHT_RE = /\b(\d{1,3})\s*%/;
const RELEVANCE_RE = /\b(due|assignment|exam|midterm|project|paper|essay|quiz|homework|problem set|presentation|lab)\b/i;
const TYPE_KEYWORDS: ReadonlyArray<readonly [RegExp, ExtractedAssignmentType]> = [
  [/\b(exam|midterm)\b/i, "exam"],
  [/\bproject\b/i, "project"],
  [/\b(essay|paper)\b/i, "essay"],
  [/\blab\b/i, "lab"],
  [/\b(problem set|assignment|quiz|homework)\b/i, "problem_set"],
];

// ponytail: bounds on a heuristic line-scanner over untrusted, unbounded
// external text — not a real limit on syllabus length, just a sane ceiling.
// Raise (or switch to a real tokenizer) if a legitimate syllabus overflows it.
const MAX_LINES = 2_000;
const MAX_RESULTS = 200;

/**
 * Line-oriented heuristic: a line is a candidate only if it names a date or a
 * weight AND uses assignment-shaped vocabulary (due/exam/project/…) — plain
 * prose with a stray percentage or date does not qualify. Title is the line
 * with the date/weight/"due" stripped out; type is inferred by keyword, left
 * unset when nothing matches (an honest "couldn't classify" beats a wrong
 * guess). Every result is inherently a review candidate — confidence is
 * carried by `status: "draft"` on the row it becomes, not a separate field.
 */
export function extractSyllabusAssignments(text: string): ExtractedAssignment[] {
  const results: ExtractedAssignment[] = [];
  const lines = text.split(/\r?\n/).slice(0, MAX_LINES);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || !RELEVANCE_RE.test(line)) continue;
    const dateMatch = line.match(DATE_RE);
    const weightMatch = line.match(WEIGHT_RE);
    if (!dateMatch && !weightMatch) continue;

    let title = line;
    if (dateMatch) title = title.replace(dateMatch[0], " ");
    if (weightMatch) title = title.replace(weightMatch[0], " ");
    title = title
      .replace(/\bdue\b\s*[:]?/i, " ")
      .replace(/\(\s*\)/g, " ")
      .replace(/[-–—:,.]+\s*$/, "")
      .replace(/^[-–—:,.\s]+/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!title) continue;

    let type: ExtractedAssignmentType | undefined;
    for (const [re, candidate] of TYPE_KEYWORDS) {
      if (re.test(line)) {
        type = candidate;
        break;
      }
    }

    let dueAt: string | undefined;
    if (dateMatch) {
      const parsed = new Date(dateMatch[0]);
      if (!Number.isNaN(parsed.getTime())) dueAt = parsed.toISOString();
    }

    const weight = weightMatch ? Math.min(100, Number(weightMatch[1])) : undefined;

    results.push({
      title,
      ...(type ? { type } : {}),
      ...(dueAt ? { dueAt } : {}),
      ...(weight != null ? { weight } : {}),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

export interface SyllabusIntakeInputs {
  /** Already-extracted PDF text (untrusted external content — taint-labeled
   * by the caller BEFORE this Skill runs, per CLAUDE.md's untrusted-content rule). */
  text: string;
}

export const syllabusIntakeSkill: Skill = {
  name: SYLLABUS_INTAKE_SKILL,
  async run(inputs) {
    const { text } = (inputs ?? {}) as Partial<SyllabusIntakeInputs>;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("academics.syllabusIntake requires extracted PDF text");
    }
    const assignments = extractSyllabusAssignments(text);
    return {
      proposedOutput: { assignments },
      diff: { draftAssignments: assignments.length },
    };
  },
};
