import { X, Sparkles, Heart, Users, MessageSquare, Star } from 'lucide-react';
import { getImpactReport } from '../../data/helpdesk';

// Fires every Dec 31 (gated by HelpdeskPage) — or via the dev "preview" affordance.
export function ImpactReportModal({ onClose }: { onClose: () => void }) {
  const r = getImpactReport();
  const stats = [
    { icon: Heart, label: 'You helped', value: `${r.peopleHelped} people.` },
    { icon: Users, label: 'You contributed across', value: `${r.communities} communities.` },
    { icon: MessageSquare, label: 'Your advice generated', value: `${r.followUps} follow-up conversations.` },
  ];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[520px] max-w-full max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-navy)' }}>
        <div className="px-6 py-5 flex items-center justify-between">
          <h3 className="text-xl font-bold flex items-center gap-2 text-white" style={{ fontFamily: 'var(--font-editorial)' }}><Sparkles className="w-5 h-5" style={{ color: 'var(--color-steel-light)' }} /> Your Impact Report</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10"><X className="w-4 h-4 text-white/70" /></button>
        </div>

        <div className="px-6 pb-2 flex flex-col gap-3">
          {stats.map((s, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
              <s.icon className="w-5 h-5 shrink-0" style={{ color: 'var(--color-steel-light)' }} />
              <div><span className="text-sm text-white/60">{s.label} </span><span className="text-base font-bold text-white">{s.value}</span></div>
            </div>
          ))}
          <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-sm text-white/60">Your most common contribution:</div>
            <div className="text-lg font-bold text-white">{r.topContribution}</div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5"><Star className="w-4 h-4" style={{ color: 'var(--color-steel-light)' }} /> Top 5 moments you helped others.</div>
          <ol className="flex flex-col gap-1.5">
            {r.moments.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                <span className="w-5 h-5 rounded-full bg-white/10 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span>{m.replace(/^dummy_\s*/, '')}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm font-semibold rounded-lg text-white" style={{ backgroundColor: 'var(--color-steel)' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
