// Signals — the core value loop. Each Signal is derived from REAL network data (not mock):
//   event/observation  →  Signal  →  Context + Insight + Evidence  →  recommended Action(s)
// "Action over analytics": every Signal carries at least one action. Acting on a signal does NOT
// send anything — it DRAFTS a proposed action into the Approvals queue (draft-then-approve).
//
// Derivation is deterministic: it reads stable fields (warmth/trust/ring, position/company,
// inbound threads, community size) — no Date.now()/Math.random() — so the surface is reproducible.
import { people, companies, threads, type NetworkPerson } from './network';
import type { LedgerEntry } from './governance';

export type SignalType = 'Dormant' | 'Introduction' | 'Help' | 'Hiring/Fundraising' | 'Community';

export interface SignalAction {
  label: string;                         // button text
  channel: 'Email' | 'Calendar' | 'Internal';
  action: string;                        // ledger verb, e.g. "Send reconnect note"
  proposed: string;                      // the draft body the agent generated
  prior?: string | null;                 // prior version for the diff drawer (usually null)
}

export interface Signal {
  id: string;
  type: SignalType;
  priority: 'high' | 'medium' | 'low';
  who: string;                           // display subject
  whoId?: string;                        // person/community name for routing (undefined = no single target)
  warmthLabel?: string;                  // qualitative only — no naked scores
  context: string;                       // grounded in real data
  insight: string;                       // why it matters
  evidence: string[];                    // WHY it fired — the facts the signal stands on
  actions: SignalAction[];               // ≥1, draft-then-approve
  detectedAt: string;
  agent: string;                         // which agent surfaced it
}

// Qualitative bands (shared discipline with the grid) — never show the raw number.
const warmthLabel = (n: number) => (n >= 80 ? 'Hot' : n >= 62 ? 'Warm' : n >= 50 ? 'Cooling' : 'Dormant');
const trustLabel = (n: number) => (n >= 85 ? 'Deep' : n >= 65 ? 'Solid' : n >= 50 ? 'Building' : 'Newer');
const first = (p: NetworkPerson) => p.firstName || p.name.split(' ')[0] || p.name;
const lc = (s: string) => (s || '').toLowerCase();

// ── Dormant reconnect — high trust, cooling warmth (the biggest trust↔warmth gap first) ──────────
function dormantSignals(): Signal[] {
  const cands = people.filter(p => p.name && p.trust >= 76 && p.warmth <= 58);
  cands.sort((a, b) => (b.trust - b.warmth) - (a.trust - a.warmth));
  return cands.slice(0, 3).map((p, i) => ({
    id: `sig_dormant_${p.id}`,
    type: 'Dormant' as const,
    priority: (i === 0 ? 'high' : 'medium') as Signal['priority'],
    who: p.name,
    whoId: p.name,
    warmthLabel: warmthLabel(p.warmth),
    context: `${first(p)}${p.position ? `, ${p.position}` : ''}${p.company ? ` at ${p.company}` : ''} — a ${lc(trustLabel(p.trust))}-trust ${lc(p.ring)}-ring tie whose warmth has slipped to ${lc(warmthLabel(p.warmth))}.`,
    insight: `High trust, cooling contact. A light touch now keeps a ${lc(p.ring)}-ring relationship from going fully dormant — cheap to do, costly to lose.`,
    evidence: [`Trust: ${trustLabel(p.trust)}`, `Warmth: ${warmthLabel(p.warmth)}`, `Ring: ${p.ring}`, p.connectedOn ? `Connected ${p.connectedOn}` : ''].filter(Boolean),
    agent: 'Reconnect Advisor',
    actions: [
      {
        label: 'Draft a reconnect note', channel: 'Email', action: 'Send reconnect note', prior: null,
        proposed: `Hi ${first(p)},\n\nIt's been too long. I was thinking about ${p.company || 'your work'} recently and realized we hadn't spoken in a while. Would you be open to a quick catch-up over the next couple of weeks?\n\nWarmly,`,
      },
      {
        label: 'Hold 20 min to reconnect', channel: 'Calendar', action: 'Propose catch-up call',
        proposed: `Hold 20 minutes for an informal catch-up with ${p.name}. No agenda — reconnect after a quiet stretch.`,
      },
      {
        label: 'Add to a check-in workflow', channel: 'Internal', action: 'Add to check-in workflow',
        proposed: `Add ${p.name} to the "Monthly inner-ring check-in" workflow so this tie doesn't slip again.`,
      },
    ],
    detectedAt: 'Today',
  }));
}

// ── Introduction — pair a founder with an investor who have no recorded intro ─────────────────────
// The user holds trust with both sides and can vet the match themselves — Bridge does NOT gate the
// intro behind a double-opt-in. Privacy consent governs SHARING a person's memory/data, not whether
// the user may introduce two people they know. The signal's job is to name the *specific* overlap.
function introSignals(): Signal[] {
  const founder = people.find(p => /founder|ceo/i.test(p.position) && p.company);
  const investor = people.find(p => /partner|capital|ventures|equity|invest/i.test(`${p.position} ${p.company}`) && p.name !== founder?.name);
  if (!founder || !investor) return [];

  // What each side actually does — prefer the community's newsInsight, skip generic "Role at Company." lines.
  const co = (n: string) => companies.find(c => lc(c.name) === lc(n || ''));
  const stripDot = (s: string) => s.replace(/\.\s*$/, '');
  const domainOf = (p: NetworkPerson) => {
    const ins = co(p.company)?.newsInsight?.trim();
    const generic = !ins || ins.length < 14 || new RegExp(`at\\s+${p.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?$`, 'i').test(ins);
    return generic ? '' : stripDot(ins!);
  };
  const fDomain = domainOf(founder);
  const iDomain = domainOf(investor);
  const sharedLoc = founder.location && investor.location && lc(founder.location) === lc(investor.location) ? founder.location : '';

  // The specific overlap — name the concrete connective tissue, not "their work overlaps".
  const investorSide = iDomain ? `${first(investor)} focuses on ${lc(iDomain)}` : `${first(investor)} invests (${investor.position}${investor.company ? ` at ${investor.company}` : ''})`;
  const founderSide = fDomain ? `${first(founder)} is building ${founder.company} — ${lc(fDomain)}` : `${first(founder)} is ${lc(founder.position)} at ${founder.company}`;
  const overlap = `${investorSide}; ${founderSide}. Direct capital-to-company fit${sharedLoc ? `, and both are based in ${sharedLoc}` : ''}.`;

  return [{
    id: `sig_intro_${founder.id}_${investor.id}`,
    type: 'Introduction',
    priority: 'high',
    who: `${founder.name} ↔ ${investor.name}`,
    context: `${first(founder)} (${founder.position} at ${founder.company}) and ${first(investor)} (${investor.position}${investor.company ? ` at ${investor.company}` : ''}) aren't connected yet. ${overlap}`,
    insight: `You know and trust both sides — you can vet this match yourself, no double-opt-in needed. A direct, well-framed intro creates value for each and reciprocity for you.`,
    evidence: [
      `${first(founder)}: ${founder.position} at ${founder.company}`,
      `${first(investor)}: ${investor.position}${investor.company ? ` at ${investor.company}` : ''}`,
      sharedLoc ? `Both based in ${sharedLoc}` : 'Capital-to-company fit',
      'No prior intro recorded',
    ].filter(Boolean),
    agent: 'Introduction Broker',
    actions: [
      {
        label: 'Draft the intro', channel: 'Email', action: 'Send introduction', prior: null,
        proposed: `Hi ${first(investor)} and ${first(founder)},\n\nConnecting you two directly — there's a clear fit. ${first(founder)} is ${lc(founder.position)} at ${founder.company}${fDomain ? ` (${lc(fDomain)})` : ''}; ${first(investor)}, given your work${iDomain ? ` in ${lc(iDomain)}` : investor.company ? ` at ${investor.company}` : ''}, this felt worth a direct introduction rather than sitting on it.\n\n${first(founder)}, meet ${first(investor)}. I'll let you take it from here.\n\nBest,`,
      },
      {
        label: 'Queue for next intro batch', channel: 'Internal', action: 'Queue introduction',
        proposed: `Queue a direct introduction between ${founder.name} and ${investor.name} for the next intro batch.`,
      },
    ],
    detectedAt: 'Today',
  }];
}

// ── Hiring / Fundraising — founders in your network, well-timed offer of help ─────────────────────
function leverSignals(): Signal[] {
  const leaders = people.filter(p => /founder|ceo|chief executive/i.test(p.position) && p.company && p.name);
  const seen = new Set<string>();
  const picks: NetworkPerson[] = [];
  for (const p of leaders) {
    if (seen.has(p.company)) continue;
    seen.add(p.company);
    picks.push(p);
    if (picks.length === 2) break;
  }
  return picks.map(p => ({
    id: `sig_lever_${p.id}`,
    type: 'Hiring/Fundraising' as const,
    priority: 'medium' as Signal['priority'],
    who: p.name,
    whoId: p.name,
    warmthLabel: warmthLabel(p.warmth),
    context: `${first(p)} is ${p.position} at ${p.company}. Founders in your network are often raising or hiring — a specific, useful offer compounds goodwill.`,
    insight: `Reaching out with something concrete (a candidate, a warm intro, a customer) lands far better than a generic check-in.`,
    evidence: [`Role: ${p.position}`, `Community: ${p.company}`, `Trust: ${trustLabel(p.trust)}`],
    agent: 'Opportunity Scout',
    actions: [
      {
        label: 'Offer a specific help', channel: 'Email', action: 'Send offer-of-help note', prior: null,
        proposed: `Hi ${first(p)},\n\nI've been following ${p.company} — exciting trajectory. If useful, I'm happy to make warm intros to a couple of people in my network who could help with hiring or distribution. No pressure — just say the word.\n\nBest,`,
      },
      {
        label: 'Add to opportunity tracker', channel: 'Internal', action: 'Track opportunity',
        proposed: `Track ${p.name} (${p.company}) on the founder-support watchlist for hiring/fundraising signals.`,
      },
    ],
    detectedAt: 'This week',
  }));
}

// ── Help — an inbound message with no recorded reply ──────────────────────────────────────────────
function helpSignals(): Signal[] {
  const incoming = threads.filter(t => t.with && t.message && lc(t.direction) !== 'outgoing' && t.message.length > 30);
  return incoming.slice(0, 2).map(t => ({
    id: `sig_help_${t.id}`,
    type: 'Help' as const,
    priority: 'medium' as Signal['priority'],
    who: t.with,
    whoId: t.with,
    context: `${t.with} reached out${t.sentAt ? ` (${t.sentAt})` : ''}: "${(t.preview || t.message).slice(0, 130)}". No reply is recorded.`,
    insight: `An unanswered inbound from your network is low-effort, high-reciprocity to close. Responding keeps the relationship warm.`,
    evidence: ['Inbound message', t.sentAt ? `Received ${t.sentAt}` : '', 'No reply recorded'].filter(Boolean),
    agent: 'Open Threads',
    actions: [
      {
        label: 'Draft a reply', channel: 'Email', action: 'Reply to message', prior: null,
        proposed: `Hi ${t.with.split(' ')[0]},\n\nThanks for reaching out — sorry for the slow reply. `,
      },
      {
        label: 'Snooze 3 days', channel: 'Internal', action: 'Snooze thread',
        proposed: `Snooze the open thread with ${t.with} for 3 days.`,
      },
    ],
    detectedAt: t.sentAt || 'Recently',
  }));
}

// ── Community movement — your densest community is leverage ───────────────────────────────────────
function communitySignals(): Signal[] {
  const top = [...companies].sort((a, b) => b.connections - a.connections)[0];
  if (!top) return [];
  return [{
    id: `sig_comm_${top.id}`,
    type: 'Community',
    priority: 'low',
    who: top.name,
    whoId: top.name,
    context: `${top.name} is your densest community — ${top.connections} people you know${top.sampleRoles?.[0] ? `, many in ${lc(top.sampleRoles[0])} roles` : ''}.`,
    insight: `A dense community is leverage: one well-placed touch (an event, a thread, a shared resource) reaches many ties at once.`,
    evidence: [`${top.connections} known members`, ...(top.sampleRoles?.slice(0, 2) ?? [])],
    agent: 'Community Mapper',
    actions: [
      {
        label: 'Propose a gathering', channel: 'Internal', action: 'Propose community gathering',
        proposed: `Propose a small gathering for your contacts at ${top.name} (${top.connections} people you know). Draft an invite and shortlist attendees.`,
      },
    ],
    detectedAt: 'This week',
  }];
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export const signals: Signal[] = [
  ...dormantSignals(),
  ...introSignals(),
  ...leverSignals(),
  ...helpSignals(),
  ...communitySignals(),
].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

// Policy that forces review, by channel (mirrors the governance demo policies).
const policyFor = (channel: SignalAction['channel']) =>
  channel === 'Email' ? 'Outbound message requires review'
  : channel === 'Calendar' ? 'Calendar action on behalf of principal requires review'
  : 'Membership / internal change requires review';

// Turn a chosen signal action into a PENDING ledger row (decision === null) for the Approvals inbox.
export function proposeFromSignal(s: Signal, actionIndex = 0): LedgerEntry {
  const a = s.actions[actionIndex] ?? s.actions[0];
  const resourceType: LedgerEntry['resourceType'] = s.type === 'Community' ? 'community' : 'person';
  return {
    id: `led_${s.id}_${actionIndex}`,
    ts: 'now',
    age: 'just now',
    actorKind: 'agent',
    actor: s.agent,
    onBehalfOfType: 'user',
    onBehalfOf: 'You',
    delegationId: null,
    runId: `run_${s.id}`,
    action: a.action,
    resourceType,
    resource: s.who,
    policy: policyFor(a.channel),
    decision: null,
    channel: a.channel,
    prior: a.prior ?? null,
    proposed: a.proposed,
    trace: { signals: s.evidence, context: s.context, reasoning: s.insight },
  };
}
