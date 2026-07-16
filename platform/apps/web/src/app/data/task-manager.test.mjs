import test from 'node:test';
import assert from 'node:assert/strict';

import { allocatePendingWork, reconcileTaskSchedules, moveScheduledTask, updateColumnPreference } from './task-manager.ts';

const tasks = Array.from({ length: 13 }, (_, index) => ({ id: `task:${index}`, title: `Task ${index}` }));

test('allocates pending work across every day in the requested planning window', () => {
  const plan = allocatePendingWork(tasks, new Date('2026-07-15T12:00:00Z'), 12);
  assert.equal(plan.length, tasks.length);
  assert.equal(new Set(plan.map((task) => task.scheduledDate)).size, 12);
  assert.equal(plan[0].scheduledDate, '2026-07-15');
  assert.ok(plan.some((task) => task.scheduledDate === '2026-07-26'));
});

test('moving a scheduled task changes only its scheduled day', () => {
  const plan = allocatePendingWork(tasks.slice(0, 2), new Date('2026-07-15T12:00:00Z'), 2);
  const moved = moveScheduledTask(plan, 'task:0', '2026-07-16');
  assert.equal(moved.find((task) => task.id === 'task:0').scheduledDate, '2026-07-16');
  assert.equal(moved.find((task) => task.id === 'task:1').scheduledDate, plan[1].scheduledDate);
});

test('schedules new canonical task IDs even when legacy schedules already exist', () => {
  const schedules = reconcileTaskSchedules(
    tasks.slice(0, 2),
    { 'roadmap:legacy': '2026-07-15', 'task:0': '2026-07-20' },
    new Date('2026-07-15T12:00:00Z'),
    12,
  );
  assert.equal(schedules['task:0'], '2026-07-20');
  assert.equal(schedules['task:1'], '2026-07-15');
  assert.equal(schedules['roadmap:legacy'], '2026-07-15');
});

test('column preferences resize and hide without losing other preferences', () => {
  const next = updateColumnPreference({}, 'task', { width: 420 });
  const hidden = updateColumnPreference(next, 'source', { hidden: true });
  assert.deepEqual(hidden, { task: { width: 420 }, source: { hidden: true } });
});
