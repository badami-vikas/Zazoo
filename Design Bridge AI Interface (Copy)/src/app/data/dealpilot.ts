// DealPilot — local reactive store + the ThesisFit scoring proven in platform/tools/dealpilot.
// Same standardization pass as JobPilot: card/kanban/list views over one dummy_ dataset.
import { useSyncExternalStore } from 'react';

export interface ThesisProfile { industries: string[]; geo: string[]; sdeMin?: number; sdeMax?: number; revenueMin?: number; revenueMax?: number }
export type TriageColor = 'green' | 'yellow' | 'red';
export interface FitResult { score: number; triage: TriageColor; matched: string[]; unmatched: string[] }

export interface DealListing {
  id: string; name: string; industry: string; geo: string; sde: number; revenue: number;
  source: 'bizbuysell' | 'businessbroker' | 'referral';
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

export interface Deal { id: string; listingId: string; name: string; industry: string; geo: string; sde: number; revenue: number; stage: DealStage; fit: FitResult; createdAt: string }

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
