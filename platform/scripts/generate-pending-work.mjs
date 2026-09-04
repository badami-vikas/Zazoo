import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assignHorizonHierarchy, duplicateFieldIncidents, parseCanonicalTasks, renderActiveTaskIndex } from './task-doc-parser.mjs';

const platformRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(platformRoot, '..');
const output = resolve(platformRoot, 'apps/web/src/app/data/pending-work.generated.json');
const taskIndexOutput = resolve(repoRoot, 'docs/CODEMAPS/current-tasks.md');

const file = 'docs/TASKS.md';
const document = await readFile(resolve(repoRoot, file), 'utf8');
const documentLines = document.split(/\r?\n/);
const statusMap = { inbox: 'pending', ready: 'pending', in_progress: 'in-progress', blocked: 'blocked', done: 'completed', dropped: 'dropped' };
// Horizon Goal nodes first, then their tasks — the projection carries the
// same parent/level/path tree the Task Manager Database materializes, so the
// two cannot disagree about what hangs under what.
const placed = assignHorizonHierarchy(parseCanonicalTasks(document));
const goals = placed.goals.map((goal, index) => ({
  id: goal.recordId,
  title: goal.title,
  isGoal: true,
  path: goal.path,
  level: goal.level,
  parentId: null,
  horizon: goal.horizon,
  sourceType: 'task',
  sourceFile: file,
  sourceLine: 0,
  status: 'open',
  rank: index + 1,
}));
const items = [
  ...goals,
  ...placed.tasks.map(({ recordId, parentRecordId, ...task }, index) => ({
    ...task,
    canonicalStatus: task.status,
    title: `${task.id} — ${task.title}`,
    isGoal: false,
    parentId: parentRecordId,
    sourceType: 'task',
    sourceFile: file,
    sourceLine:
      documentLines.findIndex((line) => line === `- ID: ${task.id}`) + 1 ||
      documentLines.findIndex((line) => line.startsWith(`## ${task.id} —`)) + 1,
    status: statusMap[task.status] ?? 'open',
    rank: goals.length + index + 1,
  })),
];

await Promise.all([
  writeFile(output, `${JSON.stringify({ items }, null, 2)}\n`),
  writeFile(taskIndexOutput, renderActiveTaskIndex(document)),
]);
for (const incident of duplicateFieldIncidents(document)) {
  console.warn(
    `WARNING ${file}: ${incident.taskId} states "${incident.field}" twice — keeping line ${incident.keptLine}, ignoring line ${incident.ignoredLine}. ` +
    'A stray field block belongs to no task; move it under its own heading or delete it.',
  );
}
console.log(`Generated ${items.length} pending-work records at ${output}`);
console.log(`Generated active task index at ${taskIndexOutput}`);
