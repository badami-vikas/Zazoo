// Flag store — persists analyst-marked inaccuracies to data/flags.jsonl.
//
// Flags record enough information to:
//  1. Exclude the row from the next promoteStaging() call.
//  2. Enable pattern analysis (which sources/labels are frequently wrong).
//
// No flag is ever deleted — append-only so patterns accumulate over time.

import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FLAGS_FILE = path.join(DATA_DIR, 'flags.jsonl');

export interface FlagRow {
  id: string;
  subjectKey: string;
  scope: string;
  label: string;
  value: string;
  source: string;
  reason?: string;
  flaggedAt: string;
}

export async function appendFlag(flag: Omit<FlagRow, 'id' | 'flaggedAt'>): Promise<FlagRow> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const row: FlagRow = {
    ...flag,
    id: `flag:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    flaggedAt: new Date().toISOString(),
  };
  await fs.appendFile(FLAGS_FILE, JSON.stringify(row) + '\n');
  return row;
}

export async function getFlags(): Promise<FlagRow[]> {
  try {
    const text = await fs.readFile(FLAGS_FILE, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as FlagRow);
  } catch {
    return [];
  }
}

/** Remove matching flags (used to UNDO an accidental flag). Returns count removed.
 *  Scoped to a single subject + reason + label + value so unrelated flags are untouched. */
export async function removeFlags(match: { subjectKey: string; reason: string; label: string; value: string }): Promise<number> {
  const flags = await getFlags();
  const keep = flags.filter(
    (f) => !(f.subjectKey === match.subjectKey && f.reason === match.reason && f.label === match.label && f.value === match.value),
  );
  const removed = flags.length - keep.length;
  if (removed) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FLAGS_FILE, keep.map((f) => JSON.stringify(f)).join('\n') + (keep.length ? '\n' : ''));
  }
  return removed;
}

/** Returns a Set of (subjectKey|scope|label|value|source) tuples for fast lookup at promote time. */
export async function getFlaggedKeys(): Promise<Set<string>> {
  const flags = await getFlags();
  return new Set(flags.map((f) => `${f.subjectKey}|${f.scope}|${f.label}|${f.value}|${f.source}`));
}
