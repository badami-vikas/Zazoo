/**
 * Derived Record metadata (TASK-063) — `createdTime`, `createdBy`,
 * `lastEditedTime`, `lastEditedBy`, computed from the Event log.
 *
 * DERIVED, NEVER STORED TWICE. Every governed write already appends an Event;
 * a second copy of "when was this last touched" on the Record row would be a
 * value that can disagree with the ledger, and the ledger is the one that is
 * append-only. So these four are a projection, and nothing can write to them.
 *
 * THE ACTOR IS READ FROM DECLARED KEYS, NOT SNIFFED. `events.payload` is
 * free-form jsonb; guessing an actor out of it would invent provenance. The
 * keys below are the ones Bridge's own writers actually use, listed here so the
 * set is reviewable — and when none is present the answer is `null`, which
 * renders as an honest empty cell rather than a plausible name (ADR-247:
 * unknown is first-class).
 */

/** Payload keys Bridge's own Event writers use for "who did this", in priority order. */
export const RECORD_ACTOR_PAYLOAD_KEYS = [
  "actorId",
  "actorUserId",
  "deciderId",
  "ownerUserId",
  "userId",
] as const;

export interface RecordEventRow {
  entityId: string;
  createdAt: string;
  payload: unknown;
}

export interface RecordMetadata {
  createdTime: string | null;
  createdBy: string | null;
  lastEditedTime: string | null;
  lastEditedBy: string | null;
}

export function actorFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of RECORD_ACTOR_PAYLOAD_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/**
 * Fold Events into one metadata row per entity.
 *
 * Order is decided here rather than trusted from the caller's query: an Event
 * log read with a different ORDER BY would otherwise silently swap "created"
 * and "last edited", and that failure looks like data rather than a bug.
 */
export function deriveRecordMetadata(
  events: readonly RecordEventRow[],
): Map<string, RecordMetadata> {
  const byEntity = new Map<string, RecordMetadata>();
  for (const event of events) {
    const current = byEntity.get(event.entityId);
    const actor = actorFromPayload(event.payload);
    if (!current) {
      byEntity.set(event.entityId, {
        createdTime: event.createdAt,
        createdBy: actor,
        lastEditedTime: event.createdAt,
        lastEditedBy: actor,
      });
      continue;
    }
    if (current.createdTime === null || event.createdAt < current.createdTime) {
      current.createdTime = event.createdAt;
      current.createdBy = actor;
    }
    if (current.lastEditedTime === null || event.createdAt >= current.lastEditedTime) {
      current.lastEditedTime = event.createdAt;
      current.lastEditedBy = actor;
    }
  }
  return byEntity;
}

/** A Record with no Events at all is not an error — it is a Record nothing has
 * happened to yet, and every field reads unknown. */
export function emptyRecordMetadata(): RecordMetadata {
  return { createdTime: null, createdBy: null, lastEditedTime: null, lastEditedBy: null };
}
