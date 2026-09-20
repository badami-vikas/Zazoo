// The Avatar's chat window. State lives in chrome.storage.local, so it survives closing the panel and restarting Chrome.
const $ = (id) => document.getElementById(id);
const store = {
  async get() { const { clip } = await chrome.storage.local.get('clip'); return clip || { records: [], log: [] }; },
  async set(clip) { await chrome.storage.local.set({ clip }); },
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const table = (rows) => `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;

function render(clip) {
  $('log').innerHTML = clip.log.map((m) => `<div class="msg ${m.who}">${m.html}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
  const last = clip.records.at(-1);
  $('status').textContent = last ? `${last.fields.length} details from ${last.source.title || last.source.url}` : 'Nothing on the clipboard yet';
}
async function say(who, html) {
  const clip = await store.get();
  clip.log.push({ who, html, at: Date.now() }); clip.log = clip.log.slice(-200);
  await store.set(clip); render(clip);
}
const blink = () => { $('avatar').classList.add('busy'); setTimeout(() => $('avatar').classList.remove('busy'), 1200); };
async function page(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  try { return { tab, res: await chrome.tabs.sendMessage(tab.id, msg) }; }
  catch { throw new Error(`I can't reach this page yet. Reload it once (the extension was installed after it loaded), or it is a browser-internal page.`); }
}

const actions = {
  async copy() {
    const { tab, res } = await page({ type: 'capture' });
    if (!res.fields.length) return say('bot', `I looked at <b>${esc(tab.title)}</b> but found no labelled details to copy. Select the text you want, or open a page with a filled form.`);
    const clip = await store.get();
    clip.records.push({ id: Date.now(), ...res }); clip.records = clip.records.slice(-20); await store.set(clip);
    blink();
    return say('bot', `Copied ${res.fields.length} details from <b>${esc(res.source.title || res.source.url)}</b>. They are saved on this machine until you ask me to forget them.${table(res.fields.map((f) => [f.key, f.value]))}`);
  },
  async recall() {
    const last = (await store.get()).records.at(-1);
    if (!last) return say('bot', 'The clipboard is empty. Open a page with the details and ask me to copy them.');
    return say('bot', `Here is what I have, from <b>${esc(last.source.title || last.source.url)}</b> (${new Date(last.source.at).toLocaleString()}):${table(last.fields.map((f) => [f.key, f.value]))}`);
  },
  async paste() {
    const last = (await store.get()).records.at(-1);
    if (!last) return say('bot', 'Nothing to paste yet. Ask me to copy the details from a page first.');
    const { res } = await page({ type: 'paste', fields: last.fields });
    blink();
    if (!res.filled.length) return say('bot', `I found no fields on <b>${esc(res.target.title)}</b> that match what I copied. The stored keys are: ${last.fields.map((f) => f.key).join(', ')}.`);
    const unmatched = last.fields.filter((f) => !res.filled.some((x) => x.from === f.key)).map((f) => f.key);
    return say('bot', `Pasted ${res.filled.length} of ${last.fields.length} details into <b>${esc(res.target.title)}</b>. Filled fields are outlined on the page. Check them before you submit.${table(res.filled.map((f) => [f.key, `${f.value}${f.key.toLowerCase() !== f.from.toLowerCase() ? `  ← ${f.from}` : ''}`]))}${unmatched.length ? `\nNo home for: ${esc(unmatched.join(', '))}` : ''}`);
  },
  async clear() {
    const clip = await store.get(); clip.records = []; await store.set(clip);
    return say('bot', 'Forgotten. The clipboard is empty.');
  },
  help: () => say('bot', 'Try: <b>copy the details</b> on a page with a filled form (or select text like "Name: Jane"), <b>recall</b> to see what I hold, <b>paste</b> on the form you want filled, <b>forget</b> to wipe it.'),
};
const intent = BridgeMatch.intent;

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('q').value.trim(); if (!t) return; $('q').value = '';
  await say('me', esc(t));
  try { await actions[intent(t)](); } catch (err) { await say('bot', esc(err.message)); }
});
store.get().then(render);
