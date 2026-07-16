import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCanonicalTasks } from './task-doc-parser.mjs';

const platformRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(platformRoot, '..');
const output = resolve(platformRoot, 'apps/web/src/app/data/pending-work.generated.json');

const file = 'docs/TASKS.md';
const document = await readFile(resolve(repoRoot, file), 'utf8');
const statusMap = { inbox: 'pending', ready: 'pending', in_progress: 'in-progress', blocked: 'blocked', done: 'completed', dropped: 'dropped' };
const items = parseCanonicalTasks(document)
  .map((task, index) => ({
    ...task,
    canonicalStatus: task.status,
    title: `${task.id} — ${task.title}`,
    sourceType: 'task',
    sourceFile: file,
    sourceLine: document.split(/\r?\n/).findIndex((line) => line.startsWith(`## ${task.id} —`)) + 1,
    status: statusMap[task.status] ?? 'open',
    rank: index + 1,
  }));

await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`);
console.log(`Generated ${items.length} pending-work records at ${output}`);
