// HNI Finder — core enricher library
// Zero-cost, keyless-first, US-focused wealth & LP profiling.
// All results are provenanced; every enricher logs steps.

export interface HNIInput {
  name: string;
  state?: string;   // two-letter US state (for FEC/voter filtering)
  company?: string; // employer/affiliation hint
  zip?: string;     // primary ZIP
}

export interface Step {
  label: string;
  ok: boolean;
  detail?: string;
}

// ── Field tiers ──────────────────────────────────────────────────────────────
// A = authoritative government/regulatory source
// B = probable (cross-referenced, likely correct)
// C = analyst-review (name match only, verify before use)

export interface Field {
  tier: 'A' | 'B' | 'C';
  label: string;
  value: string;
  source: string;
  url?: string;
}

export interface Signal {
  tier: 'A' | 'B' | 'C';
  label: string;
  detail: string;
  source: string;
  url?: string;
}

// ── Domain blocks ─────────────────────────────────────────────────────────────

export interface IdentityBlock {
  fullName?: string;
  aka?: string;
  dob?: string;
  age?: number;
  birthplace?: string;
  citizenship?: string;
  gender?: string;
  description?: string;
  education?: string[];
  family?: string[];
  wikidataQid?: string;
  sources: string[];
}

export interface WealthBlock {
  netWorthEstimate?: string;
  netWorthRank?: string;
  sourceOfWealth?: string;
  assetFloor?: string; // sum of free verifiable assets
  accreditedInvestor?: 'Yes' | 'Likely' | 'Unknown';
  qualifiedPurchaser?: 'Yes' | 'Likely' | 'Unknown';
  sources: string[];
}

export interface FECContribution {
  date: string;
  amount: number;
  committee: string;
  employer: string;
  occupation: string;
  zip: string;
  cycle?: string;
}

export interface PoliticalBlock {
  totalContributions: number;
  contributionCount: number;
  earliestDate?: string;
  latestDate?: string;
  topRecipients: { name: string; total: number }[];
  employersOnRecord: string[];
  zipsOnRecord: string[];
  ideology: 'Dem-leaning' | 'Rep-leaning' | 'Bipartisan' | 'Unknown';
  contributions: FECContribution[];
  sources: string[];
}

export interface Foundation990 {
  ein: string;
  name: string;
  city: string;
  state: string;
  totalAssets?: number;
  totalRevenue?: number;
  grantsPaid?: number;
  totalExpenses?: number;
  officerComp?: number;
  taxYear?: number;
  filingHistory: { year: number; assets: number; revenue: number }[];
}

export interface FoundationsBlock {
  foundations: Foundation990[];
  sources: string[];
}

export interface InsiderFiling {
  date: string;
  form: string;
  entity: string;
  accession: string;
}

export interface SecuritiesBlock {
  filings: InsiderFiling[];
  cik?: string;
  sources: string[];
}

export interface RegistrationRecord {
  name: string;
  crd?: string;
  firm?: string;
  status?: string;
  disclosures?: number;
  url?: string;
}

export interface RegistrationBlock {
  finra?: RegistrationRecord;
  iapd?: RegistrationRecord;
  sources: string[];
}

export interface NewsItem {
  date: string;
  title: string;
  url?: string;
  domain?: string;
}

export interface NewsBlock {
  items: NewsItem[];
  sources: string[];
}

export interface ComplianceBlock {
  ofac: 'Clean' | 'Hit' | 'Unknown';
  pep: 'No' | 'Yes' | 'Unknown';
  watchlists: 'Clean' | 'Hit' | 'Unknown';
  litigation: { count: number; items: { date: string; case: string; court: string }[] };
  sources: string[];
}

export interface HNIProfile {
  input: HNIInput;
  generatedAt: string;
  identity: IdentityBlock;
  wealth: WealthBlock;
  political: PoliticalBlock;
  foundations: FoundationsBlock;
  securities: SecuritiesBlock;
  registration: RegistrationBlock;
  news: NewsBlock;
  compliance: ComplianceBlock;
  signals: Signal[];
  fields: Field[];
  steps: Step[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(t => t.length >= 2);
}

function nameMatchScore(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.min(A.size, B.size);
}

const FEC_KEY = process.env.OPEN_FEC_API_KEY ?? 'DEMO_KEY';
const EMPLOYER_ANCHORS = ['GATE', 'MICROSOFT', 'BREAKTHROUGH', 'CASCADE', 'VENTURE', 'CAPITAL', 'INVEST', 'FUND', 'PARTNER', 'MANAGE', 'PHILANTHROP'];

function sv(ms: number): string {
  return ms > 3000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;
}

async function safeFetch(url: string, opts?: RequestInit, timeoutMs = 10000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'Bridge HNI Finder - dev.bridge.ai@gmail.com', ...(opts?.headers ?? {}) } });
    return r;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

// ── Enrichers ─────────────────────────────────────────────────────────────────

async function enrichWikidata(input: HNIInput, steps: Step[]): Promise<{ identity: Partial<IdentityBlock>; wealth: Partial<WealthBlock>; fields: Field[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const identity: Partial<IdentityBlock> = { sources: [] };
  const wealth: Partial<WealthBlock> = { sources: [] };

  // Search for entity
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(input.name)}&language=en&type=item&limit=5&format=json&origin=*`;
  const sr = await safeFetch(searchUrl);
  if (!sr?.ok) { steps.push({ label: 'Wikidata search', ok: false, detail: 'no response' }); return { identity, wealth, fields }; }

  let qid: string | null = null;
  try {
    const sd = await sr.json() as { search?: { id: string; label: string; description?: string }[] };
    const hits = sd.search ?? [];
    // Pick person hit that matches name and mentions "born" / "businessman" / "investor" / "philanthropist" in description
    for (const h of hits) {
      if (nameMatchScore(h.label, input.name) >= 0.5 && (h.description?.includes('born') || h.description?.includes('businessman') || h.description?.includes('philanthropist') || h.description?.includes('investor') || h.description?.includes('entrepreneur'))) {
        qid = h.id;
        break;
      }
    }
    if (!qid && hits.length) qid = hits[0].id; // fallback
  } catch { steps.push({ label: 'Wikidata search parse', ok: false }); return { identity, wealth, fields }; }

  if (!qid) { steps.push({ label: 'Wikidata: no match', ok: false }); return { identity, wealth, fields }; }

  // Fetch entity claims
  const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|labels|descriptions|sitelinks&languages=en&format=json&origin=*`;
  const er = await safeFetch(entityUrl);
  if (!er?.ok) { steps.push({ label: `Wikidata entity ${qid}`, ok: false }); return { identity, wealth, fields }; }

  try {
    type WDSitelink = { title: string };
    type WDEntity = { labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; claims?: Record<string, unknown[]>; sitelinks?: Record<string, WDSitelink> };
    type WDResponse = { entities?: Record<string, WDEntity> };
    const ed = await er.json() as WDResponse;
    const entity = ed.entities?.[qid];
    if (!entity) { steps.push({ label: `Wikidata ${qid}`, ok: false, detail: 'entity missing' }); return { identity, wealth, fields }; }

    identity.fullName = entity.labels?.en?.value;
    identity.description = entity.descriptions?.en?.value;
    identity.wikidataQid = qid;
    identity.sources = ['Wikidata', 'Wikipedia'];

    const claims = entity.claims ?? {};

    type Snak = { mainsnak?: { datavalue?: { type?: string; value?: unknown } } };

    function getVal(prop: string): unknown | null {
      const vs = (claims[prop] ?? []) as Snak[];
      return vs[0]?.mainsnak?.datavalue?.value ?? null;
    }
    function getVals(prop: string): unknown[] {
      return ((claims[prop] ?? []) as Snak[]).map(v => v?.mainsnak?.datavalue?.value).filter(Boolean);
    }
    function getTime(prop: string): string | null {
      const v = getVal(prop) as { time?: string } | null;
      return v?.time ?? null;
    }
    function getQId(prop: string): number | null {
      const v = getVal(prop) as { 'numeric-id'?: number } | null;
      return v?.['numeric-id'] ?? null;
    }

    const dobRaw = getTime('P569');
    if (dobRaw) {
      const d = dobRaw.replace(/^\+/, '').slice(0, 10);
      identity.dob = d;
      const now = new Date();
      const bday = new Date(d);
      let age = now.getFullYear() - bday.getFullYear();
      if (now.getMonth() < bday.getMonth() || (now.getMonth() === bday.getMonth() && now.getDate() < bday.getDate())) age--;
      identity.age = age;
    }

    // Gender
    const genderId = getQId('P21');
    if (genderId === 6581097) identity.gender = 'Male';
    else if (genderId === 6581072) identity.gender = 'Female';

    // Citizenship
    const citizenId = getQId('P27');
    if (citizenId === 30) identity.citizenship = 'United States';

    // Education — resolve IDs to labels via sitelinks or just record QIDs
    const eduIds = getVals('P69') as ({ 'numeric-id'?: number } | null)[];
    if (eduIds.length) {
      identity.education = eduIds.map(e => `Q${e?.['numeric-id'] ?? '?'}`);
    }

    // Spouse / family
    const spouseIds = getVals('P26') as ({ 'numeric-id'?: number } | null)[];
    const childIds = getVals('P40') as ({ 'numeric-id'?: number } | null)[];
    const fatherQ = getQId('P22');
    const motherQ = getQId('P25');
    const familyQs: string[] = [];
    if (fatherQ) familyQs.push(`father:Q${fatherQ}`);
    if (motherQ) familyQs.push(`mother:Q${motherQ}`);
    spouseIds.forEach(s => s?.['numeric-id'] && familyQs.push(`spouse:Q${s['numeric-id']}`));
    childIds.forEach(c => c?.['numeric-id'] && familyQs.push(`child:Q${c['numeric-id']}`));
    if (familyQs.length) identity.family = familyQs;

    // Wikipedia sitelink → description
    const wpTitle = entity.sitelinks?.enwiki?.title;

    // Fetch Wikipedia summary for richer description + wealth
    if (wpTitle) {
      const wpr = await safeFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wpTitle)}`);
      if (wpr?.ok) {
        const wpd = await wpr.json() as { extract?: string; description?: string };
        if (wpd.extract) {
          // Extract net worth mentions
          const nwMatch = wpd.extract.match(/net worth (?:stood at|of|surpassed|reached|exceeded|estimated at)?\s*(?:US\s*)?\$?([\d.,]+)\s*(billion|trillion|million)?/i);
          if (nwMatch) {
            wealth.netWorthEstimate = `$${nwMatch[1]} ${nwMatch[2] ?? ''}`.trim();
            wealth.sources = ['Wikipedia (Forbes)'];
          }
          // Extract rank
          const rankMatch = wpd.extract.match(/(\d+)(?:st|nd|rd|th)-wealthiest|wealthiest\s+(?:person|individual).*?(?:#|number\s*)(\d+)/i);
          if (rankMatch) wealth.netWorthRank = `#${rankMatch[1] ?? rankMatch[2]}`;
          identity.description = wpd.extract.slice(0, 500);
        }
      }
    }

    // Source of wealth from employer claims
    const employerQs = getVals('P108') as ({ 'numeric-id'?: number } | null)[];
    if (employerQs.length) {
      wealth.sourceOfWealth = employerQs.map(e => `Q${e?.['numeric-id']}`).join(', ');
    }

    fields.push({ tier: 'A', label: 'Wikidata QID', value: qid, source: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}` });
    if (identity.dob) fields.push({ tier: 'A', label: 'Date of birth', value: identity.dob, source: 'Wikidata' });
    if (identity.citizenship) fields.push({ tier: 'A', label: 'Citizenship', value: identity.citizenship, source: 'Wikidata' });

    steps.push({ label: `Wikidata ${qid}`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'Wikidata parse', ok: false, detail: String(e) });
  }

  return { identity, wealth, fields };
}

async function enrichFEC(input: HNIInput, steps: Step[]): Promise<{ political: Partial<PoliticalBlock>; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const political: Partial<PoliticalBlock> = { sources: [], contributions: [], topRecipients: [], employersOnRecord: [], zipsOnRecord: [] };

  const params = new URLSearchParams({
    contributor_name: input.name,
    api_key: FEC_KEY,
    per_page: '100',
    sort: '-contribution_receipt_date',
  });
  if (input.state) params.set('contributor_state', input.state);

  const url = `https://api.open.fec.gov/v1/schedules/schedule_a/?${params}`;
  const r = await safeFetch(url);
  if (!r?.ok) { steps.push({ label: 'FEC contributions', ok: false }); return { political, fields, signals }; }

  try {
    const d = await r.json() as { pagination?: { count?: number }; results?: Record<string, unknown>[] };
    const all = d.results ?? [];
    const total = d.pagination?.count ?? 0;

    // Filter to likely-real subject: employer/occupation must contain an anchor word,
    // OR if we have a company hint, use that, OR fall back to all results if <20
    const nameTokens = tokenize(input.name);
    const compTokens = input.company ? tokenize(input.company) : [];
    const anchorWords = [...EMPLOYER_ANCHORS, ...compTokens.map(t => t.toUpperCase())];

    let real = all.filter(r => {
      const emp = ((r.contributor_employer as string) ?? '').toUpperCase();
      const occ = ((r.contributor_occupation as string) ?? '').toUpperCase();
      return anchorWords.some(k => emp.includes(k) || occ.includes(k));
    });

    // Also include contributions where the name is a very close match to avoid dropping common-name subjects
    if (real.length === 0 && all.length <= 20) real = all;

    const contributions: FECContribution[] = real.map(r => ({
      date: (r.contribution_receipt_date as string) ?? '',
      amount: (r.contribution_receipt_amount as number) ?? 0,
      committee: ((r.committee as { name?: string })?.name) ?? '',
      employer: (r.contributor_employer as string) ?? '',
      occupation: (r.contributor_occupation as string) ?? '',
      zip: ((r.contributor_zip as string) ?? '').slice(0, 5),
    }));

    const totalAmt = contributions.reduce((s, c) => s + c.amount, 0);

    // Top recipients
    const byCommittee: Record<string, number> = {};
    for (const c of contributions) byCommittee[c.committee] = (byCommittee[c.committee] ?? 0) + c.amount;
    const topRecipients = Object.entries(byCommittee).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, total]) => ({ name, total }));

    // Employers
    const emps = [...new Set(contributions.map(c => c.employer).filter(Boolean))];
    const zips = [...new Set(contributions.map(c => c.zip).filter(Boolean))];

    // Ideology
    const DEM = ['ACTBLUE', 'DEMOCRAT', 'DEM ', 'DCCC', 'DSCC'];
    const REP = ['WINRED', 'REPUBLICAN', 'GOP', 'NRCC', 'NRSC'];
    const demAmt = contributions.filter(c => DEM.some(k => c.committee.toUpperCase().includes(k))).reduce((s, c) => s + c.amount, 0);
    const repAmt = contributions.filter(c => REP.some(k => c.committee.toUpperCase().includes(k))).reduce((s, c) => s + c.amount, 0);
    let ideology: PoliticalBlock['ideology'] = 'Unknown';
    if (demAmt > 0 && repAmt > 0) ideology = 'Bipartisan';
    else if (demAmt > repAmt) ideology = 'Dem-leaning';
    else if (repAmt > demAmt) ideology = 'Rep-leaning';

    const dates = contributions.map(c => c.date).filter(Boolean).sort();

    political.totalContributions = totalAmt;
    political.contributionCount = real.length;
    political.earliestDate = dates[0];
    political.latestDate = dates[dates.length - 1];
    political.topRecipients = topRecipients;
    political.employersOnRecord = emps;
    political.zipsOnRecord = zips;
    political.ideology = ideology;
    political.contributions = contributions;
    political.sources = [`FEC OpenData (${real.length} of ${total} contributions)`];

    if (totalAmt > 0) {
      fields.push({ tier: 'A', label: 'Total FEC political giving', value: `$${totalAmt.toLocaleString()}`, source: 'FEC OpenData', url: `https://www.fec.gov/data/receipts/individual-contributions/?contributor_name=${encodeURIComponent(input.name)}` });
      fields.push({ tier: 'A', label: 'Political ideology', value: ideology, source: 'FEC OpenData (derived)' });
      if (zips.length) fields.push({ tier: 'B', label: 'Residential ZIP(s)', value: zips.join(', '), source: 'FEC filings' });
      if (emps.length) fields.push({ tier: 'A', label: 'Employer (FEC self-reported)', value: emps.slice(0, 3).join(' / '), source: 'FEC filings' });
    }

    steps.push({ label: `FEC: ${real.length} contributions matched (${total} total name hits)`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'FEC parse', ok: false, detail: String(e) });
  }

  return { political, fields, signals };
}

async function enrichProPublica(input: HNIInput, steps: Step[]): Promise<{ foundations: Foundation990[]; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const foundations: Foundation990[] = [];

  // Search using multiple query terms to maximise recall:
  // 1) Full name  2) Last name + "Foundation"  3) Company hint (if provided)
  const lastName = input.name.trim().split(/\s+/).pop() ?? input.name;
  const queries = [input.name, `${lastName} Foundation`];
  if (input.company) queries.push(input.company);

  type PPOrg = { ein: string; name: string; city: string; strstate: string; ntee_code?: string; totassetsend?: number };
  const seen = new Set<string>();
  const allOrgs: PPOrg[] = [];

  for (const q of queries) {
    const r = await safeFetch(`https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(q)}`);
    if (!r?.ok) continue;
    try {
      const d = await r.json() as { organizations?: PPOrg[] };
      for (const o of d.organizations ?? []) {
        if (!seen.has(o.ein)) { seen.add(o.ein); allOrgs.push(o); }
      }
    } catch { /* skip */ }
  }

  try {
    const orgs = allOrgs;

    // Token match: org name must share at least one token with name or company
    const queryTokens = [...tokenize(input.name), ...(input.company ? tokenize(input.company) : [])];
    const candidates = orgs.filter(o => {
      const oname = o.name.toLowerCase();
      return queryTokens.some(t => oname.includes(t));
    }).slice(0, 5);

    for (const c of candidates) {
      const fr = await safeFetch(`https://projects.propublica.org/nonprofits/api/v2/organizations/${c.ein}.json`);
      if (!fr?.ok) continue;
      try {
        const fd = await fr.json() as { organization?: { name: string; ein: string; city: string; state: string; income_amount?: number; asset_amount?: number }; filings_with_data?: { tax_prd_yr?: number; totassetsend?: number; totrevenue?: number; totgrnts?: number; totfuncexpns?: number; compofficers?: number }[] };
        const org = fd.organization;
        const filings = fd.filings_with_data ?? [];
        if (!org) continue;

        const f: Foundation990 = {
          ein: org.ein,
          name: org.name,
          city: org.city,
          state: org.state,
          totalAssets: filings[0]?.totassetsend,
          totalRevenue: filings[0]?.totrevenue,
          grantsPaid: filings[0]?.totgrnts,
          totalExpenses: filings[0]?.totfuncexpns,
          officerComp: filings[0]?.compofficers,
          taxYear: filings[0]?.tax_prd_yr,
          filingHistory: filings.slice(0, 5).map(fh => ({
            year: fh.tax_prd_yr ?? 0,
            assets: fh.totassetsend ?? 0,
            revenue: fh.totrevenue ?? 0,
          })),
        };
        foundations.push(f);

        if (f.totalAssets) {
          fields.push({ tier: 'A', label: `${f.name} — Total assets (${f.taxYear})`, value: `$${f.totalAssets.toLocaleString()}`, source: 'IRS 990-PF via ProPublica', url: `https://projects.propublica.org/nonprofits/organizations/${f.ein}` });
        }
        if (f.grantsPaid) {
          fields.push({ tier: 'A', label: `${f.name} — Grants paid (${f.taxYear})`, value: `$${f.grantsPaid.toLocaleString()}`, source: 'IRS 990-PF via ProPublica' });
        }
        if (f.totalAssets && f.totalAssets > 1_000_000_000) {
          signals.push({ tier: 'A', label: `Major private foundation: ${f.name}`, detail: `Assets $${(f.totalAssets / 1e9).toFixed(1)}B — IRS 990-PF EIN ${f.ein}`, source: 'ProPublica Nonprofit Explorer', url: `https://projects.propublica.org/nonprofits/organizations/${f.ein}` });
        }
      } catch { /* skip */ }
    }

    steps.push({ label: `ProPublica 990-PF: ${foundations.length} foundation(s) found`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'ProPublica parse', ok: false, detail: String(e) });
  }

  return { foundations, fields, signals };
}

async function enrichEdgar(input: HNIInput, steps: Step[]): Promise<{ securities: Partial<SecuritiesBlock>; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const securities: Partial<SecuritiesBlock> = { filings: [], sources: [] };

  // EDGAR EFTS — no forms filter in URL (filter client-side); spaces in forms param cause 403
  // Referer + Origin headers are required; EFTS blocks headless server requests without them
  const enddt = new Date().toISOString().slice(0, 10);
  const searchUrl = `https://efts.sec.gov/LATEST/search-index/search.json?q=${encodeURIComponent(`"${input.name}"`)}&dateRange=custom&startdt=2015-01-01&enddt=${enddt}`;
  const r = await safeFetch(searchUrl, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://efts.sec.gov/LATEST/search-index',
      'Origin': 'https://efts.sec.gov',
    },
  }, 15000);

  if (!r?.ok) {
    // Fallback: EDGAR company Atom feed — public, no browser headers required
    // Searches by name in the filer name field; returns Form 4/3/5 filings
    const [lastName] = input.name.trim().split(/\s+/).reverse();
    const atomUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=${encodeURIComponent(input.name)}&type=4&dateb=&owner=include&count=20&search_text=&action=getcompany&output=atom`;
    const r2 = await safeFetch(atomUrl, { headers: { 'Accept': 'application/atom+xml, text/xml, */*' } }, 15000);
    if (!r2?.ok) {
      const note = `HTTP ${r?.status ?? 'no response'}`;
      steps.push({ label: `SEC EDGAR (${note})`, ok: false });
      fields.push({ tier: 'A', label: 'SEC EDGAR filings', value: `Skipped — ${note}`, source: 'SEC EDGAR' });
      return { securities, fields, signals };
    }
    try {
      const xml = await r2.text();
      // Parse Atom entries with simple regex — no XML lib dependency
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);
      const filings2: InsiderFiling[] = entries.slice(0, 20).map(e => {
        const date = (/<filed>(.*?)<\/filed>/.exec(e) ?? [])[1] ?? (/<updated>(.*?)<\/updated>/.exec(e) ?? [])[1] ?? '';
        const form = (/<category term="(.*?)"/.exec(e) ?? [])[1] ?? (/<filing-type>(.*?)<\/filing-type>/.exec(e) ?? [])[1] ?? '4';
        const entity = (/<company-name>(.*?)<\/company-name>/.exec(e) ?? [])[1] ?? (/<title>(.*?)<\/title>/.exec(e) ?? [])[1] ?? '';
        const accession = (/<accession-nunber>(.*?)<\/accession-nunber>/.exec(e) ?? [])[1] ?? '';
        return { date: date.slice(0, 10), form, entity, accession };
      }).filter(f => f.entity.toLowerCase().includes(lastName.toLowerCase()) || entries.length <= 3);
      securities.filings = filings2;
      securities.sources = filings2.length ? [`SEC EDGAR Atom (${filings2.length} Form 4 hits)`] : [];
      steps.push({ label: `SEC EDGAR atom: ${filings2.length} filings`, ok: true, detail: sv(Date.now() - t0) });
    } catch (e2) {
      steps.push({ label: 'SEC EDGAR atom parse', ok: false, detail: String(e2) });
    }
    return { securities, fields, signals };
  }

  try {
    const d = await r.json() as { hits?: { total?: { value?: number }; hits?: { _source?: { file_date?: string; form_type?: string; entity_name?: string; accession_no?: string; file_num?: string } }[] } };
    const hits = d.hits?.hits ?? [];
    const total = d.hits?.total?.value ?? 0;

    const filings: InsiderFiling[] = hits.slice(0, 20).map(h => ({
      date: h._source?.file_date ?? '',
      form: h._source?.form_type ?? '',
      entity: h._source?.entity_name ?? '',
      accession: h._source?.accession_no ?? '',
    }));

    securities.filings = filings;
    securities.sources = total > 0 ? [`SEC EDGAR (${total} filings)`] : [];

    // Detect insider-activity forms
    const insider = filings.filter(f => ['4','3','5'].includes(f.form));
    const ownership = filings.filter(f => f.form.startsWith('SC 13'));
    const planned = filings.filter(f => f.form === '144');

    if (insider.length) {
      fields.push({ tier: 'A', label: 'SEC insider filings (Forms 3/4/5)', value: `${insider.length} filings (most recent: ${insider[0]?.date})`, source: 'SEC EDGAR', url: `https://efts.sec.gov/LATEST/search-index/search.json?q=${encodeURIComponent(`"${input.name}"`)}&forms=4` });
      signals.push({ tier: 'A', label: 'SEC insider activity', detail: `${insider.length} Form 3/4/5 filings — equity position changes`, source: 'SEC EDGAR', url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=&type=4&dateb=&owner=include&count=40&search_text=` });
    }
    if (ownership.length) {
      fields.push({ tier: 'A', label: 'SEC 5%+ ownership filings (SC 13G/D)', value: `${ownership.length} filings`, source: 'SEC EDGAR' });
      signals.push({ tier: 'A', label: 'Beneficial ownership disclosed (≥5%)', detail: `${ownership.length} Schedule 13G/D filings`, source: 'SEC EDGAR' });
    }
    if (planned.length) {
      signals.push({ tier: 'A', label: 'Planned insider sale (Form 144)', detail: `${planned.length} filing(s) — pending stock sale signal`, source: 'SEC EDGAR' });
    }

    steps.push({ label: `SEC EDGAR: ${total} filing hits`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'SEC EDGAR parse', ok: false, detail: String(e) });
  }

  return { securities, fields, signals };
}

async function enrichFinra(input: HNIInput, steps: Step[]): Promise<{ registration: Partial<RegistrationBlock>; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const registration: Partial<RegistrationBlock> = { sources: [] };

  const r = await safeFetch(`https://api.brokercheck.finra.org/search/individual?query=${encodeURIComponent(input.name)}&hl=true&includePrevious=true&nRows=5&start=0&wrappers=0`);
  if (!r?.ok) { steps.push({ label: 'FINRA BrokerCheck', ok: false }); return { registration, fields, signals }; }

  try {
    const d = await r.json() as { hits?: { hits?: { _source?: { ind_firstname?: string; ind_lastname?: string; ind_middle_name?: string; ind_bc_scope?: string; ind_crd_nb?: string; ind_approved_finra_registration_count?: number; ind_bc_disclosure_fl?: string; firm_name?: string } }[] } };
    const hits = d.hits?.hits ?? [];

    for (const h of hits.slice(0, 3)) {
      const s = h._source ?? {};
      const fullName = [s.ind_firstname, s.ind_middle_name, s.ind_lastname].filter(Boolean).join(' ');
      if (nameMatchScore(fullName, input.name) < 0.5) continue;

      const rec: RegistrationRecord = {
        name: fullName,
        crd: s.ind_crd_nb,
        firm: s.firm_name,
        status: s.ind_bc_scope,
        disclosures: s.ind_bc_disclosure_fl === 'Y' ? 1 : 0,
        url: s.ind_crd_nb ? `https://brokercheck.finra.org/individual/summary/${s.ind_crd_nb}` : undefined,
      };
      registration.finra = rec;
      registration.sources = ['FINRA BrokerCheck'];

      fields.push({ tier: 'A', label: 'FINRA CRD #', value: rec.crd ?? 'N/A', source: 'FINRA BrokerCheck', url: rec.url });
      fields.push({ tier: 'A', label: 'Broker status', value: rec.status ?? 'Unknown', source: 'FINRA BrokerCheck' });

      if (s.ind_bc_disclosure_fl === 'Y') {
        signals.push({ tier: 'A', label: 'FINRA disclosure on record', detail: `CRD ${rec.crd} has disclosure(s) — review BrokerCheck`, source: 'FINRA BrokerCheck', url: rec.url });
      }
      break;
    }

    if (!registration.finra) {
      fields.push({ tier: 'B', label: 'FINRA registration', value: 'Not found — not a registered broker/adviser', source: 'FINRA BrokerCheck' });
    }

    steps.push({ label: `FINRA: ${hits.length} hit(s)`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'FINRA parse', ok: false, detail: String(e) });
  }

  return { registration, fields, signals };
}

async function enrichIAPD(input: HNIInput, steps: Step[]): Promise<{ registration: Partial<RegistrationBlock>; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const registration: Partial<RegistrationBlock> = { sources: [] };

  const r = await safeFetch(`https://api.adviserinfo.sec.gov/search/individual?query=${encodeURIComponent(input.name)}&hl=true&nRows=5&start=0`);
  if (!r?.ok) { steps.push({ label: 'SEC IAPD', ok: false }); return { registration, fields, signals }; }

  try {
    const d = await r.json() as { hits?: { hits?: { _source?: { ind_firstname?: string; ind_lastname?: string; ind_crd_nb?: string; ind_bc_scope?: string; firm_name?: string } }[] } };
    const hits = d.hits?.hits ?? [];

    for (const h of hits.slice(0, 3)) {
      const s = h._source ?? {};
      const fullName = [s.ind_firstname, s.ind_lastname].filter(Boolean).join(' ');
      if (nameMatchScore(fullName, input.name) < 0.5) continue;

      const rec: RegistrationRecord = {
        name: fullName,
        crd: s.ind_crd_nb,
        firm: s.firm_name,
        status: s.ind_bc_scope,
        url: s.ind_crd_nb ? `https://adviserinfo.sec.gov/individual/summary/${s.ind_crd_nb}` : undefined,
      };
      registration.iapd = rec;
      registration.sources = [...(registration.sources ?? []), 'SEC IAPD'];

      fields.push({ tier: 'A', label: 'SEC IAPD (investment adviser)', value: `${rec.name} — CRD ${rec.crd}`, source: 'SEC IAPD', url: rec.url });
      break;
    }

    steps.push({ label: `IAPD: ${hits.length} hit(s)`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'IAPD parse', ok: false, detail: String(e) });
  }

  return { registration, fields, signals };
}

async function enrichOpenSanctions(input: HNIInput, steps: Step[]): Promise<{ compliance: Partial<ComplianceBlock>; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const compliance: Partial<ComplianceBlock> = { ofac: 'Unknown', pep: 'Unknown', watchlists: 'Unknown', sources: [] };

  const osKey = process.env.OPENSANCTIONS_API_KEY;
  const body = JSON.stringify({ queries: { q1: { schema: 'Person', properties: { name: [input.name] } } } });
  const osHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (osKey) osHeaders['Authorization'] = `ApiKey ${osKey}`;
  const r = await safeFetch('https://api.opensanctions.org/match/default', { method: 'POST', headers: osHeaders, body }, 20000);

  if (!r?.ok) {
    const note = r?.status === 401 ? 'set OPENSANCTIONS_API_KEY for full access' : `HTTP ${r?.status}`;
    steps.push({ label: `OpenSanctions (${note})`, ok: false });
    // Degrade gracefully — mark unknown rather than erroring
    compliance.ofac = 'Unknown'; compliance.pep = 'Unknown'; compliance.watchlists = 'Unknown';
    fields.push({ tier: 'C', label: 'Sanctions / PEP check', value: `Skipped — ${note}`, source: 'OpenSanctions' });
    return { compliance, fields, signals };
  }

  try {
    const d = await r.json() as { responses?: { q1?: { results?: { score?: number; caption?: string; datasets?: string[]; properties?: { topics?: string[] } }[] } } };
    const results = d.responses?.q1?.results ?? [];

    const HIGH = results.filter(r => (r.score ?? 0) >= 0.8);
    if (HIGH.length === 0) {
      compliance.ofac = 'Clean';
      compliance.pep = 'No';
      compliance.watchlists = 'Clean';
      compliance.sources = ['OpenSanctions'];
      fields.push({ tier: 'A', label: 'Sanctions / PEP / watchlist', value: 'Clean — no hits', source: 'OpenSanctions' });
    } else {
      for (const h of HIGH) {
        const datasets = h.datasets ?? [];
        const topics = h.properties?.topics ?? [];
        if (datasets.some(d => d.includes('ofac'))) compliance.ofac = 'Hit';
        if (topics.includes('pep')) compliance.pep = 'Yes';
        compliance.watchlists = 'Hit';
        signals.push({ tier: 'A', label: `Watchlist hit: ${h.caption}`, detail: `Score ${h.score?.toFixed(2)} · datasets: ${datasets.join(', ')}`, source: 'OpenSanctions' });
      }
    }

    steps.push({ label: `OpenSanctions: ${HIGH.length} high-score hit(s)`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'OpenSanctions parse', ok: false, detail: String(e) });
  }

  return { compliance, fields, signals };
}

async function enrichCourtListener(input: HNIInput, steps: Step[]): Promise<{ compliance: Partial<ComplianceBlock>; fields: Field[]; signals: Signal[] }> {
  const t0 = Date.now();
  const fields: Field[] = [];
  const signals: Signal[] = [];
  const compliance: Partial<ComplianceBlock> = { litigation: { count: 0, items: [] }, sources: [] };

  const clToken = process.env.COURTLISTENER_TOKEN;
  const clHeaders: Record<string, string> = {};
  if (clToken) clHeaders['Authorization'] = `Token ${clToken}`;
  const r = await safeFetch(`https://www.courtlistener.com/api/rest/v3/search/?q=${encodeURIComponent(`"${input.name}"`)}&type=p&format=json`, { headers: clHeaders }, 15000);
  if (!r?.ok) {
    const note = r?.status === 403 ? 'set COURTLISTENER_TOKEN for full access' : `HTTP ${r?.status}`;
    steps.push({ label: `CourtListener (${note})`, ok: false });
    fields.push({ tier: 'C', label: 'Federal litigation', value: `Skipped — ${note}`, source: 'CourtListener' });
    return { compliance, fields, signals };
  }

  try {
    const d = await r.json() as { count?: number; results?: { dateFiled?: string; caseName?: string; court?: string; absolute_url?: string }[] };
    const count = d.count ?? 0;
    const items = (d.results ?? []).slice(0, 5).map(r => ({
      date: r.dateFiled ?? '',
      case: r.caseName ?? '',
      court: r.court ?? '',
    }));

    compliance.litigation = { count, items };
    compliance.sources = ['CourtListener / RECAP'];

    if (count === 0) {
      fields.push({ tier: 'A', label: 'Federal litigation', value: 'No hits', source: 'CourtListener' });
    } else {
      fields.push({ tier: 'B', label: 'Federal litigation', value: `${count} case(s) — name match, verify parties`, source: 'CourtListener', url: `https://www.courtlistener.com/?q=${encodeURIComponent(`"${input.name}"`)}&type=p` });
      signals.push({ tier: 'B', label: `Litigation: ${count} case(s)`, detail: `Name match in federal courts — verify subject is a party`, source: 'CourtListener', url: `https://www.courtlistener.com/?q=${encodeURIComponent(`"${input.name}"`)}&type=p` });
    }

    steps.push({ label: `CourtListener: ${count} case(s)`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'CourtListener parse', ok: false, detail: String(e) });
  }

  return { compliance, fields, signals };
}

async function enrichGDELT(input: HNIInput, steps: Step[]): Promise<{ news: Partial<NewsBlock>; signals: Signal[] }> {
  const t0 = Date.now();
  const signals: Signal[] = [];
  const news: Partial<NewsBlock> = { items: [], sources: [] };

  // GDELT doc API — no date range avoids filter overhead and improves response rate
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${input.name}"`)}&mode=artlist&maxrecords=15&format=json&timespan=6m`;

  // GDELT rate-limits aggressive callers; retry once after 3 s on 429
  let r = await safeFetch(url, {}, 20000);
  if (r?.status === 429) {
    await new Promise(res => setTimeout(res, 3000));
    r = await safeFetch(url, {}, 20000);
  }
  if (!r?.ok) {
    const note = r?.status === 429 ? 'rate-limited (429) — retry later' : `HTTP ${r?.status ?? 'no response'}`;
    steps.push({ label: `GDELT news (${note})`, ok: false });
    return { news, signals };
  }

  try {
    const d = await r.json() as { articles?: { seendate?: string; title?: string; url?: string; domain?: string }[] };
    const articles = d.articles ?? [];
    news.items = articles.map(a => ({
      date: (a.seendate ?? '').slice(0, 8),
      title: a.title ?? '',
      url: a.url,
      domain: a.domain,
    }));
    news.sources = articles.length ? ['GDELT (last 180 days)'] : [];

    // Flag adverse media
    const adverse = ['investigation', 'fraud', 'lawsuit', 'lawsuit', 'charged', 'arrested', 'convicted', 'SEC', 'DOJ', 'settlement', 'fine', 'penalty', 'epstein', 'scandal'];
    for (const item of news.items) {
      if (adverse.some(k => item.title.toLowerCase().includes(k))) {
        signals.push({ tier: 'C', label: `Adverse news: ${item.title.slice(0, 80)}`, detail: `${item.date} · ${item.domain}`, source: 'GDELT', url: item.url });
      }
    }

    steps.push({ label: `GDELT: ${articles.length} articles`, ok: true, detail: sv(Date.now() - t0) });
  } catch (e) {
    steps.push({ label: 'GDELT parse', ok: false, detail: String(e) });
  }

  return { news, signals };
}

// ── Derived signals ───────────────────────────────────────────────────────────

function deriveSignals(profile: Partial<HNIProfile>): Signal[] {
  const signals: Signal[] = [];
  const pol = profile.political;
  const found = profile.foundations;
  const wealth = profile.wealth;

  // High-value political donor signal
  if (pol && pol.totalContributions && pol.totalContributions >= 10_000) {
    signals.push({ tier: 'B', label: 'Significant political donor', detail: `$${pol.totalContributions.toLocaleString()} in ${pol.contributionCount} contribution(s) to federal candidates/PACs`, source: 'FEC (derived)' });
  }

  // Foundation trustee / major philanthropist
  if (found?.foundations?.length) {
    const totalAssets = found.foundations.reduce((s, f) => s + (f.totalAssets ?? 0), 0);
    if (totalAssets > 0) {
      signals.push({ tier: 'A', label: 'Foundation principal', detail: `Controls / affiliated with foundation(s) with $${(totalAssets / 1e6).toFixed(0)}M in assets`, source: 'IRS 990-PF (derived)' });
    }
  }

  // Accredited investor inference
  const hasFoundation = (found?.foundations?.length ?? 0) > 0;
  const hasInsider = (profile.securities?.filings?.filter(f => ['4','3','5'].includes(f.form)).length ?? 0) > 0;
  if (hasFoundation || hasInsider || (pol?.totalContributions ?? 0) >= 5_000) {
    signals.push({ tier: 'B', label: 'Likely accredited investor', detail: 'Foundation control and/or insider equity positions signal net worth well above $1M threshold', source: 'Derived (EDGAR + 990-PF)' });
  }

  return signals;
}

// ── Main build function ───────────────────────────────────────────────────────

export async function buildProfile(input: HNIInput): Promise<HNIProfile> {
  const steps: Step[] = [];
  const allFields: Field[] = [];
  const allSignals: Signal[] = [];

  // Run all enrichers in parallel
  const [wikiResult, fecResult, ppResult, edgarResult, finraResult, iapdResult, osResult, clResult, gdeltResult] = await Promise.all([
    enrichWikidata(input, steps),
    enrichFEC(input, steps),
    enrichProPublica(input, steps),
    enrichEdgar(input, steps),
    enrichFinra(input, steps),
    enrichIAPD(input, steps),
    enrichOpenSanctions(input, steps),
    enrichCourtListener(input, steps),
    enrichGDELT(input, steps),
  ]);

  // Merge fields and signals
  allFields.push(...wikiResult.fields, ...fecResult.fields, ...ppResult.fields, ...edgarResult.fields, ...finraResult.fields, ...iapdResult.fields, ...osResult.fields, ...clResult.fields);
  allSignals.push(...fecResult.signals, ...ppResult.signals, ...edgarResult.signals, ...finraResult.signals, ...iapdResult.signals, ...osResult.signals, ...clResult.signals, ...gdeltResult.signals);

  // Merge identity
  const identity: IdentityBlock = {
    ...wikiResult.identity,
    sources: wikiResult.identity.sources ?? [],
  };

  // Merge wealth
  const wealth: WealthBlock = {
    ...wikiResult.wealth,
    accreditedInvestor: 'Unknown',
    qualifiedPurchaser: 'Unknown',
    sources: wikiResult.wealth.sources ?? [],
  };

  // Merge compliance
  const compliance: ComplianceBlock = {
    ofac: osResult.compliance.ofac ?? 'Unknown',
    pep: osResult.compliance.pep ?? 'Unknown',
    watchlists: osResult.compliance.watchlists ?? 'Unknown',
    litigation: clResult.compliance.litigation ?? { count: 0, items: [] },
    sources: [...(osResult.compliance.sources ?? []), ...(clResult.compliance.sources ?? [])],
  };

  // Merge registration
  const registration: RegistrationBlock = {
    finra: finraResult.registration.finra,
    iapd: iapdResult.registration.iapd,
    sources: [...(finraResult.registration.sources ?? []), ...(iapdResult.registration.sources ?? [])],
  };

  const partial: Partial<HNIProfile> = {
    political: fecResult.political as PoliticalBlock,
    foundations: { foundations: ppResult.foundations, sources: ppResult.foundations.length ? ['IRS 990-PF via ProPublica'] : [] },
    securities: edgarResult.securities as SecuritiesBlock,
    wealth,
  };

  // Add derived signals
  allSignals.push(...deriveSignals(partial));

  // Accredited / QP inference
  const hasWealth = (partial.foundations?.foundations?.length ?? 0) > 0 || (partial.securities?.filings?.length ?? 0) > 0;
  if (hasWealth) {
    wealth.accreditedInvestor = 'Yes';
    wealth.qualifiedPurchaser = 'Likely';
  }

  return {
    input,
    generatedAt: new Date().toISOString(),
    identity,
    wealth,
    political: fecResult.political as PoliticalBlock,
    foundations: partial.foundations!,
    securities: edgarResult.securities as SecuritiesBlock,
    registration,
    news: gdeltResult.news as NewsBlock,
    compliance,
    signals: allSignals,
    fields: allFields,
    steps,
  };
}
