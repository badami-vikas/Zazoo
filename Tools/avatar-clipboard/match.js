// Label matching shared by the content script and the node self-check. Plain script: no modules in MV3 content scripts.
const BridgeMatch = (() => {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // ponytail: hand-written synonym groups; swap for an LLM/embedding mapper when a real portal defeats them.
  const SYN = [
    ['first name', 'given name', 'forename', 'first'],
    ['last name', 'surname', 'family name', 'last'],
    ['email', 'e mail', 'email address', 'e mail address'],
    ['phone', 'telephone', 'mobile', 'cell', 'phone number', 'mobile number'],
    ['dob', 'date of birth', 'birth date', 'birthdate', 'birthday'],
    ['street', 'address', 'address line 1', 'street address'],
    ['zip', 'zip code', 'postal code', 'postcode'],
    ['state', 'province', 'region'],
    ['vin', 'vehicle identification number'],
    ['married', 'marital status'],
    ['gender', 'sex'],
  ];
  const canon = (k) => { const n = norm(k); for (const g of SYN) if (g.includes(n)) return g[0]; return n; };
  const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
  const score = (a, b) => {
    const A = canon(a), B = canon(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    const ta = tokens(A), tb = tokens(B);
    let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
    return inter ? inter / Math.max(ta.size, tb.size) : 0;
  };
  const subset = (a, b) => { const ta = tokens(canon(a)), tb = tokens(canon(b)); const [s, l] = ta.size <= tb.size ? [ta, tb] : [tb, ta]; return s.size > 0 && [...s].every((t) => l.has(t)); };
  // Best stored field for a target label. Strong overlap wins; a token-subset match only counts when it is unambiguous.
  const best = (label, fields, min = 0.6) => {
    let b = null;
    for (const f of fields) { const s = score(label, f.key); if (s >= min && (!b || s > b.score)) b = { field: f, score: s }; }
    if (b) return b;
    const subs = fields.filter((f) => subset(label, f.key));
    return subs.length === 1 ? { field: subs[0], score: 0.5 } : null;
  };
  // "Key: value" lines out of free text (a selection, a pasted note).
  const parseText = (text) => String(text || '').split(/\r?\n/)
    .map((l) => l.match(/^\s*([^:=\t]{1,60}?)\s*[:=\t]\s*(.+?)\s*$/))
    .filter(Boolean).map((m) => ({ key: m[1], value: m[2] }));
  const dedupe = (fields) => { const seen = new Set(), out = []; for (const f of fields) { const k = norm(f.key); if (!k || !String(f.value ?? '').trim() || seen.has(k)) continue; seen.add(k); out.push({ key: f.key.trim(), value: String(f.value).trim() }); } return out; };
  // Paste beats copy so "recall and paste" pastes; copy beats recall so "copy and show me" copies.
  const intent = (t) => /\b(paste|fill)\b/i.test(t) ? 'paste' : /\b(copy|capture|grab|remember)\b/i.test(t) ? 'copy'
    : /\b(recall|show|what|clipboard|list)\b/i.test(t) ? 'recall' : /\b(clear|forget|delete|wipe)\b/i.test(t) ? 'clear' : 'help';
  return { norm, canon, score, best, parseText, dedupe, intent };
})();
if (typeof module !== 'undefined') module.exports = BridgeMatch;
