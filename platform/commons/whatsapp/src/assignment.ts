/**
 * Agent assignment — which Agent is answerable for a chat or a Person.
 *
 * Bridge canon: Skills stay under consuming Agents, and only an attributable
 * allowed Agent invokes them. An Automation starts an Agent Run, so before any
 * rule in `automation.ts` may fire there has to be an Agent that the OWNER
 * named for that subject. This module is where that naming is recorded.
 *
 * Two properties are the whole point:
 *
 *  - **Inspectable.** Every assignment carries the human who made it and when.
 *    `assignmentHistory` returns the full trail, including revoked rows, so
 *    "why did this Agent answer that chat in July" has an answer.
 *  - **Reversible.** `unassignAgent` never deletes. It stamps `unassignedAt`
 *    and `unassignedBy`, which is what makes the reversal auditable rather than
 *    an absence. `activeAssignment` is the only thing that reads as "current".
 *
 * Everything here is pure: no clock, no id generation, no I/O. `now` and `id`
 * are supplied by the caller, exactly as in `policy.ts`, so an assignment
 * decision is a function of its inputs and nothing else.
 *
 * Residency: assignments are Local Plane state. A subject key is a WhatsApp
 * chat id or a source-scoped person key, both of which are private identity
 * facts about the owner's own address book. Nothing here has a cloud path.
 */

// ── Subjects ─────────────────────────────────────────────────────────────────

/**
 * What an Agent can be assigned to.
 *
 * `chat` is a thread (`…@c.us`, `…@lid`, `…@g.us`); `person` is the
 * source-scoped identity key `LocalPerson.dedupeKey` uses (`whatsapp:+E164` or
 * `whatsapp-lid:<id>`). They are kept as separate kinds rather than collapsed
 * into one string space because a group chat has no Person behind it, and a
 * Person can be reachable in more than one thread.
 */
export type AssignmentSubjectKind = "chat" | "person";

export interface AssignmentSubject {
  kind: AssignmentSubjectKind;
  key: string;
}

/** Stable, comparable form of a subject. Used as a map key, never displayed. */
export function subjectKey(subject: AssignmentSubject): string {
  return `${subject.kind}:${subject.key}`;
}

export function sameSubject(a: AssignmentSubject, b: AssignmentSubject): boolean {
  return a.kind === b.kind && a.key === b.key;
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface AgentAssignment {
  id: string;
  subject: AssignmentSubject;
  /** A Module Agent id from the manifest, e.g. `contact-steward`. */
  agentId: string;
  /** The human who assigned. Never an Agent id — that is the attribution. */
  assignedBy: string;
  assignedAt: string;
  /** Why this Agent, in the owner's own words. Optional, never invented. */
  note?: string;
  /** Set when the assignment was revoked. Presence means "no longer active". */
  unassignedAt?: string;
  unassignedBy?: string;
  /**
   * Set when this row was ended because a NEW Agent was assigned to the same
   * subject, rather than by an explicit revocation. Kept distinct so the trail
   * can say "replaced" instead of implying the owner withdrew it.
   */
  supersededBy?: string;
}

/** The ledger. Append-and-stamp; rows are never removed. */
export interface AssignmentLedger {
  assignments: readonly AgentAssignment[];
}

export const EMPTY_ASSIGNMENT_LEDGER: AssignmentLedger = { assignments: [] };

function isActive(assignment: AgentAssignment): boolean {
  return assignment.unassignedAt === undefined;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The Agent currently answerable for a subject, or undefined.
 *
 * Undefined is a real and common answer: most chats have no assigned Agent, and
 * a surface must say so rather than implying a default. There is deliberately
 * no fallback Agent — an unassigned subject is one no Automation may act on.
 */
export function activeAssignment(
  ledger: AssignmentLedger,
  subject: AssignmentSubject,
): AgentAssignment | undefined {
  return ledger.assignments.find(
    (assignment) => isActive(assignment) && sameSubject(assignment.subject, subject),
  );
}

/** Every assignment ever made for a subject, newest first. Includes revoked. */
export function assignmentHistory(
  ledger: AssignmentLedger,
  subject: AssignmentSubject,
): readonly AgentAssignment[] {
  return ledger.assignments
    .filter((assignment) => sameSubject(assignment.subject, subject))
    .slice()
    .sort((a, b) => Date.parse(b.assignedAt) - Date.parse(a.assignedAt));
}

/** All currently-active assignments, newest first. What the panel lists. */
export function activeAssignments(ledger: AssignmentLedger): readonly AgentAssignment[] {
  return ledger.assignments
    .filter(isActive)
    .slice()
    .sort((a, b) => Date.parse(b.assignedAt) - Date.parse(a.assignedAt));
}

/**
 * The attribution gate: may this Agent act on this subject right now?
 *
 * Called before an Automation starts a Run. It is a strict identity check, not
 * a capability check — the manifest still decides what the Agent may do once it
 * is running.
 */
export function isAgentAllowedFor(
  ledger: AssignmentLedger,
  subject: AssignmentSubject,
  agentId: string,
): boolean {
  return activeAssignment(ledger, subject)?.agentId === agentId;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface AssignAgentInput {
  id: string;
  subject: AssignmentSubject;
  agentId: string;
  /** The human authorising this. Required, and it must be a name. */
  assignedBy: string;
  assignedAt: string;
  note?: string;
  /**
   * The Agent ids this Module actually declares. Passed in so the manifest
   * stays the single authority and this file does not keep a second copy that
   * can drift out of date.
   */
  allowedAgentIds: readonly string[];
}

export class AssignmentError extends Error {}

/**
 * Assign an Agent to a subject.
 *
 * Assigning over an existing assignment does not silently swap it: the previous
 * row is stamped `unassignedAt`/`supersededBy` and stays in the ledger, so the
 * history reads as a replacement with a date rather than as if the new Agent
 * had always been there.
 *
 * Re-assigning the SAME Agent to the same subject is a no-op that returns the
 * existing row, so a double-click does not produce a spurious "replaced"
 * entry in the owner's audit trail.
 */
export function assignAgent(
  ledger: AssignmentLedger,
  input: AssignAgentInput,
): { ledger: AssignmentLedger; assignment: AgentAssignment } {
  const assignedBy = input.assignedBy.trim();
  if (!assignedBy) {
    throw new AssignmentError("Assigning an Agent requires the person who authorised it.");
  }
  if (!input.subject.key.trim()) {
    throw new AssignmentError("An assignment needs a chat or a Person to be about.");
  }
  if (!input.allowedAgentIds.includes(input.agentId)) {
    throw new AssignmentError(
      `"${input.agentId}" is not an Agent this Module declares, so it cannot be assigned.`,
    );
  }

  const current = activeAssignment(ledger, input.subject);
  if (current && current.agentId === input.agentId) {
    return { ledger, assignment: current };
  }

  const note = input.note?.trim();
  const assignment: AgentAssignment = {
    id: input.id,
    subject: { kind: input.subject.kind, key: input.subject.key },
    agentId: input.agentId,
    assignedBy,
    assignedAt: input.assignedAt,
    ...(note ? { note } : {}),
  };

  const rest = ledger.assignments.map((existing) =>
    current && existing.id === current.id
      ? { ...existing, unassignedAt: input.assignedAt, unassignedBy: assignedBy, supersededBy: assignment.id }
      : existing,
  );

  return { ledger: { assignments: [assignment, ...rest] }, assignment };
}

/**
 * Revoke the active assignment for a subject.
 *
 * Returns the ledger unchanged when there was nothing active — unassigning
 * twice is not an error, and inventing a revocation row for an assignment that
 * never existed would put a fiction in the audit trail.
 */
export function unassignAgent(
  ledger: AssignmentLedger,
  subject: AssignmentSubject,
  unassignedBy: string,
  unassignedAt: string,
): { ledger: AssignmentLedger; assignment?: AgentAssignment } {
  const human = unassignedBy.trim();
  if (!human) {
    throw new AssignmentError("Removing an Agent requires the person who authorised it.");
  }
  const current = activeAssignment(ledger, subject);
  if (!current) return { ledger };

  const revoked: AgentAssignment = { ...current, unassignedAt, unassignedBy: human };
  return {
    ledger: {
      assignments: ledger.assignments.map((existing) =>
        existing.id === current.id ? revoked : existing,
      ),
    },
    assignment: revoked,
  };
}

/** One line describing an assignment's current state, for the panel. */
export function describeAssignment(assignment: AgentAssignment): string {
  if (assignment.supersededBy) {
    return `Replaced on ${assignment.unassignedAt ?? "an unrecorded date"}.`;
  }
  if (assignment.unassignedAt) {
    return `Removed by ${assignment.unassignedBy ?? "an unrecorded person"} on ${assignment.unassignedAt}.`;
  }
  return `Assigned by ${assignment.assignedBy} on ${assignment.assignedAt}.`;
}
