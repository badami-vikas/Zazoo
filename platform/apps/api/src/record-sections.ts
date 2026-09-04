/**
 * Which Sections a Database's Record pages show, and the notes those pages
 * hold (TASK-083, ADR-261 under AP-171) — everything about it that is a pure
 * function of its inputs.
 *
 * PER-DATABASE, NEVER PER-RECORD. Two Records of one Database showing
 * different Sections is precisely the single-page divergence the UI gate exists
 * to catch, so the toggle is keyed by the spec id alone and there is no
 * Record-scoped variant to drift from it.
 *
 * DISABLING IS NOT DELETING. Sections and notes live in separate namespaces, so
 * switching Notes off hides the Section and leaves every note exactly where it
 * was — switching it back on shows them again.
 */
export const RECORD_SECTIONS = ["notes", "intelligence", "governance"] as const;
export type RecordSection = (typeof RECORD_SECTIONS)[number];

export type RecordSections = Record<RecordSection, boolean>;

export const RECORD_SECTIONS_NAMESPACE_PREFIX = "record:sections:";
export const RECORD_NOTES_NAMESPACE_PREFIX = "record:notes:";

/** Off until a human turns one on: a Section nobody asked for is chrome. */
export function defaultRecordSections(): RecordSections {
  return { notes: false, intelligence: false, governance: false };
}

/** Parse whatever the state store held. Anything unrecognised reads as "all
 * off" — a corrupt row must not silently reshape every Record page. */
export function readRecordSections(raw: unknown): RecordSections {
  const sections = defaultRecordSections();
  if (!raw || typeof raw !== "object") return sections;
  const record = raw as Record<string, unknown>;
  for (const section of RECORD_SECTIONS) {
    if (typeof record[section] === "boolean") sections[section] = record[section] as boolean;
  }
  return sections;
}

export interface RecordNote {
  text: string;
  updatedAt: string;
}

/** One Database's notes, keyed by Record id. */
export type RecordNotes = Record<string, RecordNote>;

export function readRecordNotes(raw: unknown): RecordNotes {
  if (!raw || typeof raw !== "object") return {};
  const notes: RecordNotes = {};
  for (const [recordId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as { text?: unknown; updatedAt?: unknown };
    if (typeof candidate.text !== "string") continue;
    notes[recordId] = {
      text: candidate.text,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    };
  }
  return notes;
}

/**
 * Write one Record's note. An empty note is a removal rather than a stored
 * blank, so "no note" and "a note that says nothing" cannot diverge.
 */
export function applyRecordNote(
  notes: RecordNotes,
  recordId: string,
  text: string,
  updatedAt: string,
): RecordNotes {
  const next = { ...notes };
  if (text.trim() === "") delete next[recordId];
  else next[recordId] = { text, updatedAt };
  return next;
}
