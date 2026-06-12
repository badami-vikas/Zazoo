import type { LinkedInProfile, ExtractResult, ImportResult } from './types';

const RECON_URL = 'http://localhost:3001';

function show(id: string) {
  for (const el of document.querySelectorAll<HTMLElement>('[id^="state-"]')) {
    el.style.display = 'none';
  }
  const target = document.getElementById(id);
  if (target) target.style.display = 'block';
}

function setText(id: string, val: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// A flat, displayable field with a parser `category` used for flag aggregation.
interface FieldRow {
  category: string;            // education | experience | headline | … (drives flag aggregation)
  label: string;              // shown to the analyst
  value: string;
  scope?: 'person' | 'company';
}

function buildFields(p: LinkedInProfile): FieldRow[] {
  const f: FieldRow[] = [];
  f.push({ category: 'name', label: 'Name', value: p.name });
  if (p.location) f.push({ category: 'location', label: 'Location', value: p.location });
  // About already has the headline prepended at its top.
  if (p.about)    f.push({ category: 'about', label: 'About (headline + bio)', value: p.about });

  p.experience.forEach((e, i) => {
    const value = [e.title, e.company, e.companyType, e.duration, e.location].filter(Boolean).join(' · ')
      + (e.description ? `\n${e.description}` : '');
    f.push({ category: 'experience', label: i === 0 ? 'Current Role' : `Role ${i + 1}`, value });
  });

  p.education.forEach((e, i) => {
    const value = [e.school, e.degree, e.field, e.years].filter(Boolean).join(' · ');
    f.push({ category: 'education', label: p.education.length > 1 ? `Education ${i + 1}` : 'Education', value });
  });

  if (p.services.length) f.push({ category: 'services', label: 'Services (tags)', value: p.services.join(', ') });

  p.posts.forEach((post, i) => {
    const value = [post.meta, post.url].filter(Boolean).join(' — ');
    f.push({ category: 'post', label: `Social Media Activity ${i + 1}`, value });
  });

  return f;
}

// Flag icon: red outline when unmarked, solid red once flagged.
const FLAG_OUTLINE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
const FLAG_SOLID = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';

async function flagField(profile: LinkedInProfile, field: FieldRow, btn: HTMLButtonElement, row: HTMLElement) {
  const flagging = !btn.classList.contains('on'); // toggle: flag if off, unflag if on
  btn.disabled = true;
  const payload = {
    subjectName: profile.name,
    category: field.category,
    label: field.label,
    value: field.value,
    scope: field.scope ?? 'person',
  };
  try {
    const res = await fetch(`${RECON_URL}/api/extraction-flags`, {
      method: flagging ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json() as { ok: boolean; categoryCount?: number; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    if (flagging) {
      row.classList.add('flagged');
      btn.classList.add('on');
      btn.innerHTML = `${FLAG_SOLID}<span class="field-flag-count">${data.categoryCount ?? 1}</span>`;
      btn.title = `Flagged. ${data.categoryCount ?? 0} total flag(s) on "${field.category}" fields. Click again to undo.`;
    } else {
      row.classList.remove('flagged');
      btn.classList.remove('on');
      btn.innerHTML = FLAG_OUTLINE;
      btn.title = `Flag "${field.label}" as wrong`;
    }
  } catch (e) {
    btn.title = `${flagging ? 'Flag' : 'Unflag'} failed: ${e instanceof Error ? e.message : 'unknown'} (is the Recon server running?)`;
    btn.textContent = '⚠';
    setTimeout(() => { btn.innerHTML = flagging ? FLAG_OUTLINE : FLAG_SOLID; }, 1500);
  } finally {
    btn.disabled = false;
  }
}

function renderProfile(profile: LinkedInProfile) {
  setText('p-name', profile.name);
  setText('p-headline', profile.headline || (profile.currentCompany ? `at ${profile.currentCompany}` : ''));
  setText('p-location', profile.location);
  setText('s-exp', String(profile.experience.length));
  setText('s-edu', String(profile.education.length));
  setText('s-skills', String(profile.services.length));

  // Honest banner when LinkedIn's golden gate hid the full profile.
  document.getElementById('gate-banner')!.style.display = profile.gated ? 'block' : 'none';

  // Full, scrollable, flaggable field list.
  const container = document.getElementById('fields')!;
  container.innerHTML = '';
  for (const field of buildFields(profile)) {
    const row = document.createElement('div');
    row.className = 'field-row';

    const body = document.createElement('div');
    body.className = 'field-body';
    const label = document.createElement('div');
    label.className = 'field-label';
    label.textContent = field.label;
    const value = document.createElement('div');
    value.className = 'field-value';
    value.textContent = field.value || '—';
    body.append(label, value);

    const flag = document.createElement('button');
    flag.className = 'field-flag';
    flag.type = 'button';
    flag.innerHTML = FLAG_OUTLINE;
    flag.title = `Flag "${field.label}" as wrong`;
    flag.addEventListener('click', () => flagField(profile, field, flag, row));

    row.append(body, flag);
    container.appendChild(row);
  }

  show('state-profile');
}

/** Scroll the profile top→bottom→top so LinkedIn's lazy SDUI cards
 *  (experience / education / skills) render before we extract. */
async function loadLazySections(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const h = document.body.scrollHeight;
        for (let y = 0; y <= h; y += Math.max(400, window.innerHeight - 100)) {
          window.scrollTo(0, y);
          await sleep(220);
        }
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(350);
        window.scrollTo(0, 0);
        await sleep(250);
      },
    });
  } catch { /* best-effort */ }
}

async function saveProfile(profile: LinkedInProfile) {
  const btn = document.getElementById('btn-save') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const notes = (document.getElementById('p-notes') as HTMLTextAreaElement | null)?.value.trim() || undefined;

  try {
    const res = await fetch(`${RECON_URL}/api/linkedin-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, notes }),
    });

    const data: ImportResult = await res.json();

    if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    setText('saved-msg', `${profile.name} saved to staging`);
    setText('saved-sub', `${data.stagingCount ?? 0} staging rows written`);
    show('state-saved');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Save to Bridge Recon';
    setText('error-msg', `Save failed: ${e instanceof Error ? e.message : 'unknown error'}\n\nIs the Recon dev server running at localhost:3001?`);
    show('state-error');
  }
}

async function init() {
  show('state-loading');

  // Check current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('linkedin.com/in/')) {
    show('state-not-linkedin');
    return;
  }

  // (Re-)inject content script, then retry extraction up to 3x with backoff.
  // Needed for LinkedIn SPA navigation where the content script doesn't auto-re-run.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] });
  } catch { /* already injected */ }

  // Trigger lazy-loaded SDUI cards before the first extraction attempt.
  await loadLazySections(tab.id!);

  let result: ExtractResult | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
      await loadLazySections(tab.id!); // re-scroll on retry in case cards were still loading
    }
    try {
      result = await chrome.tabs.sendMessage(tab.id!, { type: 'BRIDGE_EXTRACT' });
      // Accept once we have a name AND at least one section (or a known gated profile).
      if (result.ok && (result.profile.experience.length > 0 || result.profile.education.length > 0 || result.profile.gated)) break;
    } catch { /* not ready yet */ }
  }

  if (!result) {
    setText('error-msg', 'Could not connect to the LinkedIn page.\nTry refreshing the page and clicking the extension again.');
    show('state-error');
    return;
  }

  if (!result.ok) {
    setText('error-msg', result.error);
    show('state-error');
    return;
  }

  const { profile } = result;
  renderProfile(profile);

  document.getElementById('btn-save')!.addEventListener('click', () => saveProfile(profile));

  document.getElementById('btn-copy')!.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
    const btn = document.getElementById('btn-copy')!;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
  });
}

document.getElementById('btn-view')!.addEventListener('click', () => {
  chrome.tabs.create({ url: `${RECON_URL}` });
});

document.getElementById('btn-retry')!.addEventListener('click', () => init());

// ── Auto-capture toggle + status ──────────────────────────────────────────────
async function initAutoCapture() {
  const cb = document.getElementById('autocap-checkbox') as HTMLInputElement | null;
  const status = document.getElementById('autocap-status');
  if (!cb || !status) return;

  const { autoCapture = false } = await chrome.storage.local.get('autoCapture');
  cb.checked = autoCapture;

  const refreshStatus = async () => {
    if (!cb.checked) { status.textContent = 'off'; return; }
    try {
      const q = await (await fetch(`${RECON_URL}/api/capture-queue?limit=0`)).json() as
        { ok?: boolean; paused?: boolean; reason?: string; doneToday?: number; cap?: number; error?: string };
      if (q.error === 'no-supabase-key') status.textContent = 'needs SUPABASE_SERVICE_KEY';
      else if (q.paused) status.textContent = `paused — ${q.reason ?? 'soft-block'}`;
      else status.textContent = `${q.doneToday ?? 0}/${q.cap ?? 50} today · ~6/hr`;
    } catch { status.textContent = 'recon offline'; }
  };

  cb.addEventListener('change', async () => {
    await chrome.storage.local.set({ autoCapture: cb.checked });
    refreshStatus();
  });
  refreshStatus();
}

// ── "Next up" — show the next queued profile; click the row to open + capture it now ──
async function initNextUp() {
  const bar = document.getElementById('nextup-bar') as HTMLElement | null;
  const cta = document.getElementById('nextup-cta');
  const name = document.getElementById('nextup-name');
  const url = document.getElementById('nextup-url');
  const last = document.getElementById('nextup-last');
  if (!bar || !cta || !name || !url || !last) return;

  const ago = (ms: number) => {
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
  };

  const showLast = (lc?: { at: number; status: string; name?: string; url?: string }) => {
    if (!lc) return;
    const ok = lc.status === 'ok';
    last.className = `nextup-last ${ok ? 'ok' : 'bad'}`;
    last.textContent = `${ok ? '✓' : '⚠'} last: ${lc.name || lc.url || 'profile'} — ${lc.status} (${ago(lc.at)})`;
  };

  // Last completed capture (worker records it; the popup closes when the tab opens).
  const { lastCapture } = await chrome.storage.local.get('lastCapture') as
    { lastCapture?: { at: number; status: string; name?: string; url?: string } };
  showLast(lastCapture);

  let queueItem: { name: string; linkedin_url: string; dedup_key?: string } | null = null;
  // Next pending profile in the queue — the one a click (or the scheduler) will open.
  try {
    const q = await (await fetch(`${RECON_URL}/api/capture-queue?limit=1`)).json() as
      { paused?: boolean; reason?: string; error?: string; items?: Array<{ name: string; linkedin_url: string; dedup_key?: string }> };
    if (q.error === 'no-supabase-key') { name.textContent = 'needs SUPABASE_SERVICE_KEY'; cta.textContent = ''; }
    else if (q.paused) { name.textContent = `paused — ${q.reason ?? 'soft-block'}`; cta.textContent = ''; }
    else {
      const it = q.items?.[0];
      if (!it) { name.textContent = 'nothing pending (cap reached or all captured)'; cta.textContent = ''; }
      else { queueItem = it; name.textContent = it.name || '(unnamed)'; url.textContent = it.linkedin_url; }
    }
  } catch {
    name.textContent = 'recon offline'; cta.textContent = '';
  }

  if (!queueItem) return;
  const target = queueItem;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const setMsg = (cls: string, msg: string) => { last.className = `nextup-last ${cls}`; last.textContent = msg; };

  const waitComplete = (tabId: number, timeoutMs: number) => new Promise<void>((resolve) => {
    const fin = () => { chrome.tabs.onUpdated.removeListener(l); clearTimeout(t); resolve(); };
    const l = (id: number, info: chrome.tabs.TabChangeInfo) => { if (id === tabId && info.status === 'complete') fin(); };
    const t = setTimeout(fin, timeoutMs);
    chrome.tabs.onUpdated.addListener(l);
  });

  // Scroll the (visible) tab to the bottom with TRUSTED wheel events via chrome.debugger.
  // Surfaces the real error in the popup if the permission is blocked. Returns false on fail.
  const debuggerScroll = async (tabId: number): Promise<boolean> => {
    const dbg: chrome.debugger.Debuggee = { tabId };
    try {
      await chrome.debugger.attach(dbg, '1.3');
    } catch (e) {
      setMsg('bad', `⚠ debugger.attach failed: ${e instanceof Error ? e.message : e}. Remove & re-add the extension to grant "debugger".`);
      return false;
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
      let stable = 0, lastSig = -1;
      for (let i = 0; i < 45 && stable < 6; i++) {
        await chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 500, deltaX: 0, deltaY: 1500 });
        await sleep(350);
        const s = await measure();
        if (s === lastSig) stable++; else { stable = 0; lastSig = s; }
      }
      return true;
    } finally {
      try { await chrome.debugger.detach(dbg); } catch { /* */ }
    }
  };

  // Click the row → navigate THE CURRENT (visible) tab to the profile, scroll it to the
  // bottom with trusted wheel events, extract, and save — all popup-driven on the same tab
  // so the popup stays open and shows progress. No new tab, no background worker.
  bar.addEventListener('click', async () => {
    if (bar.classList.contains('busy')) return;
    bar.classList.add('busy');
    cta.textContent = '… working';
    let status = 'error';
    let capturedName: string | undefined;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = activeTab?.id;
      if (!tabId) { setMsg('bad', '⚠ No active tab'); return; }

      setMsg('', `Opening ${target.name || 'profile'} in this tab… (keep popup open)`);
      await chrome.tabs.update(tabId, { url: target.linkedin_url });
      await waitComplete(tabId, 25_000);
      await sleep(2500);

      const cur = await chrome.tabs.get(tabId);
      if (/authwall|checkpoint|\/login|\/uas\//i.test(cur.url ?? '')) {
        status = 'soft_block';
        setMsg('bad', '⚠ LinkedIn soft-block (auth wall / checkpoint).');
      } else {
        setMsg('', 'Scrolling to the bottom…');
        await debuggerScroll(tabId); // shows its own error if attach fails; extract anyway
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch { /* injected */ }
        // Let the freshly-mounted lazy cards finish rendering before extracting (3–5s, jittered).
        const settle = 3000 + Math.floor(Math.random() * 2000);
        setMsg('', `Letting the page settle (${Math.round(settle / 1000)}s)…`);
        await sleep(settle);
        let res: ExtractResult | null = null;
        for (let i = 0; i < 3; i++) {
          if (i) await sleep(600 * i);
          try { res = await chrome.tabs.sendMessage(tabId, { type: 'BRIDGE_EXTRACT' }); } catch { /* not ready */ }
          if (res?.ok && res.profile.name) break;
        }
        if (res?.ok && res.profile.name) {
          setMsg('', 'Saving…');
          await fetch(`${RECON_URL}/api/linkedin-import`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: res.profile }),
          });
          status = 'ok';
          capturedName = res.profile.name;
          const roles = res.profile.experience?.length ?? 0;
          const edu = res.profile.education?.length ?? 0;
          setMsg('ok', `✓ Captured ${capturedName} — ${roles} roles, ${edu} schools → saved`);
        } else {
          setMsg('bad', '⚠ No profile extracted.');
        }
      }

      if (target.dedup_key) {
        try {
          await fetch(`${RECON_URL}/api/capture-queue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: [{ dedup_key: target.dedup_key, status }] }),
          });
        } catch { /* best-effort */ }
      }
      await chrome.storage.local.set({
        lastCapture: { at: Date.now(), status, name: capturedName || target.name, url: target.linkedin_url },
      });
    } catch (e) {
      setMsg('bad', `⚠ ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      bar.classList.remove('busy');
      cta.textContent = '▶ capture now';
    }
  });
}

init();
initAutoCapture();
initNextUp();
