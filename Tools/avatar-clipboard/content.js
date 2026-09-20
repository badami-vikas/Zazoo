// Runs in every page. Reads the details on the page ("copy") and fills a form from stored details ("paste").
(() => {
  const M = BridgeMatch;
  const FIELDS = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=password]):not([type=file]), select, textarea';
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s*[*:]\s*$/, '').trim();
  const ownText = (label) => { if (!label) return ''; const c = label.cloneNode(true); c.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove()); return c.textContent; }; // a wrapping label must not include the control's own option text
  const labelFor = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return clean(ownText(byFor) || ownText(el.closest('label')) || el.getAttribute('aria-label') || el.placeholder || el.name || el.id);
  };
  const groupLabel = (el) => clean(el.closest('fieldset')?.querySelector('legend')?.textContent || el.name);
  const radios = (name) => [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)];
  const valueOf = (el) => {
    if (el.type === 'checkbox') return el.checked ? 'yes' : 'no';
    if (el.tagName === 'SELECT') return el.selectedOptions[0]?.text || '';
    return el.value;
  };

  function capture() {
    const fields = [...M.parseText(String(window.getSelection() || ''))];
    const seen = new Set();
    for (const el of document.querySelectorAll(FIELDS)) {
      if (el.type === 'radio') {
        if (seen.has(el.name)) continue; seen.add(el.name);
        const on = radios(el.name).find((r) => r.checked);
        if (on) fields.push({ key: groupLabel(on), value: labelFor(on) || on.value });
        continue;
      }
      fields.push({ key: labelFor(el), value: valueOf(el) });
    }
    for (const dt of document.querySelectorAll('dt')) { const dd = dt.nextElementSibling; if (dd?.tagName === 'DD') fields.push({ key: dt.textContent, value: dd.textContent }); }
    for (const th of document.querySelectorAll('tr > th:first-child')) { const td = th.nextElementSibling; if (td?.tagName === 'TD') fields.push({ key: th.textContent, value: td.textContent }); }
    return { fields: M.dedupe(fields), source: { url: location.href, title: document.title, at: Date.now() } };
  }

  const setValue = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; // React-controlled inputs ignore plain assignment
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const toISODate = (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const d = new Date(v); // ISO parses as UTC and would shift a day return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const mark = (el) => { el.style.outline = '2px solid #6c5ce7'; el.style.outlineOffset = '1px'; };

  function paste(fields) {
    const filled = [], seen = new Set();
    for (const el of document.querySelectorAll(FIELDS)) {
      if (el.type === 'radio') {
        if (seen.has(el.name)) continue; seen.add(el.name);
        const hit = M.best(groupLabel(el), fields); if (!hit) continue;
        const want = M.norm(hit.field.value);
        const pick = radios(el.name).find((r) => M.norm(labelFor(r)) === want || M.norm(r.value) === want);
        if (pick) { pick.click(); mark(pick.closest('label') || pick); filled.push({ key: groupLabel(el), from: hit.field.key, value: hit.field.value }); }
        continue;
      }
      const label = labelFor(el); const hit = M.best(label, fields); if (!hit) continue;
      const v = hit.field.value;
      if (el.type === 'checkbox') { const want = /^(yes|true|on|1|checked)$/i.test(v); if (el.checked !== want) el.click(); }
      else if (el.tagName === 'SELECT') { const o = [...el.options].find((o) => M.norm(o.text) === M.norm(v) || M.norm(o.value) === M.norm(v)); if (!o) continue; el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (el.type === 'date') { const iso = toISODate(v); if (!iso) continue; setValue(el, iso); }
      else setValue(el, v);
      mark(el); filled.push({ key: label, from: hit.field.key, value: v });
    }
    return { filled, target: { url: location.href, title: document.title } };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg.type === 'capture') reply(capture());
      else if (msg.type === 'paste') reply(paste(msg.fields || []));
    });
  } else window.__bridgeClip = { capture, paste }; // headless self-check without the extension runtime
})();
