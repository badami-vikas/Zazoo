// Data-access seam. Reads the canonical tier from Supabase when reachable; otherwise falls
// back to the local CSV-derived dataset so the prototype always works. This is the boundary
// where the E2EE/encryptable relationship tier will later slot in (per the residency decision).
import { supabase } from '../lib/supabase';
import { people as localPeople, companies as localCompanies, type NetworkPerson, type NetworkCompany } from './network';
import { resources as localResources, type NetworkResource } from './resources.generated';

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const RING = ['Inner', 'Close', 'Warm', 'Extended'];
const RECIP = ['Balanced', 'You give more', 'They give more'];

type CommunityLocationIndex = Map<string, { city: string | null; country: string | null; display: string | null }>;

// Map a people_canonical row → the table's NetworkPerson shape. Warmth/ring are the user's
// *relationship* tier (not canonical), so they're derived deterministically here for display.
// communityLocs: dedup_key → HQ location; used as fallback when the person has no location.
function mapCanonical(d: any, i: number, communityLocs?: CommunityLocationIndex): NetworkPerson {
  const name = d.full_name || '';
  const h = hash(name + i);
  const company = d.current_company_name || '';
  const position = d.current_title || '';

  // Person location — fall back to the company HQ when person-level data is absent.
  const personCity = d.location_city as string | null;
  const personCountry = d.location_country as string | null;
  let location = [personCity, personCountry].filter(Boolean).join(', ');
  if (!location && company && communityLocs) {
    const companyKey = company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hq = communityLocs.get(companyKey);
    if (hq) {
      location = hq.display || [hq.city, hq.country].filter(Boolean).join(', ');
      if (location) location = `~${location}`; // tilde signals this is approximate (company HQ)
    }
  }

  return {
    id: d.id || `SB-${i}`,
    name, firstName: name.split(' ')[0] || '', lastName: name.split(' ').slice(1).join(' '),
    company, position,
    url: d.linkedin_url || '',
    email: Array.isArray(d.emails) ? (d.emails[0] || '') : '',
    connectedOn: '',
    newsInsight: position && company ? `${position} at ${company}.` : company ? `Works at ${company}.` : position ? `${position}.` : 'Canonical profile — no recent updates.',
    location,
    warmth: 30 + (h % 70), ring: RING[h % 4], reciprocity: RECIP[h % 3], trust: 40 + ((h >> 3) % 60),
    lastConnected: '—',
    // Recon-enriched fields
    bio: d.bio || undefined,
    skills: Array.isArray(d.skills) && d.skills.length ? d.skills : undefined,
    education: Array.isArray(d.education) && d.education.length ? d.education : undefined,
    previousCompanies: Array.isArray(d.previous_companies) && d.previous_companies.length ? d.previous_companies : undefined,
    twitterHandle: d.twitter_handle || undefined,
    githubHandle: d.github_handle || undefined,
    instagramHandle: d.instagram_handle || undefined,
    websiteUrl: d.website_url || undefined,
  };
}

export type PeopleSource = 'supabase' | 'local';

const CANON_PAGE = 1000;

// Paginate people_canonical in parallel pages after the first; returns null on first-page error.
async function fetchAllCanonical(select: string): Promise<any[] | null> {
  const { data: first, error } = await supabase
    .from('people_canonical')
    .select(select)
    .order('full_name')
    .range(0, CANON_PAGE - 1);
  if (error || !first) return null;
  if (first.length < CANON_PAGE) return first;
  // Dataset > 1 page: fetch remaining pages in parallel (covers up to 30k rows).
  const rest = await Promise.all(
    Array.from({ length: 29 }, (_, i) => i + 1).map(p =>
      supabase
        .from('people_canonical')
        .select(select)
        .order('full_name')
        .range(p * CANON_PAGE, p * CANON_PAGE + CANON_PAGE - 1)
    )
  );
  return [...first, ...rest.flatMap(r => r.data || [])];
}

export async function loadCanonicalPeople(): Promise<{ rows: NetworkPerson[]; source: PeopleSource }> {
  try {
    const [data, locsResult] = await Promise.all([
      fetchAllCanonical('id, full_name, current_title, current_company_name, linkedin_url, emails, location_city, location_country, bio, skills, education, previous_companies, twitter_handle, github_handle, instagram_handle, website_url'),
      supabase.from('communities_canonical').select('dedup_key, name, headquarters_city, headquarters_country, location_display'),
    ]);
    if (!data || data.length === 0) return { rows: localPeople, source: 'local' };

    // Build dedup_key → HQ location index for the company-location fallback.
    const communityLocs: CommunityLocationIndex = new Map();
    for (const c of (locsResult.data || [])) {
      const key = c.dedup_key || (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      communityLocs.set(key, { city: c.headquarters_city, country: c.headquarters_country, display: c.location_display });
    }

    return { rows: data.map((d, i) => mapCanonical(d, i, communityLocs)), source: 'supabase' };
  } catch {
    return { rows: localPeople, source: 'local' };
  }
}

const dedupeKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Paginate communities_canonical in parallel pages; returns empty array on error.
async function fetchAllCommunitiesCanonical(): Promise<any[]> {
  const SELECT = 'id, name, dedup_key, description, website_url, linkedin_url, twitter_handle, tech_stack, hiring_signals, headquarters_city, headquarters_country, headquarters_lat, headquarters_lng, location_display';
  const { data: first, error } = await supabase
    .from('communities_canonical')
    .select(SELECT)
    .order('name')
    .range(0, CANON_PAGE - 1);
  if (error || !first) return [];
  if (first.length < CANON_PAGE) return first;
  const rest = await Promise.all(
    Array.from({ length: 29 }, (_, i) => i + 1).map(p =>
      supabase
        .from('communities_canonical')
        .select(SELECT)
        .order('name')
        .range(p * CANON_PAGE, p * CANON_PAGE + CANON_PAGE - 1)
    )
  );
  return [...first, ...rest.flatMap(r => r.data || [])];
}

// Communities: group people_canonical by company name, then enrich each group with data from
// communities_canonical (description, HQ, tech stack, hiring signals, etc.) matched on dedup_key.
export async function loadCanonicalCommunities(): Promise<{ rows: NetworkCompany[]; source: PeopleSource }> {
  try {
    const [peopleData, canonicalRows] = await Promise.all([
      fetchAllCanonical('full_name, current_title, current_company_name'),
      fetchAllCommunitiesCanonical(),
    ]);
    const canonicalResult = { data: canonicalRows };

    if (!peopleData || peopleData.length === 0) return { rows: localCompanies, source: 'local' };

    // Build enrichment index keyed by dedup_key
    const enriched = new Map<string, any>();
    for (const c of (canonicalResult.data || [])) {
      const key = c.dedup_key || dedupeKey(c.name || '');
      enriched.set(key, c);
    }

    const byCompany = new Map<string, { name: string; roles: Map<string, number>; people: string[] }>();
    for (const d of peopleData) {
      const name = (d.current_company_name || '').trim();
      if (!name) continue;
      const key = dedupeKey(name);
      let g = byCompany.get(key);
      if (!g) { g = { name, roles: new Map(), people: [] }; byCompany.set(key, g); }
      if (d.full_name) g.people.push(d.full_name);
      const role = (d.current_title || '').trim();
      if (role) g.roles.set(role, (g.roles.get(role) || 0) + 1);
    }

    const rows: NetworkCompany[] = [...byCompany.entries()]
      .map(([key, g], i): NetworkCompany => {
        const sampleRoles = [...g.roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
        const canon = enriched.get(key);
        return {
          id: canon?.id || `SBC-${i}`,
          name: g.name,
          connections: g.people.length,
          sampleRoles,
          samplePeople: g.people.slice(0, 5),
          newsInsight: sampleRoles[0] ? `${g.people.length} you know · ${sampleRoles[0]}` : `${g.people.length} you know`,
          description: canon?.description || undefined,
          websiteUrl: canon?.website_url || undefined,
          linkedinUrl: canon?.linkedin_url || undefined,
          twitterHandle: canon?.twitter_handle || undefined,
          techStack: Array.isArray(canon?.tech_stack) && canon.tech_stack.length ? canon.tech_stack : undefined,
          hiringSignals: Array.isArray(canon?.hiring_signals) && canon.hiring_signals.length ? canon.hiring_signals : undefined,
          headquartersCity: canon?.headquarters_city || undefined,
          headquartersCountry: canon?.headquarters_country || undefined,
          headquartersLat: canon?.headquarters_lat ?? undefined,
          headquartersLng: canon?.headquarters_lng ?? undefined,
          locationDisplay: canon?.location_display || undefined,
        };
      })
      .sort((a, b) => b.connections - a.connections || a.name.localeCompare(b.name));
    return { rows, source: 'supabase' };
  } catch {
    return { rows: localCompanies, source: 'local' };
  }
}

export interface WorkspaceList {
  id: string;
  name: string;
  memberIds: Set<string>;
}

// Resolve per-workspace people.id values → their canonical_person_id, chunked to stay
// under URL length limits. The People grid is keyed by people_canonical.id, so list
// membership (stored as people.id in community_members) must be mapped across this seam.
async function resolveCanonicalIds(personIds: string[]): Promise<string[]> {
  const out: string[] = [];
  const CHUNK = 200;
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const slice = personIds.slice(i, i + CHUNK);
    const { data } = await supabase.from('people').select('canonical_person_id').in('id', slice);
    for (const r of (data || [])) if (r.canonical_person_id) out.push(r.canonical_person_id as string);
  }
  return out;
}

// Load workspace communities of kind='list' and their member canonical-person IDs.
export async function loadWorkspaceLists(): Promise<WorkspaceList[]> {
  try {
    const { data, error } = await supabase
      .from('communities')
      .select('id, name_override')
      .eq('kind', 'list');
    if (error || !data || data.length === 0) return [];
    const results = await Promise.all(data.map(async (c: any) => {
      // .range lifts PostgREST's default 1000-row cap so large lists (e.g. ETA > 2.6k)
      // return ALL members, not a truncated 1000.
      const { data: members } = await supabase
        .from('community_members')
        .select('person_id')
        .eq('community_id', c.id)
        .range(0, 99999);
      const personIds = (members || []).map((m: any) => m.person_id as string).filter(Boolean);
      const canonicalIds = await resolveCanonicalIds(personIds);
      return { id: c.id as string, name: (c.name_override || c.id) as string, memberIds: new Set<string>(canonicalIds) };
    }));
    return results;
  } catch {
    return [];
  }
}

// Map a resources_canonical row → the table's NetworkResource shape. newsInsight drives the
// table's NEWS/DESCRIPTION column + the gallery card, so fall back to a synthesized line.
function mapResource(d: any, i: number): NetworkResource {
  const by = d.author || d.host || '';
  const insight = (d.description && String(d.description).trim())
    || `${d.type || 'Resource'}${by ? ` · ${by}` : ''}`;
  return {
    id: d.id || `SBR-${i}`,
    name: d.name || '(untitled)',
    type: d.type || 'Resource',
    url: d.url || '',
    description: d.description || '',
    newsInsight: insight,
    author: d.author || undefined,
    host: d.host || undefined,
    rating: typeof d.rating === 'number' ? d.rating : (d.rating ? Number(d.rating) || undefined : undefined),
    ratingCount: d.rating_count ?? undefined,
    yearPublished: d.year_published || undefined,
    tags: Array.isArray(d.tags) ? d.tags : [],
    coverImageUrl: d.cover_image_url || undefined,
    source: d.source || undefined,
    fullTitle: d.full_title || undefined,
    dateAdded: d.date_added || '',
    notes: d.notes || undefined,
  };
}

// Resources: scraped reading/podcast/vlog catalog. Canonical tier in Supabase, local fallback.
export async function loadCanonicalResources(): Promise<{ rows: NetworkResource[]; source: PeopleSource }> {
  try {
    const SELECT = 'id, name, full_title, type, url, description, author, host, rating, rating_count, year_published, tags, cover_image_url, source, date_added, notes';
    const { data, error } = await supabase
      .from('resources_canonical')
      .select(SELECT)
      .order('type')
      .order('name');
    if (error || !data || data.length === 0) return { rows: localResources, source: 'local' };
    return { rows: data.map(mapResource), source: 'supabase' };
  } catch {
    return { rows: localResources, source: 'local' };
  }
}
