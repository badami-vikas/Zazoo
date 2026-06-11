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

function renderProfile(profile: LinkedInProfile) {
  setText('p-name', profile.name);
  setText('p-headline', profile.headline);
  setText('p-location', profile.location);
  setText('s-exp', String(profile.experience.length));
  setText('s-edu', String(profile.education.length));
  setText('s-skills', String(profile.skills.length));

  const latestRole = profile.experience[0];
  if (latestRole) {
    document.getElementById('exp-preview')!.style.display = 'block';
    setText('exp-text', `${latestRole.title} · ${latestRole.company}`);
  }

  if (profile.about) {
    document.getElementById('about-preview')!.style.display = 'block';
    setText('about-text', profile.about.slice(0, 120) + (profile.about.length > 120 ? '…' : ''));
  }

  show('state-profile');
}

async function saveProfile(profile: LinkedInProfile) {
  const btn = document.getElementById('btn-save') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch(`${RECON_URL}/api/linkedin-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
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

  // Inject content script if not already present, then send extract message
  let result: ExtractResult;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      files: ['content.js'],
    });
  } catch {
    // Already injected — ignore
  }

  try {
    result = await chrome.tabs.sendMessage(tab.id!, { type: 'BRIDGE_EXTRACT' });
  } catch {
    setText('error-msg', 'Could not connect to the LinkedIn page. Try refreshing it.');
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

init();
