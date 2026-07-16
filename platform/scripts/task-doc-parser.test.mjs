import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCanonicalTasks } from './task-doc-parser.mjs';

test('one canonical task absorbs roadmap, bug, request, and approval references', () => {
  const document = `
## TASK-001 — Prototype shell
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
