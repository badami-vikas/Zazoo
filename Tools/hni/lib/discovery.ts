// Discovery: browse HNI donors by state or by cause
// Sources: FEC OpenData (state) · ProPublica 990-PF (cause)

const FEC_KEY = process.env.OPEN_FEC_API_KEY ?? 'DEMO_KEY';

async function safeFetch(url: string, timeoutMs = 12000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Bridge HNI Finder - dev.bridge.ai@gmail.com' },
    });
  } catch { return null; } finally { clearTimeout(id); }
}

// ── Cause tagging ─────────────────────────────────────────────────────────────

const CAUSE_MAP: [RegExp, string][] = [
  [/education|school|college|universit|teach|learn|scholarship|stem/i, 'Education'],
  [/environment|climate|green|sierra|conservation|clean energy|carbon|nature/i, 'Environment'],
  [/health|medical|cancer|hospital|disease|patient|pharma|nurse/i, 'Health Care'],
  [/civil rights|aclu|justice|equality|liberty|voting|rights/i, 'Civil Rights'],
  [/technolog|innovation|science|digital|cyber|\bai\b|research/i, 'Science & Tech'],
  [/housing|homeless|shelter|affordable/i, 'Housing'],
  [/poverty|hunger|food|nutrition|meal|soup|relief/i, 'Food & Poverty'],
  [/veteran|military|defense|national security|armed forces/i, 'Veterans'],
  [/arts|culture|museum|theater|theatre|music|film|creative|humanit/i, 'Arts & Culture'],
  [/religion|faith|church|christian|jewish|muslim|synagogue/i, 'Religion'],
  [/actblue|democrat|dnc|dscc|dccc|progressive|liberal/i, 'Democratic causes'],
  [/winred|republican|rnc|nrsc|nrcc|conservative|gop/i, 'Republican causes'],
  [/international|global|africa|develop|aid|unicef|world bank/i, 'International Aid'],
  [/animal|wildlife|wilderness|humane|pet/i, 'Animal Welfare'],
  [/youth|child|kid|family|parent|mentor/i, 'Youth & Family'],
  [/immigration|immigrant|refugee/i, 'Immigration'],
];

export function tagCauses(recipientNames: string[]): string[] {
  const seen = new Set<string>();
  for (const name of recipientNames) {
    for (const [re, label] of CAUSE_MAP) {
      if (re.test(name) && !seen.has(label)) seen.add(label);
    }
  }
  return [...seen].slice(0, 5);
}

// ── NTEE code map ─────────────────────────────────────────────────────────────

export const NTEE_LABELS: Record<string, string> = {
  A: 'Arts & Culture',
  B: 'Education',
  C: 'Environment',
  D: 'Animal Welfare',
  E: 'Health Care',
  F: 'Mental Health',
  G: 'Medical Research',
  H: 'Medical Research',
  I: 'Crime & Justice',
  J: 'Employment',
  K: 'Food & Agriculture',
  L: 'Housing',
  N: 'Recreation & Sports',
  O: 'Youth Development',
  P: 'Human Services',
  Q: 'International Affairs',
  R: 'Civil Rights',
  S: 'Community Development',
  T: 'Philanthropy',
  U: 'Science & Technology',
  W: 'Public Affairs',
  X: 'Religion',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DonorCard {
  name: string;
  state: string;
  employer: string;
  totalAmount: number;
  contributionCount: number;
  topRecipients: string[];
  causes: string[];
  decades: Record<string, number>;   // '2000s' | '2010s' | '2020s' → total $
}

export interface FoundationCard {
  foundationName: string;
  ein: string;
  state: string;
  city: string;
  assets: number;
  nteeCode: string;
  cause: string;
  principalOfficer: string;
  mission: string;
  decadeAssets: Record<string, number>; // '2000s' | '2010s' | '2020s' → peak assets $
}

// ── FEC state discovery ───────────────────────────────────────────────────────

// Cycles per decade. DEMO_KEY = 40/hr limit so we use 1 per decade (3 total).
// With OPEN_FEC_API_KEY set, use 2 per decade (6 total) for fuller coverage.
function decadeCycles(): Record<string, number[]> {
  const hasKey = (process.env.OPEN_FEC_API_KEY ?? 'DEMO_KEY') !== 'DEMO_KEY';
  return hasKey
    ? { '2000s': [2004, 2008], '2010s': [2012, 2016], '2020s': [2020, 2024] }
    : { '2000s': [2008],       '2010s': [2016],       '2020s': [2024] };
}

function cycleDecade(cycle: number): string {
  if (cycle <= 2008) return '2000s';
  if (cycle <= 2018) return '2010s';
  return '2020s';
}

async function fetchFECCycle(state: string, cycle: number): Promise<{ rows: FECRow[]; decade: string; rateLimited?: boolean }> {
  const url = `https://api.open.fec.gov/v1/schedules/schedule_a/?api_key=${FEC_KEY}` +
    `&contributor_state=${encodeURIComponent(state)}` +
    `&sort=-contribution_receipt_amount&per_page=100` +
    `&two_year_transaction_period=${cycle}&is_individual=true`;
  const r = await safeFetch(url, 20000);
  if (!r?.ok) return { rows: [], decade: cycleDecade(cycle) };
  const d = await r.json() as { results?: FECRow[]; error?: unknown };
  if (d.error) return { rows: [], decade: cycleDecade(cycle), rateLimited: true };
  return { rows: d.results ?? [], decade: cycleDecade(cycle) };
}

type FECRow = {
  contributor_name?: string;
  contributor_employer?: string;
  contribution_receipt_amount?: number;
  committee?: { name?: string };
};

export async function discoverByState(state: string): Promise<DonorCard[]> {
  // Run one decade at a time; within each decade cycles are parallel.
  // 300ms gap keeps DEMO_KEY (40/hr) safe; real key has no bottleneck.
  const cycleResults: { rows: FECRow[]; decade: string; rateLimited?: boolean }[] = [];
  for (const [, cycles] of Object.entries(decadeCycles())) {
    const batch = await Promise.all(cycles.map(c => fetchFECCycle(state, c)));
    cycleResults.push(...batch);
    if (batch.some(b => b.rateLimited)) break; // stop on rate limit
    await new Promise(res => setTimeout(res, 300));
  }

  // Aggregate by contributor name across all cycles
  const map = new Map<string, {
    name: string; employer: string; state: string;
    total: number; count: number;
    recipients: Set<string>;
    decades: Record<string, number>;
  }>();

  for (const { rows, decade } of cycleResults) {
    for (const row of rows) {
      const raw = row.contributor_name?.trim();
      if (!raw || !raw.includes(',')) continue; // skip companies/PACs
      const parts = raw.split(',').map(s => s.trim());
      const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
      const key = name.toLowerCase();
      const amt = row.contribution_receipt_amount ?? 0;
      const recipient = row.committee?.name?.trim() ?? '';
      const existing = map.get(key);
      if (existing) {
        existing.total += amt;
        existing.count++;
        existing.decades[decade] = (existing.decades[decade] ?? 0) + amt;
        if (recipient) existing.recipients.add(recipient);
      } else {
        map.set(key, {
          name,
          employer: row.contributor_employer?.trim() ?? '',
          state,
          total: amt,
          count: 1,
          recipients: new Set(recipient ? [recipient] : []),
          decades: { [decade]: amt },
        });
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)
    .map(p => ({
      name: p.name,
      state: p.state,
      employer: p.employer,
      totalAmount: p.total,
      contributionCount: p.count,
      topRecipients: [...p.recipients].slice(0, 4),
      causes: tagCauses([...p.recipients]),
      decades: p.decades,
    }));
}

// ── ProPublica cause discovery ────────────────────────────────────────────────
// ProPublica's ntee[] filter returns 500 — use keyword search + client-side NTEE filter

// ProPublica search only supports single-word queries; multi-word returns 0
const NTEE_QUERIES: Record<string, string> = {
  A: 'museum',
  B: 'scholarship',
  C: 'conservation',
  D: 'humane',
  E: 'hospital',
  F: 'counseling',
  G: 'research',
  H: 'biomedical',
  I: 'justice',
  J: 'workforce',
  K: 'nutrition',
  L: 'housing',
  N: 'recreation',
  O: 'mentoring',
  P: 'welfare',
  Q: 'international',
  R: 'advocacy',
  S: 'neighborhood',
  T: 'foundation',
  U: 'innovation',
  W: 'civic',
  X: 'ministry',
};

export async function discoverByCause(ntee: string, state?: string): Promise<FoundationCard[]> {
  const query = NTEE_QUERIES[ntee.toUpperCase()] ?? 'foundation';
  const stateParam = state ? `&state%5Borg_state%5D=${encodeURIComponent(state)}` : '';

  // Fetch two pages to have enough to filter down to 20 matching NTEE
  const pages = await Promise.all(
    [0, 1].map(async page => {
      const url = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(query)}${stateParam}&page=${page}`;
      const r = await safeFetch(url, 20000);
      if (!r?.ok) return [];
      type OrgRow = { ein?: string | number; name?: string; city?: string; state?: string; ntee_code?: string };
      const d = await r.json() as { organizations?: OrgRow[] };
      return d.organizations ?? [];
    })
  );

  type OrgRow = { ein?: string | number; name?: string; city?: string; state?: string; ntee_code?: string };
  const allOrgs: OrgRow[] = pages.flat();

  // Client-side filter by NTEE first letter, deduplicate by EIN
  const targetLetter = ntee.toUpperCase().charAt(0);
  const seen = new Set<string>();
  const filtered = allOrgs.filter(o => {
    const nteeLetter = (o.ntee_code ?? '').charAt(0).toUpperCase();
    const key = String(o.ein ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return nteeLetter === targetLetter || nteeLetter === '';
  }).slice(0, 24);

  // Use all if NTEE filtering yields too few results
  const candidates = filtered.length >= 6 ? filtered : allOrgs.filter(o => {
    const key = String(o.ein ?? '');
    return o.ein && !seen.has(key);
  }).slice(0, 24);

  // Fetch details in parallel to get principal_officer + assets + decade history
  // officer + financials live in filings_with_data[], not organization{}
  type Filing = { principal_officer?: string; totassetsend?: number; tax_yr?: number };
  type OrgDetail = { organization?: { mission?: string; ntee_code?: string }; filings_with_data?: Filing[] };
  const details = await Promise.all(
    candidates.map(async org => {
      if (!org.ein) return null;
      const dr = await safeFetch(`https://projects.propublica.org/nonprofits/api/v2/organizations/${org.ein}.json`, 10000);
      if (!dr?.ok) return null;
      return dr.json() as Promise<OrgDetail>;
    })
  );

  return candidates
    .map((org, i): FoundationCard => {
      const detail = details[i];
      const allFilings = detail?.filings_with_data ?? [];
      const filing = allFilings[0];
      const nteeCode = detail?.organization?.ntee_code ?? org.ntee_code ?? ntee;
      const nteeChar = nteeCode.charAt(0).toUpperCase();

      // Peak assets per decade from filing history
      const decadeAssets: Record<string, number> = {};
      for (const f of allFilings) {
        const yr = f.tax_yr ?? 0;
        const dec = yr < 2010 ? '2000s' : yr < 2020 ? '2010s' : '2020s';
        const val = f.totassetsend ?? 0;
        if (val > (decadeAssets[dec] ?? 0)) decadeAssets[dec] = val;
      }

      return {
        foundationName: org.name ?? '',
        ein: String(org.ein ?? ''),
        state: org.state ?? '',
        city: org.city ?? '',
        assets: filing?.totassetsend ?? 0,
        nteeCode,
        cause: NTEE_LABELS[nteeChar] ?? NTEE_LABELS[targetLetter] ?? nteeChar,
        principalOfficer: filing?.principal_officer ?? '',
        mission: detail?.organization?.mission ?? '',
        decadeAssets,
      };
    })
    .filter(f => f.foundationName)
    .sort((a, b) => b.assets - a.assets);
}
