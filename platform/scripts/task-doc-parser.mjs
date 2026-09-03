const LIST_FIELDS = new Set(['scope', 'evidence', 'requests', 'dependencies']);
/** Document field name -> the property it lands on, where the two differ. */
const FIELD_KEY = { 'prototype test': 'prototypeTest' };
const ACTIVE_STATUSES = new Set(['inbox', 'ready', 'in_progress', 'blocked']);

function list(value) {
  if (!value || value.toLowerCase() === 'none') return [];
  return value.split(';').map((part) => part.trim()).filter(Boolean);
}

/**
 * The canonical `- Status:` line is a status TOKEN that may be followed by a
 * qualifier the author wrote for a human reader:
 *
 *   - Status: in_progress (admin surface LANDED 2026-08-30, ADR-262; ...)
 *   - Status: done (2026-08-16, live-verified)
 *
 * Taking the whole line as the status silently un-statuses every annotated
 * task: it matches no known status, so the projection called it `open` and the
 * active index dropped it entirely — 16 of 87 tasks, including every task
 * currently in progress, were invisible for exactly the reason that made them
 * worth annotating. The token is the status; the qualifier is kept verbatim as
 * `statusNote` rather than discarded, because it is the only place the
 * "landed but the exit test is not met" nuance is written down.
 */
function status(value) {
  const match = value.match(/^([A-Za-z_]+)\s*(.*)$/);
  if (!match) return { status: value };
  const note = match[2].trim().replace(/^\((.*)\)$/s, '$1').trim();
  return { status: match[1], ...(note ? { statusNote: note } : {}) };
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
    // FIRST wins, not last. A task's own fields lead its section; a second
    // `- Outcome:` further down is a stray — text pasted in without a heading
    // or an `- ID:` line of its own, which the scanner then hands to whichever
    // task happens to be open. Found 2026-09-01: an orphaned copy of
    // TASK-023's whole field block sits after TASK-037's record and was
    // overwriting all SEVEN of TASK-037's fields, so the Task Manager showed
    // one task wearing another's outcome, exit test, scope, evidence and
    // approval. Last-wins made a document defect silently authoritative;
    // first-wins makes it merely inert, and `duplicateFieldIncidents` below
    // makes it visible. Canon is NOT edited to work around this — the stray
    // lines stay where they are until a human decides what they were for.
    if (task[FIELD_KEY[key] ?? key] !== undefined) continue;
    if (LIST_FIELDS.has(key)) task[key] = list(value);
    else if (key === 'prototype test') task.prototypeTest = value;
    else if (key === 'status') Object.assign(task, status(value));
    else if (key === 'priority' || key === 'horizon' || key === 'outcome' || key === 'approval' || key === 'estimate') task[key] = value;
  }

  if (!explicitOrder) return tasks;
  const ranks = new Map(explicitOrder[1].split(',').map((id, index) => [id.trim(), index]));
  return tasks.slice().sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Every place a task's section states the same field twice. The parser keeps
 * the first and ignores the rest, so this is what turns a silently-inert
 * document defect into something a human is told about — the generator prints
 * it, and it names the line numbers so the stray block can be found.
 */
export function duplicateFieldIncidents(document) {
  const tracked = new Set([...LIST_FIELDS, 'status', 'priority', 'horizon', 'outcome', 'approval', 'estimate', 'prototype test']);
  const incidents = [];
  let taskId = null;
  let seen = new Map();
  document.split(/\r?\n/).forEach((line, index) => {
    if (/^## /.test(line)) { taskId = null; seen = new Map(); return; }
    const field = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!field) return;
    const key = field[1].trim().toLowerCase();
    if (key === 'id' && /^TASK-\d+$/.test(field[2].trim())) {
      taskId = field[2].trim();
      seen = new Map();
      return;
    }
    if (!taskId || !tracked.has(key)) return;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index + 1);
    else incidents.push({ taskId, field: key, keptLine: first, ignoredLine: index + 1 });
  });
  return incidents;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function horizonSlug(horizon) {
  return `HORIZON-${horizon.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * The parent/child hierarchy of the canonical ledger.
 *
 * docs/TASKS.md has no `Parent:` field and never had one — it is 87 sibling
 * `##` sections. The ONE grouping it does declare per task is `Horizon`, so
 * that is what the tree is built from: a Goal node per Horizon, in the order
 * the Horizons first appear in the execution queue, with its tasks beneath it.
 * Inventing a deeper task-to-task parentage from titles or dependencies would
 * be a fabricated hierarchy (AP-247) — `Dependencies` is an edge between
 * siblings, not parenthood, and it stays one.
 *
 * A task with no Horizon stays at the root next to the Goal nodes rather than
 * being filed under a guessed one.
 *
 * Returns the Goal nodes and the tasks, each carrying `path`, `level`, and
 * `parentRecordId` — the three fields `tasks` (schema.ts LAYER 8) materializes
 * a tree from.
 */
export function assignHorizonHierarchy(tasks) {
  const horizons = [];
  for (const task of tasks) {
    if (task.horizon && !horizons.includes(task.horizon)) horizons.push(task.horizon);
  }
  const goals = horizons.map((horizon, index) => ({
    id: horizonSlug(horizon),
    recordId: horizonSlug(horizon),
    title: horizon,
    horizon,
    isGoal: true,
    path: String(index + 1),
    level: 0,
    parentRecordId: null,
  }));
  const childCounts = new Map();
  let rootNext = goals.length;
  const placed = tasks.map((task) => {
    if (!task.horizon) {
      rootNext += 1;
      return { ...task, recordId: task.id, isGoal: false, path: String(rootNext), level: 0, parentRecordId: null };
    }
    const parent = horizonSlug(task.horizon);
    const order = (childCounts.get(parent) ?? 0) + 1;
    childCounts.set(parent, order);
    const parentPath = goals.find((goal) => goal.recordId === parent).path;
    return {
      ...task,
      recordId: task.id,
      isGoal: false,
      path: `${parentPath}.${order}`,
      level: 1,
      parentRecordId: parent,
    };
  });
  return { goals, tasks: placed };
}

/** Bridge's legacy docs/TASKS.md is a deterministic projection input: TASK-nnn
 * remains stable Record identity while `assignHorizonHierarchy` materializes
 * the Horizon Goal node it hangs under and the dot path that encodes it.
 * Database ingestion still requires governed reconciliation. */
export function projectCanonicalTasks(document) {
  const placed = assignHorizonHierarchy(parseCanonicalTasks(document));
  const tasks = [...placed.goals, ...placed.tasks].map((task) => ({
    ...task,
    outcomes: task.outcome
      ? [{
          id: `${task.id}:outcome`,
          title: task.outcome,
          measure: 'prototype test',
          target: task.prototypeTest ?? task.outcome,
          indicatorKind: 'lagging',
        }]
      : [],
    exitTest: task.prototypeTest ?? null,
  }));
  return {
    contentHash: stableHash(document),
    recordVersions: Object.fromEntries(tasks.map((task) => [
      task.recordId,
      stableHash(JSON.stringify(task)),
    ])),
    tasks,
  };
}

function markdownCell(value) {
  return String(value ?? 'none').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

/** The index's Dependencies cell: TASK-nnn ids only, deduplicated, in first-
 * mention order. The canonical line in docs/TASKS.md may carry prose (stale-
 * blocker notes, unblock conditions) — that prose stays canon; the always-
 * loaded index (check-agent-context's activeTasksBytes budget) renders just
 * the ids, or an honest pointer when the gate is not a task at all. */
function dependencyIdsCell(dependencies) {
  if (!dependencies || dependencies.length === 0) return 'none';
  const ids = [...new Set(dependencies.join(' ').match(/TASK-\d+/g) ?? [])];
  return ids.length > 0 ? ids.join(', ') : 'non-task gate (see TASKS.md)';
}

export function renderActiveTaskIndex(document) {
  const tasks = parseCanonicalTasks(document).filter((task) => ACTIVE_STATUSES.has(task.status));
  const rows = tasks.length > 0
    ? tasks.map((task) => [
        task.id,
        task.status,
        task.priority ?? 'none',
        task.title,
        dependencyIdsCell(task.dependencies),
      ].map(markdownCell))
    : [['none', 'none', 'none', 'No active tasks', 'none']];

  return [
    '<!-- Generated by platform/scripts/generate-pending-work.mjs from docs/TASKS.md. Do not edit. -->',
    '# Current Task Index',
    '',
    'Non-canonical navigation only. `docs/TASKS.md` remains the sole execution queue.',
    '',
    '| ID | Status | Priority | Task | Dependencies |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}
