// Auto-capture brain — the QUEUE + daily cap + circuit breaker for the extension's
// background scheduler. Recon owns pacing/safety; the EXTENSION does the actual
// LinkedIn visits (only the browser has the logged-in session).
//
// Safety model:
//  • Hard daily cap (default 50). Extension also gates active-hours + jitter client-side.
//  • Circuit breaker: N consecutive soft-blocks (auth wall / checkpoint / captcha) → pause
//    for PAUSE_HOURS. The extension stops scheduling while paused.
//  • Order: "recent data first" — freshest canonical records captured first.

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const STATE_FILE = path.join(process.cwd(), 'data', 'capture-state.json');

// Gradual warm-up ramp (LinkedIn best practice 2026: ramp ~5/week, don't start at full).
// Week 1: 10/day · Week 2: 15 · Week 3: 20 · Week 4: 25 · then FULL_CAP. Profile VIEWS only
// (no connects/messages), so even FULL_CAP sits far under LinkedIn's ~500/day view ceiling.
const FULL_CAP = Number(process.env.CAPTURE_DAILY_CAP ?? 50);
const BURNIN_START = process.env.CAPTURE_BURNIN_START ?? '2026-06-11'; // day the warm-up began (UTC)
const RAMP = (process.env.CAPTURE_RAMP ?? '10,15,20,25').split(',').map((n) => Number(n.trim()));
const PAUSE_THRESHOLD = Number(process.env.CAPTURE_PAUSE_THRESHOLD ?? 2); // consecutive soft-blocks
const PAUSE_HOURS = Number(process.env.CAPTURE_PAUSE_HOURS ?? 6);

/** Whole UTC days between a YYYY-MM-DD start key and today (clamped at 0). */
function daysSince(startKey: string): number {
  const start = Date.parse(`${startKey}T00:00:00Z`);
  const now = Date.parse(`${todayKey()}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(now)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor((now - start) / 86_400_000));
}

/** Ramp the cap one step per week through the warm-up, then settle at FULL_CAP. */
function dailyCap(): number {
  const week = Math.floor(daysSince(BURNIN_START) / 7);
  return week < RAMP.length ? RAMP[week] : FULL_CAP;
}

export interface CaptureState {
  dayKey: string;
  doneToday: number;
  totalCaptured: number;
  consecutiveBadRuns: number;
  pausedReason: string | null;
  pausedUntil: string | null; // ISO
  lastTickAt: string | null;
}

export interface QueueItem { name: string; linkedin_url: string; dedup_key: string }
export interface CaptureResult { dedup_key: string; status: 'ok' | 'soft_block' | 'error' }

function todayKey(): string { return new Date().toISOString().slice(0, 10); }

function defaultState(): CaptureState {
  return { dayKey: todayKey(), doneToday: 0, totalCaptured: 0, consecutiveBadRuns: 0, pausedReason: null, pausedUntil: null, lastTickAt: null };
}

async function loadState(): Promise<CaptureState> {
  try {
    const s = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as CaptureState;
    if (s.dayKey !== todayKey()) { s.dayKey = todayKey(); s.doneToday = 0; } // roll day
    return s;
  } catch {
    return defaultState();
  }
}

async function saveState(s: CaptureState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

function supa() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? createClient(url, key) : null;
}

function isPaused(s: CaptureState): boolean {
  return !!s.pausedUntil && new Date(s.pausedUntil).getTime() > Date.now();
}

export interface QueueResponse {
  ok: boolean;
  paused: boolean;
  reason?: string | null;
  cap: number;
  doneToday: number;
  remainingToday: number;
  pendingTotal?: number;
  items: QueueItem[];
  error?: string;
}

/** Next batch of pending profiles, respecting the daily cap and pause state. */
export async function getQueue(requestedLimit: number): Promise<QueueResponse> {
  const s = await loadState();
  await saveState(s); // persist any day-roll
  const cap = dailyCap();
  const remainingToday = Math.max(0, cap - s.doneToday);
  const base = { ok: true as const, cap, doneToday: s.doneToday, remainingToday };

  if (isPaused(s)) return { ...base, paused: true, reason: s.pausedReason, items: [] };
  if (remainingToday <= 0) return { ...base, paused: false, items: [] };

  const supabase = supa();
  if (!supabase) return { ...base, paused: false, items: [], error: 'no-supabase-key' };

  const limit = Math.max(1, Math.min(requestedLimit || 1, remainingToday));
  // "Recent data first" — freshest canonical records captured first.
  const { data, error } = await supabase
    .from('people_canonical')
    .select('full_name, linkedin_url, dedup_key')
    .is('extension_captured_at', null)
    .not('linkedin_url', 'is', null)
    .order('last_enriched_at', { ascending: false, nullsFirst: false })
    .order('recon_run_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return { ...base, paused: false, items: [], error: error.message };

  const items: QueueItem[] = (data ?? [])
    .filter((r) => r.linkedin_url && r.dedup_key)
    .map((r) => ({ name: r.full_name ?? '', linkedin_url: r.linkedin_url as string, dedup_key: r.dedup_key as string }));

  return { ...base, paused: false, items };
}

/** Record a tick's results: advance counters, mark done, trip/reset the breaker. */
export async function recordResults(results: CaptureResult[]): Promise<CaptureState> {
  const s = await loadState();
  s.lastTickAt = new Date().toISOString();

  const okKeys = results.filter((r) => r.status === 'ok').map((r) => r.dedup_key);
  const errorKeys = results.filter((r) => r.status === 'error').map((r) => r.dedup_key);
  const softBlocks = results.filter((r) => r.status === 'soft_block').length;

  // ok = real capture (linkedin-import already set extension_captured_at). error = skip
  // permanently (mark captured so we don't spin). soft_block = leave pending (not the
  // profile's fault) and trip the breaker.
  const supabase = supa();
  if (supabase && (okKeys.length || errorKeys.length)) {
    const keys = [...okKeys, ...errorKeys];
    await supabase.from('people_canonical')
      .update({ extension_captured_at: new Date().toISOString() })
      .in('dedup_key', keys)
      .is('extension_captured_at', null);
  }

  s.doneToday += okKeys.length;
  s.totalCaptured += okKeys.length;

  if (softBlocks > 0) {
    s.consecutiveBadRuns += softBlocks;
    if (s.consecutiveBadRuns >= PAUSE_THRESHOLD) {
      s.pausedReason = `${s.consecutiveBadRuns} consecutive soft-blocks (auth wall / checkpoint). Auto-paused ${PAUSE_HOURS}h.`;
      s.pausedUntil = new Date(Date.now() + PAUSE_HOURS * 3600_000).toISOString();
    }
  } else if (okKeys.length > 0) {
    s.consecutiveBadRuns = 0; // clean run resets the breaker
  }

  await saveState(s);
  return s;
}

export async function getState(): Promise<CaptureState & { cap: number; paused: boolean }> {
  const s = await loadState();
  return { ...s, cap: dailyCap(), paused: isPaused(s) };
}
