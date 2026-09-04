// Geocoding via Nominatim (OpenStreetMap) + Wikidata HQ resolution.
//
// Two-step strategy per community:
//   1. Wikidata: resolve the org's Q-entity → P159 (HQ location) → P625 (coordinates)
//      This gives structured, precise HQ data for well-known orgs — no Nominatim call needed.
//   2. Nominatim fallback: text-geocode any location string (city, address, "Name HQ")
//      Used when Wikidata has no HQ claim, or for arbitrary location strings.
//
// Nominatim ToS requirements (https://operations.osmfoundation.org/policies/nominatim/):
//   - User-Agent must identify the app + contact
//   - Max 1 request per second
//   - No bulk geocoding without pre-approval

import { SEC_UA } from './recon';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoResult {
  lat: number;
  lng: number;
  display: string; // human-readable normalised name, e.g. "New York, NY, United States"
  source: 'wikidata' | 'nominatim';
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-API rate limiters (queue-based, race-condition-free)
//
// A shared-state "check last-call timestamp" approach breaks with concurrent
// coroutines: two workers can read the same timestamp simultaneously, both
// compute the same wait, and fire at the same time.
//
// This queue-based approach atomically reserves the NEXT time slot in one
// synchronous step (no await between read and write of `_next`), so
// concurrent callers always get distinct, non-overlapping slots.
//
// Wikidata ToS: 60 req/min = 1 req/sec (same as Nominatim).
// Splitting into two limiters lets Wikidata and Nominatim calls for different
// companies interleave without cross-API contention.
// ─────────────────────────────────────────────────────────────────────────────

function makeRateLimiter(gapMs: number) {
  let _next = 0;
  return async function acquire(): Promise<void> {
    const now = Date.now();
    if (now >= _next) {
      _next = now + gapMs;
    } else {
      const slot = _next;
      _next = slot + gapMs; // atomically reserve the next slot
      await new Promise((r) => setTimeout(r, slot - now));
    }
  };
}

const _nominatimAcquire = makeRateLimiter(1100); // 1 req/sec (Nominatim ToS)
const _wikidataAcquire  = makeRateLimiter(1100); // 1 req/sec (Wikidata 60/min limit)

async function nominatimFetch(url: string): Promise<Response> {
  await _nominatimAcquire();
  return fetch(url, {
    headers: { 'User-Agent': SEC_UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(10000),
  });
}

async function wikidataFetch(url: string): Promise<Response> {
  await _wikidataAcquire();
  return fetch(url, {
    headers: { 'Api-User-Agent': SEC_UA },
    signal: AbortSignal.timeout(10000),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Wikidata HQ resolver
//
// Looks up the organisation by name, finds the first match whose label or alias
// matches, then resolves P159 (headquarters location) → P625 (coordinate location).
// Falls back to P625 directly on the organisation itself (some small orgs skip P159).
// ─────────────────────────────────────────────────────────────────────────────

interface WdSearchResult {
  search?: Array<{ id: string; label?: string; description?: string }>;
}

interface WdEntity {
  claims?: Record<string, Array<{
    mainsnak?: {
      datavalue?: {
        value?: unknown;
      };
    };
  }>>;
  labels?: { en?: { value: string } };
}

interface WdEntities {
  entities?: Record<string, WdEntity>;
}

function claimCoords(ent: WdEntity): { lat: number; lng: number } | null {
  const vals = ent.claims?.['P625'] ?? [];
  const v = vals[0]?.mainsnak?.datavalue?.value as { latitude?: number; longitude?: number } | undefined;
  if (typeof v?.latitude === 'number' && typeof v?.longitude === 'number') {
    return { lat: v.latitude, lng: v.longitude };
  }
  return null;
}

function claimItemId(ent: WdEntity, prop: string): string | null {
  const vals = ent.claims?.[prop] ?? [];
  const v = vals[0]?.mainsnak?.datavalue?.value as { id?: string } | undefined;
  return v?.id ?? null;
}

async function fetchWdEntity(qid: string): Promise<WdEntity | null> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  try {
    const r = await wikidataFetch(url);
    if (!r.ok) return null;
    const data = (await r.json()) as WdEntities;
    return data.entities?.[qid] ?? null;
  } catch {
    return null;
  }
}

export async function resolveWikidataHq(orgName: string): Promise<GeoResult | null> {
  // Step 1 — search for the org by name
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(orgName)}&language=en&format=json&type=item&limit=5`;
  let hits: WdSearchResult['search'] = [];
  try {
    const r = await wikidataFetch(searchUrl);
    if (r.ok) {
      const data = (await r.json()) as WdSearchResult;
      hits = data.search ?? [];
    }
  } catch {
    return null;
  }

  if (!hits.length) return null;

  // Step 2 — pick the best matching entity (prefer exact org match, skip geographic places)
  const orgNorm = orgName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const GEO_DESCRIPTIONS = /\b(commune|municipality|city|town|village|hamlet|borough|county|district|river|lake|mountain|island|peninsula|bay|region|province|state|department|arrondissement|parish|ward)\b/i;
  const ranked = hits
    .filter((h) => {
      // Skip pure geographic entities unless the org name strongly matches
      const desc = h.description ?? '';
      if (GEO_DESCRIPTIONS.test(desc)) {
        // Allow only if label is a very close match to the org name
        const labelNorm = (h.label ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return labelNorm === orgNorm;
      }
      return true;
    })
    .map((h) => ({
      ...h,
      score: (h.label ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === orgNorm ? 3
           : (h.label ?? '').toLowerCase().includes(orgName.toLowerCase()) ? 2
           : orgName.toLowerCase().includes((h.label ?? '').toLowerCase()) ? 1
           : 0,
    }))
    .sort((a, b) => b.score - a.score);

  for (const hit of ranked.slice(0, 3)) {
    const ent = await fetchWdEntity(hit.id);
    if (!ent) continue;

    // Try P159 (headquarters location) → get that city entity's coordinates
    const hqQid = claimItemId(ent, 'P159');
    if (hqQid) {
      const hqEnt = await fetchWdEntity(hqQid);
      if (hqEnt) {
        const coords = claimCoords(hqEnt);
        if (coords) {
          const city = hqEnt.labels?.en?.value ?? hit.label ?? orgName;
          return { ...coords, display: city, source: 'wikidata' };
        }
      }
    }

    // Try P625 directly on the org (some small orgs only have this)
    const coords = claimCoords(ent);
    if (coords) {
      return { ...coords, display: hit.label ?? orgName, source: 'wikidata' };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nominatim geocoder
//
// Accepts any free-text location string and returns the best match.
// Used as a fallback when Wikidata has no HQ claim, and to geocode
// city+country strings extracted by the recon enrichers.
// ─────────────────────────────────────────────────────────────────────────────

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
}

export async function geocodeText(query: string): Promise<GeoResult | null> {
  if (!query.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;
  try {
    const r = await nominatimFetch(url);
    if (!r.ok) return null;
    const results = (await r.json()) as NominatimResult[];
    const hit = results[0];
    if (!hit?.lat || !hit?.lon) return null;
    return {
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      display: hit.display_name ?? query,
      source: 'nominatim',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
//
// Strategy:
//   1. If city (+ optional country) string is provided, geocode it directly via Nominatim.
//   2. Otherwise try Wikidata HQ resolution for the org name.
//   3. Fallback: Nominatim text search on "<orgName> headquarters".
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveLocation(opts: {
  orgName?: string;
  city?: string | null;
  country?: string | null;
}): Promise<GeoResult | null> {
  const { orgName, city, country } = opts;

  // Path 1 — direct geocode from known city
  if (city) {
    const query = [city, country].filter(Boolean).join(', ');
    const result = await geocodeText(query);
    if (result) return result;
  }

  // Path 2 — Wikidata HQ
  if (orgName) {
    const result = await resolveWikidataHq(orgName);
    if (result) return result;
  }

  // Path 3 — Nominatim fallback: try with "headquarters", then bare name
  if (orgName) {
    const r1 = await geocodeText(`${orgName} headquarters`);
    if (r1) return r1;
    const r2 = await geocodeText(orgName);
    if (r2) return r2;
  }

  return null;
}
