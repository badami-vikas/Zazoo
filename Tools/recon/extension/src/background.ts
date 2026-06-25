// MV3 service worker — auto-scroll + auto-capture.
//
// (1) AUTO-SCROLL: whenever ANY LinkedIn profile finishes loading, scroll it to the
//     bottom with TRUSTED wheel events (chrome.debugger). LinkedIn lazy-loads
//     Experience/Education only on trusted scroll — synthetic JS scroll is ignored, and
//     it only works on the VISIBLE tab, so this runs in the worker on the foreground tab.
//     tabs.onUpdated reliably wakes the MV3 worker (unlike runtime messaging).
// (2) AUTO-CAPTURE: a per-tick alarm opens the next pending profile (foreground) and sets
//     a captureRequest; the same onUpdated handler scrolls it, extracts, saves, and closes
//     it. The popup's "capture now" uses the identical captureRequest path.

import type { ConnectStatus } from './types';

const RECON_URL = 'http://localhost:3001';
const ALARM = 'bridge-capture';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface QueueItem { name: string; linkedin_url: string; dedup_key: string }
type Status = 'ok' | 'soft_block' | 'error';
interface CaptureReq { url: string; dedup_key?: string; name?: string }

const sameProfile = (a: string, b: string) => {
  const n = (u: string) => u.replace(/[/]+$/, '').split('?')[0].toLowerCase();
  return n(a) === n(b);
};

// ── Alarm scheduler ────────────────────────────────────────────────────────────────
function armNextAlarm(soon = false) {
  // Wider jitter (8–20 min) so the cadence isn't a regular ~6/hr pattern (velocity fingerprint).
  const mins = soon ? 0.5 : 8 + Math.random() * 12;
  chrome.alarms.create(ALARM, { delayInMinutes: mins });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      autoCapture: false, autoScroll: true, activeStart: 8, activeEnd: 20,
      autoConnect: false, connectDailyCap: 15,
      noteTemplate: 'Hi {firstName}, I came across your profile and would love to connect.',
    });
  }
  armNextAlarm();
});
chrome.runtime.onStartup.addListener(() => armNextAlarm());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) {
    (async () => {
      const opened = await captureTick();        // returns true if it opened a tab
      if (!opened) await connectTick();           // otherwise try a connection-send
    })().catch(() => {}).finally(() => armNextAlarm());
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoCapture?.newValue === true) armNextAlarm(true);
});

// ── Auto-scroll every profile to the bottom (+ capture if requested) ────────────────
console.log('[Bridge Recon] service worker loaded', new Date().toISOString());

const handling = new Set<number>();
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = tab.url ?? '';
  if (!/^https:\/\/www\.linkedin\.com\/in\//.test(url)) return;
  console.log('[Bridge Recon] profile loaded → scrolling', url);
  if (handling.has(tabId)) return;
  handling.add(tabId);
  onProfileLoaded(tabId, url).catch((e) => console.warn('[Bridge Recon] onProfileLoaded failed', e)).finally(() => handling.delete(tabId));
});

async function onProfileLoaded(tabId: number, url: string): Promise<void> {
  // Is this profile one we were asked to capture?
  let req: CaptureReq | undefined;
  try { ({ captureRequest: req } = await chrome.storage.local.get('captureRequest')); } catch { /* */ }
  const isCapture = !!req?.url && sameProfile(url, req.url);

  // Is this profile one we were asked to connect to?
  let creq: { url: string; dedup_key?: string; name?: string } | undefined;
  try { ({ connectRequest: creq } = await chrome.storage.local.get('connectRequest')); } catch { /* */ }
  const isConnect = !!creq?.url && sameProfile(url, creq.url);

  // Auto-scroll unless the user turned it off (always scroll for a capture/connect).
  const { autoScroll = true } = await chrome.storage.local.get('autoScroll');
  if (!autoScroll && !isCapture && !isConnect) return;

  await sleep(2000); // let the initial render settle
  await debuggerScrollToBottom(tabId);

  if (isCapture && req) {
    try { await chrome.storage.local.remove('captureRequest'); } catch { /* */ }
    await captureLoadedTab(tabId, req);
  }

  if (isConnect && creq?.url) {
    try { await chrome.storage.local.remove('connectRequest'); } catch { /* */ }
    await connectLoadedTab(tabId, creq);
  }
}

// Scroll the (visible) tab to the bottom with trusted DevTools wheel events. Loops until
// the section count + page height stop growing — that's when all lazy cards have mounted.
async function debuggerScrollToBottom(tabId: number): Promise<void> {
  const dbg: chrome.debugger.Debuggee = { tabId };
  try {
    await chrome.debugger.attach(dbg, '1.3');
    console.log('[Bridge Recon] debugger attached → scrolling', tabId);
  } catch (e) {
    console.warn('[Bridge Recon] debugger.attach FAILED — is the "debugger" permission granted?', e);
    return;
  }
  try {
    const measure = async (): Promise<number> => {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.querySelectorAll('main section').length * 1_000_000 +
            Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        });
        return (r?.result as number) ?? 0;
      } catch { return 0; }
    };
    let stable = 0;
    let last = -1;
    for (let i = 0; i < 45 && stable < 6; i++) {
      await chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 500, deltaX: 0, deltaY: 1500 });
      await sleep(350);
      const sig = await measure();
      if (sig === last) stable++; else { stable = 0; last = sig; }
    }
  } finally {
    try { await chrome.debugger.detach(dbg); } catch { /* */ }
  }
}

// Extract the (now fully scrolled) profile and save it; then close the tab.
async function captureLoadedTab(tabId: number, req: CaptureReq): Promise<void> {
  let status: Status = 'error';
  let name = req.name ?? '';
  try {
    const cur = await chrome.tabs.get(tabId);
    if (/authwall|checkpoint|\/login|\/uas\//i.test(cur.url ?? '')) {
      status = 'soft_block';
    } else {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch { /* injected */ }
      await sleep(300);
      let res: { ok: boolean; profile?: { name?: string } } | undefined;
      for (let i = 0; i < 3; i++) {
        if (i) await sleep(600 * i);
        try { res = await chrome.tabs.sendMessage(tabId, { type: 'BRIDGE_EXTRACT' }); } catch { /* not ready */ }
        if (res?.ok && res.profile?.name) break;
      }
      if (res?.ok && res.profile?.name) {
        name = res.profile.name;
        await fetch(`${RECON_URL}/api/linkedin-import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: res.profile }),
        });
        status = 'ok';
      }
    }
  } catch { status = 'error'; }

  try { await chrome.storage.local.set({ lastCapture: { at: Date.now(), status, name, url: req.url } }); } catch { /* */ }
  if (req.dedup_key) {
    try {
      await fetch(`${RECON_URL}/api/capture-queue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: [{ dedup_key: req.dedup_key, status }] }),
      });
    } catch { /* best-effort */ }
  }
  // Close the capture tab (it was opened by us, not the user browsing).
  try { await chrome.tabs.remove(tabId); } catch { /* */ }
}

// ── Auto-capture tick (alarm-driven) ────────────────────────────────────────────────
async function captureTick(): Promise<boolean> {
  const { autoCapture = false, activeStart = 8, activeEnd = 20 } =
    await chrome.storage.local.get(['autoCapture', 'activeStart', 'activeEnd']);
  if (!autoCapture) return false;
  const hour = new Date().getHours();
  if (hour < activeStart || hour >= activeEnd) return false;
  if (!navigator.onLine) return false;

  // Occasionally skip a tick so the pace isn't perfectly regular (the alarm re-arms either
  // way, so this just yields an irregular human-looking cadence). ~18% skip rate.
  if (Math.random() < 0.18) return false;

  let q: { ok?: boolean; paused?: boolean; items?: QueueItem[] };
  try {
    q = await (await fetch(`${RECON_URL}/api/capture-queue?limit=1`)).json();
  } catch { return false; }
  if (!q?.ok || q.paused || !q.items?.length) return false;

  // Queue the capture, then open the profile in the foreground; onUpdated does the rest.
  const item = q.items[0];
  await chrome.storage.local.set({ captureRequest: { url: item.linkedin_url, dedup_key: item.dedup_key, name: item.name } });
  await chrome.tabs.create({ url: item.linkedin_url, active: true });
  return true;
}

// ── Auto-connect tick (alarm-driven) ──────────────────────────────────────────────────
// ConnectStatus is the single source of truth in ./types — imported, not re-declared.

function todayKey(): string { return new Date().toISOString().slice(0, 10); }

async function connectTick(): Promise<void> {
  const st = await chrome.storage.local.get([
    'autoConnect', 'activeStart', 'activeEnd', 'connectDailyCap', 'connectSentToday', 'captureRequest', 'connectRequest',
  ]);
  if (!st.autoConnect) return;
  const hour = new Date().getHours();
  if (hour < (st.activeStart ?? 8) || hour >= (st.activeEnd ?? 20)) return;
  if (!navigator.onLine) return;
  if (st.captureRequest || st.connectRequest) return; // a profile is already mid-flight
  if (Math.random() < 0.18) return;                    // irregular cadence

  // Daily cap (reset on date change).
  const cap = st.connectDailyCap ?? 15;
  const sent = st.connectSentToday?.date === todayKey() ? st.connectSentToday.count : 0;
  if (sent >= cap) return;

  let q: { ok?: boolean; paused?: boolean; items?: Array<{ name: string; linkedin_url: string; dedup_key: string; note?: string }> };
  try { q = await (await fetch(`${RECON_URL}/api/capture-queue?limit=1&action=connect`)).json(); } catch { return; }
  if (!q?.ok || q.paused || !q.items?.length) return;

  const item = q.items[0];
  // Carry the queue-provided note (exact per-profile text) through to the send routine;
  // connectLoadedTab falls back to the local noteTemplate when the item has none.
  await chrome.storage.local.set({ connectRequest: { url: item.linkedin_url, dedup_key: item.dedup_key, name: item.name, note: item.note } });
  await chrome.tabs.create({ url: item.linkedin_url, active: true });
}

async function resolveNote(name: string): Promise<string> {
  const { noteTemplate = 'Hi {firstName}, I would love to connect.' } = await chrome.storage.local.get('noteTemplate');
  const firstName = (name ?? '').split(/[\s,]+/)[0] ?? '';
  return noteTemplate.replace(/\{firstName\}/g, firstName).replace(/\{name\}/g, name ?? '').slice(0, 300);
}

async function connectLoadedTab(tabId: number, req: { url: string; dedup_key?: string; name?: string; note?: string }): Promise<void> {
  let status: ConnectStatus = 'error';
  try {
    const cur = await chrome.tabs.get(tabId);
    if (/authwall|checkpoint|\/login|\/uas\//i.test(cur.url ?? '')) {
      status = 'soft_block';
    } else {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch { /* injected */ }
      await sleep(800);
      // Prefer the exact queue-provided note; fall back to the local template.
      const note = req.note ? req.note.slice(0, 300) : await resolveNote(req.name ?? '');
      let res: { ok: boolean; status?: ConnectStatus } | undefined;
      for (let i = 0; i < 3; i++) {
        if (i) await sleep(700 * i);
        try { res = await chrome.tabs.sendMessage(tabId, { type: 'BRIDGE_CONNECT', note }); } catch { /* not ready */ }
        if (res?.status) break;
      }
      status = res?.status ?? 'error';
    }
  } catch { status = 'error'; }

  // Count only an actual send against the daily cap.
  if (status === 'sent') {
    const { connectSentToday } = await chrome.storage.local.get('connectSentToday');
    const count = connectSentToday?.date === todayKey() ? connectSentToday.count + 1 : 1;
    await chrome.storage.local.set({ connectSentToday: { date: todayKey(), count } });
  }
  try { await chrome.storage.local.set({ lastConnect: { at: Date.now(), status, name: req.name ?? '', url: req.url } }); } catch { /* */ }
  if (req.dedup_key) {
    try {
      await fetch(`${RECON_URL}/api/capture-queue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', results: [{ dedup_key: req.dedup_key, status }] }),
      });
    } catch { /* best-effort */ }
  }
  try { await chrome.tabs.remove(tabId); } catch { /* */ }
}
