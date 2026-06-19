// Helpdesk — local reactive store + capability-routing engine (in-Bridge MVP).
//
// Routing is CAPABILITY-based, not topic-based: "can this person contribute?" — scored by
// the overlap of a recipient's capability tokens (role/company/insight) with the request's
// inferred need-tags, plus a capability-kind affinity. Invisible-by-default: below threshold
// → no route. Deterministic (no model) — the real Helpdesk AI slots into the same seam later.
//
// Operational data is LOCAL (residency, like Initiatives). Governance rides Supabase: when you
// Offer Help, that drafts a governed proposal into Approvals (see HelpdeskPage → proposeToLedger).
import { useSyncExternalStore } from 'react';
import { people as networkPeople, type NetworkPerson } from './network';

export type RoutingMode = 'ai_assisted' | 'broadcast';
export type RequestStatus = 'open' | 'resolved' | 'closed';
export type RouteStatus = 'proposed' | 'offered' | 'dismissed' | 'hidden';

export type ContactVisibility = 'none' | 'email' | 'phone' | 'both';
export type ModerationStatus = 'approved' | 'flagged' | 'held';

// Helpdesk AI behaviour, set from the top-bar dropdown. 'off' suppresses routing entirely.
export type AiMode = 'filters_rec' | 'filters' | 'rec' | 'off';

// Attachments are local-only in the prototype (no upload) — name/size/kind metadata only.
export interface HelpAttachment { id: string; name: string; size?: string; kind?: string }

// Where an ask is broadcast. network = my 1st-degree network; helpdesks = the communities /
// helpdesks it is posted into. `locked` marks a non-public (member-only) audience; the Bridge AI
// channel is always locked (private capability routing, never a public board).
export interface AudienceTarget { id: string; name: string; public: boolean; locked: boolean }
export interface Audience { network: boolean; helpdesks: AudienceTarget[] }

export interface HelpReply { id: string; author: string; body: string; createdAt: string }

export interface HelpWorkspace {
  id: string; name: string; slug: string; description: string;
  visibility: 'public' | 'unlisted' | 'private'; broadcastDefault: boolean; createdAt: string;
  brandColor?: string;
}
export interface HelpRequest {
  id: string; workspaceId: string | null; requesterId: string; requesterName: string;
  title: string; body: string; needTags: string[];
  status: RequestStatus; routingMode: RoutingMode; autoFilter: boolean; createdAt: string;
  // public identity + contact preferences (P2) + moderation (P3)
  requesterEmail?: string; requesterPhone?: string;
  allowDirectContact?: boolean; contactVisibility?: ContactVisibility;
  isPublic?: boolean; moderationStatus?: ModerationStatus; moderationReason?: string;
  // redesign: AI-suggested ways to help + attachments + broadcast audience + helpdesk AI mode
  waysToHelp?: string[]; attachments?: HelpAttachment[]; audience?: Audience; aiMode?: AiMode;
}
export interface HelpRoute {
  id: string; requestId: string; recipientId: string; recipientName: string;
  status: RouteStatus; score: number; reason: string; assistancePaths: string[]; createdAt: string;
}
export interface HelpOffer {
  id: string; requestId: string; routeId: string | null; helperId: string; helperName: string;
  message: string; contactShared: boolean; createdAt: string;
  helperEmail?: string; responsePrivate?: boolean; moderationStatus?: ModerationStatus;
  // redesign: which AI-suggested ways the helper picked + attachments + threaded replies
  waysSelected?: string[]; attachments?: HelpAttachment[]; replies?: HelpReply[];
}

// ── reactive localStorage store ────────────────────────────────────────────────
const K = {
  ws: 'bridge.helpdesk.workspaces.v1',
  req: 'bridge.helpdesk.requests.v1',
  rt: 'bridge.helpdesk.routes.v1',
  of: 'bridge.helpdesk.offers.v1',
};
function read<T>(k: string): T[] { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

let workspaces: HelpWorkspace[] = typeof window !== 'undefined' ? read(K.ws) : [];
let requests: HelpRequest[] = typeof window !== 'undefined' ? read(K.req) : [];
let routes: HelpRoute[] = typeof window !== 'undefined' ? read(K.rt) : [];
let offers: HelpOffer[] = typeof window !== 'undefined' ? read(K.of) : [];

const subs = new Set<() => void>();
function emit() { subs.forEach(fn => fn()); }
function persist() {
  try {
    localStorage.setItem(K.ws, JSON.stringify(workspaces));
    localStorage.setItem(K.req, JSON.stringify(requests));
    localStorage.setItem(K.rt, JSON.stringify(routes));
    localStorage.setItem(K.of, JSON.stringify(offers));
  } catch { /* noop */ }
  emit();
}

// ── "you" (the demo helper persona) — used to route INBOUND requests to the user ─
export const YOU_ID = 'you';
export const YOU_NAME = 'You';
const YOU_CAPABILITY = 'founder product design startups fundraising venture community intro recruiting go-to-market';

// ── tokenization ────────────────────────────────────────────────────────────────
const STOP = new Set('the a an and or for to of in on with my our your need needs looking help want would could should can please just really also more most who what when where why how do does did get got make made about as is are be was were been being i we you they it this that these those some any at by from into hi hey'.split(/\s+/));
function tokenize(s: string): string[] {
  return Array.from(new Set((s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))));
}

// ── capability kinds (what a person can DO), inferred from their role ────────────
type CapKind = 'founder' | 'investor' | 'professor' | 'engineer' | 'recruiter' | 'designer' | 'product' | 'operator' | 'generic';
function capabilityKind(role: string): CapKind {
  const r = (role || '').toLowerCase();
  if (/found|ceo|co-?found|owner|entrepreneur/.test(r)) return 'founder';
  if (/invest|venture|\bvc\b|\bgp\b|\blp\b|partner|capital|angel|\bfund\b/.test(r)) return 'investor';
  if (/prof|teach|lectur|research|\bphd\b|scientist|faculty|postdoc|student/.test(r)) return 'professor';
  if (/engineer|developer|\bswe\b|software|programmer|architect|\bml\b|\bai\b|data|devops|\bsre\b/.test(r)) return 'engineer';
  if (/recruit|talent|\bhr\b|people ops|sourcer|staffing/.test(r)) return 'recruiter';
  if (/design|\bux\b|\bui\b|brand|creative/.test(r)) return 'designer';
  if (/\bproduct\b|\bpm\b|\bgrowth\b|\bgtm\b/.test(r)) return 'product'; // \b: avoid "Production" → product
  if (/operat|\bcoo\b|\bcfo\b|chief|director|\bvp\b|head|manager|\blead\b|principal/.test(r)) return 'operator';
  return 'generic';
}
function capabilityTokens(p: { position?: string; company?: string; newsInsight?: string }): string[] {
  return tokenize(`${p.position || ''} ${p.company || ''} ${p.newsInsight || ''}`);
}

// ── request intents (what KIND of help is asked for), classified from the text ──
type Intent = 'intro' | 'hiring' | 'funding' | 'feedback' | 'expertise' | 'resource' | 'recommendation' | 'networking' | 'operations' | 'design' | 'product' | 'technical' | 'mentorship';
const INTENT_DEFS: { intent: Intent; label: string; re: RegExp }[] = [
  { intent: 'intro', label: 'an introduction', re: /\b(intro|introduc|connect me|warm intro|put me in touch|referral|refer me)\b/i },
  { intent: 'hiring', label: 'hiring/recruiting', re: /\b(hir|recruit|candidate|talent|\bjob\b|internship|intern\b|opening|founding (engineer|hire)|resume|résumé|\bcv\b)\b/i },
  { intent: 'funding', label: 'fundraising', re: /\b(fund|raise|raising|investor|\bvc\b|angel|seed|pre-?seed|series [a-c]|valuation|cap table|pitch|term sheet|runway)\b/i },
  { intent: 'feedback', label: 'feedback', re: /\b(feedback|review|critique|thoughts on|sanity check|poke holes|gut check|tear (it|this) apart)\b/i },
  { intent: 'expertise', label: 'expertise', re: /\b(understand|explain|concept|how (do|to|should)|expertise|deep dive|figure out|wrap my head)\b/i },
  { intent: 'resource', label: 'resources', re: /\b(resource|reading|course|tool|template|dataset|\bpaper\b|reference|example|guide)\b/i },
  { intent: 'recommendation', label: 'a recommendation', re: /\b(recommend|suggestion|which|\bbest\b|vendor|provider|who should|what should i use)\b/i },
  { intent: 'networking', label: 'networking', re: /\b(network|community|meet people|people in|connections in|who knows)\b/i },
  { intent: 'operations', label: 'operations', re: /\b(operations|process|legal|finance|accounting|\bops\b|playbook|incorporat|contract|compliance)\b/i },
  { intent: 'design', label: 'design', re: /\b(design|\bux\b|\bui\b|brand|logo|figma|prototype|wireframe)\b/i },
  { intent: 'product', label: 'product', re: /\b(product|roadmap|prioriti|\bpmf\b|user research|go-?to-?market|\bgtm\b|positioning|onboarding)\b/i },
  { intent: 'technical', label: 'a technical problem', re: /\b(code|architecture|technical|\bstack\b|infra|\bml\b|model|\bapi\b|database|\bbug\b|scal|latency)\b/i },
  { intent: 'mentorship', label: 'mentorship', re: /\b(mentor|career|coach|guidance|navigate)\b/i },
];
const INTENT_LABEL = Object.fromEntries(INTENT_DEFS.map(d => [d.intent, d.label])) as Record<Intent, string>;
const INTENT_WORDS = new Set('intro introduction introductions hiring recruiting recruit funding fund raise feedback review expertise advice resource resources recommendation recommend networking operations design product technical mentor mentorship career'.split(' '));
// Generic, non-topic words that must NOT count as a domain match — they false-hit company
// names and roles (e.g. "building" a product ⊂ "Cornerstone Building Brands"). Topic words
// like climate-tech / algebra / eigenvectors survive.
const DOMAIN_NOISE = new Set('build building built make making create creating app apps idea ideas project projects thing things stuff early soon before talk talking partner deck slide slides startup company companies business work working role roles team teams people person someone anyone help advice perspective question questions tricky stuck class final-year student students new good great best want looking around lot bit using use used'.split(' '));

export function classifyIntents(title: string, body: string): Intent[] {
  const text = `${title} ${body}`;
  const hits = INTENT_DEFS.filter(d => d.re.test(text)).map(d => d.intent);
  return hits.length ? Array.from(new Set(hits)) : ['expertise']; // a bare "help with X" → expertise/advice
}
export type { Intent };
// Domain tokens = the topic words (climate, math, marketplace…), intent + noise + stop words removed.
export function needTagsFrom(title: string, body: string): string[] {
  return tokenize(`${title} ${body}`).filter(t => !INTENT_WORDS.has(t) && !DOMAIN_NOISE.has(t)).slice(0, 12);
}

// ── intent × capability: how well each kind SERVES each intent (0–2) ─────────────
// The heart of capability-based routing: a founder serves hiring/funding/intro even when the
// topic isn't "startups". Topic overlap is a BONUS, not the gate.
const KIND_SERVES: Record<Intent, Partial<Record<CapKind, number>>> = {
  intro:          { investor: 2, founder: 1.5, operator: 1.5, recruiter: 1, product: 1, professor: 1, generic: 0.4 },
  hiring:         { recruiter: 2, founder: 1.5, operator: 1.5, engineer: 0.8 },
  funding:        { investor: 2, founder: 1.5, operator: 0.8 },
  feedback:       { product: 1.5, founder: 1, investor: 1, designer: 1, engineer: 1, professor: 1, operator: 0.8 },
  expertise:      { professor: 2, engineer: 1.5, founder: 1, investor: 1, product: 1, operator: 1, designer: 1 },
  resource:       { professor: 1.5, engineer: 1, product: 1, operator: 1, designer: 0.8, generic: 0.4 },
  recommendation: { operator: 1.5, founder: 1, investor: 1, product: 1, engineer: 1, generic: 0.4 },
  networking:     { investor: 1.5, founder: 1.5, operator: 1.5, recruiter: 1, product: 0.8 },
  operations:     { operator: 2, founder: 1.5, recruiter: 0.8, investor: 0.8 },
  design:         { designer: 2, product: 1.5, founder: 0.5 },
  product:        { product: 2, founder: 1.5, designer: 1, investor: 1 },
  technical:      { engineer: 2, product: 1, professor: 1, founder: 0.5 },
  mentorship:     { professor: 1.5, founder: 1.5, investor: 1, operator: 1, recruiter: 0.8 },
};
const INTENT_PATHS: Record<Intent, string[]> = {
  intro: ['Make an introduction', 'Open their network'],
  hiring: ['Share openings', 'Refer a candidate', 'Recruiting advice'],
  funding: ['Funding perspective', 'Intro to an investor', 'Pitch feedback'],
  feedback: ['Give honest feedback', 'Review your materials'],
  expertise: ['Share expertise', 'Explain the approach'],
  resource: ['Share a resource', 'Point to references'],
  recommendation: ['Recommend an option', 'Recommend someone'],
  networking: ['Suggest people to meet', 'Open their network'],
  operations: ['Operational playbook', 'Process advice'],
  design: ['Design feedback', 'UX / portfolio review'],
  product: ['Product feedback', 'Roadmap perspective'],
  technical: ['Technical review', 'Architecture advice'],
  mentorship: ['Mentor you', 'Career guidance'],
};
const KIND_DEFAULT_PATHS: Record<CapKind, string[]> = {
  founder: ['Share experience', 'Open their network'],
  investor: ['Market perspective', 'Intro to their network'],
  professor: ['Explain the concept', 'Share resources'],
  engineer: ['Technical feedback', 'Review your work'],
  recruiter: ['Share openings', 'Refer internally'],
  designer: ['Design feedback', 'Share a reference'],
  product: ['Product feedback', 'User perspective'],
  operator: ['Operational advice', 'Intro to a specialist'],
  generic: ['Share advice', 'Point to a resource'],
};

// strict token match — avoids "art" ⊂ "startup" noise (needs whole-word or ≥5-char containment)
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a));
}
const RING_BONUS: Record<string, number> = { Inner: 0.4, Close: 0.3, Warm: 0.15 };

interface Scored { score: number; served: Intent[]; domainHit?: string }
function scoreCandidate(intents: Intent[], domainToks: string[], capToks: string[], kind: CapKind, ring?: string): Scored {
  let intentScore = 0; const served: Intent[] = [];
  for (const it of intents) {
    const w = KIND_SERVES[it]?.[kind] ?? 0;
    if (w > 0) { intentScore += w; served.push(it); }
  }
  let domainScore = 0; let domainHit: string | undefined;
  for (const d of domainToks) {
    if (capToks.some(c => tokenMatch(d, c))) { domainScore += 1; if (!domainHit) domainHit = d; }
  }
  const score = intentScore + Math.min(domainScore, 3) * 0.8 + (RING_BONUS[ring || ''] ?? 0);
  return { score, served, domainHit };
}
function pathsFor(served: Intent[], kind: CapKind): string[] {
  const out: string[] = [];
  for (const it of served) for (const p of INTENT_PATHS[it]) if (!out.includes(p)) out.push(p);
  for (const p of KIND_DEFAULT_PATHS[kind]) if (out.length < 4 && !out.includes(p)) out.push(p);
  return out.slice(0, 4);
}
function buildReason(role: string, company: string, kind: CapKind, served: Intent[], domainHit?: string): string {
  const who = [role, company && `at ${company}`].filter(Boolean).join(' ') || 'In your network';
  const help = served.length
    ? `can help with ${served.slice(0, 2).map(s => INTENT_LABEL[s]).join(' & ')}`
    : (kind !== 'generic' ? `has ${kind} experience to draw on` : 'may be able to weigh in');
  return domainHit ? `${who} — ${help} · knows ${domainHit}` : `${who} — ${help}`;
}

export interface RouteResult { recipientId: string; recipientName: string; score: number; reason: string; assistancePaths: string[]; }

/** Capability-route a request over the user's connections (intent × capability, not topic). */
export function routeOverConnections(intents: Intent[], domainToks: string[], mode: RoutingMode, autoFilter: boolean): RouteResult[] {
  // AI-assisted = high precision: must clear a real capability bar. Broadcast = everyone
  // eligible; auto-filter applies a low floor; without it, all connections pass.
  const floor = mode === 'broadcast' ? (autoFilter ? 0.8 : -1) : 1.6;
  const out: RouteResult[] = [];
  for (const p of networkPeople as NetworkPerson[]) {
    const kind = capabilityKind(p.position || '');
    const caps = capabilityTokens(p);
    const base = scoreCandidate(intents, domainToks, caps, kind, (p as any).ring);
    const { served, domainHit } = base;
    // P4 learning: user's per-intent bias (more/fewer like this) × score + this helper's
    // accumulated offer-history bonus for these intents.
    const score = base.score * intentBiasFor(served) + helperHitBonus(p.id, served);
    // AI-assisted requires an actual capability reason (served an intent), not a stray word —
    // this is what keeps the inbox quiet (invisible-by-default).
    const hasReason = served.length > 0 || (mode === 'broadcast' && domainHit !== undefined);
    if (score <= floor || (mode !== 'broadcast' && !hasReason)) continue;
    out.push({
      recipientId: p.id, recipientName: p.name, score,
      reason: buildReason(p.position || '', p.company || '', kind, served, domainHit),
      assistancePaths: pathsFor(served, kind),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, mode === 'broadcast' ? 60 : 8);
}

// Score one explicit persona (used to route INBOUND requests to YOU).
function scorePersona(intents: Intent[], domainToks: string[], personaKinds: CapKind[], personaTokens: string[], roleLabel: string): { score: number; paths: string[]; reason: string } {
  let best: Scored = { score: -Infinity, served: [] }; let bestKind: CapKind = personaKinds[0] ?? 'generic';
  for (const k of personaKinds) {
    const s = scoreCandidate(intents, domainToks, personaTokens, k);
    if (s.score > best.score) { best = s; bestKind = k; }
  }
  return { score: best.score, paths: pathsFor(best.served, bestKind), reason: buildReason(roleLabel, '', bestKind, best.served, best.domainHit) };
}

// ── mutations ──────────────────────────────────────────────────────────────────
let n = Date.now() % 100000;
const nid = (p: string) => `${p}-${++n}`;

export function createWorkspace(p: Partial<HelpWorkspace>): HelpWorkspace {
  const name = (p.name || '').trim() || 'Untitled Helpdesk';
  const slug = (p.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const ws: HelpWorkspace = {
    id: nid('hw'), name, slug, description: p.description || '',
    visibility: p.visibility || 'unlisted', broadcastDefault: p.broadcastDefault ?? false,
    createdAt: new Date().toISOString(),
  };
  workspaces = [ws, ...workspaces]; persist(); return ws;
}

export function submitRequest(p: {
  workspaceId: string | null; title: string; body: string; routingMode: RoutingMode; autoFilter: boolean; crossWorkspace?: boolean;
  waysToHelp?: string[]; attachments?: HelpAttachment[]; audience?: Audience;
  requesterEmail?: string; requesterPhone?: string; isPublic?: boolean;
}): { request: HelpRequest; routed: RouteResult[]; crossPosted: number } {
  const intents = classifyIntents(p.title, p.body);
  const needTags = needTagsFrom(p.title, p.body);
  const mode = getAiMode();
  const request: HelpRequest = {
    id: nid('hr'), workspaceId: p.workspaceId, requesterId: YOU_ID, requesterName: YOU_NAME,
    title: p.title.trim(), body: p.body.trim(), needTags,
    status: 'open', routingMode: p.routingMode, autoFilter: p.autoFilter, createdAt: new Date().toISOString(),
    waysToHelp: p.waysToHelp ?? suggestWaysToHelp(p.title, p.body),
    attachments: p.attachments, audience: p.audience, aiMode: mode,
    requesterEmail: p.requesterEmail, requesterPhone: p.requesterPhone, isPublic: p.isPublic,
  };
  // Helpdesk AI 'off' → no capability routing at all (invisible-by-default becomes invisible-always).
  const routed = mode === 'off' ? [] : routeOverConnections(intents, needTags, p.routingMode, p.autoFilter);
  const newRoutes: HelpRoute[] = routed.map(r => ({
    id: nid('rt'), requestId: request.id, recipientId: r.recipientId, recipientName: r.recipientName,
    status: 'proposed', score: r.score, reason: r.reason, assistancePaths: r.assistancePaths, createdAt: request.createdAt,
  }));
  requests = [request, ...requests];
  routes = [...newRoutes, ...routes];
  persist();
  let crossPosted = 0;
  if (p.crossWorkspace) { const before = requests.length; crossPublish({ ...request }); crossPosted = requests.length - before; }
  return { request, routed, crossPosted };
}

export function setRequestStatus(id: string, status: RequestStatus) {
  requests = requests.map(r => r.id === id ? { ...r, status } : r); persist();
}
export function setRouteStatus(id: string, status: RouteStatus) {
  routes = routes.map(r => r.id === id ? { ...r, status } : r); persist();
}
export function recordOffer(p: { requestId: string; routeId: string | null; message: string; contactShared: boolean; waysSelected?: string[]; attachments?: HelpAttachment[] }): HelpOffer {
  const offer: HelpOffer = {
    id: nid('of'), requestId: p.requestId, routeId: p.routeId,
    helperId: YOU_ID, helperName: YOU_NAME, message: p.message, contactShared: p.contactShared,
    waysSelected: p.waysSelected, attachments: p.attachments, replies: [],
    createdAt: new Date().toISOString(),
  };
  offers = [offer, ...offers];
  if (p.routeId) routes = routes.map(r => r.id === p.routeId ? { ...r, status: 'offered' } : r);
  persist();
  // P4 capability learning: record that this helper helped with this request's intents.
  const route = p.routeId ? routes.find(r => r.id === p.routeId) : null;
  const req = requests.find(r => r.id === p.requestId);
  if (route && req) noteHelpRecorded(route.recipientId, classifyIntents(req.title, req.body));
  return offer;
}

// ── P3: deterministic pre-publish moderation (stands in for the model) ──────────
const SCAM_RE = /\b(crypto|forex|guaranteed returns?|wire transfer|bitcoin|gift ?card|sextortion|loan offer|earn \$\d|investment opportunity|double your money|nigerian prince)\b/i;
const HARASS_RE = /\b(idiot|stupid|kill yourself|\bkys\b|loser|worthless|shut up)\b/i;
const LINK_G = /(https?:\/\/|www\.)/gi;
const SHORTENER_RE = /\b(bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd)\b/i;
export interface ModerationResult { status: ModerationStatus; reason?: string }
export function moderate(text: string): ModerationResult {
  const t = text || '';
  if (HARASS_RE.test(t)) return { status: 'held', reason: 'Possible harassment' };
  if (SCAM_RE.test(t)) return { status: 'held', reason: 'Possible scam / spam' };
  if (SHORTENER_RE.test(t)) return { status: 'flagged', reason: 'Shortened link — review before publish' };
  const links = (t.match(LINK_G) || []).length;
  if (links >= 3) return { status: 'flagged', reason: 'Many links' };
  if (links >= 1) return { status: 'flagged', reason: 'Contains a link' };
  return { status: 'approved' };
}

// ── P3: advisory client-side rate limit (a real limit belongs server-side) ──────
const RL_KEY = 'bridge.helpdesk.rate.v1';
export function rateOk(bucket: string, maxPerHour = 5): boolean {
  if (typeof window === 'undefined') return true;
  let m: Record<string, number[]> = {};
  try { m = JSON.parse(localStorage.getItem(RL_KEY) || '{}'); } catch { /* noop */ }
  const now = Date.now(); const cutoff = now - 3600_000;
  const arr = (m[bucket] || []).filter(t => t > cutoff);
  if (arr.length >= maxPerHour) { m[bucket] = arr; try { localStorage.setItem(RL_KEY, JSON.stringify(m)); } catch {} ; return false; }
  arr.push(now); m[bucket] = arr; try { localStorage.setItem(RL_KEY, JSON.stringify(m)); } catch {}
  return true;
}

// ── P1: workspace visibility + public lookups ───────────────────────────────────
export function setWorkspaceVisibility(id: string, visibility: HelpWorkspace['visibility']) {
  workspaces = workspaces.map(w => w.id === id ? { ...w, visibility } : w); persist();
}
export function workspaceBySlug(slug: string): HelpWorkspace | undefined { return workspaces.find(w => w.slug === slug); }
export interface PublicRequest { id: string; title: string; body: string; status: RequestStatus; helperCount: number; createdAt: string; allowDirectContact: boolean }
export function publicRequests(workspaceId: string): PublicRequest[] {
  return requests
    .filter(r => r.workspaceId === workspaceId && r.isPublic && (r.moderationStatus ?? 'approved') === 'approved')
    .map(r => ({ id: r.id, title: r.title, body: r.body, status: r.status, helperCount: offers.filter(o => o.requestId === r.id).length, createdAt: r.createdAt, allowDirectContact: !!r.allowDirectContact }));
}
// Contact is revealed ONLY to a helper who chooses "Offer Direct Help", and ONLY per the
// requester's visibility preference. Public viewers never see this.
export function revealContact(requestId: string): { email?: string; phone?: string } | null {
  const r = requests.find(x => x.id === requestId);
  if (!r || !r.allowDirectContact) return null;
  const v = r.contactVisibility ?? 'none';
  return {
    email: (v === 'email' || v === 'both') ? r.requesterEmail : undefined,
    phone: (v === 'phone' || v === 'both') ? r.requesterPhone : undefined,
  };
}

// ── P2: anonymous public posting (identity + contact prefs + moderation) ────────
export function submitPublicRequest(p: {
  workspaceId: string; name: string; email: string; phone?: string;
  title: string; body: string; allowDirectContact: boolean; contactVisibility: ContactVisibility;
}): { ok: boolean; status: ModerationStatus; reason?: string } {
  const mod = moderate(`${p.title} ${p.body}`);
  const req: HelpRequest = {
    id: nid('hr'), workspaceId: p.workspaceId, requesterId: `anon:${p.email.toLowerCase()}`, requesterName: p.name.trim(),
    title: p.title.trim(), body: p.body.trim(), needTags: needTagsFrom(p.title, p.body),
    status: 'open', routingMode: 'broadcast', autoFilter: true, createdAt: new Date().toISOString(),
    requesterEmail: p.email.trim().toLowerCase(), requesterPhone: p.phone?.trim() || undefined,
    allowDirectContact: p.allowDirectContact, contactVisibility: p.allowDirectContact ? p.contactVisibility : 'none',
    isPublic: true, moderationStatus: mod.status, moderationReason: mod.reason,
  };
  requests = [req, ...requests]; persist();
  return { ok: mod.status !== 'held', status: mod.status, reason: mod.reason };
}
export function submitPublicOffer(p: { requestId: string; name: string; email: string; message: string }): { ok: boolean; status: ModerationStatus; reason?: string } {
  const mod = moderate(p.message);
  if (mod.status !== 'held') {
    const offer: HelpOffer = {
      id: nid('of'), requestId: p.requestId, routeId: null, helperId: `anon:${p.email.toLowerCase()}`, helperName: p.name.trim(),
      message: p.message.trim(), contactShared: false, helperEmail: p.email.trim().toLowerCase(), responsePrivate: true,
      moderationStatus: mod.status, createdAt: new Date().toISOString(),
    };
    offers = [offer, ...offers]; persist();
  }
  return { ok: mod.status !== 'held', status: mod.status, reason: mod.reason };
}
export function offersForRequest(requestId: string): HelpOffer[] { return offers.filter(o => o.requestId === requestId); }

// ── P2: lightweight session — recover by EXACT name + email match ───────────────
export interface MySession { requests: HelpRequest[]; offersMade: HelpOffer[] }
export function findMySubmissions(name: string, email: string): MySession | null {
  const e = email.trim().toLowerCase(); const n = name.trim().toLowerCase();
  if (!e || !n) return null;
  const reqs = requests.filter(r => (r.requesterEmail || '').toLowerCase() === e && r.requesterName.trim().toLowerCase() === n);
  const offs = offers.filter(o => (o.helperEmail || '').toLowerCase() === e && o.helperName.trim().toLowerCase() === n);
  if (!reqs.length && !offs.length) return null; // access denied — no exact match
  return { requests: reqs, offersMade: offs };
}

// ── P3: admin — submissions + moderation overrides + identity verification ──────
export function workspaceSubmissions(workspaceId: string): HelpRequest[] { return requests.filter(r => r.workspaceId === workspaceId); }
export function setModeration(requestId: string, status: ModerationStatus, reason?: string) {
  requests = requests.map(r => r.id === requestId ? { ...r, moderationStatus: status, moderationReason: reason ?? r.moderationReason } : r); persist();
}

// ── P4: learning — auto-filter tuning + capability learning + cross-workspace ───
const LEARN_KEY = 'bridge.helpdesk.learn.v1';
interface Learn { intentBias: Partial<Record<Intent, number>>; helperHits: Record<string, Partial<Record<Intent, number>>> }
let learn: Learn = ((): Learn => {
  if (typeof window === 'undefined') return { intentBias: {}, helperHits: {} };
  try { return { intentBias: {}, helperHits: {}, ...JSON.parse(localStorage.getItem(LEARN_KEY) || '{}') }; } catch { return { intentBias: {}, helperHits: {} }; }
})();
function persistLearn() { try { localStorage.setItem(LEARN_KEY, JSON.stringify(learn)); } catch {} emit(); }
export function tuneIntent(intent: Intent, dir: 'more' | 'fewer') {
  const cur = learn.intentBias[intent] ?? 1;
  learn.intentBias[intent] = Math.max(0.3, Math.min(2, cur + (dir === 'more' ? 0.25 : -0.25)));
  persistLearn();
}
export function intentBiasFor(intents: Intent[]): number {
  if (!intents.length) return 1;
  return intents.reduce((a, it) => a + (learn.intentBias[it] ?? 1), 0) / intents.length;
}
export function helperHitBonus(helperId: string, intents: Intent[]): number {
  const h = learn.helperHits[helperId]; if (!h) return 0;
  return intents.reduce((a, it) => a + Math.min(h[it] ?? 0, 3) * 0.3, 0);
}
function noteHelpRecorded(helperId: string, intents: Intent[]) {
  const h = learn.helperHits[helperId] ?? (learn.helperHits[helperId] = {});
  for (const it of intents) h[it] = (h[it] ?? 0) + 1;
  persistLearn();
}
/** Cross-workspace discovery: also publish a personal request to the user's public Helpdesks. */
export function crossPublish(req: HelpRequest) {
  const targets = workspaces.filter(w => w.visibility === 'public');
  if (!targets.length) return;
  const copies: HelpRequest[] = targets.map(w => ({
    ...req, id: nid('hr'), workspaceId: w.id, isPublic: true, moderationStatus: 'approved',
    requesterEmail: req.requesterEmail, routingMode: 'broadcast',
  }));
  requests = [...copies, ...requests]; persist();
}

// ── redesign: Helpdesk AI mode (top-bar dropdown) ───────────────────────────────
// filters_rec = filter the feed AND recommend who can help · filters = filter only ·
// rec = recommend only (no feed filtering) · off = no routing, no recommendations.
const AIMODE_KEY = 'bridge.helpdesk.aimode.v1';
let aiMode: AiMode = (() => {
  if (typeof window === 'undefined') return 'filters_rec';
  const v = localStorage.getItem(AIMODE_KEY) as AiMode | null;
  return v && ['filters_rec', 'filters', 'rec', 'off'].includes(v) ? v : 'filters_rec';
})();
export function getAiMode(): AiMode { return aiMode; }
export function setAiMode(m: AiMode) { aiMode = m; try { localStorage.setItem(AIMODE_KEY, m); } catch {} emit(); }
export const AI_MODE_LABELS: Record<AiMode, string> = {
  filters_rec: 'AI filters and Recommendations',
  filters: 'AI filters',
  rec: 'AI Recommendation',
  off: 'Disable Helpdesk AI',
};
// Two independent toggles (the 3-dot menu): AI Recommendation (who can help) + AI Screening
// (hide non-fit asks). Both fold into the single aiMode the routing engine reads.
export interface AiFlags { recommendation: boolean; screening: boolean }
function flagsFromMode(m: AiMode): AiFlags { return { recommendation: m === 'filters_rec' || m === 'rec', screening: m === 'filters_rec' || m === 'filters' }; }
function modeFromFlags(rec: boolean, screen: boolean): AiMode { return rec && screen ? 'filters_rec' : screen ? 'filters' : rec ? 'rec' : 'off'; }
export function getAiFlags(): AiFlags { return flagsFromMode(aiMode); }
export function setAiRecommendation(on: boolean) { const f = getAiFlags(); setAiMode(modeFromFlags(on, f.screening)); }
export function setAiScreening(on: boolean) { const f = getAiFlags(); setAiMode(modeFromFlags(f.recommendation, on)); }
export const AI_FLAG_TOOLTIPS = {
  recommendation: 'Bridge AI recommends people in your network who can meaningfully help — and how.',
  screening: 'Bridge AI screens the feed, hiding asks that are not a fit so your inbox stays quiet.',
};

// ── redesign: AI-suggested "ways to help" (intent → helper actions) ──────────────
// Deterministic stand-in for the model; reuses classifyIntents. Helper sees these as a
// checklist ("Bridge AI thinks you may be able to help by: ☐ …").
const INTENT_WAYS: Record<Intent, string[]> = {
  intro: ['Introduce relevant organizations', 'Connect you with someone', 'Open my network'],
  hiring: ['Share opportunities', 'Review your resume', 'Give recruiting advice', 'Introduce relevant organizations'],
  funding: ['Share market insights', 'Introduce relevant people', 'Review your pitch'],
  feedback: ['Review idea', 'Challenge assumptions', 'Share market insights', 'Provide customer perspective'],
  expertise: ['Explain concepts', 'Answer questions', 'Review work'],
  resource: ['Share resources', 'Recommend resources'],
  recommendation: ['Recommend an option', 'Recommend someone'],
  networking: ['Connect you with someone', 'Suggest people to meet'],
  operations: ['Share a playbook', 'Give process advice'],
  design: ['Review design', 'Share a reference'],
  product: ['Review idea', 'Give product feedback', 'Provide customer perspective'],
  technical: ['Review work', 'Give technical advice'],
  mentorship: ['Offer mentorship', 'Study together', 'Career guidance', 'Tutor directly'],
};
const GENERIC_WAYS = ['Share resources', 'Answer questions', 'Connect you with someone'];
export function suggestWaysToHelp(title: string, body: string): string[] {
  const intents = classifyIntents(title, body);
  const out: string[] = [];
  for (const it of intents) for (const w of (INTENT_WAYS[it] || [])) if (!out.includes(w)) out.push(w);
  for (const w of GENERIC_WAYS) { if (out.length >= 7) break; if (!out.includes(w)) out.push(w); }
  return [...out.slice(0, 7), 'Something else'];
}

// ── redesign: "you" identity auto-populated on Bridge-user public asks (editable) ─
export const dummy_youProfile = { name: YOU_NAME, email: 'dummy_you@bridge.ai', phone: 'dummy_+1 (555) 0100' };

// ── redesign: my / public helpdesks + communities ───────────────────────────────
// Locally-created workspaces are MINE (private/invite-link by default — NOT public).
// "Public Helpdesks" = ones that are public OR shared with me via a link I opened
// (click link → addLinkedHelpdesk → appears in the Public Helpdesks list). dummy_-seeded.
const dummy_publicHelpdesks: HelpWorkspace[] = [
  { id: 'dummy_hw_eship', name: 'Entrepreneurship Hub', slug: 'entrepreneurship-hub', description: 'Founders helping founders.', visibility: 'public', broadcastDefault: true, createdAt: '2026-01-01T00:00:00.000Z', brandColor: '#4D7EA8' },
  { id: 'dummy_hw_climate', name: 'Climate Builders', slug: 'climate-builders', description: 'Public climate-tech helpdesk.', visibility: 'public', broadcastDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
];
// Helpdesks I joined by opening a shared link (persisted).
const LINKED_KEY = 'bridge.helpdesk.linked.v1';
let linkedHelpdesks: HelpWorkspace[] = (() => { if (typeof window === 'undefined') return []; try { const v = JSON.parse(localStorage.getItem(LINKED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
function persistLinked() { try { localStorage.setItem(LINKED_KEY, JSON.stringify(linkedHelpdesks)); } catch {} emit(); }
export function addLinkedHelpdesk(ws: HelpWorkspace) { if (!linkedHelpdesks.some(w => w.id === ws.id)) { linkedHelpdesks = [ws, ...linkedHelpdesks]; persistLinked(); } }
export function myHelpdesks(): HelpWorkspace[] { return workspaces; }
export function publicHelpdesks(): HelpWorkspace[] { return [...linkedHelpdesks, ...dummy_publicHelpdesks]; }
export function allHelpdesks(): HelpWorkspace[] { return [...workspaces, ...publicHelpdesks()]; }
const helpdeskNameById = (id: string | null) => id ? (allHelpdesks().find(w => w.id === id)?.name) : undefined;
export { helpdeskNameById };
// My communities (for the My-Network broadcast scope; Bridge-AI-focused). dummy_-seeded.
export const dummy_myCommunities = [
  { id: 'dummy_comm_wustl', name: 'WashU Founders' },
  { id: 'dummy_comm_climate', name: 'Climate Tech Circle' },
  { id: 'dummy_comm_gp', name: 'GP / LP Network' },
];

// ── redesign: per-card pin (My asks pinned by default; any card pin/unpinnable) ──
const ASKPIN_KEY = 'bridge.helpdesk.askpins.v1';
let askPins: Record<string, boolean> = (() => { if (typeof window === 'undefined') return {}; try { return JSON.parse(localStorage.getItem(ASKPIN_KEY) || '{}'); } catch { return {}; } })();
export function isAskPinned(r: HelpRequest): boolean { return askPins[r.id] ?? isMine(r); }
export function toggleAskPin(r: HelpRequest) { askPins = { ...askPins, [r.id]: !isAskPinned(r) }; try { localStorage.setItem(ASKPIN_KEY, JSON.stringify(askPins)); } catch {} emit(); }
export function useAskPins() { return useStore(() => askPins); }

// ── redesign: gamification (all dummy_-seeded; People-Helped reactive where cheap) ─
export interface Streak { count: number; unit: 'days' | 'weeks' }
export interface Badge { id: string; label: string }
export interface ImpactReport { peopleHelped: number; communities: number; followUps: number; topContribution: string; moments: string[] }
const dummy_streak: Streak = { count: 7, unit: 'weeks' };
const dummy_badges: Badge[] = [
  { id: 'dummy_badge_trusted', label: 'Trusted Helper' },
  { id: 'dummy_badge_community', label: 'Community Builder' },
  { id: 'dummy_badge_advisor', label: 'Startup Advisor' },
];
const dummy_peopleHelpedBase = 42;
// Reputation earned from real helping patterns (dummy_-seeded by person name).
const dummy_reputation: Record<string, string> = {
  'daniel salinas': 'Community Builder',
  'manoj keshav': 'Startup Advisor',
  'clive muir, phd': 'Career Guide',
  'you': 'Trusted Helper',
};
const dummy_impact: ImpactReport = {
  peopleHelped: 83, communities: 6, followUps: 42, topContribution: 'Career Advice',
  moments: [
    'dummy_ Helped a first-time founder close their founding engineer.',
    'dummy_ Reviewed a pre-seed deck that went on to raise.',
    'dummy_ Tutored a student through linear algebra finals.',
    'dummy_ Introduced two operators who now co-run a community.',
    'dummy_ Gave career guidance that led to a new role.',
  ],
};
export function getStreak(): Streak { return dummy_streak; }
export function getBadges(): Badge[] { return dummy_badges; }
export function getImpactReport(): ImpactReport { return dummy_impact; }
export function reputationFor(name: string): string | null { return dummy_reputation[(name || '').trim().toLowerCase()] ?? null; }
// People-Helped = dummy_ base + the count of asks YOU actually offered help on (reactive).
export function peopleHelpedCount(): number { return dummy_peopleHelpedBase + offers.filter(o => o.helperId === YOU_ID).length; }
// Impact report fires every Dec 31 (prototype UI may read the clock; engine code may not).
export function shouldShowImpactReport(d: Date): boolean { return d.getMonth() === 11 && d.getDate() === 31; }

// ── redesign: thread helpers ─────────────────────────────────────────────────────
export const isMine = (r: HelpRequest) => r.requesterId === YOU_ID;
export function requestById(id: string): HelpRequest | undefined { return requests.find(r => r.id === id); }
export function addReply(offerId: string, body: string, author: string = YOU_NAME): HelpReply | null {
  const text = (body || '').trim(); if (!text) return null;
  const reply: HelpReply = { id: nid('rp'), author, body: text, createdAt: new Date().toISOString() };
  offers = offers.map(o => o.id === offerId ? { ...o, replies: [...(o.replies || []), reply] } : o);
  persist();
  return reply;
}

// ── selectors / hooks ──────────────────────────────────────────────────────────
export function getWorkspaces() { return workspaces; }
export function getRequests() { return requests; }
export function getRoutes() { return routes; }
export function getOffers() { return offers; }
function useStore<T>(get: () => T): T {
  return useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn); }; }, get, get);
}
export function useWorkspaces() { return useStore(getWorkspaces); }
export function useRequests() { return useStore(getRequests); }
export function useRoutes() { return useStore(getRoutes); }
export function useOffers() { return useStore(getOffers); }
export function useAiMode() { return useStore(getAiMode); }

/** Inbound routes addressed to YOU (the recipient inbox) — invisible-by-default already applied. */
export function inboxRoutes(): HelpRoute[] { return routes.filter(r => r.recipientId === YOU_ID && r.status === 'proposed'); }

// ── one-time demo seed: inbound requests where YOU are a candidate helper ────────
export function seedInboxIfEmpty() {
  if (typeof window === 'undefined') return;
  if (requests.some(r => r.requesterId !== YOU_ID)) return; // already seeded inbound
  const youToks = tokenize(YOU_CAPABILITY);
  const youKinds: CapKind[] = ['founder', 'product', 'investor'];
  const dummy_seeds: Array<{ requester: string; title: string; body: string }> = [
    { requester: 'Daniel Salinas', title: 'Feedback on a pre-seed startup idea', body: 'Building a climate-tech marketplace. Looking for product and fundraising feedback before I talk to investors.' },
    { requester: 'Manoj Keshav', title: 'Looking for a design partner intro', body: 'Need an intro to an early design partner for a B2B product, and any go-to-market advice.' },
    { requester: 'Clive Muir, PhD', title: 'Recruiting advice for a first founding hire', body: 'How should I think about my first founding engineer / recruiting? Any playbook helps.' },
  ];
  const made: { reqs: HelpRequest[]; rts: HelpRoute[] } = { reqs: [], rts: [] };
  for (const s of dummy_seeds) {
    const intents = classifyIntents(s.title, s.body);
    const needTags = needTagsFrom(s.title, s.body);
    const sc = scorePersona(intents, needTags, youKinds, youToks, 'Founder · product');
    const req: HelpRequest = {
      id: nid('dummy_hr'), workspaceId: null, requesterId: `dummy_seed-${s.requester}`, requesterName: s.requester,
      title: s.title, body: s.body, needTags, status: 'open', routingMode: 'ai_assisted', autoFilter: true,
      createdAt: new Date().toISOString(),
      waysToHelp: suggestWaysToHelp(s.title, s.body),
      audience: { network: true, helpdesks: [] },
    };
    made.reqs.push(req);
    made.rts.push({
      id: nid('rt'), requestId: req.id, recipientId: YOU_ID, recipientName: YOU_NAME, status: 'proposed',
      score: Math.max(sc.score, 1.5), reason: sc.reason,
      assistancePaths: sc.paths.length ? sc.paths : KIND_DEFAULT_PATHS.founder, createdAt: req.createdAt,
    });
  }
  requests = [...made.reqs, ...requests];
  routes = [...made.rts, ...routes];
  persist();
}
