import type { JsonResume, WorkEntry, EducationEntry, Skill, Basics } from "./resume-schema.js";

// Master profile compiler (JP1 deliverable): deterministic compile + dedupe across multiple
// parsed source documents. No LLM calls here — extraction from raw PDF is a later concern
// (requires real user documents; see JP1 exit criteria). This module owns only the merge layer:
// given 1..N ParsedSources (each a JSON Resume produced upstream), produce a single MasterProfile
// with field-level provenance and explicit NeedsHuman markers for ambiguous or conflicting fields.
//
// Design refs: JobFunnel dedupe pattern (MIT) for the two-stage dedup key; Resume-Matcher
// PROTECTED_FIELDS invariant for the "never silently drop" rule.

// Reason a field cannot be automatically resolved during compilation.
export type NeedsHumanReason =
  | "conflict" // same field has different values across sources
  | "missing" // required field absent from all sources
  | "parse_error"; // source could not be parsed reliably (caller-supplied)

// Explicit marker for a field that requires human review before the profile becomes authoritative.
// Downstream skills MUST NOT consume fields whose path appears in `pendingFields`.
export interface NeedsHumanField {
  readonly needsHuman: true;
  readonly reason: NeedsHumanReason;
  readonly fieldPath: string; // e.g. "basics.name", "basics.email"
  readonly message: string;
  readonly conflictingValues?: readonly unknown[]; // for "conflict" reason
  readonly sourceIds?: readonly string[]; // which sources contributed the conflict
}

// A source document that has been parsed into JSON Resume format upstream (e.g. by a PDF parser
// or manual input). The `sourceId` must be stable across re-parses of the same document so
// dedupe keys are deterministic.
export interface ParsedSource {
  readonly sourceId: string; // filename or other stable identifier
  readonly parsedAt: string; // ISO timestamp; used only for display, not for merge priority
  readonly resume: JsonResume;
}

// The compiled master profile — the single authoritative representation of the candidate's
// history, ready for human review and approval. It starts in "pending" state; downstream skills
// (tailoring, fit scoring) MUST NOT consume it until a human approves it via profile-approval.ts.
export interface MasterProfile {
  readonly compiledAt: string;
  readonly sourceIds: readonly string[];
  /** Best-effort merged JSON Resume. Conflicting basics fields are omitted; array sections are deduped. */
  readonly resume: JsonResume;
  /** Fields requiring human resolution before the profile can be approved. */
  readonly pendingFields: readonly NeedsHumanField[];
  /** Convenience count; equals pendingFields.length. */
  readonly needsHumanCount: number;
  /** Human-readable notes about what was merged, deduped, or flagged during compilation. */
  readonly compileNotes: readonly string[];
}

// ---------------------------------------------------------------------------
// Internal merge helpers
// ---------------------------------------------------------------------------

// Resolves a scalar basics field across all sources. Returns the common value if all sources
// agree; pushes a NeedsHumanField and returns undefined if they conflict.
function mergeScalar<T>(
  fieldPath: string,
  values: ReadonlyArray<{ value: T | undefined; sourceId: string }>,
  pendingFields: NeedsHumanField[],
  notes: string[],
): T | undefined {
  const present = values.filter((v): v is { value: T; sourceId: string } => v.value !== undefined);
  if (present.length === 0) return undefined;

  // Stringify-compare to catch deep equality on objects (e.g. location)
  const first = present[0];
  const unique = new Map<string, { value: T; sourceIds: string[] }>();
  for (const p of present) {
    const key = JSON.stringify(p.value);
    const existing = unique.get(key);
    if (existing) {
      existing.sourceIds.push(p.sourceId);
    } else {
      unique.set(key, { value: p.value, sourceIds: [p.sourceId] });
    }
  }

  if (unique.size === 1 && first !== undefined) {
    return first.value; // all agree
  }

  // Conflict — cannot auto-resolve
  const conflictingValues = [...unique.values()].map((e) => e.value);
  const conflictingSourceIds = present.map((p) => p.sourceId);
  pendingFields.push({
    needsHuman: true,
    reason: "conflict",
    fieldPath,
    message: `"${fieldPath}" has conflicting values across sources; human must resolve`,
    conflictingValues,
    sourceIds: conflictingSourceIds,
  });
  notes.push(`conflict on "${fieldPath}" across [${conflictingSourceIds.join(", ")}]`);
  return undefined;
}

// Dedupe key for a work entry — identifies the same employment record across sources.
// We use name + position + startDate; omitting endDate so an entry updated with a departure
// date in a newer resume still dedupes against the older version.
function workKey(entry: WorkEntry): string {
  return `${entry.name.trim().toLowerCase()}|${entry.position.trim().toLowerCase()}|${(entry.startDate ?? "").trim()}`;
}

// "Completeness" score for a work entry — used to pick the richer entry when two sources share
// a dedupe key. Higher = more detail.
function workCompleteness(entry: WorkEntry): number {
  return (entry.summary !== undefined ? 1 : 0) + (entry.endDate !== undefined ? 1 : 0) + (entry.url !== undefined ? 1 : 0) + (entry.highlights?.length ?? 0);
}

function mergeWorkEntries(sources: ReadonlyArray<ParsedSource>, notes: string[]): WorkEntry[] {
  const best = new Map<string, WorkEntry>();
  const order: string[] = [];

  for (const source of sources) {
    for (const entry of source.resume.work ?? []) {
      const key = workKey(entry);
      const existing = best.get(key);
      if (existing === undefined) {
        best.set(key, entry);
        order.push(key);
      } else if (workCompleteness(entry) > workCompleteness(existing)) {
        best.set(key, entry);
        notes.push(`work "${entry.name}/${entry.position}" — kept richer entry from "${source.sourceId}"`);
      }
    }
  }

  return order.flatMap((k) => {
    const v = best.get(k);
    return v !== undefined ? [v] : [];
  });
}

// Dedupe key for an education entry.
function educationKey(entry: EducationEntry): string {
  return `${entry.institution.trim().toLowerCase()}|${(entry.studyType ?? "").trim().toLowerCase()}|${(entry.startDate ?? "").trim()}`;
}

function educationCompleteness(entry: EducationEntry): number {
  return (entry.area !== undefined ? 1 : 0) + (entry.endDate !== undefined ? 1 : 0) + (entry.score !== undefined ? 1 : 0) + (entry.courses?.length ?? 0);
}

function mergeEducationEntries(sources: ReadonlyArray<ParsedSource>, notes: string[]): EducationEntry[] {
  const best = new Map<string, EducationEntry>();
  const order: string[] = [];

  for (const source of sources) {
    for (const entry of source.resume.education ?? []) {
      const key = educationKey(entry);
      const existing = best.get(key);
      if (existing === undefined) {
        best.set(key, entry);
        order.push(key);
      } else if (educationCompleteness(entry) > educationCompleteness(existing)) {
        best.set(key, entry);
        notes.push(`education "${entry.institution}" — kept richer entry from "${source.sourceId}"`);
      }
    }
  }

  return order.flatMap((k) => {
    const v = best.get(k);
    return v !== undefined ? [v] : [];
  });
}

// Skills dedupe: same name (case-insensitive) → merge keywords, keep original casing from first
// occurrence, take the higher level if specified.
function mergeSkills(sources: ReadonlyArray<ParsedSource>, notes: string[]): Skill[] {
  const best = new Map<string, { name: string; level?: string; keywordsSet: Set<string> }>();
  const order: string[] = [];

  for (const source of sources) {
    for (const skill of source.resume.skills ?? []) {
      const key = skill.name.trim().toLowerCase();
      const existing = best.get(key);
      if (existing === undefined) {
        best.set(key, {
          name: skill.name,
          ...(skill.level !== undefined ? { level: skill.level } : {}),
          keywordsSet: new Set(skill.keywords ?? []),
        });
        order.push(key);
      } else {
        // Merge keywords; prefer a defined level over undefined
        for (const kw of skill.keywords ?? []) existing.keywordsSet.add(kw);
        if (existing.level === undefined && skill.level !== undefined) {
          existing.level = skill.level;
          notes.push(`skill "${skill.name}" — level added from "${source.sourceId}"`);
        }
      }
    }
  }

  return order.flatMap((k) => {
    const entry = best.get(k);
    if (entry === undefined) return [];
    const skill: Skill = { name: entry.name };
    if (entry.level !== undefined) skill.level = entry.level;
    if (entry.keywordsSet.size > 0) skill.keywords = [...entry.keywordsSet];
    return [skill];
  });
}

// Merge basics, returning the merged object and any pending fields.
function mergeBasics(sources: ReadonlyArray<ParsedSource>, pendingFields: NeedsHumanField[], notes: string[]): Basics | undefined {
  const allBasics = sources.map((s) => ({ sourceId: s.sourceId, basics: s.resume.basics }));
  if (allBasics.every((b) => b.basics === undefined)) return undefined;

  const pick = <K extends keyof Basics>(field: K) =>
    allBasics.map((b) => ({ value: b.basics?.[field], sourceId: b.sourceId }));

  const name = mergeScalar("basics.name", pick("name"), pendingFields, notes);
  const email = mergeScalar("basics.email", pick("email"), pendingFields, notes);
  const phone = mergeScalar("basics.phone", pick("phone"), pendingFields, notes);
  const label = mergeScalar("basics.label", pick("label"), pendingFields, notes);
  const summary = mergeScalar("basics.summary", pick("summary"), pendingFields, notes);
  const url = mergeScalar("basics.url", pick("url"), pendingFields, notes);
  const location = mergeScalar("basics.location", pick("location"), pendingFields, notes);

  // profiles: union by network+username
  const profilesSeen = new Set<string>();
  const mergedProfiles = allBasics.flatMap((b) => b.basics?.profiles ?? []).filter((p) => {
    const key = `${p.network.toLowerCase()}|${p.username.toLowerCase()}`;
    if (profilesSeen.has(key)) return false;
    profilesSeen.add(key);
    return true;
  });

  const basics: Basics = {};
  if (name !== undefined) basics.name = name;
  if (email !== undefined) basics.email = email;
  if (phone !== undefined) basics.phone = phone;
  if (label !== undefined) basics.label = label;
  if (summary !== undefined) basics.summary = summary;
  if (url !== undefined) basics.url = url;
  if (location !== undefined) basics.location = location;
  if (mergedProfiles.length > 0) basics.profiles = mergedProfiles;

  return basics;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a master profile from 1..N parsed source documents.
 *
 * Rules:
 * - basics scalars: agree across sources → resolve; conflict → NeedsHuman (field omitted)
 * - work entries: deduplicate by (name+position+startDate); keep most-complete version
 * - education: deduplicate by (institution+studyType+startDate); keep most-complete version
 * - skills: deduplicate by name (case-insensitive); merge keywords, prefer defined level
 * - all other sections (volunteer, awards, etc.): union without dedupe (low-risk duplication)
 *
 * The returned MasterProfile starts with no approvalState — call approveProfile() from
 * profile-approval.ts after human review to mark it authoritative.
 */
export function compileProfile(sources: ReadonlyArray<ParsedSource>): MasterProfile {
  if (sources.length === 0) throw new Error("compileProfile: at least one ParsedSource is required");

  const pendingFields: NeedsHumanField[] = [];
  const notes: string[] = [];

  const work = mergeWorkEntries(sources, notes);
  const education = mergeEducationEntries(sources, notes);
  const skills = mergeSkills(sources, notes);
  const basics = mergeBasics(sources, pendingFields, notes);

  // Union-merge for sections where identity is stable enough to not require dedup (rare, small)
  const volunteer = sources.flatMap((s) => s.resume.volunteer ?? []);
  const awards = sources.flatMap((s) => s.resume.awards ?? []);
  const certificates = sources.flatMap((s) => s.resume.certificates ?? []);
  const publications = sources.flatMap((s) => s.resume.publications ?? []);
  const languages = sources.flatMap((s) => s.resume.languages ?? []);
  const interests = sources.flatMap((s) => s.resume.interests ?? []);
  const references = sources.flatMap((s) => s.resume.references ?? []);
  const projects = sources.flatMap((s) => s.resume.projects ?? []);

  const resume: JsonResume = {};
  if (basics !== undefined) resume.basics = basics;
  if (work.length > 0) resume.work = work;
  if (volunteer.length > 0) resume.volunteer = volunteer;
  if (education.length > 0) resume.education = education;
  if (awards.length > 0) resume.awards = awards;
  if (certificates.length > 0) resume.certificates = certificates;
  if (publications.length > 0) resume.publications = publications;
  if (skills.length > 0) resume.skills = skills;
  if (languages.length > 0) resume.languages = languages;
  if (interests.length > 0) resume.interests = interests;
  if (references.length > 0) resume.references = references;
  if (projects.length > 0) resume.projects = projects;

  notes.push(
    `compiled ${sources.length} source(s) → ${work.length} work, ${education.length} education, ${skills.length} skills`,
  );

  return {
    compiledAt: new Date().toISOString(),
    sourceIds: sources.map((s) => s.sourceId),
    resume,
    pendingFields,
    needsHumanCount: pendingFields.length,
    compileNotes: notes,
  };
}
