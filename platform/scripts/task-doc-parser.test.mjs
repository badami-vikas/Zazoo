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

