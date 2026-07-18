import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCanonicalTasks } from './task-doc-parser.mjs';

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