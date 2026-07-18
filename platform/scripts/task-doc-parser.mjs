const LIST_FIELDS = new Set(['scope', 'evidence', 'requests', 'dependencies']);

function list(value) {
  if (!value || value.toLowerCase() === 'none') return [];
  return value.split(';').map((part) => part.trim()).filter(Boolean);
}

/**
 * Canonical `docs/TASKS.md` task-record shape (as of the TASK-008 RM4 merge):
 * a `## <Title>` heading followed immediately by `- ID: TASK-XXX` as its
 * first field — NOT the older `## TASK-XXX — <Title>` heading this parser
 * used before that merge (see `task-doc-parser.test.mjs`'s prior fixture).
 * A `##` heading with no immediately-following `- ID:` line is a section
 * heading (e.g. "Execution order", "Operating standard"), never a task —
 * its own `- field:` lines (if any) must NOT be attributed to whichever
 * task happened to precede it, so `task` is reset to `null` on any such
 * heading.
 */
export function parseCanonicalTasks(document) {
  const tasks = [];
  let task = null;
  const explicitOrder = document.match(/`(TASK-\d+(?:,\s*TASK-\d+)*)`/);
  const lines = document.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      const idLine = lines[i + 1]?.match(/^- ID:\s*(TASK-\d+)\s*$/);
      task = idLine ? { id: idLine[1], title: heading[1].trim() } : null;
      if (task) tasks.push(task);
      continue;
    }
    if (!task) continue;
    const field = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1].trim().toLowerCase();
    if (key === 'id') continue; // consumed via the heading's next-line lookahead above
    const value = field[2].trim();
    if (LIST_FIELDS.has(key)) task[key] = list(value);
    else if (key === 'prototype test') task.prototypeTest = value;
    else if (key === 'status' || key === 'priority' || key === 'horizon' || key === 'outcome' || key === 'approval') task[key] = value;
  }

  if (!explicitOrder) return tasks;
  const ranks = new Map(explicitOrder[1].split(',').map((id, index) => [id.trim(), index]));
  return tasks.slice().sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
