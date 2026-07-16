const LIST_FIELDS = new Set(['scope', 'evidence', 'requests', 'dependencies']);

function list(value) {
  if (!value || value.toLowerCase() === 'none') return [];
  return value.split(';').map((part) => part.trim()).filter(Boolean);
}

export function parseCanonicalTasks(document) {
  const tasks = [];
  let task = null;

  for (const line of document.split(/\r?\n/)) {
    const heading = line.match(/^## (TASK-\d+) — (.+)$/);
    if (heading) {
      task = { id: heading[1], title: heading[2].trim() };
      tasks.push(task);
      continue;
    }
    if (!task) continue;
    const field = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1].trim().toLowerCase();
    const value = field[2].trim();
    if (LIST_FIELDS.has(key)) task[key] = list(value);
    else if (key === 'prototype test') task.prototypeTest = value;
    else if (key === 'status' || key === 'priority' || key === 'horizon' || key === 'outcome' || key === 'approval') task[key] = value;
  }

  return tasks;
}
