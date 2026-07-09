import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Flag, Check, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';
import { reconSummary, reconSubjects, flagReconFact, approveReconSubject, type ReconSubject } from '../data/reconStaging';

type Tab = 'pending' | 'flagged' | 'auto_merged';
const tierBadge: Record<string, { label: string; color: string }> = {
  strong: { label: 'Strong', color: '#6B7C65' }, moderate: { label: 'Moderate', color: '#C4955A' }, flag: { label: 'Flag', color: '#C0573E' },
};
const riskColor: Record<string, string> = { high: '#C0573E', moderate: '#C4955A', low: '#7FA5C5' };

export function ReconReview({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const [summary, setSummary] = useState<{ statuses: Record<string, number>; risks: Record<string, number> } | null>(null);
  const [tab, setTab] = useState<Tab>('pending');
  const [risk, setRisk] = useState<string | undefined>(undefined);
  const [subjects, setSubjects] = useState<ReconSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [goneFacts, setGoneFacts] = useState<Set<string>>(new Set());
  const [goneSubjects, setGoneSubjects] = useState<Set<string>>(new Set());

  useEffect(() => { reconSummary().then(setSummary); }, []);
  useEffect(() => {
    setLoading(true);
    reconSubjects({ status: tab, risk: tab === 'flagged' ? risk : undefined, limit: 400 }).then(s => { setSubjects(s); setLoading(false); });
  }, [tab, risk]);

  const flag = async (id: string) => {
    setBusy(id);
    const r = await flagReconFact(id);
    setBusy(null);
    if (r.ok) { setGoneFacts(p => new Set(p).add(id)); onToast(`Flagged · ${r.risk} risk`); }
    else onToast(`Flag failed: ${r.error}`);
  };
  const approve = async (key: string, name: string) => {
    setBusy(key);
    const r = await approveReconSubject(key);
    setBusy(null);
    if (r.ok) { setGoneSubjects(p => new Set(p).add(key)); onToast(`Approved ${name} — ${r.facts} facts committed (local + global)`); }
    else onToast(`Approve failed: ${r.error}`);
  };

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'pending', label: 'Needs review', n: summary?.statuses.pending },
    { id: 'flagged', label: 'Flagged', n: summary?.statuses.flagged },
    { id: 'auto_merged', label: 'Auto-merged', n: summary?.statuses.auto_merged },
  ];
  const visible = subjects.filter(s => !goneSubjects.has(s.key)).map(s => ({ ...s, facts: s.facts.filter(f => !goneFacts.has(f.id)) })).filter(s => s.facts.length);

  return (
    <motion.div className="absolute inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.div className="relative h-full w-full max-w-3xl bg-white shadow-2xl overflow-y-auto" initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} style={{ borderLeft: '1px solid var(--color-border)' }}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 z-10" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><ShieldCheck className="w-4.5 h-4.5" style={{ color: 'var(--color-steel)' }} />
              <h2 style={{ fontFamily: 'var(--font-editorial)', fontSize: '18px', fontWeight: 600, color: 'var(--color-navy)' }}>Recon review</h2></div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--color-surface)]"><X className="w-4 h-4" /></button>
          </div>
          {summary && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-warm-gray)' }}>
              {summary.statuses.auto_merged.toLocaleString()} auto-merged (strong, name-verified) · {summary.statuses.pending} pending · {summary.statuses.flagged.toLocaleString()} flagged
              <span> ({summary.risks.high} high · {summary.risks.moderate} moderate · {summary.risks.low} low risk)</span>
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setRisk(undefined); }}
                className="px-3 py-1.5 rounded-full text-sm font-medium border transition-colors"
                style={{ backgroundColor: tab === t.id ? 'var(--color-steel)' : 'white', color: tab === t.id ? 'white' : 'var(--color-navy-mid)', borderColor: tab === t.id ? 'var(--color-steel)' : 'var(--color-border)' }}>
                {t.label}{t.n != null ? ` (${t.n.toLocaleString()})` : ''}
              </button>
            ))}
          </div>
          {tab === 'flagged' && (
            <div className="flex items-center gap-1.5 mt-2">
              {['high', 'moderate', 'low'].map(r => (
                <button key={r} onClick={() => setRisk(risk === r ? undefined : r)}
                  className="px-2.5 py-1 rounded-full text-xs font-semibold border capitalize"
                  style={{ backgroundColor: risk === r ? riskColor[r] : 'white', color: risk === r ? 'white' : 'var(--color-navy-mid)', borderColor: risk === r ? riskColor[r] : 'var(--color-border)' }}>
                  {r} risk{summary ? ` (${summary.risks[r]})` : ''}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 flex flex-col gap-4">
          {tab === 'pending' && <p className="text-sm -mt-1" style={{ color: 'var(--color-navy-mid)' }}>Name matched but no corroborating data point — approve to commit (local + global), or flag individual facts.</p>}
          {loading ? (
            <div className="py-16 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--color-warm-gray)' }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center border border-dashed rounded-xl" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>Nothing here.</div>
          ) : visible.map(s => {
            const tb = tierBadge[s.tier || ''] || tierBadge.flag;
            return (
              <div key={s.key} className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: 'var(--font-editorial)', fontWeight: 600, color: 'var(--color-navy)' }}>{s.name}</span>
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tb.color + '20', color: tb.color }}>{tb.label}</span>
                    <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{s.facts.length} facts</span>
                  </div>
                  {tab === 'pending' && (
                    <button disabled={busy === s.key} onClick={() => approve(s.key, s.name)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-steel)' }}>
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {s.facts.map(f => (
                    <div key={f.id} className="group flex items-start gap-2 px-4 py-2 hover:bg-[var(--color-surface)]/50">
                      <button onClick={() => flag(f.id)} disabled={busy === f.id}
                        title="Flag this data point"
                        className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
                        style={{ color: 'var(--danger, #C0573E)' }}>
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>{f.label}</span>
                          <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>· {f.source}</span>
                          {f.source_verdict === 'weak' && <span className="text-[10px] px-1 rounded" style={{ backgroundColor: '#C4955A20', color: '#C4955A' }}>weak name</span>}
                          {f.risk_tier && <span className="text-[10px] px-1 rounded capitalize" style={{ backgroundColor: (riskColor[f.risk_tier]||'#999') + '20', color: riskColor[f.risk_tier] }}>{f.risk_tier} risk</span>}
                          {f.url && <a href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-xs inline-flex items-center gap-0.5" style={{ color: 'var(--color-steel)' }}><ExternalLink className="w-3 h-3" /></a>}
                        </div>
                        <div className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>{f.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {!loading && visible.length >= 1 && subjects.length >= 400 && (
            <p className="text-xs text-center" style={{ color: 'var(--color-warm-gray)' }}>Showing first 400 rows for this view.</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
