import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { assignHorizonHierarchy, duplicateFieldIncidents, parseCanonicalTasks, projectCanonicalTasks, renderActiveTaskIndex } from './task-doc-parser.mjs';

test('one canonical task absorbs roadmap, bug, request, and approval references', () => {
  const document = `
## Prototype shell
- ID: TASK-001
- Status: ready
- Priority: P0
- Horizon: Prototype
- Outcome: One coherent shell.
- Prototype test: Modules open and deprecated labels are absent.
- Scope: docs/raw/ui.md
- Evidence: BUGS#tools; BUGS#panels
- Requests: R-019
- Approval: AP-021 applied
- Dependencies: none
`;
  const tasks = parseCanonicalTasks(document);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0], {
    id: 'TASK-001', title: 'Prototype shell', status: 'ready', priority: 'P0', horizon: 'Prototype',
    outcome: 'One coherent shell.', prototypeTest: 'Modules open and deprecated labels are absent.',
    scope: ['docs/raw/ui.md'], evidence: ['BUGS#tools', 'BUGS#panels'], requests: ['R-019'],
    approval: 'AP-021 applied', dependencies: [],
  });
});

test('docs/TASKS.md projection separates stable Record identity from materialized tree path', () => {
  const projection = projectCanonicalTasks(`
## Task Manager Module
- ID: TASK-021
- Status: in_progress
- Horizon: Prototype
- Outcome: One governed queue.
- Prototype test: Real Task flow completes with evidence.
`);
  const goal = projection.tasks.find((task) => task.isGoal);
  const task = projection.tasks.find((entry) => entry.recordId === 'TASK-021');
  assert.equal(goal.recordId, 'HORIZON-prototype');
  assert.equal(goal.path, '1');
  assert.equal(task.path, '1.1');
  assert.equal(task.level, 1);
  assert.equal(task.parentRecordId, 'HORIZON-prototype');
  assert.equal(task.exitTest, 'Real Task flow completes with evidence.');
  assert.equal(task.outcomes[0].target, 'Real Task flow completes with evidence.');
  assert.match(projection.contentHash, /^[0-9a-f]{8}$/);
  assert.match(projection.recordVersions['TASK-021'], /^[0-9a-f]{8}$/);
});

test('an annotated Status line keeps its status token and preserves the qualifier', () => {
  const tasks = parseCanonicalTasks(`
## Landed but not met
- ID: TASK-089
- Status: in_progress (admin surface LANDED 2026-08-30, ADR-262; the invite half is NOT met)

## Verified complete
- ID: TASK-072
- Status: done (2026-08-16, live-verified)

## Plain
- ID: TASK-001
- Status: ready
`);
  assert.deepEqual(tasks.map((task) => task.status), ['in_progress', 'done', 'ready']);
  assert.equal(tasks[0].statusNote, 'admin surface LANDED 2026-08-30, ADR-262; the invite half is NOT met');
  assert.equal(tasks[1].statusNote, '2026-08-16, live-verified');
  assert.equal(tasks[2].statusNote, undefined);
  // The bug this guards: an annotated in_progress task fell out of the active
  // index entirely, because the whole line was compared against the statuses.
  const index = renderActiveTaskIndex(`
## Landed but not met
- ID: TASK-089
- Status: in_progress (admin surface LANDED 2026-08-30, ADR-262)
- Priority: P2
`);
  assert.match(index, /\| TASK-089 \| in_progress \| P2 \| Landed but not met \| none \|/);
});

test('hierarchy is Horizon Goal nodes over their tasks, and never a guessed task-to-task parent', () => {
  const { goals, tasks } = assignHorizonHierarchy(parseCanonicalTasks(`
## First
- ID: TASK-001
- Status: done
- Horizon: Prototype

## Second
- ID: TASK-002
- Status: ready
- Horizon: Core Modules
- Dependencies: TASK-001

## Third
- ID: TASK-003
- Status: ready
- Horizon: Prototype

## Unfiled
- ID: TASK-004
- Status: ready
`));
  assert.deepEqual(goals.map((goal) => [goal.recordId, goal.path]), [
    ['HORIZON-prototype', '1'],
    ['HORIZON-core-modules', '2'],
  ]);
  assert.deepEqual(tasks.map((task) => [task.id, task.parentRecordId, task.path, task.level]), [
    ['TASK-001', 'HORIZON-prototype', '1.1', 1],
    ['TASK-002', 'HORIZON-core-modules', '2.1', 1],
    ['TASK-003', 'HORIZON-prototype', '1.2', 1],
    // No Horizon declared -> root, next to the Goal nodes. Never filed under a
    // guessed parent, and never parented by its Dependencies.
    ['TASK-004', null, '3', 0],
  ]);
  assert.equal(new Set([...goals, ...tasks].map((node) => node.path)).size, 6, 'paths are unique');
});

test('a non-task section heading (no immediately-following "- ID:" line) is never mistaken for a task, and does not leak its own fields onto the preceding task', () => {
  const document = `
## Prototype shell
- ID: TASK-001
- Status: ready

## Execution order

Some prose, not a field line.

- Status: this looks like a field but belongs to no task

## Second task
- ID: TASK-002
- Status: done
`;
  const tasks = parseCanonicalTasks(document);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((t) => t.id), ['TASK-001', 'TASK-002']);
  assert.equal(tasks[0].status, 'ready', "the 'Execution order' section's stray '- Status:' line must never overwrite TASK-001's own status");
  assert.equal(tasks[1].status, 'done');
});

test('parses title headings with explicit task IDs and preserves canonical order', () => {
  const document = `
IDs for cross-reference: \`TASK-002, TASK-001\`

## Prototype shell
- ID: TASK-001
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: One coherent shell.
- Prototype test: Modules open.
- Scope: docs/raw/ui.md
- Evidence: browser proof
- Requests: none
- Approval: AP-021 applied
- Dependencies: none

## Relationship module
- ID: TASK-002
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: One Relationship module.
- Prototype test: Signal opens.
- Scope: docs/raw/relationships.md
- Evidence: API proof
- Requests: R-001
- Approval: AP-030 applied
- Dependencies: TASK-001
`;

  const tasks = parseCanonicalTasks(document);
  assert.deepEqual(tasks.map(({ id, title }) => ({ id, title })), [
    { id: 'TASK-002', title: 'Relationship module' },
    { id: 'TASK-001', title: 'Prototype shell' },
  ]);
  assert.deepEqual(tasks[0].dependencies, ['TASK-001']);
  assert.deepEqual(tasks[1].dependencies, []);
});

test('hybrid legacy sections do not duplicate matching IDs and reject conflicts', () => {
  const matching = parseCanonicalTasks(`
## TASK-001 — Prototype shell
- ID: TASK-001
- Status: ready
`);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].status, 'ready');

  assert.throws(
    () => parseCanonicalTasks(`
## TASK-001 — Prototype shell
- ID: TASK-002
`),
    /Conflicting task IDs/,
  );
});

test('active task index is compact, ordered, and excludes completed audit history', () => {
  const index = renderActiveTaskIndex(`
IDs for cross-reference: \`TASK-003, TASK-001, TASK-002\`

## Completed shell
- ID: TASK-001
- Status: done
- Priority: P0

## Blocked integration
- ID: TASK-002
- Status: blocked
- Priority: P1
- Dependencies: TASK-001

## Current optimization
- ID: TASK-003
- Status: in_progress
- Priority: P1
- Dependencies: none
`);

  assert.doesNotMatch(index, /Completed shell/);
  assert.match(index, /\| TASK-003 \| in_progress \| P1 \| Current optimization \| none \|/);
  assert.match(index, /\| TASK-002 \| blocked \| P1 \| Blocked integration \| TASK-001 \|/);
  assert.ok(index.indexOf('TASK-003') < index.indexOf('TASK-002'));
});

test('active task index renders dependency IDs only — canonical prose stays in TASKS.md', () => {
  // The index is non-canonical navigation under an always-loaded byte budget
  // (check-agent-context). The canonical Dependencies line may carry prose
  // (stale-blocker notes, unblock conditions); the INDEX renders just the
  // TASK-nnn ids, deduplicated, or an honest pointer when the gate is not a
  // task at all — never a paragraph.
  const index = renderActiveTaskIndex(`
## Prose-gated work
- ID: TASK-010
- Status: blocked
- Priority: P2
- Dependencies: the TASK-011 PT-5 cold-start evidence; TASK-012 is \`done\` and was a stale blocker; TASK-011 also gates the deploy

## Non-task gate
- ID: TASK-013
- Status: blocked
- Priority: P2
- Dependencies: user acceptance of the proposed phase mapping (AP-007 still PROPOSED)
`);

  assert.match(index, /\| TASK-010 \| blocked \| P2 \| Prose-gated work \| TASK-011, TASK-012 \|/);
  assert.match(index, /\| TASK-013 \| blocked \| P2 \| Non-task gate \| non-task gate \(see TASKS.md\) \|/);
  assert.match(index, /Non-canonical navigation only/);
});
test('a stray field block is inert, not authoritative — the record\'s own fields win and the duplicate is reported', () => {
  // The real defect, 2026-09-01: an orphaned copy of TASK-023's whole field
  // block sat after TASK-037's record with no heading and no `- ID:` of its
  // own, so the scanner handed all seven fields to TASK-037 and the Task
  // Manager showed one task wearing another's outcome and approval.
  const document = `
## Repository hygiene
- ID: TASK-037
- Status: ready
- Outcome: No unlanded work exists only on one machine.
- Dependencies: none

- Outcome: Learning Agent gains a web-research Skill.
- Dependencies: TASK-007
- Approval: AP-039 applied
`;
  const [task] = parseCanonicalTasks(document);
  assert.equal(task.outcome, 'No unlanded work exists only on one machine.');
  assert.deepEqual(task.dependencies, []);
  assert.equal(task.approval, 'AP-039 applied', 'a field the record never states is still picked up — only duplicates are ignored');

  assert.deepEqual(duplicateFieldIncidents(document), [
    { taskId: 'TASK-037', field: 'outcome', keptLine: 5, ignoredLine: 8 },
    { taskId: 'TASK-037', field: 'dependencies', keptLine: 6, ignoredLine: 9 },
  ]);
});

test('on the committed ledger, no reported duplicate is the value the parser kept', () => {
  // The weaker version of this test — "no two tasks share an Outcome verbatim"
  // — passed against the BROKEN parser, because the stray block is an older
  // variant of TASK-023's text rather than a byte copy. A test that cannot
  // fail on the defect is not evidence (2026-08-03 test audit). This asserts
  // the actual contract instead: for every duplicate the document contains,
  // the value the parser ended up with is the one on the line it KEPT, never
  // the one it reported as ignored.
  const document = readFileSync(new URL('../../docs/TASKS.md', import.meta.url), 'utf8');
  const lines = document.split(/\r?\n/);
  const tasks = new Map(parseCanonicalTasks(document).map((task) => [task.id, task]));
  const incidents = duplicateFieldIncidents(document);
  assert.ok(incidents.length > 0, 'the fixture for this test is the real document; it currently contains stray blocks');
  for (const incident of incidents) {
    const parsed = tasks.get(incident.taskId);
    const valueOf = (line) => lines[line - 1].slice(lines[line - 1].indexOf(':') + 1).trim();
    const kept = valueOf(incident.keptLine);
    const ignored = valueOf(incident.ignoredLine);
    if (kept === ignored) continue;
    const property = incident.field === 'prototype test' ? 'prototypeTest' : incident.field;
    const actual = parsed[property];
    const rendered = Array.isArray(actual) ? actual.join('; ') : String(actual ?? '');
    assert.notEqual(
      rendered,
      ignored === 'none' ? '' : ignored,
      `${incident.taskId}.${incident.field} took the value from ignored line ${incident.ignoredLine}`,
    );
  }
});
