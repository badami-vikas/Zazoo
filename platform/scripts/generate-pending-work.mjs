import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCanonicalTasks, renderActiveTaskIndex } from './task-doc-parser.mjs';

const platformRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(platformRoot, '..');
const output = resolve(platformRoot, 'apps/web/src/app/data/pending-work.generated.json');
const taskIndexOutput = resolve(repoRoot, 'docs/CODEMAPS/current-tasks.md');

const file = 'docs/TASKS.md';
const document = await readFile(resolve(repoRoot, file), 'utf8');
const documentLines = document.split(/\r?\n/);
const statusMap = { inbox: 'pending', ready: 'pending', in_progress: 'in-progress', blocked: 'blocked', done: 'completed', dropped: 'dropped' };
const items = parseCanonicalTasks(document)
  .map((task, index) => ({
    ...task,
    canonicalStatus: task.status,
    title: `${task.id} — ${task.title}`,
    sourceType: 'task',
    sourceFile: file,
    sourceLine:
      documentLines.findIndex((line) => line === `- ID: ${task.id}`) + 1 ||
      documentLines.findIndex((line) => line.startsWith(`## ${task.id} —`)) + 1,
    status: statusMap[task.status] ?? 'open',
    rank: index + 1,
  }));

await Promise.all([
  writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`),
  writeFile(taskIndexOutput, renderActiveTaskIndex(document)),
]);
console.log(`Generated ${items.length} pending-work records at ${output}`);
console.log(`Generated active task index at ${taskIndexOutput}`);
