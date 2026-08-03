#!/usr/bin/env node
/**
 * scheduler.mjs — self-pacing Recon enrichment daemon.
 *
 * Walks the LinkedIn Connections list, running `enrich-linkedin.ts` on a
 * randomized batch each cycle. Owns ALL the randomness + safety logic so the
 * batch script stays a dumb worker:
 *
 *   • random batch size      — clamped Gaussian (mean 40, sd 8, [20,50])
 *   • irregular inter-run gap — Gaussian (~70 min, sd 20, [40,120] min)
 *   • daytime window          — only runs 08:00–22:00 local; drifting morning start
 *   • daily cap               — hard backstop to stay inside free-tier limits
 *   • resumable cursor        — advances through the list, persisted to disk
 *   • circuit breaker         — cross-run backoff + hard PAUSE on sustained blocks
 *   • kill switch             — presence of data/PAUSE idles the daemon
 *
 * It does NOT supervise its own liveness — that's launchd's job (KeepAlive).
 * This loop only decides *when* and *how much* to run, and *when to stop*.
 *
 * Usage:
 *   node scripts/scheduler.mjs            # run the daemon
 *   node scripts/scheduler.mjs --dry-run  # print one cycle's decisions and exit
 *   node scripts/scheduler.mjs --status   # print state + exit
 *
 * Tunables (env or .env.local):
 *   BATCH_MEAN=40 BATCH_SD=8 BATCH_MIN=20 BATCH_MAX=50
 *   GAP_MEAN_MIN=70 GAP_SD_MIN=20 GAP_MIN_MIN=40 GAP_MAX_MIN=120
 *   WINDOW_START_HOUR=8 WINDOW_END_HOUR=22 MORNING_DRIFT_MIN=40
 *   DAILY_CAP=300
 *   END_OF_QUEUE=stop|refresh
 *   PER_PROFILE_MIN_MS=3000 PER_PROFILE_MAX_MS=15000
 *   BREAKER_INRUN_CONSEC=5 BREAKER_BADRUN_RATE=0.4 BREAKER_HARD_AFTER=3
 *   BACKOFF_MULT=2 BACKOFF_CAP_MIN=280
 *   AUTO_RESUME_AFTER_MIN=0            # 0 = off; hard PAUSE stays until cleared
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');          // Tools/recon
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'scheduler-state.json');
const PAUSE_FILE = path.join(DATA_DIR, 'PAUSE');
const LOG_FILE = path.join(DATA_DIR, 'scheduler.log');

// ── Minimal .env.local loader (Next.js loads it; a bare node process does not) ─
async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env.local — rely on existing env */ }
}

const num = (k, d) => { const v = parseFloat(process.env[k]); return Number.isFinite(v) ? v : d; };
const str = (k, d) => process.env[k] ?? d;

const CFG = () => ({
  batch:  { mean: num('BATCH_MEAN', 40), sd: num('BATCH_SD', 8), min: num('BATCH_MIN', 20), max: num('BATCH_MAX', 50) },
  gap:    { mean: num('GAP_MEAN_MIN', 70), sd: num('GAP_SD_MIN', 20), min: num('GAP_MIN_MIN', 40), max: num('GAP_MAX_MIN', 120) },
  window: { start: num('WINDOW_START_HOUR', 8), end: num('WINDOW_END_HOUR', 22), drift: num('MORNING_DRIFT_MIN', 40) },
  dailyCap: num('DAILY_CAP', 300),
  source: str('RECON_SOURCE', 'csv'), // 'csv' | 'supabase' (people already in Bridge)
  endOfQueue: str('END_OF_QUEUE', 'stop'),
  perProfile: { min: num('PER_PROFILE_MIN_MS', 3000), max: num('PER_PROFILE_MAX_MS', 15000) },
  breaker: {
    inrunConsec: num('BREAKER_INRUN_CONSEC', 5),
    badRunRate: num('BREAKER_BADRUN_RATE', 0.4),
    hardAfter: num('BREAKER_HARD_AFTER', 3),
    backoffMult: num('BACKOFF_MULT', 2),
    backoffCapMin: num('BACKOFF_CAP_MIN', 280),
    autoResumeAfterMin: num('AUTO_RESUME_AFTER_MIN', 0),
  },
});

// ── Random helpers ────────────────────────────────────────────────────────────
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Box–Muller standard normal.
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clampedGauss = (mean, sd, lo, hi) => clamp(Math.round(mean + sd * gauss()), lo, hi);
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// ── State ─────────────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  cursor: 0,
  dayKey: '',
  doneToday: 0,
  lastRunAt: null,
  consecutiveBadRuns: 0,
  currentBackoffMult: 1,
  pausedReason: null,
  history: [], // last N run summaries (trimmed)
};

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
async function writeState(s) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  s.history = (s.history ?? []).slice(-20); // keep it small
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.appendFile(LOG_FILE, line + '\n'); } catch { /* best effort */ }
}

// ── Time-window logic ─────────────────────────────────────────────────────────
function inWindow(cfg, d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= cfg.window.start && h < cfg.window.end;
}
// ms until the next window opening (today if not yet open, else tomorrow), plus a
// random morning drift so the daily start time is never a fixed clock tick.
function msUntilWindowOpen(cfg, d = new Date()) {
  const open = new Date(d);
  open.setHours(cfg.window.start, 0, 0, 0);
  if (d.getHours() + d.getMinutes() / 60 >= cfg.window.start) open.setDate(open.getDate() + 1);
  const driftMs = randInt(0, Math.round(cfg.window.drift * 60_000));
  return (open.getTime() - d.getTime()) + driftMs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// ── Run the worker once ───────────────────────────────────────────────────────
function runWorker(env) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'scripts/enrich-linkedin.ts'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; process.stdout.write(s); });
    child.on('close', (code) => {
      // Parse the last sentinel line as the run summary.
      let summary = null;
      for (const line of stdout.split('\n')) {
        const i = line.indexOf('__RECON_RUN_SUMMARY__');
        if (i !== -1) { try { summary = JSON.parse(line.slice(i + '__RECON_RUN_SUMMARY__'.length).trim()); } catch { /* ignore */ } }
      }
      resolve({ code, summary });
    });
    child.on('error', (err) => resolve({ code: -1, summary: null, error: String(err) }));
  });
}

// ── Circuit-breaker evaluation of a completed run ─────────────────────────────
// Returns { badRun, hardPause, reason }. A run is "bad" when the share of blocked
// attempts exceeds the threshold, OR the worker aborted in-run on a wall.
function evaluateRun(cfg, summary) {
  if (!summary || !summary.attempted) return { badRun: false, hardPause: false, reason: '' };
  const blockRate = summary.blocked / summary.attempted;
  const badRun = summary.aborted || blockRate >= cfg.breaker.badRunRate;
  return {
    badRun,
    blockRate,
    reason: summary.aborted
      ? `in-run abort (${summary.blocked}/${summary.attempted} blocked; canaries: ${(summary.blockedCanaries || []).join(',') || 'n/a'})`
      : `block rate ${(blockRate * 100).toFixed(0)}% ≥ ${(cfg.breaker.badRunRate * 100).toFixed(0)}%`,
  };
}

async function writePause(state, reason) {
  state.pausedReason = reason;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PAUSE_FILE, `${new Date().toISOString()}  ${reason}\n`);
  await log(`⛔ HARD PAUSE — ${reason}. Delete ${path.relative(ROOT, PAUSE_FILE)} to resume.`);
}

async function pauseActive(cfg, state) {
  let exists = false;
  try { await fs.access(PAUSE_FILE); exists = true; } catch { /* none */ }
  if (!exists) { if (state.pausedReason) { state.pausedReason = null; await writeState(state); } return false; }
  // Optional auto-resume after a cooldown.
  if (cfg.breaker.autoResumeAfterMin > 0) {
    try {
      const st = await fs.stat(PAUSE_FILE);
      const ageMin = (Date.now() - st.mtimeMs) / 60_000;
      if (ageMin >= cfg.breaker.autoResumeAfterMin) {
        await fs.rm(PAUSE_FILE, { force: true });
        state.pausedReason = null; state.consecutiveBadRuns = 0; state.currentBackoffMult = 1;
        await writeState(state);
        await log(`▶ auto-resume after ${Math.round(ageMin)} min cooldown`);
        return false;
      }
    } catch { /* ignore */ }
  }
  return true;
}

// ── One scheduling decision (shared by the loop and --dry-run) ────────────────
function planNextCycle(cfg, state) {
  const batch = clampedGauss(cfg.batch.mean, cfg.batch.sd, cfg.batch.min, cfg.batch.max);
  const baseGap = clampedGauss(cfg.gap.mean, cfg.gap.sd, cfg.gap.min, cfg.gap.max);
  const gapMin = Math.min(baseGap * (state.currentBackoffMult || 1), cfg.breaker.backoffCapMin);
  return { batch, gapMin };
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function cycle(cfg, state) {
  // Roll over the daily counter at local midnight.
  const tk = todayKey();
  if (state.dayKey !== tk) { state.dayKey = tk; state.doneToday = 0; }

  // Daily cap reached → idle until tomorrow's window.
  if (state.doneToday >= cfg.dailyCap) {
    const waitMs = msUntilWindowOpen(cfg);
    await log(`🎯 daily cap ${cfg.dailyCap} reached (${state.doneToday}) — sleeping ${Math.round(waitMs / 60000)} min to next window`);
    await writeState(state);
    return waitMs;
  }

  // Outside the daytime window → sleep to next opening (+ drift).
  if (!inWindow(cfg)) {
    const waitMs = msUntilWindowOpen(cfg);
    await log(`🌙 outside window ${cfg.window.start}:00–${cfg.window.end}:00 — sleeping ${Math.round(waitMs / 60000)} min`);
    await writeState(state);
    return waitMs;
  }

  // Plan + run.
  const { batch } = planNextCycle(cfg, state);
  // Don't exceed the remaining daily budget.
  const limit = Math.max(0, Math.min(batch, cfg.dailyCap - state.doneToday));
  await log(`▶ run: offset=${state.cursor} limit=${limit} (doneToday=${state.doneToday}/${cfg.dailyCap}, backoff×${state.currentBackoffMult})`);

  const { code, summary, error } = await runWorker({
    RECON_SOURCE: cfg.source,
    RECON_OFFSET: String(state.cursor),
    RECON_LIMIT: String(limit),
    RECON_BATCH_SIZE: '1',
    RECON_MIN_DELAY_MS: String(cfg.perProfile.min),
    RECON_MAX_DELAY_MS: String(cfg.perProfile.max),
    BREAKER_INRUN_CONSEC: String(cfg.breaker.inrunConsec),
  });

  state.lastRunAt = new Date().toISOString();

  if (error || code !== 0 || !summary) {
    // Worker crashed (not a throttle signal) — treat as a soft bad run, back off
    // a little, but don't hard-pause on process errors alone.
    state.consecutiveBadRuns = (state.consecutiveBadRuns || 0) + 1;
    state.currentBackoffMult = Math.min((state.currentBackoffMult || 1) * cfg.breaker.backoffMult, 8);
    await log(`✗ worker failed (code=${code}${error ? `, ${error}` : ''}) — backoff×${state.currentBackoffMult}`);
    state.history.push({ at: state.lastRunAt, crash: true, code });
    await writeState(state);
    const { gapMin } = planNextCycle(cfg, state);
    return gapMin * 60_000;
  }

  // Advance the cursor + daily counter by what was actually attempted.
  state.cursor = summary.nextOffset ?? (state.cursor + (summary.attempted || 0));
  state.doneToday += summary.attempted || 0;
  state.history.push({ at: state.lastRunAt, ...summary });

  // End-of-queue handling.
  if (summary.queueExhausted || state.cursor >= (summary.total || Infinity)) {
    if (cfg.endOfQueue === 'refresh') {
      await log(`🔄 queue exhausted at ${state.cursor}/${summary.total} — wrapping to 0 (refresh mode)`);
      state.cursor = 0;
    } else {
      await log(`📭 queue exhausted at ${state.cursor}/${summary.total} — idling (END_OF_QUEUE=stop). Reset cursor in ${path.basename(STATE_FILE)} to re-run.`);
      await writeState(state);
      return msUntilWindowOpen(cfg); // re-check daily; effectively idle
    }
  }

  // Circuit-breaker evaluation.
  const verdict = evaluateRun(cfg, summary);
  if (verdict.badRun) {
    state.consecutiveBadRuns = (state.consecutiveBadRuns || 0) + 1;
    state.currentBackoffMult = Math.min((state.currentBackoffMult || 1) * cfg.breaker.backoffMult, 8);
    await log(`⚠ bad run #${state.consecutiveBadRuns} — ${verdict.reason} — backoff×${state.currentBackoffMult}`);
    if (state.consecutiveBadRuns >= cfg.breaker.hardAfter) {
      await writePause(state, `${state.consecutiveBadRuns} consecutive bad runs — ${verdict.reason}`);
      await writeState(state);
      return msUntilWindowOpen(cfg); // idled; pauseActive() will hold next cycles
    }
  } else {
    if (state.consecutiveBadRuns || state.currentBackoffMult > 1) {
      await log(`✓ clean run — resetting backoff (was ×${state.currentBackoffMult})`);
    }
    state.consecutiveBadRuns = 0;
    state.currentBackoffMult = 1;
  }

  await writeState(state);
  const { gapMin } = planNextCycle(cfg, state);
  await log(`💤 next run in ~${gapMin} min  (attempted=${summary.attempted} ok=${summary.ok} soft=${summary.soft} blocked=${summary.blocked})`);
  return gapMin * 60_000;
}

async function mainLoop() {
  await loadEnv();
  const state = await readState();
  await log(`🚀 Recon scheduler up — cursor=${state.cursor}, doneToday=${state.doneToday}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cfg = CFG();
    if (await pauseActive(cfg, state)) {
      await log(`⏸ paused (${state.pausedReason || 'data/PAUSE present'}) — re-checking in 10 min`);
      await sleep(10 * 60_000);
      continue;
    }
    let waitMs;
    try {
      waitMs = await cycle(cfg, state);
    } catch (err) {
      await log(`‼ cycle error: ${err?.stack || err}`);
      waitMs = 15 * 60_000; // recover, don't spin
    }
    await sleep(waitMs);
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  await loadEnv();
  const arg = process.argv[2];
  if (arg === '--status') {
    const state = await readState();
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (arg === '--dry-run') {
    const cfg = CFG();
    const state = await readState();
    const now = new Date();
    const plan = planNextCycle(cfg, state);
    console.log(JSON.stringify({
      now: now.toISOString(),
      inWindow: inWindow(cfg, now),
      msUntilWindowOpen: inWindow(cfg, now) ? 0 : msUntilWindowOpen(cfg, now),
      dailyCap: cfg.dailyCap,
      doneToday: state.doneToday,
      cursor: state.cursor,
      plannedBatch: plan.batch,
      plannedGapMin: plan.gapMin,
      backoffMult: state.currentBackoffMult,
      consecutiveBadRuns: state.consecutiveBadRuns,
      pausedReason: state.pausedReason,
      config: cfg,
    }, null, 2));
    return;
  }
  await mainLoop();
}

main().catch((err) => { console.error(err); process.exit(1); });
