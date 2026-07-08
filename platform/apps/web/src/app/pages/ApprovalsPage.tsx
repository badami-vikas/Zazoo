import { useMemo, useState, useEffect } from 'react';
import {
  ShieldCheck, Check, X, PencilLine, Bot, User, ArrowRight, Sparkles,
  CornerDownRight, Inbox, FileText, GitCompareArrows, Info, List as ListIcon,
} from 'lucide-react';
import { Header } from '../components/shared/Header';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { CollapsibleInsights } from '../components/shared/CollapsibleInsights';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import {
  pendingApprovals, delegations, vetoReasons,
  type LedgerEntry, type Decision,
} from '../data/governance';
import { useActionQueue, resolveAction } from '../data/actionQueue';
import { loadLedger, recordDecisionAppend, type LedgerSource } from '../data/ledger';
import { materializeApprovedCapture } from '../data/toolCaptures';
import { API_ENABLED } from '../data/api';

// crude line-diff for the drawer — marks removed (prior-only) and added (proposed-only) lines
function lineDiff(prior: string | null | undefined, proposed: string) {
  const next = proposed.split('\n');
  if (!prior) return next.map(text => ({ text, kind: 'same' as const }));
  const prev = prior.split('\n');
  const prevSet = new Set(prev.map(l => l.trim()));
  const nextSet = new Set(next.map(l => l.trim()));
  const removed = prev.filter(l => l.trim() && !nextSet.has(l.trim())).map(text => ({ text, kind: 'del' as const }));
  const shown = next.map(text => ({ text, kind: nextSet.has(text.trim()) && !prevSet.has(text.trim()) ? ('add' as const) : ('same' as const) }));
  return [...removed, ...shown];
}

function ActorChip({ kind, name }: { kind: 'agent' | 'human'; name: string }) {
  const Icon = kind === 'agent' ? Bot : User;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: kind === 'agent' ? 'color-mix(in srgb, var(--color-steel) 12%, transparent)' : 'var(--color-surface)',
        color: kind === 'agent' ? 'var(--color-steel)' : 'var(--color-navy-mid)',
      }}
    >
      <Icon className="w-3 h-3" /> {name}
    </span>
  );
}

// "Drafted by Agent on behalf of User · ritual run" — provenance on every AI action
function Provenance({ e }: { e: LedgerEntry }) {
  const dlg = e.delegationId ? delegations[e.delegationId] : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: 'var(--color-navy-mid)' }}>
      <span className="font-medium" style={{ color: 'var(--color-warm-gray)' }}>Drafted by</span>
      <ActorChip kind={e.actorKind} name={e.actor} />
      {e.onBehalfOf && (
        <>
          <span style={{ color: 'var(--color-warm-gray)' }}>on behalf of</span>
          <ActorChip kind="human" name={e.onBehalfOf} />
        </>
      )}
      {e.runId && (
        <>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <span className="font-mono" style={{ color: 'var(--color-warm-gray)' }}>{e.runId}</span>
        </>
      )}
      {dlg && (
        <span className="font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }} title={`Delegation ${e.delegationId}`}>
          via delegation: {dlg.scope}
        </span>
      )}
    </div>
  );
}

export function ApprovalsPage() {
  // Live queue = signal-proposed actions (local draft store) + pending rows from the Supabase ledger.
  const queued = useActionQueue();
  const [live, setLive] = useState<LedgerEntry[]>(pendingApprovals);
  const [source, setSource] = useState<LedgerSource>('local');
  useEffect(() => {
    let alive = true;
    loadLedger().then(({ pending, source }) => { if (alive) { setLive(pending); setSource(source); } });
    return () => { alive = false; };
  }, []);
  const queue = useMemo(() => [...queued, ...live], [queued, live]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keep a valid selection as drafts arrive / items resolve.
  useEffect(() => {
    if (queue.length === 0) { if (selectedId !== null) setSelectedId(null); return; }
    if (!selectedId || !queue.some(e => e.id === selectedId)) setSelectedId(queue[0].id);
  }, [queue, selectedId]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [vetoOpen, setVetoOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [resolved, setResolved] = useState<{ id: string; decision: Decision; reason?: string } | null>(null);

  const visibleQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter(e => `${e.action} ${e.resource} ${e.actor} ${e.policy}`.toLowerCase().includes(q));
  }, [queue, search]);
  const selected = useMemo(() => queue.find(e => e.id === selectedId) ?? null, [queue, selectedId]);
  const diff = useMemo(() => (selected ? lineDiff(selected.prior, editing ? draft : selected.proposed) : []), [selected, editing, draft]);

  const advance = (id: string, decision: Decision, reason?: string) => {
    const entry = queue.find(e => e.id === id) ?? null;
    setResolved({ id, decision, reason });
    setTimeout(() => {
      if (queued.some(e => e.id === id)) {
        resolveAction(id);                                   // signal-proposed → local draft store
      } else {
        setLive(q => q.filter(e => e.id !== id));            // live ledger row → optimistic drop
        // append-only: record the decision as a NEW ledger row (the table has no UPDATE policy).
        // Routes through the governed pipeline when the API is enabled, else direct-Supabase append.
        if (entry && (API_ENABLED || source === 'supabase')) recordDecisionAppend(entry, decision, reason);
        // On APPROVE of a tool capture, materialize the Person into the grid (draft-then-approve).
        if (entry) materializeApprovedCapture(entry, decision);
      }
      // selection is re-pointed by the queue effect above
      setResolved(null);
      setEditing(false);
      setVetoOpen(false);
    }, 650);
  };

  const startEdit = () => {
    if (!selected) return;
    setDraft(selected.proposed);
    setEditing(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
      <Header tabs={[{ id: 'Approvals', icon: ShieldCheck }]} activeTab="Approvals" onTabChange={() => {}} />
      <StandardToolbar
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen(o => !o)}
        view="list"
        views={[{ id: 'list', label: 'List', icon: ListIcon }]}
        onViewChange={() => {}}
        search={search}
        onSearchChange={setSearch}
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: 'awaiting', label: 'Awaiting review', value: String(queue.length), hint: 'every outbound or sensitive agent action pauses here' },
          { id: 'source', label: 'Ledger source', value: source === 'supabase' ? 'Supabase' : 'Local', hint: 'append-only' },
        ]}
      />

      {queue.length === 0 ? (
        // Empty state — reinforces governed-by-default, not idle
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
            <Inbox className="w-8 h-8" style={{ color: 'var(--color-sage)' }} />
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>Nothing awaiting review</h2>
          <p className="text-sm max-w-sm mt-2" style={{ color: 'var(--color-navy-mid)' }}>
            Agents are operating within policy. When an action needs your judgment, it will appear here with its full reasoning and provenance.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* List */}
          <div className="w-[380px] shrink-0 border-r overflow-y-auto" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)' }}>
            {visibleQueue.map(e => {
              const active = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  onClick={() => { setSelectedId(e.id); setEditing(false); setVetoOpen(false); }}
                  className="w-full text-left px-4 py-3.5 border-b transition-colors"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: active ? 'color-mix(in srgb, var(--color-steel) 7%, transparent)' : 'transparent',
                    boxShadow: active ? 'inset 3px 0 0 var(--color-steel)' : 'none',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <ActorChip kind={e.actorKind} name={e.actor} />
                    <span className="text-xs font-medium shrink-0" style={{ color: 'var(--color-warm-gray)' }}>{e.age}</span>
                  </div>
                  <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-navy)' }}>
                    {e.action} <span style={{ color: 'var(--color-warm-gray)' }}>→</span> {e.resource}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-navy-mid)' }}>
                    <ShieldCheck className="w-3 h-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
                    <span className="truncate">{e.policy}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail / diff drawer */}
          <div className="flex-1 overflow-y-auto">
            {selected && (
              <div className="max-w-3xl mx-auto px-8 py-8 flex flex-col gap-7">
                {/* title + provenance */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{selected.channel}</span>
                    <h2 className="text-xl font-bold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>
                      {selected.action}
                    </h2>
                  </div>
                  <Provenance e={selected} />
                  <div className="flex items-center gap-2 text-sm">
                    <span style={{ color: 'var(--color-warm-gray)' }}>Target:</span>
                    <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{selected.resource}</span>
                    <span style={{ color: 'var(--color-border)' }}>·</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>
                      <ShieldCheck className="w-3 h-3" /> {selected.policy}
                    </span>
                  </div>
                </div>

                {/* Proposed output + inline diff */}
                <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
                  <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                    {selected.prior ? <GitCompareArrows className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /> : <FileText className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} />}
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-navy-mid)' }}>
                      {selected.prior ? 'Proposed output · diff vs. prior' : 'Proposed output'}
                    </span>
                    {!editing && (
                      <button onClick={startEdit} className="ml-auto text-xs font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors" style={{ color: 'var(--color-steel)' }}>
                        <PencilLine className="w-3.5 h-3.5" /> Edit
                      </button>
                    )}
                  </div>

                  {editing ? (
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={ev => setDraft(ev.target.value)}
                      rows={Math.max(6, draft.split('\n').length + 1)}
                      className="w-full p-4 text-sm font-sans outline-none resize-none"
                      style={{ color: 'var(--color-navy)', backgroundColor: 'white' }}
                    />
                  ) : (
                    <div className="p-4 text-sm whitespace-pre-wrap leading-relaxed font-sans">
                      {diff.map((l, i) => (
                        <div
                          key={i}
                          className="px-2 -mx-2 rounded"
                          style={{
                            backgroundColor: l.kind === 'add' ? 'color-mix(in srgb, var(--success) 12%, transparent)'
                              : l.kind === 'del' ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'transparent',
                            color: l.kind === 'del' ? 'var(--danger)' : 'var(--color-navy)',
                            textDecoration: l.kind === 'del' ? 'line-through' : 'none',
                            opacity: l.kind === 'del' ? 0.7 : 1,
                          }}
                        >
                          {l.kind !== 'same' && <span className="font-bold mr-1.5">{l.kind === 'add' ? '+' : '−'}</span>}
                          {l.text || ' '}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Why — decision_traces */}
                <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'color-mix(in srgb, var(--color-steel) 25%, var(--color-border))', backgroundColor: 'color-mix(in srgb, var(--color-steel) 4%, transparent)' }}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-steel)' }}>Why this was proposed</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.trace.signals.map(s => (
                      <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: 'white', color: 'var(--color-navy-mid)', border: '1px solid var(--color-border)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-amber-soft, var(--warning))' }} /> {s}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>
                    <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Context. </span>{selected.trace.context}
                  </p>
                  <p className="text-sm leading-relaxed flex gap-2" style={{ color: 'var(--color-navy-mid)' }}>
                    <CornerDownRight className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
                    <span><span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Reasoning. </span>{selected.trace.reasoning}</span>
                  </p>
                </div>

                {/* Veto reason chips */}
                <AnimatePresence>
                  {vetoOpen && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="rounded-xl border p-4" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--color-border))', backgroundColor: 'color-mix(in srgb, var(--danger) 5%, transparent)' }}>
                        <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--danger)' }}>Why are you vetoing? <span className="font-normal normal-case" style={{ color: 'var(--color-navy-mid)' }}>(optional)</span></div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {vetoReasons.map(r => (
                            <button key={r} onClick={() => advance(selected.id, 'vetoed', r)} className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white', color: 'var(--color-navy-mid)' }}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-warm-gray)' }}>
                          <Info className="w-3.5 h-3.5 shrink-0" />
                          This tunes future drafts — your veto adjusts policy parameters, never the agent’s code.
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex items-center gap-3 sticky bottom-0 py-4 -mb-8" style={{ background: 'linear-gradient(to top, var(--color-background) 70%, transparent)' }}>
                  <button
                    onClick={() => advance(selected.id, editing ? 'edited_approved' : 'approved')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--success)' }}
                  >
                    <Check className="w-4 h-4" /> {editing ? 'Approve edit' : 'Approve'}
                  </button>
                  {!editing && (
                    <button onClick={startEdit} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)', backgroundColor: 'white' }}>
                      <PencilLine className="w-4 h-4" /> Edit then approve
                    </button>
                  )}
                  <button
                    onClick={() => setVetoOpen(v => !v)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ml-auto"
                    style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--color-border))', color: 'var(--danger)', backgroundColor: vetoOpen ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'white' }}
                  >
                    <X className="w-4 h-4" /> Veto
                  </button>
                </div>

                {/* resolution toast */}
                <AnimatePresence>
                  {resolved && resolved.id === selected.id && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold text-white flex items-center gap-2 z-50"
                      style={{ backgroundColor: resolved.decision === 'vetoed' ? 'var(--danger)' : 'var(--success)' }}
                    >
                      {resolved.decision === 'vetoed' ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                      Recorded to ledger · {resolved.decision === 'vetoed' ? `Vetoed${resolved.reason ? ` (${resolved.reason})` : ''}` : 'Approved'} <ArrowRight className="w-3.5 h-3.5" /> append-only
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
