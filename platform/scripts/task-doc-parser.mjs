const LIST_FIELDS = new Set(['scope', 'evidence', 'requests', 'dependencies']);

function list(value) {
  if (!value || value.toLowerCase() === 'none') return [];
  return value.split(';').map((part) => part.trim()).filter(Boolean);
}

export function parseCanonicalTasks(document) {
  const tasks = [];
  let task = null;
  let sectionTitle = null;
  const explicitOrder = document.match(/`(TASK-\d+(?:,\s*TASK-\d+)*)`/);

  for (const line of document.split(/\r?\n/)) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      task = null;
      sectionTitle = heading[1].trim();
      const legacyTaskHeading = sectionTitle.match(/^(TASK-\d+) — (.+)$/);
      if (legacyTaskHeading) {
        task = { id: legacyTaskHeading[1], title: legacyTaskHeading[2].trim() };
        tasks.push(task);
      }
      continue;
    }
    const field = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1].trim().toLowerCase();
    const value = field[2].trim();
    if (key === 'id' && /^TASK-\d+$/.test(value) && sectionTitle) {
      if (task) {
        if (task.id === value) continue;
        throw new Error(`Conflicting task IDs in section "${sectionTitle}": ${task.id} and ${value}`);
      }
      task = { id: value, title: sectionTitle };
      tasks.push(task);
      continue;
    }
    if (!task) continue;
    if (LIST_FIELDS.has(key)) task[key] = list(value);
    else if (key === 'prototype test') task.prototypeTest = value;
    else if (key === 'status' || key === 'priority' || key === 'horizon' || key === 'outcome' || key === 'approval') task[key] = value;
  }

  if (!explicitOrder) return tasks;
  const ranks = new Map(explicitOrder[1].split(',').map((id, index) => [id.trim(), index]));
  return tasks.slice().sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
