import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Sparkles, ArrowRight, RefreshCw, UserPlus, Briefcase, HandHeart, TrendingUp, Check, ShieldCheck } from 'lucide-react';
import { signals as allSignals, proposeFromSignal, type Signal, type SignalType } from '../data/signals';
import { proposeAction } from '../data/actionQueue';
import { proposeToLedger } from '../data/ledger';

const signalMeta: Record<SignalType, { icon: any; accent: string }> = {
  Dormant: { icon: RefreshCw, accent: '#C4955A' },
  Introduction: { icon: UserPlus, accent: '#4D7EA8' },
  Help: { icon: HandHeart, accent: '#6B7C65' },
  'Hiring/Fundraising': { icon: Briefcase, accent: '#2E4057' },
  Community: { icon: TrendingUp, accent: '#7FA5C5' },
};

export function HomePage() {
  const navigate = useNavigate();
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  // The four highest-priority real signals — same source as the Signals view, no fabricated blocks.
  const blocks = useMemo(() => allSignals.slice(0, 4), []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const act = async (s: Signal) => {
    const entry = proposeFromSignal(s, 0);
    const staged = await proposeToLedger(entry);
    if (!staged) proposeAction(entry);
    setProposed(prev => ({ ...prev, [s.id]: s.actions[0].label }));
    setToast(
      !staged
        ? `"${s.actions[0].label}" saved locally — reconnect the API before it can be reviewed`
        : staged.status === 'resolved'
          ? `"${s.actions[0].label}" was already reviewed (${staged.decision.replace('_', ' ')})`
          : `"${s.actions[0].label}" drafted to Approvals through the Action Pipeline`,
    );
    window.setTimeout(() => setToast(null), 2800);
  };

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-auto"
      style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="max-w-4xl mx-auto w-full px-6 py-10 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-steel)' }}>
            <Sparkles className="w-3.5 h-3.5" />
            Adaptive canvas · {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <h1 style={{
            fontFamily: 'var(--font-editorial)',
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--color-navy)',
            letterSpacing: '-0.02em',
          }}>
            {greeting}. Here's what matters in the next hour.
          </h1>
          <p style={{ color: 'var(--color-warm-gray)', maxWidth: 640 }}>
            Adaptive blocks generated from your real Signals, People, and Communities. Ask
            Bridge AI on the right to re-steer what's shown here.
          </p>
        </div>

        {blocks.length > 0 ? (
          <div className="grid grid-cols-1 @[700px]:grid-cols-2 gap-3">
            {blocks.map((s, i) => {
              const meta = signalMeta[s.type];
              const Icon = meta.icon;
              const wasProposed = proposed[s.id];
              return (
                <motion.article
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="border rounded-xl bg-white p-5 hover:shadow-md transition-shadow flex flex-col gap-3"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: meta.accent + '15' }}>
                      <Icon className="w-5 h-5" style={{ color: meta.accent }} />
                    </div>
                    <h3
                      className="cursor-pointer hover:underline"
                      onClick={() => s.whoId && navigate(`/item/${encodeURIComponent(s.whoId)}`)}
                      style={{
                        fontFamily: 'var(--font-editorial)',
                        fontSize: '15px',
                        fontWeight: 600,
                        color: 'var(--color-navy)',
                      }}>
                      {s.who}
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>
                    {s.insight}
                  </p>
                  {wasProposed ? (
                    <span className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>
                      <Check className="w-3.5 h-3.5" /> Drafted: {wasProposed}
                    </span>
                  ) : (
                    <button
                      onClick={() => act(s)}
                      className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: 'var(--color-steel)' }}
                    >
                      {s.actions[0].label}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </motion.article>
              );
            })}
          </div>
        ) : (
          <div className="p-10 text-center border border-dashed rounded-xl" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
            No signals yet — connect more of your network for Bridge to start surfacing what matters.
          </div>
        )}
      </div>

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
    </div>
  );
}
