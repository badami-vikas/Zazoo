/**
 * Agent assignment. The two properties under test are the two the panel
 * promises: every assignment is inspectable, and every one is reversible
 * WITHOUT losing the fact that it existed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  AssignmentError,
  EMPTY_ASSIGNMENT_LEDGER,
  activeAssignment,
  activeAssignments,
  assignAgent,
  assignmentHistory,
  describeAssignment,
  isAgentAllowedFor,
  sameSubject,
  subjectKey,
  unassignAgent,
  type AssignmentSubject,
} from "../src/assignment.js";

const AGENTS = ["contact-steward", "conversation-steward"];
const CHAT: AssignmentSubject = { kind: "chat", key: "919876543210@c.us" };
const PERSON: AssignmentSubject = { kind: "person", key: "whatsapp:+919876543210" };

function assign(ledger = EMPTY_ASSIGNMENT_LEDGER, overrides: Partial<Parameters<typeof assignAgent>[1]> = {}) {
  return assignAgent(ledger, {
    id: "a1",
    subject: CHAT,
    agentId: "conversation-steward",
    assignedBy: "Vikas",
    assignedAt: "2026-08-01T10:00:00.000Z",
    allowedAgentIds: AGENTS,
    ...overrides,
  });
}

test("a chat subject and a person subject with the same key are different subjects", () => {
  assert.equal(sameSubject(CHAT, PERSON), false);
  assert.notEqual(subjectKey(CHAT), subjectKey({ kind: "person", key: CHAT.key }));
});

test("an empty ledger has no active assignment, rather than a default Agent", () => {
  assert.equal(activeAssignment(EMPTY_ASSIGNMENT_LEDGER, CHAT), undefined);
  assert.deepEqual(activeAssignments(EMPTY_ASSIGNMENT_LEDGER), []);
  assert.equal(isAgentAllowedFor(EMPTY_ASSIGNMENT_LEDGER, CHAT, "conversation-steward"), false);
});

test("assigning records the human who authorised it", () => {
  const { assignment } = assign();
  assert.equal(assignment.assignedBy, "Vikas");
  assert.equal(assignment.assignedAt, "2026-08-01T10:00:00.000Z");
  assert.match(describeAssignment(assignment), /Assigned by Vikas/);
});

test("assigning without a named human is refused", () => {
  assert.throws(() => assign(EMPTY_ASSIGNMENT_LEDGER, { assignedBy: "   " }), AssignmentError);
});

test("only an Agent the Module declares can be assigned", () => {
  assert.throws(
    () => assign(EMPTY_ASSIGNMENT_LEDGER, { agentId: "some-other-agent" }),
    /not an Agent this Module declares/,
  );
});

test("the attribution gate answers for the assigned Agent and no other", () => {
  const { ledger } = assign();
  assert.equal(isAgentAllowedFor(ledger, CHAT, "conversation-steward"), true);
  assert.equal(isAgentAllowedFor(ledger, CHAT, "contact-steward"), false);
  // …and only for the subject it was assigned to.
  assert.equal(isAgentAllowedFor(ledger, PERSON, "conversation-steward"), false);
});

test("re-assigning the same Agent is a no-op, not a spurious 'replaced' row", () => {
  const first = assign();
  const second = assignAgent(first.ledger, {
    id: "a2",
    subject: CHAT,
    agentId: "conversation-steward",
    assignedBy: "Vikas",
    assignedAt: "2026-08-02T10:00:00.000Z",
    allowedAgentIds: AGENTS,
  });
  assert.equal(second.ledger.assignments.length, 1);
  assert.equal(second.assignment.id, "a1");
});

test("assigning a different Agent supersedes the old row instead of deleting it", () => {
  const first = assign();
  const second = assignAgent(first.ledger, {
    id: "a2",
    subject: CHAT,
    agentId: "contact-steward",
    assignedBy: "Vikas",
    assignedAt: "2026-08-02T10:00:00.000Z",
    allowedAgentIds: AGENTS,
  });

  assert.equal(activeAssignment(second.ledger, CHAT)?.agentId, "contact-steward");
  const history = assignmentHistory(second.ledger, CHAT);
  assert.equal(history.length, 2);
  const superseded = history.find((entry) => entry.id === "a1");
  assert.equal(superseded?.supersededBy, "a2");
  assert.equal(superseded?.unassignedAt, "2026-08-02T10:00:00.000Z");
  assert.match(describeAssignment(superseded!), /Replaced on 2026-08-02/);
});

test("unassigning is reversible-by-record: the row survives, stamped", () => {
  const { ledger } = assign();
  const removed = unassignAgent(ledger, CHAT, "Vikas", "2026-08-03T10:00:00.000Z");

  assert.equal(activeAssignment(removed.ledger, CHAT), undefined);
  assert.equal(removed.ledger.assignments.length, 1, "the assignment must not be deleted");
  assert.equal(removed.assignment?.unassignedBy, "Vikas");
  assert.match(describeAssignment(removed.assignment!), /Removed by Vikas/);
  // And the Agent immediately loses the right to act.
  assert.equal(isAgentAllowedFor(removed.ledger, CHAT, "conversation-steward"), false);
});

test("unassigning twice is not an error and invents no second revocation", () => {
  const { ledger } = assign();
  const once = unassignAgent(ledger, CHAT, "Vikas", "2026-08-03T10:00:00.000Z");
  const twice = unassignAgent(once.ledger, CHAT, "Vikas", "2026-08-04T10:00:00.000Z");
  assert.equal(twice.assignment, undefined);
  assert.deepEqual(twice.ledger, once.ledger);
});

test("unassigning without a named human is refused", () => {
  const { ledger } = assign();
  assert.throws(() => unassignAgent(ledger, CHAT, "", "2026-08-03T10:00:00.000Z"), AssignmentError);
});

test("an assignment with a blank subject key is refused", () => {
  assert.throws(
    () => assign(EMPTY_ASSIGNMENT_LEDGER, { subject: { kind: "chat", key: "  " } }),
    /needs a chat or a Person/,
  );
});
