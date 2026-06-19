// Parse the LinkedIn CSV exports → a typed network.ts the app consumes.
// Connections.csv → people (+ derived companies). Invitations.csv → threads (messages).
// Run: node scripts/parse-network.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// RFC4180-ish CSV parser: handles quoted fields with embedded commas, quotes, newlines.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

// ── Connections ────────────────────────────────────────────────────────────────
const connText = readFileSync(join(root, 'data/Connections.csv'), 'utf8');
const connRows = parseCSV(connText);
// Find the header row (starts with "First Name")
let headerIdx = connRows.findIndex(r => r[0] === 'First Name');
const connBody = connRows.slice(headerIdx + 1).filter(r => r.length >= 6 && (r[0] || r[1]));

const RING = ['Inner', 'Close', 'Warm', 'Extended'];
const RECIP = ['Balanced', 'You give more', 'They give more'];

const peopleAll = connBody.map((r, i) => {
  const [firstName, lastName, url, email, company, position, connectedOn] = r;
  const name = `${firstName} ${lastName}`.trim();
  const h = hash(name + i);
  const warmth = 30 + (h % 70);
  const trust = 40 + ((h >> 3) % 60);
  const insight = position && company ? `${position} at ${company}.`
    : company ? `Works at ${company}.`
    : position ? `${position}.`
    : 'LinkedIn connection — no recent public updates.';
  return {
    id: `P-${1000 + i}`,
    name, firstName, lastName,
    company: company || '', position: position || '', url: url || '', email: email || '',
    connectedOn: connectedOn || '',
    newsInsight: insight,
    location: '',
    warmth, ring: RING[h % 4], reciprocity: RECIP[h % 3], trust,
    lastConnected: connectedOn || '—',
  };
});

// Sort by connectedOn desc (parse "04 Apr 2026")
const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const toTime = (s) => { const m = /(\d{1,2})\s+(\w{3})\s+(\d{4})/.exec(s || ''); return m ? new Date(+m[3], months[m[2]] ?? 0, +m[1]).getTime() : 0; };
peopleAll.sort((a, b) => toTime(b.connectedOn) - toTime(a.connectedOn));

const PEOPLE_CAP = 600;
const people = peopleAll.slice(0, PEOPLE_CAP);

// ── Companies (aggregate) ───────────────────────────────────────────────────────
const companyMap = new Map();
for (const p of peopleAll) {
  if (!p.company) continue;
  if (!companyMap.has(p.company)) companyMap.set(p.company, { name: p.company, count: 0, roles: new Set(), people: [] });
  const c = companyMap.get(p.company);
  c.count++;
  if (p.position) c.roles.add(p.position);
  if (c.people.length < 5) c.people.push(p.name);
}
const companies = [...companyMap.values()]
  .sort((a, b) => b.count - a.count)
  .slice(0, 150)
  .map((c, i) => ({
    id: `C-${2000 + i}`,
    name: c.name,
    connections: c.count,
    sampleRoles: [...c.roles].slice(0, 3),
    samplePeople: c.people,
    newsInsight: `${c.count} ${c.count === 1 ? 'connection' : 'connections'} in your network${c.roles.size ? ` · ${[...c.roles][0]}` : ''}.`,
  }));

// ── Invitations → threads (messages) ────────────────────────────────────────────
const invText = readFileSync(join(root, 'data/Invitations.csv'), 'utf8');
const invRows = parseCSV(invText);
const invHeaderIdx = invRows.findIndex(r => r[0] === 'From');
const invBody = invRows.slice(invHeaderIdx + 1).filter(r => r.length >= 5);

const threads = invBody
  .filter(r => (r[3] || '').trim().length > 0) // only invitations with a message
  .map((r, i) => {
    const [from, to, sentAt, message, direction] = r;
    const counterpart = direction === 'OUTGOING' ? to : from;
    return {
      id: `T-${3000 + i}`,
      with: counterpart,
      from, to, sentAt: sentAt || '', direction: direction || 'OUTGOING',
      message: (message || '').trim(),
      preview: (message || '').trim().slice(0, 120),
    };
  });

// ── Emit ─────────────────────────────────────────────────────────────────────────
const out = `// AUTO-GENERATED from data/Connections.csv + data/Invitations.csv by scripts/parse-network.mjs.
// DO NOT EDIT BY HAND. Regenerate: node scripts/parse-network.mjs
export interface NetworkPerson {
  id: string; name: string; firstName: string; lastName: string;
  company: string; position: string; url: string; email: string; connectedOn: string;
  newsInsight: string; location: string;
  warmth: number; ring: string; reciprocity: string; trust: number; lastConnected: string;
}
export interface NetworkCompany {
  id: string; name: string; connections: number; sampleRoles: string[]; samplePeople: string[]; newsInsight: string;
}
export interface NetworkThread {
  id: string; with: string; from: string; to: string; sentAt: string; direction: string; message: string; preview: string;
}

export const totalConnections = ${peopleAll.length};
export const people: NetworkPerson[] = ${JSON.stringify(people)};
export const companies: NetworkCompany[] = ${JSON.stringify(companies)};
export const threads: NetworkThread[] = ${JSON.stringify(threads)};
`;

writeFileSync(join(root, 'src/app/data/network.ts'), out);

// ── Seed SQL for Supabase people_canonical (canonical tier) ──────────────────────
const sqlEsc = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";
const emailArr = (e) => (e && e.trim()) ? `array[${sqlEsc(e.trim())}]::text[]` : `'{}'::text[]`;
const valueRows = people.slice(0, 200).map(p =>
  `(${sqlEsc(p.name)}, ${p.position ? sqlEsc(p.position) : 'null'}, ${p.company ? sqlEsc(p.company) : 'null'}, ${p.url ? sqlEsc(p.url) : 'null'}, ${emailArr(p.email)}, 'linkedin_csv', ${sqlEsc('csv:' + p.id)})`
);
const batches = [];
for (let i = 0; i < valueRows.length; i += 200) batches.push(valueRows.slice(i, i + 200));
const seedSql = [
  `delete from public.people_canonical where enrichment_source = 'linkedin_csv';`,
  ...batches.map(b =>
    `insert into public.people_canonical (full_name, current_title, current_company_name, linkedin_url, emails, enrichment_source, dedup_key)\nvalues\n${b.join(',\n')};`
  ),
].join('\n\n');
writeFileSync(join(root, 'data/seed_canonical.sql'), seedSql);

console.log(JSON.stringify({
  totalConnections: peopleAll.length,
  peopleEmitted: people.length,
  companies: companies.length,
  threads: threads.length,
  samplePerson: people[0],
  sampleCompany: companies[0],
  sampleThread: threads[0],
}, null, 2));
