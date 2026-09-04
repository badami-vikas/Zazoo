/**
 * Tags and internal notes — Bridge's OWN data about a WhatsApp subject.
 *
 * This module touches no WhatsApp API, reads no session, and sends nothing. A
 * tag and a note are things the OWNER wrote about a chat, a Person, or a
 * Community; they are not observations scraped out of WhatsApp and they are
 * never visible to the counterparty. That is the whole point of "internal".
 *
 * Residency: Local Plane only. These annotations are the owner's private
 * commentary about other people, which is if anything MORE sensitive than the
 * message bodies ADR-158 already confined to the local tier. There is no
 * dual-write and no promote path.
 *
 * Pure, like the rest of this Module: no clock, no RNG, no I/O. `now` and the
 * note id are supplied by the caller, so the whole surface is a reducer over a
 * JSON value that `LocalStateStore` persists.
 */

/** The Local Plane state namespace these annotations live in. */
export const WHATSAPP_ANNOTATIONS_NAMESPACE = "whatsapp:annotations";

/**
 * What an annotation can be attached to.
 *
 * A `chat` and a `community` are distinguished even though both are addressed
 * by a chat id: a note about "this group" and a note about "this thread" mean
 * different things to a reader, and collapsing them would silently merge two
 * people's notes into one list.
 */
export type AnnotationSubjectKind = "chat" | "person" | "community";

export interface AnnotationSubject {
  kind: AnnotationSubjectKind;
  /**
   * The subject's identifier in ITS OWN key space: a chat id (`…@c.us`,
   * `…@g.us`) for `chat`/`community`, and a source-scoped dedupe key
   * (`whatsapp:+E164` or `whatsapp-lid:<id>`) for `person`. Never mixed — the
   * same rule `normalize.ts` enforces for identity.
   */
  id: string;
}

export interface InternalNote {
  id: string;
  /** The note text, exactly as written. Never sent anywhere. */
  body: string;
  /** Who wrote it. A human identity, never an Agent id. */
  authorId: string;
  createdAt: string;
}

export interface SubjectAnnotations {
  subjectKey: string;
  kind: AnnotationSubjectKind;
  subjectId: string;
  /** Normalized, de-duplicated, sorted. */
  tags: string[];
  /** Newest first. */
  notes: InternalNote[];
  updatedAt: string;
}

export interface AnnotationState {
  version: 1;
  subjects: Record<string, SubjectAnnotations>;
}

/** Longest accepted tag. Long enough for a real label, short enough to render. */
export const MAX_TAG_LENGTH = 48;
/** Longest accepted note. Generous — a note is prose, not a field. */
export const MAX_NOTE_LENGTH = 4_096;

export function subjectKeyOf(subject: AnnotationSubject): string {
  return `${subject.kind}:${subject.id}`;
}

export function emptyAnnotationState(): AnnotationState {
  return { version: 1, subjects: {} };
}

/**
 * Normalize a tag to its stored form: case-folded, whitespace-collapsed.
 *
 * Case folding is what makes "Investor" and "investor" one tag rather than two,
 * which is the difference between a tag list that stays useful and one that
 * accumulates near-duplicates until nobody trusts it. Returns an empty string
 * for anything that normalizes to nothing, which callers treat as "not a tag".
 */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/**
 * Accept an unknown persisted value as annotation state, or start fresh.
 *
 * Same reasoning as `readSyncState` in `messages.ts`: the value comes back from
 * a JSON column and could have been written by an older shape. Anything
 * unrecognised yields empty state. Unlike a sync cursor, though, discarding
 * these would LOSE the owner's own writing rather than cost a re-read — so this
 * reader is deliberately salvaging: a malformed subject entry is skipped
 * individually, and the rest of the state survives.
 */
export function readAnnotationState(value: unknown): AnnotationState {
  if (typeof value !== "object" || value === null) return emptyAnnotationState();
  const candidate = value as Partial<AnnotationState>;
  if (
    candidate.version !== 1 ||
    typeof candidate.subjects !== "object" ||
    candidate.subjects === null
  ) {
    return emptyAnnotationState();
  }

  const subjects: Record<string, SubjectAnnotations> = {};
  for (const [subjectKey, entry] of Object.entries(candidate.subjects)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<SubjectAnnotations>;
    if (row.kind !== "chat" && row.kind !== "person" && row.kind !== "community") continue;
    if (typeof row.subjectId !== "string" || row.subjectId.length === 0) continue;

    const tags = Array.isArray(row.tags)
      ? [
          ...new Set(
            row.tags
              .filter((tag): tag is string => typeof tag === "string")
              .map(normalizeTag)
              .filter((tag) => tag.length > 0),
          ),
        ].sort()
      : [];

    const notes = Array.isArray(row.notes)
      ? row.notes
          .filter((note): note is InternalNote => {
            if (!note || typeof note !== "object") return false;
            const record = note as Partial<InternalNote>;
            return (
              typeof record.id === "string" &&
              record.id.length > 0 &&
              typeof record.body === "string" &&
              typeof record.authorId === "string" &&
              typeof record.createdAt === "string"
            );
          })
          .map((note) => ({
            id: note.id,
            body: note.body,
            authorId: note.authorId,
            createdAt: note.createdAt,
          }))
      : [];

    subjects[subjectKey] = {
      subjectKey,
      kind: row.kind,
      subjectId: row.subjectId,
      tags,
      notes,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    };
  }
  return { version: 1, subjects };
}

function subjectEntry(
  state: AnnotationState,
  subject: AnnotationSubject,
): SubjectAnnotations {
  const key = subjectKeyOf(subject);
  return (
    state.subjects[key] ?? {
      subjectKey: key,
      kind: subject.kind,
      subjectId: subject.id,
      tags: [],
      notes: [],
      updatedAt: "",
    }
  );
}

/**
 * Drop a subject that carries nothing.
 *
 * An entry with no tags and no notes is indistinguishable from an absent one to
 * every reader, so keeping it would only grow the state and make "how many
 * things have I annotated" wrong.
 */
function pruned(state: AnnotationState, key: string): AnnotationState {
  const entry = state.subjects[key];
  if (!entry || entry.tags.length > 0 || entry.notes.length > 0) return state;
  const subjects = { ...state.subjects };
  delete subjects[key];
  return { version: 1, subjects };
}

/** Add tags. Idempotent: re-adding an existing tag changes nothing. */
export function addTags(
  state: AnnotationState,
  subject: AnnotationSubject,
  rawTags: readonly string[],
  atIso: string,
): AnnotationState {
  const incoming = rawTags.map(normalizeTag).filter((tag) => tag.length > 0);
  if (incoming.length === 0) return state;

  const entry = subjectEntry(state, subject);
  const merged = [...new Set([...entry.tags, ...incoming])].sort();
  if (merged.length === entry.tags.length && merged.every((tag, i) => tag === entry.tags[i])) {
    return state;
  }
  return {
    version: 1,
    subjects: {
      ...state.subjects,
      [entry.subjectKey]: { ...entry, tags: merged, updatedAt: atIso },
    },
  };
}

/** Remove one tag. Removing an absent tag is a no-op, not an error. */
export function removeTag(
  state: AnnotationState,
  subject: AnnotationSubject,
  rawTag: string,
  atIso: string,
): AnnotationState {
  const tag = normalizeTag(rawTag);
  const key = subjectKeyOf(subject);
  const entry = state.subjects[key];
  if (!entry || !entry.tags.includes(tag)) return state;

  const next: AnnotationState = {
    version: 1,
    subjects: {
      ...state.subjects,
      [key]: {
        ...entry,
        tags: entry.tags.filter((candidate) => candidate !== tag),
        updatedAt: atIso,
      },
    },
  };
  return pruned(next, key);
}

/**
 * Add an internal note. Newest first.
 *
 * An empty body is refused rather than stored: a blank note is not a record of
 * anything, and a list of them makes the real notes harder to find.
 */
export function addNote(
  state: AnnotationState,
  subject: AnnotationSubject,
  note: { id: string; body: string; authorId: string },
  atIso: string,
): AnnotationState {
  const body = note.body.trim().slice(0, MAX_NOTE_LENGTH);
  if (body.length === 0) throw new Error("An internal note needs a body");
  const author = note.authorId.trim();
  if (author.length === 0) throw new Error("An internal note needs the person who wrote it");

  const entry = subjectEntry(state, subject);
  if (entry.notes.some((existing) => existing.id === note.id)) return state;

  return {
    version: 1,
    subjects: {
      ...state.subjects,
      [entry.subjectKey]: {
        ...entry,
        notes: [{ id: note.id, body, authorId: author, createdAt: atIso }, ...entry.notes],
        updatedAt: atIso,
      },
    },
  };
}

/** Remove one note by id. Removing an absent note is a no-op. */
export function removeNote(
  state: AnnotationState,
  subject: AnnotationSubject,
  noteId: string,
  atIso: string,
): AnnotationState {
  const key = subjectKeyOf(subject);
  const entry = state.subjects[key];
  if (!entry || !entry.notes.some((note) => note.id === noteId)) return state;

  const next: AnnotationState = {
    version: 1,
    subjects: {
      ...state.subjects,
      [key]: {
        ...entry,
        notes: entry.notes.filter((note) => note.id !== noteId),
        updatedAt: atIso,
      },
    },
  };
  return pruned(next, key);
}

/** Everything annotated, most recently touched first. Empty when nothing is. */
export function listAnnotations(state: AnnotationState): SubjectAnnotations[] {
  return Object.values(state.subjects).sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.subjectKey.localeCompare(b.subjectKey);
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

/** One subject's annotations, or null when it has none. Never a blank stand-in. */
export function annotationsFor(
  state: AnnotationState,
  subject: AnnotationSubject,
): SubjectAnnotations | null {
  return state.subjects[subjectKeyOf(subject)] ?? null;
}

/** Every tag in use with how many subjects carry it, most used first. */
export function tagCounts(state: AnnotationState): { tag: string; subjects: number }[] {
  const counts = new Map<string, number>();
  for (const entry of Object.values(state.subjects)) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, subjects]) => ({ tag, subjects }))
    .sort((a, b) => (b.subjects - a.subjects) || a.tag.localeCompare(b.tag));
}

/** Subjects carrying a tag, so a tag can actually be used to select a group. */
export function subjectsWithTag(
  state: AnnotationState,
  rawTag: string,
): SubjectAnnotations[] {
  const tag = normalizeTag(rawTag);
  if (tag.length === 0) return [];
  return listAnnotations(state).filter((entry) => entry.tags.includes(tag));
}
