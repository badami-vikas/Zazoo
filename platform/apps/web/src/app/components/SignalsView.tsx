import { RefreshCw, UserPlus, HandHeart, Briefcase, TrendingUp, ArrowRight, MoreHorizontal, Sparkles, ShieldCheck, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { signals as allSignals, proposeFromSignal, type Signal, type SignalType } from '../data/signals';
import { proposeAction } from '../data/actionQueue';
import { proposeToLedger } from '../data/ledger';

const signalMeta: Record<SignalType, { icon: any; label: string; color: string }> = {
  Dormant: { icon: RefreshCw, label: 'Dormant Reconnect', color: '#C4955A' },
  Introduction: { icon: UserPlus, label: 'Introduction', color: '#4D7EA8' },
  Help: { icon: HandHeart, label: 'Help Opportunity', color: '#6B7C65' },
  'Hiring/Fundraising': { icon: Briefcase, label: 'Hiring / Fundraising', color: '#2E4057' },
  Community: { icon: TrendingUp, label: 'Community Movement', color: '#7FA5C5' },
};

const priorityStyle = {
  high: { bg: '#FDF2F2', dot: '#C0573E', label: 'High priority' },
  medium: { bg: '#F0EEE8', dot: '#C4955A', label: 'Medium' },
  low: { bg: '#F0EEE8', dot: '#6B7C65', label: 'Low' },
};

export function SignalsView({ selectedList }: { selectedList?: string | null }) {
  const [filter, setFilter] = useState<'all' | SignalType>('all');
  // Which signals have been acted on (drafted into Approvals) this session.
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const navigate = useNavigate();

  let filtered = filter === 'all' ? allSignals : allSignals.filter(s => s.type === filter);
  // Optional pill filters from the surrounding ListPillRow.
  if (selectedList === 'High priority') filtered = filtered.filter(s => s.priority === 'high');
  if (selectedList === 'Dormant') filtered = filtered.filter(s => s.type === 'Dormant');
  if (selectedList === 'Intros') filtered = filtered.filter(s => s.type === 'Introduction');

  const types = Object.keys(signalMeta) as SignalType[];

  const act = async (s: Signal, actionIndex: number, label: string) => {
    const entry = proposeFromSignal(s, actionIndex);
    const staged = await proposeToLedger(entry);
    if (!staged) proposeAction(entry);
    setProposed(prev => ({ ...prev, [s.id]: label }));
    setToast(
      !staged
        ? `“${label}” saved locally — reconnect the API before it can be reviewed`
        : staged.status === 'resolved'
          ? `“${label}” was already reviewed (${staged.decision.replace('_', ' ')})`
          : `“${label}” drafted to Approvals through the Action Pipeline`,
    );
    window.setTimeout(() => setToast(null), 2800);
  };

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of allSignals) m[s.type] = (m[s.type] ?? 0) + 1;
    return m;
  }, []);

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

      {/* Type filter */}
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
          All ({allSignals.length})
        </button>
        {types.map(t => {
          const meta = signalMeta[t];
          const Icon = meta.icon;
          const count = counts[t] ?? 0;
          if (count === 0) return null;
          const active = filter === t;
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border flex items-center gap-1.5"
              style={{
                backgroundColor: active ? meta.color : 'white',
                color: active ? 'white' : 'var(--color-navy-mid)',
                borderColor: active ? meta.color : 'var(--color-border)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3">
        {filtered.map((s, idx) => {
          const meta = signalMeta[s.type];
          const Icon = meta.icon;
          const pri = priorityStyle[s.priority];
          const wasProposed = proposed[s.id];
          return (
            <motion.article
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.04, 0.3) }}
              className="border rounded-xl bg-white p-5 hover:shadow-md transition-shadow"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + '15' }}>
                  <Icon className="w-5 h-5" style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-xs uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: pri.bg, color: pri.dot }}>{pri.label}</span>
                    {s.warmthLabel && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{s.warmthLabel}</span>
                    )}
                    <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>· {s.detectedAt}</span>
                  </div>
                  {s.whoId ? (
                    <button
                      onClick={() => navigate(`/item/${encodeURIComponent(s.whoId!)}`)}
                      className="mt-1 text-left hover:underline truncate block"
                      style={{ fontFamily: 'var(--font-editorial)', fontSize: '17px', fontWeight: 600, color: 'var(--color-navy)' }}
                    >
                      {s.who}
                    </button>
                  ) : (
                    <h3 className="mt-1 truncate" style={{ fontFamily: 'var(--font-editorial)', fontSize: '17px', fontWeight: 600, color: 'var(--color-navy)' }}>{s.who}</h3>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-warm-gray)' }} title="The agent that surfaced this signal">
                    <Sparkles className="w-3 h-3" /> {s.agent}
                  </span>
                  <button className="p-1.5 rounded-md hover:bg-[var(--color-surface)] text-[var(--color-warm-gray)]"><MoreHorizontal className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="flex flex-col gap-3" style={{ paddingLeft: 52 }}>
                <SignalRow label="Context" body={s.context} />
                <SignalRow label="Insight" body={s.insight} accent />

                {/* Evidence — why this fired */}
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

                {/* Actions */}
                <div>
                  <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>Recommended action</div>
                  {wasProposed ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>
                        <Check className="w-3.5 h-3.5" /> Drafted: {wasProposed}
                      </span>
                      <button
                        onClick={() => navigate('/approvals')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border bg-white hover:bg-[var(--color-surface)] transition-colors"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)' }}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" /> Review in Approvals <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => act(s, 0, s.actions[0].label)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: 'var(--color-steel)' }}
                      >
                        <Sparkles className="w-3.5 h-3.5" /> {s.actions[0].label} <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      {s.actions.slice(1).map((a, ai) => (
                        <button
                          key={a.label}
                          onClick={() => act(s, ai + 1, a.label)}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-white hover:bg-[var(--color-surface)] transition-colors"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.article>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-10 text-center border border-dashed rounded-xl" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
            No signals match the current filter.
          </div>
        )}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold text-white flex items-center gap-2 z-50"
            style={{ backgroundColor: 'var(--color-steel)' }}
          >
            <ShieldCheck className="w-4 h-4" /> {toast}
            <button onClick={() => navigate('/approvals')} className="ml-1 underline underline-offset-2 inline-flex items-center gap-1">Review <ArrowRight className="w-3.5 h-3.5" /></button>
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
