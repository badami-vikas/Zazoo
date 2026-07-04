// DealPilot prototype data — dummy_ only. The real engine (scoring/pipeline/connectors) lives in
// platform/tools/dealpilot; this file is a client-side mirror of its shapes for the UI, not a
// second implementation (no live API yet — see docs/wiki/known-issues.md tool-registry-desync).

export type TriageState = 'green' | 'yellow' | 'red';

export interface DealCandidate {
  id: string;
  name: string;
  industry: string;
  geo: string;
  askPrice?: number;
  revenue?: number;
  sde?: number;
  source: 'bizbuysell' | 'businessbroker';
  triage: TriageState;
  score: number; // 0..1, ThesisFit
  reasons: string[];
}

export const dummy_dealCandidates: DealCandidate[] = [
  {
    id: 'dummy_deal_1', name: 'Profitable HVAC Company', industry: 'HVAC / Home Services', geo: 'Dallas, TX',
    askPrice: 850_000, revenue: 600_000, sde: 250_000, source: 'bizbuysell',
    triage: 'green', score: 0.86, reasons: ['industry match', 'geo match', 'SDE in range'],
  },
  {
    id: 'dummy_deal_2', name: 'Riverside Car Wash', industry: 'Automotive', geo: 'Portland, OR',
    askPrice: 725_000, revenue: 410_000, sde: 180_500, source: 'businessbroker',
    triage: 'yellow', score: 0.54, reasons: ['industry match', 'SDE below target range'],
  },
  {
    id: 'dummy_deal_3', name: 'Coastal Laundromat', industry: 'Laundry Services', geo: 'Tampa, FL',
    askPrice: 1_200_000, source: 'bizbuysell',
    triage: 'yellow', score: 0.41, reasons: ['geo match', 'missing revenue/SDE facts'],
  },
  {
    id: 'dummy_deal_4', name: 'Downtown Auto Repair', industry: 'Automotive Repair', geo: 'Cleveland, OH',
    askPrice: 400_000, revenue: 300_000, sde: 90_000, source: 'bizbuysell',
    triage: 'red', score: 0.18, reasons: ['no industry match', 'geo out of target'],
  },
];

export function formatMoney(value?: number): string {
  if (value === undefined) return '—';
  return `$${(value / 1000).toFixed(0)}K`;
}

export const TRIAGE_COLUMNS: { id: TriageState; label: string; color: string }[] = [
  { id: 'green', label: 'Green — pursue', color: 'var(--success)' },
  { id: 'yellow', label: 'Yellow — review', color: 'var(--warning)' },
  { id: 'red', label: 'Red — discarded', color: 'var(--danger)' },
];
