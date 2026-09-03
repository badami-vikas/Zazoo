import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPendingWorkEdits,
  movePendingWorkItem,
  updatePendingWorkItem,
  archivePendingWorkItem,
} from './pending-work.ts';

const source = [
  { id: 'roadmap:1', title: 'First', sourceType: 'roadmap', sourceFile: 'docs/PROGRESS.md', sourceLine: 10, status: 'open' },
  { id: 'bug:1', title: 'Second', sourceType: 'bug', sourceFile: 'docs/BUGS.md', sourceLine: 20, status: 'open' },
  { id: 'request:1', title: 'Third', sourceType: 'request', sourceFile: 'docs/requests.md', sourceLine: 30, status: 'partial' },
];

test('rank order is stable and persisted independently from source order', () => {
  const edits = movePendingWorkItem({}, source, 'request:1', 'roadmap:1');
  assert.deepEqual(applyPendingWorkEdits(source, edits).map((item) => item.id), [
    'request:1',
    'roadmap:1',
    'bug:1',
  ]);
});

test('title edits preserve source provenance', () => {
  const edits = updatePendingWorkItem({}, 'bug:1', { title: 'Clarified second task' });
  const item = applyPendingWorkEdits(source, edits).find((candidate) => candidate.id === 'bug:1');
  assert.equal(item.title, 'Clarified second task');
  assert.equal(item.sourceFile, 'docs/BUGS.md');
  assert.equal(item.sourceLine, 20);
});

test('delete is reversible archive, not destruction of the source record', () => {
  const edits = archivePendingWorkItem({}, 'roadmap:1', true);
  assert.equal(applyPendingWorkEdits(source, edits, false).some((item) => item.id === 'roadmap:1'), false);
  assert.equal(applyPendingWorkEdits(source, edits, true).find((item) => item.id === 'roadmap:1')?.archived, true);

  const restored = archivePendingWorkItem(edits, 'roadmap:1', false);
  assert.equal(applyPendingWorkEdits(source, restored, false).some((item) => item.id === 'roadmap:1'), true);
});

import { canonicalLedgerImportPayload } from './pending-work.ts';
import { PENDING_WORK_SOURCE } from './pending-work.ts';

test('the import payload puts Goal nodes before their children and maps all six ledger statuses', () => {
  const payload = canonicalLedgerImportPayload([
    { id: 'TASK-002', title: 'Child two', sourceType: 'task', sourceFile: 'docs/TASKS.md', sourceLine: 2, status: 'completed', canonicalStatus: 'done', parentId: 'HORIZON-a', priority: 'P1', outcome: 'Done thing', prototypeTest: 'It works' },
    { id: 'HORIZON-a', title: 'Prototype', sourceType: 'task', sourceFile: 'docs/TASKS.md', sourceLine: 0, status: 'open', isGoal: true },
    { id: 'TASK-001', title: 'Child one', sourceType: 'task', sourceFile: 'docs/TASKS.md', sourceLine: 1, status: 'in-progress', canonicalStatus: 'in_progress', parentId: 'HORIZON-a' },
  ]);
  assert.deepEqual(payload.map((entry) => entry.recordId), ['HORIZON-a', 'TASK-002', 'TASK-001']);
  assert.equal(payload[0].isGoal, true);
  assert.equal(payload[0].status, 'pending');
  assert.equal(payload[0].parentRecordId, null);
  assert.equal(payload[1].status, 'done');
  assert.equal(payload[1].parentRecordId, 'HORIZON-a');
  assert.equal(payload[1].exitTest, 'It works');
  assert.equal(payload[2].status, 'in_progress');
});

test('an unknown canonical status is dropped rather than guessed into pending', () => {
  const payload = canonicalLedgerImportPayload([
    { id: 'TASK-003', title: 'Annotated', sourceType: 'task', sourceFile: 'docs/TASKS.md', sourceLine: 3, status: 'open', canonicalStatus: 'in_progress (LANDED, exit test NOT met)' },
    { id: 'TASK-004', title: 'Plain', sourceType: 'task', sourceFile: 'docs/TASKS.md', sourceLine: 4, status: 'pending', canonicalStatus: 'ready' },
  ]);
  assert.deepEqual(payload.map((entry) => entry.recordId), ['TASK-004']);
});

test('the committed projection imports whole — every record maps, and every parent is present', () => {
  const payload = canonicalLedgerImportPayload(PENDING_WORK_SOURCE);
  assert.equal(payload.length, PENDING_WORK_SOURCE.length, 'no record is dropped for an unmapped status');
  const ids = new Set(payload.map((entry) => entry.recordId));
  for (const entry of payload) {
    if (entry.parentRecordId) assert.ok(ids.has(entry.parentRecordId), `${entry.recordId} names a missing parent`);
  }
  const firstTask = payload.findIndex((entry) => !entry.isGoal);
  assert.ok(payload.slice(0, firstTask).every((entry) => entry.isGoal), 'Goal nodes lead');
});
