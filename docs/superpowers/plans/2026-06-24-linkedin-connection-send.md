# LinkedIn Connection-Send (Recon Extension) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Manual gate:** The content-script send routine (Task 3) can ONLY be verified against a LIVE LinkedIn profile in a real browser with the unpacked extension loaded. No automated test substitutes for it. Budget a hands-on verification session on a throwaway/low-risk connection target.

**Goal:** Let the Recon extension send LinkedIn connection requests with a personalized `{placeholders}` note to pre-defined profiles drawn from the capture-queue, automatically, with hard safety rails.

**Architecture:** Mirror the existing auto-capture machinery. The capture-queue gains an `action` filter (`capture` | `connect`). The background worker runs a `connectTick` (same alarm, jitter, daytime window) that opens a queued profile and asks the content script (new `BRIDGE_CONNECT` message) to click Connect → Add note → fill → Send. A separate 15/day cap + default-OFF `autoConnect` kill-switch gate it.

**Tech Stack:** Chrome MV3 (TypeScript, esbuild), `chrome.storage.local`, `chrome.tabs`/`chrome.scripting`/`chrome.debugger`, the Recon Next.js `/api/capture-queue`.

**Design source:** [2026-06-24-recon-extension-deploy-and-linkedin-send-design.md](../specs/2026-06-24-recon-extension-deploy-and-linkedin-send-design.md). Locked decisions: template with `{firstName}`/`{name}`, automated over the capture-queue, 15/day cap, daytime window, jitter, default-OFF kill-switch. **Governance note:** automated send departs from draft-then-approve; accepted for the sole user's own account; the rails are the mitigation; LinkedIn ToS/account risk is the user's.

---

## File Structure

**Modified (extension, `Tools/recon/extension/src/`):**
- `types.ts` — add `ConnectResult` + connect message/result types.
- `content.ts` — add a `BRIDGE_CONNECT` handler + the DOM send routine (`sendConnectionRequest(note)`).
- `background.ts` — add `connectTick()` + connect branch in `onProfileLoaded`; new storage keys; daily-cap + kill-switch logic; note resolution.
- `popup.html` / `popup.ts` — Settings: Auto-connect toggle, note template textarea, daily cap, last-connect status.

**Modified (backend, `Tools/recon/`):**
- `lib/capture.ts` + `app/api/capture-queue/route.ts` — honor `?action=connect` (return profiles flagged for connection-send rather than capture).

---

## Task 1: Connect types

**Files:** Modify `Tools/recon/extension/src/types.ts`

- [ ] **Step 1: Add the connect result + message types**

```ts
// Append to Tools/recon/extension/src/types.ts
export type ConnectStatus = 'sent' | 'already_connected' | 'note_unavailable' | 'soft_block' | 'error';

export interface ConnectResult {
  ok: boolean;
  status: ConnectStatus;
  detail?: string;
}

/** Message the background worker sends to the content script to fire a connection request. */
export interface ConnectMessage {
  type: 'BRIDGE_CONNECT';
  note: string; // already templated + truncated by the worker
}
```

- [ ] **Step 2: Build the extension to confirm types compile**

Run: `cd Tools/recon/extension && npm run build`
Expected: build succeeds (esbuild + tsc).

- [ ] **Step 3: Commit**

```bash
git add Tools/recon/extension/src/types.ts
git commit -m "feat(ext): connect message + result types"
```

---

## Task 2: Backend — capture-queue `action=connect`

**Files:** Modify `Tools/recon/lib/capture.ts`, `Tools/recon/app/api/capture-queue/route.ts`

**Inspection-first:** Read `lib/capture.ts` (the queue query against Supabase `people_canonical`) and `app/api/capture-queue/route.ts`. Determine how pending items are selected today, then add an `action` dimension.

- [ ] **Step 1: Read the current queue selection** and identify the column that marks a row as "needs capture" (e.g. a null `captured_at`, a `status`, or a dedup_key set). The connect variant needs an analogous flag — recommended: a boolean/timestamp column `connect_requested` (or reuse an existing `intent` field) on `people_canonical`. If no such column exists, add a migration `ALTER TABLE people_canonical ADD COLUMN connect_requested boolean DEFAULT false` (Supabase MCP `apply_migration`).

- [ ] **Step 2: Add `action` support to the queue function** in `lib/capture.ts`: accept `action: 'capture' | 'connect'` (default `'capture'`). For `connect`, select rows where `connect_requested = true` AND not yet sent (add a `connect_sent_at` timestamp, set on result report), respecting the same ordering/caps. Return the same `{ name, linkedin_url, dedup_key }` item shape.

- [ ] **Step 3: Thread `action` through the route** in `app/api/capture-queue/route.ts`: read `?action=` on GET and pass it down; on POST, when a result row carries a connect status, write `connect_sent_at` / record the outcome instead of the capture fields. Keep the existing capture path unchanged when `action` is absent.

- [ ] **Step 4: Verify** with curl against a local `npm run dev`:
```bash
curl 'http://localhost:3001/api/capture-queue?limit=1&action=connect'
```
Expected: `{ ok: true, items: [...] }` returning only connect-flagged rows (empty list is fine if none flagged). The default `?action=capture` (or no param) must return the same as before — confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add Tools/recon/lib/capture.ts Tools/recon/app/api/capture-queue/route.ts
git commit -m "feat(recon): capture-queue action=connect selection"
```

---

## Task 3: Content script — the send routine (MANUAL-VERIFY)

**Files:** Modify `Tools/recon/extension/src/content.ts`

LinkedIn's DOM is obfuscated/SDUI; anchor on stable signals (`aria-label`, button text), exactly like the existing extractor. The Connect button is often hidden under a "More" overflow.

- [ ] **Step 1: Add the send routine + message handler**

```ts
// Add to Tools/recon/extension/src/content.ts (above the existing onMessage listener)
import type { ConnectResult } from './types'; // extend the existing import line

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Find a visible button/anchor whose trimmed text or aria-label matches `label` (case-insensitive). */
function findByLabel(label: string): HTMLElement | null {
  const want = label.toLowerCase();
  const els = document.querySelectorAll<HTMLElement>('button, a[role="button"], div[role="button"]');
  for (const el of els) {
    const aria = (el.getAttribute('aria-label') ?? '').toLowerCase();
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (aria === want || aria.startsWith(want + ' ') || text === want) {
      if (el.offsetParent !== null) return el; // visible
    }
  }
  return null;
}

async function sendConnectionRequest(note: string): Promise<ConnectResult> {
  // 1. Already connected / pending? No actionable Connect entry point.
  // 2. Primary Connect button, else open the "More" overflow and find Connect there.
  let connect = findByLabel('Connect');
  if (!connect) {
    const more = findByLabel('More actions') ?? findByLabel('More');
    if (more) { more.click(); await sleep(600); connect = findByLabel('Connect'); }
  }
  if (!connect) {
    // Distinguish "already connected/pending" from a DOM miss.
    if (findByLabel('Pending') || findByLabel('Message')) return { ok: true, status: 'already_connected' };
    return { ok: false, status: 'error', detail: 'Connect button not found' };
  }
  connect.click();
  await sleep(900);

  // 3. "Add a note" in the invitation modal.
  const addNote = findByLabel('Add a note');
  if (!addNote) {
    // Some accounts hit the monthly free-invite-note limit → no note box.
    return { ok: false, status: 'note_unavailable', detail: 'Add-a-note unavailable' };
  }
  addNote.click();
  await sleep(600);

  // 4. Fill the note textarea (respect its maxlength).
  const ta = document.querySelector<HTMLTextAreaElement>('textarea#custom-message, textarea[name="message"]');
  if (!ta) return { ok: false, status: 'error', detail: 'note textarea not found' };
  const max = ta.maxLength > 0 ? ta.maxLength : 300;
  ta.focus();
  ta.value = note.slice(0, max);
  ta.dispatchEvent(new Event('input', { bubbles: true })); // let React see the value
  await sleep(300);

  // 5. Send.
  const send = findByLabel('Send invitation') ?? findByLabel('Send') ?? findByLabel('Send now');
  if (!send) return { ok: false, status: 'error', detail: 'Send button not found' };
  // Weekly invite cap surfaces as a blocking dialog after click.
  send.click();
  await sleep(1000);
  const body = document.body.innerText;
  if (/you've reached the weekly invitation limit|reached the weekly limit/i.test(body)) {
    return { ok: false, status: 'soft_block', detail: 'weekly invite limit' };
  }
  return { ok: true, status: 'sent' };
}
```

- [ ] **Step 2: Wire `BRIDGE_CONNECT` into the existing message listener**

The current listener at the bottom of `content.ts` handles `BRIDGE_EXTRACT` synchronously. `BRIDGE_CONNECT` is async, so respond from a promise:

```ts
// Replace the existing onMessage listener with:
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'BRIDGE_EXTRACT') {
    sendResponse(extract());
    return true;
  }
  if (msg?.type === 'BRIDGE_CONNECT') {
    sendConnectionRequest(String(msg.note ?? '')).then(sendResponse).catch((e) =>
      sendResponse({ ok: false, status: 'error', detail: e instanceof Error ? e.message : 'connect failed' }),
    );
    return true; // keep the message channel open for the async response
  }
  return true;
});
```

- [ ] **Step 3: Build**

Run: `cd Tools/recon/extension && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add Tools/recon/extension/src/content.ts
git commit -m "feat(ext): LinkedIn connection-send content routine (BRIDGE_CONNECT)"
```

---

## Task 4: Background worker — connectTick + storage keys

**Files:** Modify `Tools/recon/extension/src/background.ts`

Mirror `captureTick`/`onProfileLoaded`. Reuse the alarm + active-hours + jitter. Add a `connectRequest` (parallel to `captureRequest`) and a daily cap.

- [ ] **Step 1: Seed defaults on install**

In the `chrome.runtime.onInstalled` handler, extend the `storage.local.set` defaults:

```ts
await chrome.storage.local.set({
  autoCapture: false, autoScroll: true, activeStart: 8, activeEnd: 20,
  autoConnect: false, connectDailyCap: 15,
  noteTemplate: 'Hi {firstName}, I came across your profile and would love to connect.',
});
```

- [ ] **Step 2: Add the connect tick (called from the alarm)**

Change the alarm handler to also try connect (capture takes priority; only one tab-opening action per tick):

```ts
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) {
    (async () => {
      const opened = await captureTick();        // returns true if it opened a tab
      if (!opened) await connectTick();           // otherwise try a connection-send
    })().catch(() => {}).finally(() => armNextAlarm());
  }
});
```

Make `captureTick` return a boolean (`return true` right after `chrome.tabs.create(...)`, `return false` on every early `return`). Then add:

```ts
type ConnectStatus = 'sent' | 'already_connected' | 'note_unavailable' | 'soft_block' | 'error';

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

  let q: { ok?: boolean; paused?: boolean; items?: Array<{ name: string; linkedin_url: string; dedup_key: string }> };
  try { q = await (await fetch(`${RECON_URL}/api/capture-queue?limit=1&action=connect`)).json(); } catch { return; }
  if (!q?.ok || q.paused || !q.items?.length) return;

  const item = q.items[0];
  await chrome.storage.local.set({ connectRequest: { url: item.linkedin_url, dedup_key: item.dedup_key, name: item.name } });
  await chrome.tabs.create({ url: item.linkedin_url, active: true });
}
```

- [ ] **Step 3: Handle the connect request in `onProfileLoaded`**

After the existing capture branch in `onProfileLoaded`, add a connect branch (it scrolls minimally — the top card with the Connect button is above the fold, so no full scroll needed):

```ts
// in onProfileLoaded, after the capture handling block:
let creq: { url: string; dedup_key?: string; name?: string } | undefined;
try { ({ connectRequest: creq } = await chrome.storage.local.get('connectRequest')); } catch { /* */ }
if (creq?.url && sameProfile(url, creq.url)) {
  try { await chrome.storage.local.remove('connectRequest'); } catch { /* */ }
  await connectLoadedTab(tabId, creq);
}
```

Note: place this check so it does not require `autoScroll`. The early `if (!autoScroll && !isCapture) return;` must also allow connect — change it to `if (!autoScroll && !isCapture && !isConnect) return;` where `isConnect` is computed at the top of `onProfileLoaded` the same way `isCapture` is. Compute both up front.

- [ ] **Step 4: Add `connectLoadedTab`**

```ts
async function resolveNote(name: string): Promise<string> {
  const { noteTemplate = 'Hi {firstName}, I would love to connect.' } = await chrome.storage.local.get('noteTemplate');
  const firstName = (name ?? '').split(/[\s,]+/)[0] ?? '';
  return noteTemplate.replace(/\{firstName\}/g, firstName).replace(/\{name\}/g, name ?? '').slice(0, 300);
}

async function connectLoadedTab(tabId: number, req: { url: string; dedup_key?: string; name?: string }): Promise<void> {
  let status: ConnectStatus = 'error';
  try {
    const cur = await chrome.tabs.get(tabId);
    if (/authwall|checkpoint|\/login|\/uas\//i.test(cur.url ?? '')) {
      status = 'soft_block';
    } else {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch { /* injected */ }
      await sleep(800);
      const note = await resolveNote(req.name ?? '');
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
```

- [ ] **Step 5: Build**

Run: `cd Tools/recon/extension && npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add Tools/recon/extension/src/background.ts
git commit -m "feat(ext): connectTick worker — automated connection-send with 15/day cap"
```

---

## Task 5: Popup settings UI

**Files:** Modify `Tools/recon/extension/src/popup.html`, `Tools/recon/extension/src/popup.ts`

**Inspection-first:** Read `popup.html` + `popup.ts` to match the existing toggle/field pattern (how `autoCapture`/`autoScroll`/`activeStart` are rendered + persisted to `chrome.storage.local`).

- [ ] **Step 1: Add a "Connection requests" section to `popup.html`** mirroring the existing auto-capture controls: an `Auto-connect` checkbox (`#autoConnect`), a `Daily cap` number input (`#connectDailyCap`), a `Note template` textarea (`#noteTemplate`, helper text `Use {firstName} / {name}`), and a `Last connect:` status line (`#lastConnect`).

- [ ] **Step 2: Wire them in `popup.ts`** following the existing load/save pattern: on load, read `autoConnect`/`connectDailyCap`/`noteTemplate`/`lastConnect` from `chrome.storage.local` and populate the controls; on change, persist. Render `lastConnect` as e.g. `sent · Dana Lee · 2m ago`.

- [ ] **Step 3: Build + load unpacked**

Run: `cd Tools/recon/extension && npm run build`. Then in Chrome → Extensions → Load unpacked → `Tools/recon/extension/dist`. Confirm the popup shows the new section and toggling persists across popup reopen.

- [ ] **Step 4: Commit**

```bash
git add Tools/recon/extension/src/popup.html Tools/recon/extension/src/popup.ts
git commit -m "feat(ext): popup controls for auto-connect, note template, daily cap"
```

---

## Task 6: Live end-to-end verification (MANUAL — needs a real LinkedIn session)

No automated substitute. Use a low-stakes connection target.

- [ ] **Step 1:** Ensure the Recon backend is running (local or deployed) and has ≥1 profile flagged `connect_requested = true`.
- [ ] **Step 2:** In the popup, set a note template, set `Auto-connect` ON, cap = 1.
- [ ] **Step 3:** Wait for a tick (or temporarily lower the alarm jitter for testing), confirm: the profile opens, the note box fills with `{firstName}` substituted and within the char limit, the request sends, the tab closes, `lastConnect` shows `sent`, the daily counter increments, and a `connect` result posts back to `/api/capture-queue`.
- [ ] **Step 4:** Verify the rails: with cap reached, no further sends; toggling `Auto-connect` OFF halts immediately; outside the active-hours window nothing fires.
- [ ] **Step 5:** Verify graceful outcomes on an already-connected profile (`already_connected`) and confirm no crash when the Connect button is absent.

---

## Self-Review notes (for the executor)

- **Coverage:** note template `{placeholders}` → Task 4 `resolveNote`; automated over queue → Tasks 2+4; 15/day cap + kill-switch + daytime + jitter → Task 4; send routine + overflow handling + char limit + soft-block detection → Task 3; UI → Task 5.
- **Type consistency:** `ConnectStatus`/`ConnectResult` defined in Task 1, used in Tasks 3–4; `connectRequest`/`connectSentToday`/`noteTemplate`/`lastConnect` storage keys are consistent across background + popup.
- **Sharp edges (flagged):** `captureTick` must be changed to RETURN a boolean (Task 4 Step 2) or the connect branch never runs. The `BRIDGE_CONNECT` listener MUST `return true` for the async response. LinkedIn DOM selectors (`textarea#custom-message`, button labels) are the most fragile part and need the manual Task 6 pass; expect to tune them against the live DOM.
- **Out of scope:** the configurable-URL extension UI + redirecting to the deployment (covered in the deploy plan Task 9 Step 3); migrating the queue source away from `people_canonical`.
- **Governance/risk:** automated unattended sending — rails are cap/window/jitter/kill-switch; ToS/account risk accepted by the user (sole user, own account). Record an ADR + known-issue when this lands.
