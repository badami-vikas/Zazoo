// Associations — ONE global relationship map, derived from the real network (people + communities),
// re-centered on whichever entity is selected. The "public" layer is people↔community membership;
// the "local" overlay is the user's initiatives, appended per-center.
//
// Degrees are computed relative to the chosen center:
//   1st  — direct ties (co-members of the center's community, or members of a community)
//   2nd  — role-adjacent communities (bridged by shared, non-generic role tokens) and their members
//   3rd+ — communities adjacent to those, then the wider network
//
// Deterministic: stable fields only, no Date.now()/Math.random(). Built once at module load; the
// per-center neighbourhood is a cheap lookup + BFS over the prebuilt indices.
import { people, companies, type NetworkPerson, type NetworkCompany } from './network';

const lc = (s: string) => (s || '').toLowerCase().trim();
const uniq = <T,>(a: T[]) => [...new Set(a)];

// ── qualitative bands (shared discipline — never expose the raw number) ──────────────────────────
const warmthBand = (n: number) => (n >= 80 ? 'Hot' : n >= 62 ? 'Warm' : n >= 50 ? 'Cooling' : 'Dormant');
const trustBand = (n: number) => (n >= 85 ? 'Deep' : n >= 65 ? 'Solid' : n >= 50 ? 'Building' : 'Newer');

export interface AssocPerson {
  id: string; name: string; rel: string; community: string;
  warmth: number; trust: number; warmthBand: string; trustBand: string; ring: string;
}
export interface AssocInitiative { id: string; name: string; rel: string }
export interface AssocResult {
  centerLabel: string;
  centerKind: 'person' | 'community' | 'self';
  centerSubtitle: string;
  degrees: { one: AssocPerson[]; two: AssocPerson[]; three: AssocPerson[] };
  counts: { one: number; two: number; three: number };
  communities: { home: string[]; related: string[] };
  initiatives: AssocInitiative[];
}

// ── prebuilt global indices ──────────────────────────────────────────────────────────────────────
const peopleByCompany = new Map<string, NetworkPerson[]>();
for (const p of people) {
  const k = lc(p.company);
  if (!k) continue;
  let arr = peopleByCompany.get(k);
  if (!arr) { arr = []; peopleByCompany.set(k, arr); }
  arr.push(p);
}
const companyByKey = new Map<string, NetworkCompany>();
for (const c of companies) companyByKey.set(lc(c.name), c);

const STOP = new Set(['and', 'the', 'of', 'at', 'to', 'for', 'in', 'with', 'your', 'our', 'inc', 'llc', 'ltd', 'co']);
const tokenize = (s: string) => lc(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));

// role-token sets per community + document frequency, to bridge role-adjacent communities
const companyTokens = new Map<string, Set<string>>();
const df = new Map<string, number>();
for (const c of companies) {
  const toks = new Set<string>();
  for (const r of c.sampleRoles || []) for (const t of tokenize(r)) toks.add(t);
  companyTokens.set(lc(c.name), toks);
  for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
}
// drop the most ubiquitous role tokens (e.g. "founder", "engineer") so bridges mean something
const dynamicStop = new Set([...df.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]));
const bridgeTokens = (k: string) => {
  const s = companyTokens.get(k);
  return s ? new Set([...s].filter(t => !dynamicStop.has(t))) : new Set<string>();
};

function relatedCompanies(nameKey: string, cap = 6): string[] {
  const mine = bridgeTokens(nameKey);
  if (mine.size === 0) return [];
  const scored: { k: string; o: number; conn: number }[] = [];
  for (const [k, toks] of companyTokens) {
    if (k === nameKey) continue;
    let o = 0;
    for (const t of mine) if (toks.has(t)) o++;
    if (o > 0) scored.push({ k, o, conn: companyByKey.get(k)?.connections || 0 });
  }
  scored.sort((a, b) => b.o - a.o || b.conn - a.conn || a.k.localeCompare(b.k));
  return scored.slice(0, cap).map(s => s.k);
}

const score = (p: NetworkPerson) => (p.trust || 0) + (p.warmth || 0);
const byScore = (a: NetworkPerson, b: NetworkPerson) => score(b) - score(a) || a.name.localeCompare(b.name);

const CAP = 40;

export function buildAssociations(centerName: string, isCommunity = false): AssocResult {
  const ck = lc(centerName);
  const asCompany = isCommunity || companyByKey.has(ck);
  const centerPerson = people.find(p => lc(p.name) === ck);
  const seen = new Set<string>();
  const homeCommunities: string[] = [];

  const toAssoc = (p: NetworkPerson, rel: string): AssocPerson => ({
    id: p.id, name: p.name, rel, community: p.company || '—',
    warmth: p.warmth, trust: p.trust, warmthBand: warmthBand(p.warmth), trustBand: trustBand(p.trust), ring: p.ring,
  });

  // ── self / ego view — degrees by ring ──────────────────────────────────────────────────────────
  if (!asCompany && !centerPerson) {
    const ring = (names: string[]) => people.filter(p => names.includes(lc(p.ring))).sort(byScore);
    const one = ring(['inner', 'close']).map(p => toAssoc(p, `${p.ring} ring`));
    const two = ring(['warm']).map(p => toAssoc(p, 'Warm ring'));
    const three = ring(['extended', 'peripheral']).map(p => toAssoc(p, 'Extended ring'));
    return {
      centerLabel: centerName, centerKind: 'self', centerSubtitle: 'Your network',
      degrees: { one: one.slice(0, CAP), two: two.slice(0, CAP), three: three.slice(0, CAP) },
      counts: { one: one.length, two: two.length, three: three.length },
      communities: { home: [], related: [] },
      initiatives: [{ id: 'ini_checkin', name: 'Monthly inner-ring check-in', rel: 'Local Automation' }],
    };
  }

  // ── person / community view ──────────────────────────────────────────────────────────────────────
  let centerKind: 'person' | 'community' = asCompany ? 'community' : 'person';
  let centerSubtitle = '';
  let oneRaw: { p: NetworkPerson; rel: string }[] = [];

  if (asCompany) {
    const c = companyByKey.get(ck);
    const cName = c?.name || centerName;
    homeCommunities.push(cName);
    const members = (peopleByCompany.get(ck) || []).slice().sort(byScore);
    centerSubtitle = `${members.length} people you know here`;
    oneRaw = members.map(p => ({ p, rel: `Member of ${cName}` }));
  } else if (centerPerson) {
    const comp = centerPerson.company;
    centerSubtitle = `${centerPerson.position || 'Person'}${comp ? ` · ${comp}` : ''}`;
    if (comp) homeCommunities.push(comp);
    seen.add(centerPerson.id);
    const coMembers = (peopleByCompany.get(lc(comp)) || []).filter(p => p.id !== centerPerson.id).sort(byScore);
    oneRaw = coMembers.map(p => ({ p, rel: comp ? `Shared community · ${comp}` : 'Direct tie' }));
  }

  const one: AssocPerson[] = [];
  for (const { p, rel } of oneRaw) { if (seen.has(p.id)) continue; seen.add(p.id); one.push(toAssoc(p, rel)); }

  // related (role-adjacent) communities → 2nd degree
  const relatedKeys = uniq(homeCommunities.flatMap(h => relatedCompanies(lc(h)))).filter(k => !homeCommunities.some(h => lc(h) === k));
  const two: AssocPerson[] = [];
  for (const rk of relatedKeys) {
    const cName = companyByKey.get(rk)?.name || rk;
    for (const p of (peopleByCompany.get(rk) || []).slice().sort(byScore)) {
      if (seen.has(p.id)) continue; seen.add(p.id); two.push(toAssoc(p, `Role-adjacent · ${cName}`));
    }
  }

  // communities adjacent to those → 3rd+ degree
  const threeKeys = uniq(relatedKeys.flatMap(rk => relatedCompanies(rk))).filter(k => k !== ck && !relatedKeys.includes(k) && !homeCommunities.some(h => lc(h) === k));
  const three: AssocPerson[] = [];
  for (const tk of threeKeys) {
    const cName = companyByKey.get(tk)?.name || tk;
    for (const p of (peopleByCompany.get(tk) || []).slice().sort(byScore)) {
      if (seen.has(p.id)) continue; seen.add(p.id); three.push(toAssoc(p, `Extended · ${cName}`));
    }
  }

  // keep the degrees useful even when role-bridges are sparse — fill from the wider network by score
  if (two.length < 6 || three.length < 8) {
    for (const p of people.filter(p => !seen.has(p.id)).sort(byScore)) {
      if (two.length < 12) { seen.add(p.id); two.push(toAssoc(p, 'Wider network')); }
      else if (three.length < 18) { seen.add(p.id); three.push(toAssoc(p, 'Extended network')); }
      else break;
    }
  }

  const related = relatedKeys.map(k => companyByKey.get(k)?.name || k);

  // local overlay — the user's initiatives, appended onto the public map
  const initiatives: AssocInitiative[] = [];
  const homeName = homeCommunities[0];
  if (homeName) {
    initiatives.push({ id: `ini_intro_${lc(homeName)}`, name: `${homeName} — warm-intro round`, rel: 'Local initiative' });
    if (one.length >= 4) initiatives.push({ id: `ini_gather_${lc(homeName)}`, name: `${homeName} gathering`, rel: 'Local initiative' });
  }

  return {
    centerLabel: asCompany ? (companyByKey.get(ck)?.name || centerName) : centerName,
    centerKind, centerSubtitle,
    degrees: { one: one.slice(0, CAP), two: two.slice(0, CAP), three: three.slice(0, CAP) },
    counts: { one: one.length, two: two.length, three: three.length },
    communities: { home: homeCommunities, related },
    initiatives,
  };
}
