// DealPilot — local reactive store + the ThesisFit scoring proven in platform/tools/dealpilot.
// Same standardization pass as JobPilot: card/kanban/list views over one dummy_ dataset.
import { useSyncExternalStore, useState } from 'react';

export interface ThesisProfile { industries: string[]; geo: string[]; sdeMin?: number; sdeMax?: number; revenueMin?: number; revenueMax?: number }
export type TriageColor = 'green' | 'yellow' | 'red';
export interface FitResult { score: number; triage: TriageColor; matched: string[]; unmatched: string[] }

export interface DealListing {
  id: string; name: string; industry: string; geo: string; sde: number; revenue: number;
  source: 'bizbuysell' | 'businessbroker' | 'referral' | 'live';
}

export type DealStage = 'sourced' | 'reviewing' | 'diligence' | 'offer' | 'closed' | 'passed';
export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  sourced: 'Sourced', reviewing: 'Reviewing', diligence: 'Diligence', offer: 'Offer', closed: 'Closed', passed: 'Passed',
};
const ALLOWED: Record<DealStage, DealStage[]> = {
  sourced: ['reviewing', 'passed'], reviewing: ['diligence', 'passed'], diligence: ['offer', 'passed'],
  offer: ['closed', 'passed'], closed: [], passed: [],
};
export class InvalidTransitionError extends Error {}
function transition(current: DealStage, to: DealStage): DealStage {
  if (!ALLOWED[current].includes(to)) throw new InvalidTransitionError(`cannot go ${current} -> ${to}`);
  return to;
}

// ── scoreThesisFit — port of platform/tools/dealpilot/src/scoring.ts ───────────────────────────
export function scoreThesisFit(deal: DealListing, thesis: ThesisProfile): FitResult {
  const matched: string[] = []; const unmatched: string[] = [];
  let points = 0; let possible = 0;

  possible += 1;
  if (thesis.industries.some((i) => i.toLowerCase() === deal.industry.toLowerCase())) { points += 1; matched.push(`industry match: ${deal.industry}`); }
  else unmatched.push(`industry mismatch: ${deal.industry} not in thesis`);

  possible += 1;
  if (thesis.geo.some((g) => g.toLowerCase() === deal.geo.toLowerCase())) { points += 1; matched.push(`geo match: ${deal.geo}`); }
  else unmatched.push(`geo mismatch: ${deal.geo} not in thesis`);

  if (thesis.sdeMin != null || thesis.sdeMax != null) {
    possible += 1;
    const inRange = (thesis.sdeMin == null || deal.sde >= thesis.sdeMin) && (thesis.sdeMax == null || deal.sde <= thesis.sdeMax);
    if (inRange) { points += 1; matched.push(`SDE $${deal.sde.toLocaleString()} within thesis range`); }
    else unmatched.push(`SDE $${deal.sde.toLocaleString()} outside thesis range`);
  }

  const score = possible === 0 ? 0 : points / possible;
  const triage: TriageColor = score >= 0.75 ? 'green' : score >= 0.4 ? 'yellow' : 'red';
  return { score, triage, matched, unmatched };
}

export interface DealAnalysis { summary: string; draftEmail: string; draftMessage: string; generatedAt: string }
export interface Deal { id: string; listingId: string; name: string; industry: string; geo: string; sde: number; revenue: number; stage: DealStage; fit: FitResult; createdAt: string; analysis?: DealAnalysis }

const DEFAULT_THESIS: ThesisProfile = { industries: ['HVAC', 'Landscaping', 'IT Services'], geo: ['Texas', 'Florida'], sdeMin: 300000, sdeMax: 900000 };

export const LISTINGS: DealListing[] = [
  { id: 'dummy_deal_1', name: 'Alamo HVAC Services', industry: 'HVAC', geo: 'Texas', sde: 520000, revenue: 2100000, source: 'bizbuysell' },
  { id: 'dummy_deal_2', name: 'Sunbelt Landscaping Co', industry: 'Landscaping', geo: 'Florida', sde: 410000, revenue: 1800000, source: 'businessbroker' },
  { id: 'dummy_deal_3', name: 'Gulf Coast IT Services', industry: 'IT Services', geo: 'Texas', sde: 260000, revenue: 1200000, source: 'bizbuysell' },
  { id: 'dummy_deal_4', name: 'Pacific Grill Franchise', industry: 'Restaurant', geo: 'California', sde: 180000, revenue: 900000, source: 'businessbroker' },
  { id: 'dummy_deal_5', name: 'Lone Star Mechanical', industry: 'HVAC', geo: 'Texas', sde: 810000, revenue: 3400000, source: 'referral' },
  { id: 'dummy_deal_6', name: 'Everglades Lawn & Tree', industry: 'Landscaping', geo: 'Florida', sde: 95000, revenue: 500000, source: 'bizbuysell' },
];

const K = { thesis: 'bridge.dealpilot.thesis.v1', deals: 'bridge.dealpilot.deals.v1' };
function read<T>(k: string, fallback: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }

let thesis: ThesisProfile = typeof window !== 'undefined' ? read(K.thesis, DEFAULT_THESIS) : DEFAULT_THESIS;
let deals: Deal[] = typeof window !== 'undefined' ? read(K.deals, []) : [];

const subs = new Set<() => void>();
function emit() { subs.forEach((fn) => fn()); }
function persist() {
  try { localStorage.setItem(K.thesis, JSON.stringify(thesis)); localStorage.setItem(K.deals, JSON.stringify(deals)); } catch { /* noop */ }
  emit();
}
function subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); }

export function useThesisProfile(): ThesisProfile { return useSyncExternalStore(subscribe, () => thesis, () => DEFAULT_THESIS); }
export function useDeals(): Deal[] { return useSyncExternalStore(subscribe, () => deals, () => []); }
export function updateThesisProfile(next: Partial<ThesisProfile>) { thesis = { ...thesis, ...next }; persist(); }
export function dealForListing(listingId: string): Deal | undefined { return deals.find((d) => d.listingId === listingId); }

let seq = 0;
export function addToPipeline(listing: DealListing) {
  seq += 1;
  const fit = scoreThesisFit(listing, thesis);
  const deal: Deal = { id: `dummy_pipeline_${seq}`, listingId: listing.id, name: listing.name, industry: listing.industry, geo: listing.geo, sde: listing.sde, revenue: listing.revenue, stage: 'sourced', fit, createdAt: new Date().toISOString() };
  deals = [...deals, deal]; persist();
}
export function advanceDeal(dealId: string, to: DealStage) {
  const deal = deals.find((d) => d.id === dealId); if (!deal) return;
  deal.stage = transition(deal.stage, to); deals = [...deals]; persist();
}

// Deep-dive analysis + draft outreach, triggered by flagging a deal (not a sourced listing) green.
// Deterministic/simulated — same fidelity as JobPilot's fabrication-guard evaluator, no real LLM
// call and no real send; drafts are stored for the human to review and send themselves.
export function runDeepDive(dealId: string) {
  const deal = deals.find((d) => d.id === dealId); if (!deal || deal.analysis) return;
  const strengths = deal.fit.matched.join('; ') || 'no thesis criteria matched yet';
  const risks = deal.fit.unmatched.join('; ') || 'no gaps flagged';
  const summary = `${deal.name} (${deal.industry}, ${deal.geo}): SDE $${deal.sde.toLocaleString()} on $${deal.revenue.toLocaleString()} revenue — ${Math.round(deal.fit.score * 100)}% thesis fit. Strengths: ${strengths}. Watch: ${risks}.`;
  const draftEmail = `Subject: Interest in ${deal.name}\n\nHi,\n\nWe came across ${deal.name} and wanted to express interest in learning more. Based on what's public, it looks like a ${deal.fit.triage === 'green' ? 'strong' : 'possible'} fit for our current thesis (${deal.industry}, ${deal.geo}). Could we set up a call to discuss financials and next steps?\n\nBest,\n[Your name]`;
  const draftMessage = `Hey — flagged ${deal.name} (${deal.industry}, ${deal.geo}, SDE $${deal.sde.toLocaleString()}) as a green deal. Sent an intro email, will keep you posted.`;
  deal.analysis = { summary, draftEmail, draftMessage, generatedAt: new Date().toISOString() };
  deals = [...deals]; persist();
}

// ── REAL-backend sourcing layer (additive, gated by API_ENABLED) ───────────────────────────────
// DESIGN CHOICE: `LISTINGS` stays exactly as-is (a plain exported dummy_ array) — DealPilotPage.tsx
// uses it in a `.filter().map()` chain and a plain `.find()`, both inside the component body but
// as a bare identifier, not a hook call. Converting it to a hook (`useListings()`) would still
// require touching DealPilotPage.tsx's call sites, which is out of scope here. Instead we add a
// SEPARATE `useLiveListings()` reactive store for API-sourced candidates; a future UI pass can
// merge `[...LISTINGS, ...useLiveListings()]` at the call site with a one-line change.
import { API_ENABLED, apiDealPilotSource, apiDealPilotCommit, apiDealPilotList, type DealPilotCapturePreview, type DealPilotCandidateDTO } from './api';

export type Listing = DealListing;

export interface PendingCapture { captureId: string; preview: DealPilotCapturePreview }

const KL = { live: 'bridge.dealpilot.live_listings.v1', pending: 'bridge.dealpilot.pending_captures.v1' };

let liveListings: Listing[] = typeof window !== 'undefined' ? read(KL.live, []) : [];
let pendingCaptures: PendingCapture[] = typeof window !== 'undefined' ? read(KL.pending, []) : [];

const liveSubs = new Set<() => void>();
function emitLive() { liveSubs.forEach((fn) => fn()); }
function persistLive() {
  try {
    localStorage.setItem(KL.live, JSON.stringify(liveListings));
    localStorage.setItem(KL.pending, JSON.stringify(pendingCaptures));
  } catch { /* noop */ }
  emitLive();
}
function subscribeLive(fn: () => void) { liveSubs.add(fn); return () => liveSubs.delete(fn); }

/** API-sourced listings only (empty array when API disabled or nothing committed yet). Merge with
 * the dummy_ `LISTINGS` constant at the call site, e.g. `[...LISTINGS, ...useLiveListings()]`. */
export function useLiveListings(): Listing[] { return useSyncExternalStore(subscribeLive, () => liveListings, () => []); }

/** Quarantined-but-uncommitted captures awaiting a human "Add" decision. */
export function usePendingCaptures(): PendingCapture[] { return useSyncExternalStore(subscribeLive, () => pendingCaptures, () => []); }

function candidateToListing(row: DealPilotCandidateDTO): Listing {
  const p = row.profile;
  return {
    id: row.id,
    name: p.name ?? 'Unnamed listing',
    industry: p.industry ?? 'Unknown',
    geo: p.geo ?? 'Unknown',
    sde: p.sde ?? 0,
    revenue: p.revenue ?? 0,
    source: 'live',
  };
}

/** Source new listings via the governed pipeline: quarantines them (no commit yet). No-op when
 * the API is disabled (dummy/demo mode) — throws only on a real API failure. */
export async function sourceListings(): Promise<void> {
  if (!API_ENABLED) return;
  const result = await apiDealPilotSource();
  if (!result) return;
  const additions: PendingCapture[] = result.captureIds.map((captureId, i) => ({
    captureId,
    preview: result.sample[i] ?? {},
  }));
  pendingCaptures = [...pendingCaptures, ...additions];
  persistLive();
}

/** The human "Add": commit one quarantined capture, then refresh the committed candidate list
 * from the platform and merge it into `liveListings`. No-op when the API is disabled. */
export async function commitCapture(captureId: string): Promise<void> {
  if (!API_ENABLED) return;
  const committed = await apiDealPilotCommit(captureId);
  if (!committed) return;
  pendingCaptures = pendingCaptures.filter((c) => c.captureId !== captureId);

  const rows = await apiDealPilotList();
  if (rows) {
    liveListings = rows.map(candidateToListing);
  }
  persistLive();
}

/** Convenience hook bundling pending captures + the two async actions + a loading flag, so the
 * sourcing UI can consume this module in one call. */
export function useDealPilotSourcing() {
  const pending = usePendingCaptures();
  const live = useLiveListings();
  const [loading, setLoading] = useState(false);

  async function source() {
    setLoading(true);
    try { await sourceListings(); } finally { setLoading(false); }
  }
  async function commit(captureId: string) {
    setLoading(true);
    try { await commitCapture(captureId); } finally { setLoading(false); }
  }

  return { pendingCaptures: pending, liveListings: live, loading, source, commit };
}
