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
