import { useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  Lock, Download, Filter, X, Bot, User, ArrowRight, ShieldCheck, Layers,
  CheckCircle2, XCircle, MinusCircle, GitCommitVertical, ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import {
  allLedger, delegations, decisionLabel, decisionToken,
  type LedgerEntry, type Decision, type PolicyResult,
} from '../data/governance';
import { loadLedger, type LedgerSource } from '../data/ledger';

// derive a pre/runtime/post policy ladder for the trace drawer from the entry
function derivePolicyResults(e: LedgerEntry): PolicyResult[] {
  const base: PolicyResult[] = [
    { phase: 'pre', policy: 'Actor authority resolved', result: 'pass', note: 'role ∩ capability_scope − deny' },
    { phase: 'runtime', policy: e.policy === '—' ? 'No runtime policy' : e.policy, result: e.decision === 'auto_approved' ? 'pass' : 'flag', note: e.decision === 'auto_approved' ? 'within policy' : 'routed for human review' },
  ];
  const post: PolicyResult =
    e.decision === 'vetoed'
      ? { phase: 'post', policy: 'Outcome recorded', result: 'block', note: 'vetoed — no event emitted' }
      : { phase: 'post', policy: 'Outcome recorded', result: 'pass', note: 'event emitted downstream' };
  return [...base, post];
}

function diffLines(prior: string | null | undefined, proposed: string) {
  const next = proposed.split('\n');
  if (!prior) return next.map(text => ({ text, kind: 'same' as const }));
  const nextSet = new Set(next.map(l => l.trim()));
  const prevSet = new Set(prior.split('\n').map(l => l.trim()));
  const removed = prior.split('\n').filter(l => l.trim() && !nextSet.has(l.trim())).map(text => ({ text, kind: 'del' as const }));
  const shown = next.map(text => ({ text, kind: nextSet.has(text.trim()) && !prevSet.has(text.trim()) ? ('add' as const) : ('same' as const) }));
  return [...removed, ...shown];
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows: LedgerEntry[]): string {
  const head = ['id', 'timestamp', 'actor_kind', 'actor', 'on_behalf_of', 'delegation_id', 'action', 'resource_type', 'resource', 'policy', 'decision', 'run_id'];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(e => [e.id, e.ts, e.actorKind, e.actor, e.onBehalfOf ?? '', e.delegationId ?? '', e.action, e.resourceType, e.resource, e.policy, decisionLabel(e.decision), e.runId ?? ''].map(esc).join(','));
  return [head.join(','), ...body].join('\n');
}

const DecisionPill = ({ d }: { d: Decision }) => (
  <span
    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
    style={{ backgroundColor: `color-mix(in srgb, ${decisionToken(d)} 14%, transparent)`, color: decisionToken(d) }}
  >
    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: decisionToken(d) }} />
    {decisionLabel(d)}
  </span>
);

const ActorCell = ({ kind, name }: { kind: 'agent' | 'human'; name: string }) => {
  const Icon = kind === 'agent' ? Bot : User;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-navy)' }}>
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: kind === 'agent' ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
      <span className="font-medium">{name}</span>
    </span>
  );
};

export function ExecutionLedger() {
  const [actorFilter, setActorFilter] = useState<'all' | 'agent' | 'human'>('all');
  const [decisionFilter, setDecisionFilter] = useState<'all' | NonNullable<Decision> | 'pending'>('all');
  const [resourceFilter, setResourceFilter] = useState<'all' | LedgerEntry['resourceType']>('all');
  const [lens, setLens] = useState(false); // delegation lens — group by on-behalf-of
  const [openId, setOpenId] = useState<string | null>(null);

  // Append-only ledger, Supabase-first → local fallback (mirrors data/db.ts).
  const [entries, setEntries] = useState<LedgerEntry[]>(allLedger);
  const [source, setSource] = useState<LedgerSource>('local');
  useEffect(() => {
    let alive = true;
    loadLedger().then(({ all, source }) => { if (alive) { setEntries(all); setSource(source); } });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    return entries.filter(e => {
      if (actorFilter !== 'all' && e.actorKind !== actorFilter) return false;
      if (resourceFilter !== 'all' && e.resourceType !== resourceFilter) return false;
      if (decisionFilter !== 'all') {
        if (decisionFilter === 'pending' && e.decision !== null) return false;
        if (decisionFilter !== 'pending' && e.decision !== decisionFilter) return false;
      }
      return true;
    });
  }, [entries, actorFilter, decisionFilter, resourceFilter]);

  const open = openId ? entries.find(e => e.id === openId) ?? null : null;

  // delegation lens grouping
  const groups = useMemo(() => {
    if (!lens) return null;
    const m = new Map<string, LedgerEntry[]>();
    rows.forEach(e => {
      const key = e.onBehalfOf ?? '— direct (no delegation) —';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    });
    return Array.from(m.entries());
  }, [rows, lens]);

  const Select = ({ value, onChange, opts }: { value: string; onChange: (v: any) => void; opts: { v: string; label: string }[] }) => (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs font-medium px-2.5 py-1.5 rounded-lg border outline-none cursor-pointer"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}
    >
      {opts.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );

  const Row = ({ e }: { e: LedgerEntry }) => (
    <tr
      onClick={() => setOpenId(e.id)}
      className="border-b cursor-pointer transition-colors group"
      style={{ borderColor: 'var(--color-border)' }}
      onMouseEnter={ev => (ev.currentTarget.style.backgroundColor = 'var(--color-surface)')}
      onMouseLeave={ev => (ev.currentTarget.style.backgroundColor = 'transparent')}
    >
      <td className="px-4 py-3 text-xs font-mono whitespace-nowrap" style={{ color: 'var(--color-warm-gray)' }}>{e.ts}</td>
      <td className="px-4 py-3"><ActorCell kind={e.actorKind} name={e.actor} /></td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-navy-mid)' }}>{e.onBehalfOf ?? <span style={{ color: 'var(--color-warm-gray)' }}>—</span>}</td>
      <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--color-navy)' }}>{e.action}</td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-navy-mid)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-warm-gray)' }}>{e.resourceType}</span>
          {e.resource}
        </span>
      </td>
      <td className="px-4 py-3"><DecisionPill d={e.decision} /></td>
      <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 inline opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-warm-gray)' }} /></td>
    </tr>
  );

  const TableHead = () => (
    <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
      <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
        {['Timestamp', 'Actor', 'On behalf of', 'Action', 'Resource', 'Decision', ''].map(h => (
          <th key={h} className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--color-navy-mid)' }}>{h}</th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--color-navy)' }}>Execution Ledger</h2>
          <p className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>Every action an agent or teammate took — what, on whose behalf, and why.</p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0" title={source === 'supabase' ? 'Loaded from the Supabase ledger (append-only)' : 'Supabase unreachable — showing local fallback (empty)'} style={{ backgroundColor: source === 'supabase' ? 'color-mix(in srgb, var(--success) 14%, transparent)' : 'var(--color-surface)', color: source === 'supabase' ? 'var(--success)' : 'var(--color-warm-gray)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: source === 'supabase' ? 'var(--success)' : 'var(--color-warm-gray)' }} /> {source === 'supabase' ? 'Supabase ledger' : 'Local'}
        </span>
      </div>

      {/* tamper-evident banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border" style={{ backgroundColor: 'color-mix(in srgb, var(--color-navy) 4%, transparent)', borderColor: 'var(--color-border)' }}>
        <Lock className="w-4 h-4 shrink-0" style={{ color: 'var(--color-navy-mid)' }} />
        <div className="text-xs flex-1" style={{ color: 'var(--color-navy-mid)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Append-only · tamper-evident.</span> Entries cannot be edited or deleted — the database revokes UPDATE and DELETE on this table. Export for SOC 2 evidence.
        </div>
        <button onClick={() => download('bridge-ledger.csv', toCSV(rows), 'text/csv')} className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={() => download('bridge-ledger.json', JSON.stringify(rows, null, 2), 'application/json')} className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>
          <Download className="w-3.5 h-3.5" /> JSON
        </button>
      </div>

      {/* filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} />
        <Select value={actorFilter} onChange={setActorFilter} opts={[{ v: 'all', label: 'All actors' }, { v: 'agent', label: 'Agents' }, { v: 'human', label: 'Humans' }]} />
        <Select value={decisionFilter} onChange={setDecisionFilter} opts={[{ v: 'all', label: 'Any decision' }, { v: 'approved', label: 'Approved' }, { v: 'edited_approved', label: 'Edited + approved' }, { v: 'vetoed', label: 'Vetoed' }, { v: 'auto_approved', label: 'Auto-approved' }, { v: 'pending', label: 'Pending' }]} />
        <Select value={resourceFilter} onChange={setResourceFilter} opts={[{ v: 'all', label: 'Any resource' }, { v: 'person', label: 'Person' }, { v: 'initiative', label: 'Initiative' }, { v: 'community', label: 'Community' }, { v: 'ritual', label: 'Ritual' }, { v: 'external', label: 'External' }]} />
        <button
          onClick={() => setLens(l => !l)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ml-auto"
          style={{ borderColor: lens ? 'var(--color-steel)' : 'var(--color-border)', color: lens ? 'var(--color-steel)' : 'var(--color-navy-mid)', backgroundColor: lens ? 'color-mix(in srgb, var(--color-steel) 8%, transparent)' : 'white' }}
          title="Group by on whose behalf"
        >
          <Layers className="w-3.5 h-3.5" /> Delegation lens
        </button>
      </div>

      {/* table */}
      <div className="rounded-xl border overflow-hidden shadow-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
        {!lens ? (
          <table className="w-full">
            <TableHead />
            <tbody>{rows.map(e => <Row key={e.id} e={e} />)}</tbody>
          </table>
        ) : (
          <div>
            {groups!.map(([key, list]) => {
              const dlgEntry = list.find(x => x.delegationId)?.delegationId;
              const dlg = dlgEntry ? delegations[dlgEntry] : null;
              return (
                <div key={key}>
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 6%, transparent)', borderColor: 'var(--color-border)' }}>
                    <Layers className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} />
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-navy)' }}>On behalf of {key}</span>
                    {dlg && <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>· {dlg.scope}</span>}
                    <span className="ml-auto text-xs font-medium" style={{ color: 'var(--color-warm-gray)' }}>{list.length}</span>
                  </div>
                  <table className="w-full"><tbody>{list.map(e => <Row key={e.id} e={e} />)}</tbody></table>
                </div>
              );
            })}
          </div>
        )}
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>No entries match these filters.</div>
        )}
      </div>

      {/* Trace drawer — the full §3 pipeline for one action */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpenId(null)} className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(26,43,60,0.35)' }} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="fixed top-0 right-0 bottom-0 w-[460px] max-w-[92vw] z-50 overflow-y-auto shadow-2xl"
              style={{ backgroundColor: 'var(--color-background)' }}
            >
              <div className="sticky top-0 z-10 px-5 py-4 border-b flex items-center justify-between" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
                <div className="flex items-center gap-2">
                  <GitCommitVertical className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
                  <span className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>Decision trace</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-warm-gray)' }}>{open.id}</span>
                </div>
                <button onClick={() => setOpenId(null)} className="p-1.5 rounded-lg" style={{ color: 'var(--color-warm-gray)' }}><X className="w-4 h-4" /></button>
              </div>

              <div className="px-5 py-5 flex flex-col gap-5">
                {/* header line */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <ActorCell kind={open.actorKind} name={open.actor} />
                    {open.onBehalfOf && <><ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} /><span className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>on behalf of <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{open.onBehalfOf}</span></span></>}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--color-navy)' }}><span className="font-semibold">{open.action}</span> → {open.resource}</div>
                  <div><DecisionPill d={open.decision} /></div>
                </div>

                {/* inputs / signals */}
                <Section title="Inputs · signals">
                  <div className="flex flex-wrap gap-1.5">
                    {open.trace.signals.map(s => (
                      <span key={s} className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: 'white', color: 'var(--color-navy-mid)', border: '1px solid var(--color-border)' }}>{s}</span>
                    ))}
                  </div>
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>{open.trace.context}</p>
                </Section>

                {/* proposed + diff */}
                <Section title={open.prior ? 'Proposed · diff vs prior' : 'Proposed'}>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed font-sans">
                    {diffLines(open.prior, open.proposed).map((l, i) => (
                      <div key={i} className="px-1.5 -mx-1.5 rounded" style={{
                        backgroundColor: l.kind === 'add' ? 'color-mix(in srgb, var(--success) 12%, transparent)' : l.kind === 'del' ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'transparent',
                        color: l.kind === 'del' ? 'var(--danger)' : 'var(--color-navy)',
                        textDecoration: l.kind === 'del' ? 'line-through' : 'none', opacity: l.kind === 'del' ? 0.7 : 1,
                      }}>
                        {l.kind !== 'same' && <span className="font-bold mr-1">{l.kind === 'add' ? '+' : '−'}</span>}{l.text || ' '}
                      </div>
                    ))}
                  </div>
                </Section>

                {/* reasoning */}
                <Section title="Reasoning">
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>{open.trace.reasoning}</p>
                </Section>

                {/* policy ladder pre/runtime/post */}
                <Section title="Policy results">
                  <div className="flex flex-col gap-1.5">
                    {derivePolicyResults(open).map((p, i) => {
                      const Icon = p.result === 'pass' ? CheckCircle2 : p.result === 'block' ? XCircle : MinusCircle;
                      const color = p.result === 'pass' ? 'var(--success)' : p.result === 'block' ? 'var(--danger)' : 'var(--warning)';
                      return (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className="uppercase font-bold tracking-wider w-14 shrink-0 pt-0.5" style={{ color: 'var(--color-warm-gray)' }}>{p.phase}</span>
                          <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color }} />
                          <span className="flex-1" style={{ color: 'var(--color-navy)' }}><span className="font-medium">{p.policy}</span>{p.note && <span style={{ color: 'var(--color-warm-gray)' }}> — {p.note}</span>}</span>
                        </div>
                      );
                    })}
                  </div>
                </Section>

                {/* emitted event */}
                <div className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-lg" style={{ backgroundColor: open.decision === 'vetoed' ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'color-mix(in srgb, var(--success) 8%, transparent)', color: open.decision === 'vetoed' ? 'var(--danger)' : 'var(--success)' }}>
                  {open.decision === 'vetoed' ? <XCircle className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span className="font-medium">{open.decision === 'vetoed' ? 'No downstream event — action was vetoed.' : 'Event emitted downstream after this decision.'}</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-navy-mid)' }}>{title}</div>
      {children}
    </div>
  );
}
