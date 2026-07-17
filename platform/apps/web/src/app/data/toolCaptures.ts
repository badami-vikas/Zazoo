// Tool-capture intake seam (Bridge side of the Tool-internalization handoff).
//
// Standalone / shared-link tools (e.g. the internalized card-scanner) insert
// PUBLIC, QUARANTINED captures into the Supabase `tool_captures` table. Here we
// read the pending ones and let the user ADOPT each — the gated commit. Per the
// architecture, an external-origin capture is FORCED through review: "Add" routes
// it through the governed pipeline (a person:write proposal → Approvals) and marks
// the capture adopted so it leaves the pending list. Capture ≠ commit.
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { proposeToLedger } from './ledger';
import { createInitiative } from './initiatives';
import type { LedgerEntry } from './governance';

export interface CapturePerson {
  name: string; title: string; company: string;
  emails: string[]; phones: string[];
  address: string; website: string; notes: string;
}
export interface CaptureTouchpoint { text: string; capturedAt: string }

export interface CaptureNextStep { text: string; owner?: string | null; due?: string | null }
export interface CaptureConversation {
  title: string; summary: string; transcript?: string;
  nextSteps: CaptureNextStep[];
  initiative: { name: string; description?: string };
}

export interface ToolCapture {
  id: string;
  toolId: string;
  status: 'quarantined' | 'adopted' | 'dismissed';
  dataScope: string;
  contract: string;          // 'person.v1' | 'conversation.v1'
  person: CapturePerson;     // person.v1
  touchpoint: CaptureTouchpoint;
  conversation?: CaptureConversation; // conversation.v1
  provenance: { model?: string; source?: string };
  capturedAt: string;
}

export type CaptureSource = 'supabase' | 'local';

function rowToCapture(r: any): ToolCapture {
  const payload = r.payload || {};
  const p = payload.person || {};
  const t = payload.touchpoint || {};
  const cv = payload.conversation;
  return {
    id: r.id,
    toolId: r.tool_id,
    status: r.status,
    dataScope: r.data_scope,
    contract: r.contract,
    person: {
      name: p.name ?? '', title: p.title ?? '', company: p.company ?? '',
      emails: Array.isArray(p.emails) ? p.emails : [],
      phones: Array.isArray(p.phones) ? p.phones : [],
      address: p.address ?? '', website: p.website ?? '', notes: p.notes ?? '',
    },
    touchpoint: { text: t.text ?? '', capturedAt: t.capturedAt ?? r.captured_at },
    conversation: cv ? {
      title: cv.title ?? '', summary: cv.summary ?? '', transcript: cv.transcript ?? '',
      nextSteps: Array.isArray(cv.nextSteps) ? cv.nextSteps : (Array.isArray(cv.next_steps) ? cv.next_steps : []),
      initiative: cv.initiative ?? { name: cv.title ?? 'Conversation' },
    } : undefined,
    provenance: r.provenance ?? {},
    capturedAt: r.captured_at,
  };
}

// When Supabase is unreachable (e.g. signed-out), there is no real capture data to show — an
// honest empty list beats fabricated captures.
function localDemo(): ToolCapture[] {
  return [];
}

export async function loadPendingCaptures(toolId?: string): Promise<{ captures: ToolCapture[]; source: CaptureSource }> {
  try {
    let q = supabase
      .from('tool_captures')
      .select('id, tool_id, status, data_scope, contract, payload, provenance, captured_at')
      .eq('status', 'quarantined');
    if (toolId) q = q.eq('tool_id', toolId);
    const { data, error } = await q.order('captured_at', { ascending: false }).limit(100);
    if (error) throw error;
    return { captures: (data ?? []).map(rowToCapture), source: 'supabase' };
  } catch {
    return { captures: localDemo().filter(c => !toolId || c.toolId === toolId), source: 'local' };
  }
}

function buildEntry(c: ToolCapture): LedgerEntry {
  const base = {
    id: `cap-${c.id}`,
    ts: '', age: '0m',
    actorKind: 'agent' as const,
    onBehalfOfType: 'user' as const,
    onBehalfOf: 'You',
    delegationId: null,
    runId: null,
    action: 'write',
    decision: null,
    prior: null,
  };

  // conversation.v1 (recorder) → a Memory + Touchpoints proposal (private scope)
  if (c.contract === 'conversation.v1' && c.conversation) {
    const cv = c.conversation;
    const steps = cv.nextSteps.map(s => `• ${s.text}${s.owner ? ` (@${s.owner})` : ''}${s.due ? ` — due ${s.due}` : ''}`).join('\n');
    return {
      ...base,
      actor: 'Recorder',
      resourceType: 'memory',
      resource: cv.title || cv.initiative.name || 'Conversation',
      policy: 'Tool intake · private scope · single-party self-capture → review',
      channel: 'recorder',
      proposed: `Memory: ${cv.title || cv.initiative.name}\n${cv.summary}\n\nInitiative: ${cv.initiative.name}\nTouchpoints (${cv.nextSteps.length}):\n${steps || '—'}`,
      trace: {
        signals: ['Conversation captured', `Provenance: ${c.provenance.source ?? 'tool'}/${c.provenance.model ?? '—'}`],
        context: `Quarantined capture from ${c.toolId} (${c.dataScope} scope). Output contract: conversation.v1 → Memory + Touchpoints + Initiative.`,
        reasoning: 'Single-party self-capture; private relationship tier stays local. Routed through the governed pipeline for review before it commits.',
      },
    };
  }

  // person.v1 (card-scanner) → a Person + Touchpoint proposal (public scope)
  const p = c.person;
  const who = p.name || p.company || 'a new contact';
  const summary = [p.title, p.company].filter(Boolean).join(' @ ');
  const contact = [p.emails[0], p.phones[0]].filter(Boolean).join(' · ');
  return {
    ...base,
    actor: 'Card Scanner',
    resourceType: 'person',
    resource: who,
    policy: 'Tool intake · public scope · external origin → review',
    channel: 'card-scanner',
    proposed: `Add ${who}${summary ? ` — ${summary}` : ''}${contact ? `\n${contact}` : ''}\nTouchpoint: ${c.touchpoint.text}`,
    trace: {
      signals: ['Business card captured', `Provenance: ${c.provenance.source ?? 'tool'}/${c.provenance.model ?? '—'}`],
      context: `Quarantined capture from ${c.toolId} (${c.dataScope} scope). Output contract: ${c.contract} → Person + Touchpoint.`,
      reasoning: 'External-origin tool capture adopted into Bridge — routed through the governed pipeline for review before it commits to the graph.',
    },
  };
}

/** Adopt = the gated commit: governed person:write proposal → Approvals, then freeze the capture. */
export async function adoptCapture(c: ToolCapture): Promise<'pending' | 'approved' | 'vetoed' | null> {
  const staged = await proposeToLedger(buildEntry(c));
  if (!staged) return null;
  const outcome =
    staged.status === 'pending'
      ? 'pending'
      : staged.decision === 'vetoed'
        ? 'vetoed'
        : 'approved';
  try {
    const { data, error } = await supabase.from('tool_captures')
      .update(
        outcome === 'vetoed'
          ? { status: 'dismissed' }
          : { status: 'adopted', adopted_at: new Date().toISOString() },
      )
      .eq('id', c.id)
      .select('id')
      .maybeSingle();
    if (error || !data) return null;
    if (staged.status === 'resolved' && outcome === 'approved') {
      await materializeApprovedCapture(buildEntry(c), staged.decision);
    }
    return outcome;
  } catch {
    return null;
  }
}

export async function dismissCapture(c: ToolCapture): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('tool_captures')
      .update({ status: 'dismissed' })
      .eq('id', c.id)
      .select('id')
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

// ── Captured People store (materialized on APPROVE — draft-then-approve) ────────
// A capture becomes a real Person only when its proposal is APPROVED in Approvals.
// The People grid merges this reactive store on top of the canonical/CSV rows.

export interface CapturedPerson {
  id: string; name: string; firstName: string; lastName: string;
  company: string; position: string; url: string; email: string;
  connectedOn: string; newsInsight: string; location: string;
  warmth: number; ring: string; reciprocity: string; trust: number; lastConnected: string;
  captured: true; toolId: string;
}

const CP_KEY = 'bridge.capturedPeople.v1';
let cpCache: CapturedPerson[] | null = null;
const cpSubs = new Set<() => void>();

function readCP(): CapturedPerson[] {
  if (cpCache) return cpCache;
  try { cpCache = JSON.parse(localStorage.getItem(CP_KEY) ?? '[]'); } catch { cpCache = []; }
  return cpCache!;
}
function writeCP(list: CapturedPerson[]) {
  cpCache = list;
  try { localStorage.setItem(CP_KEY, JSON.stringify(list)); } catch { /* noop */ }
  cpSubs.forEach(fn => fn());
}
export function getCapturedPeople(): CapturedPerson[] { return readCP(); }
export function addCapturedPerson(p: CapturedPerson) {
  const list = readCP();
  if (list.some(x => x.id === p.id)) return;
  writeCP([p, ...list]);
}
export function useCapturedPeople(): CapturedPerson[] {
  return useSyncExternalStore(fn => { cpSubs.add(fn); return () => { cpSubs.delete(fn); }; }, readCP, readCP);
}

const APPROVALS = new Set(['approved', 'edited_approved', 'auto_approved']);

/**
 * Hooked from the Approvals decision handler. When a card-scanner capture proposal
 * is APPROVED, re-read the structured `tool_captures` row (status=adopted, full
 * payload) and materialize the Person into the grid. Survives reload (Supabase-backed).
 */
export async function materializeApprovedCapture(
  entry: { id: string; channel?: string; resource?: string },
  decision: string | null,
): Promise<void> {
  if (!decision || !APPROVALS.has(decision)) return;
  if (!entry.id.startsWith('cap-')) return;
  const captureId = entry.id.slice(4);

  let payload: any = null;
  try {
    const { data } = await supabase.from('tool_captures').select('payload').eq('id', captureId).single();
    payload = data && (data as any).payload;
  } catch { /* fall back to entry fields below */ }

  // conversation.v1 (recorder) → an Initiative + its Touchpoints (Memory surface = P3;
  // summary rides on the Initiative goal for now). next_steps shape already matches.
  if (entry.channel === 'recorder') {
    const cv = (payload && payload.conversation) || {};
    const name = cv.initiative?.name || cv.title || entry.resource || 'Conversation';
    const steps: any[] = Array.isArray(cv.nextSteps) ? cv.nextSteps : (Array.isArray(cv.next_steps) ? cv.next_steps : []);
    const it = createInitiative({ name, goal: cv.summary || '', list: 'Work', visibility: 'private' });
    const touchpoints = steps.map((s, i) => ({
      id: `tp-${captureId}-${i}`,
      name: `${s.text}${s.owner ? ` (@${s.owner})` : ''}${s.due ? ` — due ${s.due}` : ''}`,
      done: false, parentId: null as string | null, collapsed: false,
    }));
    try { localStorage.setItem(`bridge.initiative.${it.id}.tasks`, JSON.stringify(touchpoints)); } catch { /* noop */ }
    return;
  }

  // person.v1 (card-scanner) → a Person row in the grid
  const person: CapturePerson | null = (payload && payload.person) || null;
  const name = person?.name || entry.resource || 'New contact';
  const [firstName, ...rest] = name.split(' ');
  addCapturedPerson({
    id: `cap-person-${captureId}`,
    name, firstName, lastName: rest.join(' '),
    company: person?.company ?? '',
    position: person?.title ?? '',
    url: person?.website ?? '',
    email: person?.emails?.[0] ?? '',
    connectedOn: 'Just now',
    newsInsight: [person?.title, person?.company].filter(Boolean).join(' @ ') || 'Added from a scanned business card.',
    location: person?.address ?? '',
    warmth: 50, ring: 'Extended', reciprocity: 'Balanced', trust: 50, lastConnected: 'Just now',
    captured: true, toolId: 'card-scanner',
  });
}
