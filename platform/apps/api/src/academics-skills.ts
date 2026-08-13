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

/**
 * academics.lectureSynthesis (TASK-069 follow-on phase) — the second Study
 * Steward Skill. Same deterministic-heuristic posture as syllabus-intake
 * (ADR-237's Decision 1 reasoning still holds: no reusable Skill-level
 * `ModelProvider` structured-call convention exists in this repo yet) and the
 * same PURE/no-I/O shape: the caller extracts PDF/text content and hands it
 * in, this Skill only transforms it. It writes NOTHING — no draft row, no
 * Section-worth-a-table exists for "a synthesis of one lecture's text" the
 * way "a candidate Assignment" did, so the result is returned to the caller
 * to read or copy into `academicsLectureSessions.myNotes` by hand, avoiding
 * an unrequested new store/staging idiom for a feature that doesn't need one.
 */
export const LECTURE_SYNTHESIS_SKILL = "academics.lectureSynthesis";

export interface LectureSynthesisResult {
  /** False when the source text was empty/whitespace-only (e.g. a scanned,
   * image-only PDF `unpdf` could extract no text from) — an honest "could not
   * extract" rather than a fabricated summary of nothing. */
  extractable: boolean;
  keyPoints: string[];
}

const NOISE_LINE_RE = /^(page \d+( of \d+)?|\d+|slide \d+|©.*|www\..*)$/i;
const MAX_KEY_POINTS = 25;
const MAX_KEY_POINT_LENGTH = 240;

/**
 * Line-oriented, like the syllabus extractor: a "key point" is a
 * substantive, non-boilerplate line (skips page numbers/slide markers/
 * copyright footers and anything under 20 characters, since a fragment that
 * short is never a standalone point), deduplicated and capped. No
 * summarization or rewriting happens — every key point is a verbatim line
 * from the source, which is the only way this stays honest without a model.
 */
export function synthesizeLecture(text: string): LectureSynthesisResult {
  if (text.trim().length === 0) return { extractable: false, keyPoints: [] };

  const seen = new Set<string>();
  const keyPoints: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s{2,}/g, " ");
    if (line.length < 20 || NOISE_LINE_RE.test(line)) continue;
    const truncated = line.length > MAX_KEY_POINT_LENGTH ? `${line.slice(0, MAX_KEY_POINT_LENGTH)}…` : line;
    const key = truncated.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keyPoints.push(truncated);
    if (keyPoints.length >= MAX_KEY_POINTS) break;
  }
  return { extractable: true, keyPoints };
}

export interface LectureSynthesisInputs {
  /** Already-extracted, taint-labeled text — same contract as syllabus intake. */
  text: string;
}

export const lectureSynthesisSkill: Skill = {
  name: LECTURE_SYNTHESIS_SKILL,
  async run(inputs) {
    const { text } = (inputs ?? {}) as Partial<LectureSynthesisInputs>;
    if (typeof text !== "string") {
      throw new Error("academics.lectureSynthesis requires extracted lecture text");
    }
    const synthesis = synthesizeLecture(text);
    return {
      proposedOutput: synthesis,
      diff: { keyPointCount: synthesis.keyPoints.length, extractable: synthesis.extractable },
    };
  },
};

/**
 * academics.referenceResolve (TASK-069 follow-on phase) — resolves
 * citations/references mentioned in course materials into a normalized list.
 * Deliberately narrow and conservative, mirroring syllabus-intake's honesty
 * bias: only the two citation SHAPES that are unambiguous enough to have
 * zero realistic false-positive rate on ordinary prose are matched.
 * Anything else (a bare year, a stray parenthetical) is silently skipped
 * rather than guessed at — a missed reference is recoverable by a human
 * scanning the source; a fabricated one is not.
 */
export const REFERENCE_RESOLVE_SKILL = "academics.referenceResolve";

export interface ResolvedReference {
  author: string;
  year: string;
  title?: string;
}

// In-text parenthetical: "(Harroch et al., 2019)", "(Smith & Jones, 2020)",
// "(Smith, 2020a)". Requires a capitalized author token and a 4-digit year
// inside parens together — a bare "(2020)" or "(see above)" never matches.
const IN_TEXT_CITATION_RE =
  /\(([A-Z][A-Za-z'-]+(?:\s(?:&|and)\s[A-Z][A-Za-z'-]+)?(?:\set al\.)?),?\s((?:19|20)\d{2}[a-z]?)\)/g;

// Reference-list entry: "Harroch, R. (2019). Title of the piece." — a line
// that STARTS with "Lastname, Initial(s)." followed by "(YYYY)." The title is
// whatever prose follows up to the next sentence boundary, when present.
const REFERENCE_LIST_ENTRY_RE =
  /^([A-Z][A-Za-z'-]+(?:,?\s[A-Z]\.){1,3}(?:,\s(?:&|and)\s[A-Z][A-Za-z'-]+(?:,?\s[A-Z]\.){1,3})?)\s*\(((?:19|20)\d{2}[a-z]?)\)\.\s*(.+)?$/;

export function extractReferences(text: string): ResolvedReference[] {
  const results: ResolvedReference[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const listMatch = line.match(REFERENCE_LIST_ENTRY_RE);
    if (listMatch) {
      const [, author, year, rest] = listMatch;
      const title = rest?.trim().replace(/\.+$/, "").trim();
      const key = `${author!.toLowerCase()}|${year}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ author: author!, year: year!, ...(title ? { title } : {}) });
      }
      continue;
    }

    for (const match of line.matchAll(IN_TEXT_CITATION_RE)) {
      const author = match[1]!;
      const year = match[2]!;
      const key = `${author.toLowerCase()}|${year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ author, year });
    }
  }
  return results;
}

export interface ReferenceResolveInputs {
  text: string;
}

export const referenceResolveSkill: Skill = {
  name: REFERENCE_RESOLVE_SKILL,
  async run(inputs) {
    const { text } = (inputs ?? {}) as Partial<ReferenceResolveInputs>;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("academics.referenceResolve requires extracted material text");
    }
    const references = extractReferences(text);
    return {
      proposedOutput: { references },
      diff: { referenceCount: references.length },
    };
  },
};

/**
 * academics.workloadForecast (TASK-069 follow-on phase) — pure aggregation
 * over ALREADY-MODELED Assignment rows (`academicsAssignments`, via the
 * existing `listAssignments` store call). No extraction heuristic needed —
 * unlike the other three Skills, this one has no untrusted-text boundary at
 * all, so it carries no taint-labeling concern and could be called directly
 * from a query procedure with no file read in between.
 */
export const WORKLOAD_FORECAST_SKILL = "academics.workloadForecast";

export interface WorkloadForecastAssignment {
  dueAt?: string | null;
  weight?: number | null;
  status: string;
}

export interface WorkloadForecastWeek {
  /** ISO date, Monday of the week. */
  weekStart: string;
  assignmentCount: number;
  /** Sum of `weight` (0-100 scale) due that week — a rough proxy for grade-impact density. */
  totalWeight: number;
}

function mondayOf(date: Date): string {
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

/**
 * Buckets every assignment that is NOT already `submitted`/`graded` and DOES
 * have a `dueAt` by the Monday of its due week, summing count and weight.
 * Assignments with no `dueAt` are real (a human hasn't scheduled it yet) but
 * cannot be forecast into a week — they are reported separately rather than
 * silently dropped or forced into an arbitrary bucket.
 */
export function forecastWorkload(assignments: WorkloadForecastAssignment[]): {
  weeks: WorkloadForecastWeek[];
  unscheduledCount: number;
} {
  const buckets = new Map<string, WorkloadForecastWeek>();
  let unscheduledCount = 0;

  for (const assignment of assignments) {
    if (assignment.status === "submitted" || assignment.status === "graded") continue;
    if (!assignment.dueAt) {
      unscheduledCount += 1;
      continue;
    }
    const due = new Date(assignment.dueAt);
    if (Number.isNaN(due.getTime())) {
      unscheduledCount += 1;
      continue;
    }
    const weekStart = mondayOf(due);
    const existing = buckets.get(weekStart);
    const weight = typeof assignment.weight === "number" ? assignment.weight : 0;
    if (existing) {
      existing.assignmentCount += 1;
      existing.totalWeight += weight;
    } else {
      buckets.set(weekStart, { weekStart, assignmentCount: 1, totalWeight: weight });
    }
  }

  const weeks = [...buckets.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return { weeks, unscheduledCount };
}

export interface WorkloadForecastInputs {
  assignments: WorkloadForecastAssignment[];
}

export const workloadForecastSkill: Skill = {
  name: WORKLOAD_FORECAST_SKILL,
  async run(inputs) {
    const { assignments } = (inputs ?? {}) as Partial<WorkloadForecastInputs>;
    if (!Array.isArray(assignments)) {
      throw new Error("academics.workloadForecast requires an assignments array");
    }
    const forecast = forecastWorkload(assignments);
    return {
      proposedOutput: forecast,
      diff: { weekCount: forecast.weeks.length, unscheduledCount: forecast.unscheduledCount },
    };
  },
};
