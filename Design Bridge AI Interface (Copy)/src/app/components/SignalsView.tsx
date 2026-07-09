import { RefreshCw, UserPlus, HandHeart, Briefcase, TrendingUp, ArrowRight, MoreHorizontal, Sparkles, ShieldCheck, Check, Users, X, ArrowLeftRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { signals as allSignals, proposeFromSignal, type Signal, type SignalType } from '../data/signals';
import { proposeAction } from '../data/actionQueue';
import { proposeToLedger } from '../data/ledger';
import { loadDbSignals, approveDbSignal, dismissDbSignal, saveSignalNote, loadDuplicatePair, type DbSignal, type DupProfile } from '../data/dbSignals';
import { ReconReview } from './ReconReview';

const signalMeta: Record<SignalType, { icon: any; label: string; color: string }> = {
  Dormant: { icon: RefreshCw, label: 'Dormant Reconnect', color: '#C4955A' },
  Introduction: { icon: UserPlus, label: 'Introduction', color: '#4D7EA8' },
  Help: { icon: HandHeart, label: 'Help Opportunity', color: '#6B7C65' },
  'Hiring/Fundraising': { icon: Briefcase, label: 'Hiring / Fundraising', color: '#2E4057' },
  Community: { icon: TrendingUp, label: 'Community Movement', color: '#7FA5C5' },
};

// DB-backed signal categories, shown as first-class filter tags alongside the derived ones.
const dbMeta: Record<string, { icon: any; label: string; color: string }> = {
  possible_duplicate: { icon: Users, label: 'Possible Duplicate', color: '#9B6B8F' },
};
const dbMetaFor = (t: string) => dbMeta[t] || { icon: ShieldCheck, label: t.replace(/[._]/g, ' '), color: '#4D7EA8' };

const priorityStyle = {
  high: { bg: '#FDF2F2', dot: '#C0573E', label: 'High priority' },
  medium: { bg: '#F0EEE8', dot: '#C4955A', label: 'Medium' },
  low: { bg: '#F0EEE8', dot: '#6B7C65', label: 'Low' },
};

export function SignalsView({ selectedList }: { selectedList?: string | null }) {
  const [filter, setFilter] = useState<string>('all'); // 'all' | SignalType | `db:<type>`
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [dbSignals, setDbSignals] = useState<DbSignal[]>([]);
  const [reviewing, setReviewing] = useState<DbSignal | null>(null);
  const [reviewingDb, setReviewingDb] = useState<DbSignal | null>(null);
  const [reconOpen, setReconOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { loadDbSignals().then(setDbSignals); }, []);

  const removeDb = (id: string) => setDbSignals(prev => prev.filter(x => x.id !== id));
  // possible_duplicate → merge-review drawer; recon.promotion → full recon review; else → generic detail drawer.
  const openDb = (s: DbSignal) =>
    s.type === 'possible_duplicate' ? setReviewing(s)
    : s.type === 'recon.promotion' ? setReconOpen(true)
    : setReviewingDb(s);

  let filteredDerived = (filter === 'all' || !filter.startsWith('db:'))
    ? (filter === 'all' ? allSignals : allSignals.filter(s => s.type === filter))
    : [];
  if (selectedList === 'High priority') filteredDerived = filteredDerived.filter(s => s.priority === 'high');
  if (selectedList === 'Dormant') filteredDerived = filteredDerived.filter(s => s.type === 'Dormant');
  if (selectedList === 'Intros') filteredDerived = filteredDerived.filter(s => s.type === 'Introduction');

  const dbToShow = filter === 'all' ? dbSignals : (filter.startsWith('db:') ? dbSignals.filter(s => 'db:' + s.type === filter) : []);

  const types = Object.keys(signalMeta) as SignalType[];
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of allSignals) m[s.type] = (m[s.type] ?? 0) + 1;
    return m;
  }, []);
  const dbCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of dbSignals) m[s.type] = (m[s.type] ?? 0) + 1;
    return m;
  }, [dbSignals]);

  const act = async (s: Signal, actionIndex: number, label: string) => {
    const entry = proposeFromSignal(s, actionIndex);
    const live = await proposeToLedger(entry);
    if (!live) proposeAction(entry);
    setProposed(prev => ({ ...prev, [s.id]: label }));
    setToast(live ? `“${label}” drafted to Approvals — recorded in the live ledger` : `“${label}” drafted — sent to Approvals for your review`);
    window.setTimeout(() => setToast(null), 2800);
  };

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 3200); };

  const empty = filteredDerived.length === 0 && dbToShow.length === 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 style={{ fontFamily: 'var(--font-editorial)', fontSize: '28px', fontWeight: 600, color: 'var(--color-navy)', letterSpacing: '-0.02em' }}>
          Signals
        </h1>
        <p style={{ color: 'var(--color-warm-gray)', maxWidth: 660 }}>
          What relationship actions matter right now. Each signal is a decision surface — context, insight, and the evidence it stands on.
          <span style={{ color: 'var(--color-navy-mid)' }}> Acting drafts a proposal for your approval; nothing is sent automatically.</span>
        </p>
      </div>

      {/* Type filter — derived + DB-backed categories together */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border"
          style={{
            backgroundColor: filter === 'all' ? 'var(--color-steel)' : 'white',
            color: filter === 'all' ? 'white' : 'var(--color-navy-mid)',
            borderColor: filter === 'all' ? 'var(--color-steel)' : 'var(--color-border)',
          }}
        >
          All ({allSignals.length + dbSignals.length})
        </button>
        {types.map(t => {
          const meta = signalMeta[t];
          const Icon = meta.icon;
          const count = counts[t] ?? 0;
          if (count === 0) return null;
          const active = filter === t;
          return (
            <button key={t} onClick={() => setFilter(t)}
              className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border flex items-center gap-1.5"
              style={{ backgroundColor: active ? meta.color : 'white', color: active ? 'white' : 'var(--color-navy-mid)', borderColor: active ? meta.color : 'var(--color-border)' }}>
              <Icon className="w-3.5 h-3.5" />{meta.label} ({count})
            </button>
          );
        })}
        {Object.keys(dbCounts).map(t => {
          const meta = dbMetaFor(t);
          const Icon = meta.icon;
          const active = filter === 'db:' + t;
          return (
            <button key={t} onClick={() => setFilter('db:' + t)}
              className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border flex items-center gap-1.5"
              style={{ backgroundColor: active ? meta.color : 'white', color: active ? 'white' : 'var(--color-navy-mid)', borderColor: active ? meta.color : 'var(--color-border)' }}>
              <Icon className="w-3.5 h-3.5" />{meta.label} ({dbCounts[t]})
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3">
        {/* DB-backed signal cards (governance / data quality) — click to review */}
        {dbToShow.map(s => {
          const meta = dbMetaFor(s.type);
          const Icon = meta.icon;
          const name = String(s.payload.name || s.action.label || s.type);
          return (
            <article key={s.id}
              className="border rounded-xl bg-white p-4 hover:shadow-md transition-shadow cursor-pointer"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => openDb(s)}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + '18' }}>
                  <Icon className="w-4.5 h-4.5" style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>· needs your review</span>
                  </div>
                  <h3 className="mt-0.5 truncate" style={{ fontFamily: 'var(--font-editorial)', fontSize: '16px', fontWeight: 600, color: 'var(--color-navy)' }}>{name}</h3>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-navy-mid)' }}>{String(s.payload.reason || s.payload.preview || s.action.description || '')}</p>
                </div>
                <button className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                  style={{ backgroundColor: meta.color }}
                  onClick={(e) => { e.stopPropagation(); openDb(s); }}>
                  Review <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </article>
          );
        })}

        {/* Derived relationship signals */}
        {filteredDerived.map((s, idx) => {
          const meta = signalMeta[s.type];
          const Icon = meta.icon;
          const pri = priorityStyle[s.priority];
          const wasProposed = proposed[s.id];
          return (
            <motion.article key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx * 0.04, 0.3) }}
              className="border rounded-xl bg-white p-5 hover:shadow-md transition-shadow" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + '15' }}>
                  <Icon className="w-5 h-5" style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-xs uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: pri.bg, color: pri.dot }}>{pri.label}</span>
                    {s.warmthLabel && (<span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{s.warmthLabel}</span>)}
                    <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>· {s.detectedAt}</span>
                  </div>
                  {s.whoId ? (
                    <button onClick={() => navigate(`/item/${encodeURIComponent(s.whoId!)}`)} className="mt-1 text-left hover:underline truncate block" style={{ fontFamily: 'var(--font-editorial)', fontSize: '17px', fontWeight: 600, color: 'var(--color-navy)' }}>{s.who}</button>
                  ) : (
                    <h3 className="mt-1 truncate" style={{ fontFamily: 'var(--font-editorial)', fontSize: '17px', fontWeight: 600, color: 'var(--color-navy)' }}>{s.who}</h3>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-warm-gray)' }} title="The agent that surfaced this signal"><Sparkles className="w-3 h-3" /> {s.agent}</span>
                  <button className="p-1.5 rounded-md hover:bg-[var(--color-surface)] text-[var(--color-warm-gray)]"><MoreHorizontal className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex flex-col gap-3" style={{ paddingLeft: 52 }}>
                <SignalRow label="Context" body={s.context} />
                <SignalRow label="Insight" body={s.insight} accent />
                <div>
                  <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Why this fired</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.evidence.map(e => (
                      <span key={e} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: 'white', color: 'var(--color-navy-mid)', border: '1px solid var(--color-border)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} /> {e}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Recommended action</div>
                  {wasProposed ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}><Check className="w-3.5 h-3.5" /> Drafted: {wasProposed}</span>
                      <button onClick={() => navigate('/approvals')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border bg-white hover:bg-[var(--color-surface)] transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)' }}><ShieldCheck className="w-3.5 h-3.5" /> Review in Approvals <ArrowRight className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => act(s, 0, s.actions[0].label)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90" style={{ backgroundColor: 'var(--color-steel)' }}><Sparkles className="w-3.5 h-3.5" /> {s.actions[0].label} <ArrowRight className="w-3.5 h-3.5" /></button>
                      {s.actions.slice(1).map((a, ai) => (
                        <button key={a.label} onClick={() => act(s, ai + 1, a.label)} className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-white hover:bg-[var(--color-surface)] transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{a.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.article>
          );
        })}
        {empty && (
          <div className="p-10 text-center border border-dashed rounded-xl" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>No signals match the current filter.</div>
        )}
      </div>

      {/* Review drawer for possible_duplicate */}
      <AnimatePresence>
        {reviewing && (
          <DupReviewDrawer
            signal={reviewing}
            onClose={() => setReviewing(null)}
            onResolved={(msg) => { flash(msg); removeDb(reviewing.id); setReviewing(null); }}
            onNote={(msg) => flash(msg)}
          />
        )}
      </AnimatePresence>

      {/* Generic review drawer for data signals */}
      <AnimatePresence>
        {reviewingDb && (
          <DbDetailDrawer
            signal={reviewingDb}
            onClose={() => setReviewingDb(null)}
            onResolved={(msg) => { flash(msg); removeDb(reviewingDb.id); setReviewingDb(null); }}
            onError={(msg) => flash(msg)}
          />
        )}
      </AnimatePresence>

      {/* Full recon staging review (recon.promotion) */}
      <AnimatePresence>
        {reconOpen && <ReconReview onClose={() => setReconOpen(false)} onToast={flash} />}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold text-white flex items-center gap-2 z-50" style={{ backgroundColor: 'var(--color-steel)' }}>
            <ShieldCheck className="w-4 h-4" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SignalRow({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--color-warm-gray)' }}>{label}</div>
      <p className="text-sm leading-relaxed" style={{ color: accent ? 'var(--color-navy)' : 'var(--color-navy-mid)', fontWeight: accent ? 500 : 400 }}>{body}</p>
    </div>
  );
}

// ── Possible-duplicate review drawer ──────────────────────────────────────────
function DupReviewDrawer({ signal, onClose, onResolved, onNote }: {
  signal: DbSignal; onClose: () => void; onResolved: (msg: string) => void; onNote: (msg: string) => void;
}) {
  const [pair, setPair] = useState<{ imported?: DupProfile; candidate?: DupProfile }>({});
  const [loading, setLoading] = useState(true);
  const [survivor, setSurvivor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadDuplicatePair(signal).then(p => {
      setPair(p);
      setSurvivor(p.candidate?.id ?? p.imported?.id ?? null); // default: keep the pre-existing record
      setLoading(false);
    });
  }, [signal]);

  const survProfile = survivor === pair.imported?.id ? pair.imported : pair.candidate;
  const otherProfile = survivor === pair.imported?.id ? pair.candidate : pair.imported;
  const uniq = (xs: (string | undefined | null)[]) => Array.from(new Set(xs.filter(Boolean) as string[]));
  const mergedEmails = uniq([...(survProfile?.emails || []), ...(otherProfile?.emails || [])]);
  const mergedLists = uniq([...(survProfile?.lists || []), ...(otherProfile?.lists || [])]);
  const pick = (a?: string | null, b?: string | null) => a || b || '—';

  const approve = async () => {
    setBusy(true);
    const r = await approveDbSignal(signal, { survivor: survivor ?? undefined });
    setBusy(false);
    if (r.ok) onResolved(`Merged — kept ${survProfile?.full_name || 'survivor'}, combined fields & lists`);
    else onNote(`Merge failed: ${r.error || 'unknown error'}`);
  };
  const dismiss = async () => {
    setBusy(true);
    const r = await dismissDbSignal(signal, { note: note || undefined });
    setBusy(false);
    if (r.ok) onResolved('Dismissed — marked not a duplicate');
    else onNote(`Dismiss failed: ${r.error || 'unknown error'}`);
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    const r = await saveSignalNote(signal, note.trim());
    setBusy(false);
    onNote(r.ok ? 'Instructions saved on this signal' : `Could not save: ${r.error}`);
  };

  return (
    <motion.div className="absolute inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.div className="relative h-full w-full max-w-2xl bg-white shadow-2xl overflow-y-auto"
        initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} style={{ borderLeft: '1px solid var(--color-border)' }}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Users className="w-4.5 h-4.5" style={{ color: '#9B6B8F' }} />
            <h2 style={{ fontFamily: 'var(--font-editorial)', fontSize: '18px', fontWeight: 600, color: 'var(--color-navy)' }}>Review possible duplicate</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>Loading both profiles…</div>
        ) : (
          <div className="p-6 flex flex-col gap-5">
            <p className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>
              These two records share the name <strong>{signal.payload.name}</strong>. Choose which to <strong>keep</strong> (survivor); the other is merged into it — emails, contact details and list memberships are combined, nothing is lost. The merged-away record is then removed.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {[pair.imported, pair.candidate].filter(Boolean).map((p) => {
                const prof = p as DupProfile;
                const isSurv = survivor === prof.id;
                return (
                  <button key={prof.id} onClick={() => setSurvivor(prof.id)} className="text-left rounded-xl border p-3 transition-all"
                    style={{ borderColor: isSurv ? '#9B6B8F' : 'var(--color-border)', boxShadow: isSurv ? '0 0 0 2px #9B6B8F33' : 'none', backgroundColor: isSurv ? '#9B6B8F0A' : 'white' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>
                        {prof.id === pair.imported?.id ? 'Imported' : 'Existing'}
                      </span>
                      {isSurv && <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: '#9B6B8F' }}>Keep</span>}
                    </div>
                    <div style={{ fontFamily: 'var(--font-editorial)', fontWeight: 600, color: 'var(--color-navy)' }}>{prof.full_name || '—'}</div>
                    <div className="text-sm mt-0.5" style={{ color: 'var(--color-navy-mid)' }}>{pick(prof.current_title)}</div>
                    <div className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>{pick(prof.current_company_name)}</div>
                    <Field label="Email" v={(prof.emails || []).join(', ') || '—'} />
                    <Field label="LinkedIn" v={prof.linkedin_url || '—'} />
                    <Field label="Location" v={[prof.location_city, prof.location_country].filter(Boolean).join(', ') || '—'} />
                    <Field label="Lists" v={prof.lists.join(', ') || '—'} />
                    <Field label="Source" v={prof.enrichment_source || '—'} />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-center">
              <button onClick={() => setSurvivor(otherProfile?.id ?? survivor)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border hover:bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                <ArrowLeftRight className="w-3.5 h-3.5" /> Swap which one is kept
              </button>
            </div>

            {/* Merge preview */}
            <div className="rounded-xl border p-3" style={{ borderColor: '#9B6B8F', backgroundColor: '#9B6B8F08' }}>
              <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: '#9B6B8F' }}>Result after merge</div>
              <div style={{ fontFamily: 'var(--font-editorial)', fontWeight: 600, color: 'var(--color-navy)' }}>{survProfile?.full_name || '—'}</div>
              <Field label="Title" v={pick(survProfile?.current_title, otherProfile?.current_title)} />
              <Field label="Company" v={pick(survProfile?.current_company_name, otherProfile?.current_company_name)} />
              <Field label="LinkedIn" v={pick(survProfile?.linkedin_url, otherProfile?.linkedin_url)} />
              <Field label="Emails" v={mergedEmails.join(', ') || '—'} />
              <Field label="Lists" v={mergedLists.join(', ') || '—'} />
            </div>

            {/* Instructions / modify */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--color-warm-gray)' }}>Instructions / notes (optional)</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. these are different people — keep both; or merge but use the imported title…"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--color-steel)]" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }} />
              <button onClick={saveNote} disabled={busy || !note.trim()} className="self-start text-xs font-semibold px-2.5 py-1 rounded-md border hover:bg-[var(--color-surface)] disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)' }}>Save instructions only</button>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: 'var(--color-border)', paddingTop: 14 }}>
              <button onClick={approve} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#9B6B8F' }}>
                <Check className="w-4 h-4" /> {busy ? 'Working…' : `Merge — keep ${survProfile?.full_name?.split(' ')[0] || 'this'}`}
              </button>
              <button onClick={dismiss} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold border bg-white hover:bg-[var(--color-surface)] disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                Not a duplicate
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex gap-1.5 text-xs mt-0.5">
      <span className="shrink-0" style={{ color: 'var(--color-warm-gray)', minWidth: 58 }}>{label}</span>
      <span className="truncate" style={{ color: 'var(--color-navy-mid)' }} title={v}>{v}</span>
    </div>
  );
}

// ── Generic review drawer for recon / data signals (e.g. recon.promotion) ─────
function DbDetailDrawer({ signal, onClose, onResolved, onError }: {
  signal: DbSignal; onClose: () => void; onResolved: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const meta = dbMetaFor(signal.type);
  const Icon = meta.icon;
  // Surface the human-meaningful payload fields (skip giant maps / internal keys).
  const rows = Object.entries(signal.payload || {}).filter(([k, v]) =>
    !['preview', 'applied_detail', 'reason'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'));

  const approve = async () => {
    setBusy(true);
    const r = await approveDbSignal(signal);
    setBusy(false);
    if (r.ok) onResolved(`Approved — ${r.detail || 'applied'}`);
    else onError(`Couldn’t apply: ${r.error || 'the executor for this signal type is unreachable'}`);
  };
  const dismiss = async () => {
    setBusy(true);
    const r = await dismissDbSignal(signal);
    setBusy(false);
    if (r.ok) onResolved('Dismissed');
    else onError(`Dismiss failed: ${r.error || 'unknown error'}`);
  };

  return (
    <motion.div className="absolute inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.div className="relative h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto"
        initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} style={{ borderLeft: '1px solid var(--color-border)' }}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Icon className="w-4.5 h-4.5" style={{ color: meta.color }} />
            <h2 style={{ fontFamily: 'var(--font-editorial)', fontSize: '18px', fontWeight: 600, color: 'var(--color-navy)' }}>{meta.label}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 flex flex-col gap-5">
          <div>
            <div className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>{signal.action.label}</div>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>{String(signal.payload.preview || signal.action.description || '')}</p>
          </div>

          {rows.length > 0 && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Details</div>
              {rows.map(([k, v]) => <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())} v={String(v)} />)}
            </div>
          )}

          {/* the WashU-style company_merge map, if present */}
          {signal.payload.map && typeof signal.payload.map === 'object' && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Will merge {Object.keys(signal.payload.map).length} variants →</div>
              <div className="text-sm max-h-48 overflow-y-auto flex flex-col gap-0.5" style={{ color: 'var(--color-navy-mid)' }}>
                {Object.keys(signal.payload.map).slice(0, 40).map(k => <div key={k} className="truncate" title={k}>· {k}</div>)}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button onClick={approve} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: meta.color }}>
              <Check className="w-4 h-4" /> {busy ? 'Working…' : signal.action.verb}
            </button>
            <button onClick={dismiss} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold border bg-white hover:bg-[var(--color-surface)] disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
              Dismiss
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>
            Approving runs the privileged executor for this action. Recon promotions require the recon service to be reachable; if it isn’t, you’ll see an error and nothing is committed.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
