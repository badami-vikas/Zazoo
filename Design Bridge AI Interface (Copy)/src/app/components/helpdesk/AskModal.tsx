import { useMemo, useState } from 'react';
import { X, ChevronDown, Search, Lock, Check, Sparkles, Info, ShieldCheck } from 'lucide-react';
import {
  submitRequest, suggestWaysToHelp, myHelpdesks, publicHelpdesks, dummy_myCommunities, dummy_youProfile,
  type HelpAttachment, type AudienceTarget,
} from '../../data/helpdesk';
import { AttachmentPicker } from './HelpdeskBits';

// Add Ask is scoped to the list it was launched from.
export type AskScope = 'all' | 'network' | 'myhelpdesk' | 'public';
type Opt = { id: string; name: string; public: boolean; locked: boolean; group: 'channel' | 'community' | 'helpdesk' };

const SCOPE_PLACEHOLDER: Record<AskScope, string> = {
  all: 'Choose audience…',
  network: 'My network & communities',
  myhelpdesk: 'My helpdesks',
  public: 'Public helpdesks',
};

export function AskModal({ scope = 'all', onClose, onCreated }: { scope?: AskScope; onClose: () => void; onCreated?: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<HelpAttachment[]>([]);
  const [capRouting, setCapRouting] = useState(true);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [bq, setBq] = useState('');
  const [identity, setIdentity] = useState({ ...dummy_youProfile });

  const options = useMemo<Opt[]>(() => {
    const ch: Opt[] = [
      { id: 'network', name: 'My Network', public: false, locked: false, group: 'channel' },
      { id: 'bridge-ai', name: 'Bridge AI', public: false, locked: true, group: 'channel' },
    ];
    const comm: Opt[] = dummy_myCommunities.map(c => ({ id: c.id, name: c.name, public: false, locked: false, group: 'community' as const }));
    const mine: Opt[] = myHelpdesks().map(w => ({ id: w.id, name: w.name, public: w.visibility === 'public', locked: w.visibility !== 'public', group: 'helpdesk' as const }));
    const pub: Opt[] = publicHelpdesks().map(w => ({ id: w.id, name: w.name, public: true, locked: false, group: 'helpdesk' as const }));
    if (scope === 'network') return [...ch, ...comm];
    if (scope === 'myhelpdesk') return mine;
    if (scope === 'public') return pub;
    return [...ch, ...comm, ...mine, ...pub];
  }, [scope]);
  // My Network + Bridge AI preselected only where they exist (network / all scopes).
  const [selected, setSelected] = useState<Set<string>>(() => (scope === 'network' || scope === 'all') ? new Set(['network', 'bridge-ai']) : new Set());
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const ways = useMemo(() => (title.trim() || body.trim()) ? suggestWaysToHelp(title, body) : [], [title, body]);
  const selectedOpts = options.filter(o => selected.has(o.id));
  const isPublicAsk = selectedOpts.some(o => o.group === 'helpdesk' && o.public);
  const channelLabel = selectedOpts.length ? selectedOpts.map(o => o.name).join(', ') : SCOPE_PLACEHOLDER[scope];

  const submit = () => {
    if (!title.trim()) return;
    const helpdesks: AudienceTarget[] = selectedOpts
      .filter(o => o.group === 'helpdesk')
      .map(o => ({ id: o.id, name: o.name, public: o.public, locked: o.locked }));
    const { request } = submitRequest({
      workspaceId: null,
      title, body,
      routingMode: capRouting ? 'ai_assisted' : 'broadcast',
      autoFilter: true,
      waysToHelp: ways,
      attachments,
      audience: { network: selected.has('network'), helpdesks },
      requesterEmail: identity.email,
      requesterPhone: identity.phone,
      isPublic: isPublicAsk,
    });
    onCreated?.(request.id);
    onClose();
  };

  const bf = bq.trim().toLowerCase();
  const match = (o: Opt) => !bf || o.name.toLowerCase().includes(bf);
  const channelOpts = options.filter(o => o.group === 'channel' && match(o));
  const communityOpts = options.filter(o => o.group === 'community' && match(o));
  const helpdeskOpts = options.filter(o => o.group === 'helpdesk' && match(o));
  const helpdeskHeader = scope === 'public' ? 'Public Helpdesks' : scope === 'myhelpdesk' ? 'My Helpdesks' : "Network Helpdesks I'm part of";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[560px] max-w-full max-h-[90vh] overflow-y-auto rounded-2xl border bg-white shadow-2xl" style={{ borderColor: 'var(--color-border)' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}><Sparkles className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Share an ask</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>Share an ask and watch people, resources, and opportunities align around it.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--color-surface)]"><X className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* What's your ask? */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>What's your ask?</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Looking for a climate-tech internship" className="mt-1.5 w-full px-3 py-2 border rounded-lg text-sm outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Add a little context so people know how they can help…" className="mt-2 w-full px-3 py-2 border rounded-lg text-sm outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
          </div>

          {/* AI-suggested ways helpers will see */}
          {ways.length > 0 && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 4%, white)' }}>
              <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-steel)' }}><ShieldCheck className="w-3.5 h-3.5" /> Helpers will be offered these ways to contribute</div>
              <div className="flex flex-wrap gap-1.5">
                {ways.map(w => <span key={w} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'white' }}>{w}</span>)}
              </div>
            </div>
          )}

          {/* Attachment */}
          <AttachmentPicker attachments={attachments} onAdd={a => setAttachments(p => [...p, a])} onRemove={id => setAttachments(p => p.filter(x => x.id !== id))} />

          {/* Who should see this ask? — Broadcast multiselect */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Who should see this ask?</label>
            <div className="relative mt-1.5">
              <button onClick={() => setBroadcastOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 border rounded-lg text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }}>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-steel)' }}>Broadcast</span>
                <span className="truncate flex-1 text-left" style={{ color: selectedOpts.length ? 'var(--color-navy)' : 'var(--color-warm-gray)' }}>{channelLabel}</span>
                <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
              </button>
              {broadcastOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setBroadcastOpen(false)} />
                  <div className="absolute top-full left-0 right-0 mt-1 border rounded-xl shadow-lg z-50 bg-white overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="p-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
                        <input value={bq} onChange={e => setBq(e.target.value)} placeholder="Search helpdesks…" className="w-full pl-8 pr-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {channelOpts.map(o => (
                        <OptRow key={o.id} o={o} checked={selected.has(o.id)} onToggle={() => toggle(o.id)} />
                      ))}
                      {communityOpts.length > 0 && <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>My communities</div>}
                      {communityOpts.map(o => (
                        <OptRow key={o.id} o={o} checked={selected.has(o.id)} onToggle={() => toggle(o.id)} />
                      ))}
                      {(helpdeskOpts.length > 0 || scope !== 'network') && <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>{helpdeskHeader}</div>}
                      {helpdeskOpts.length === 0 && scope !== 'network' && <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>No helpdesks here yet.</div>}
                      {helpdeskOpts.map(o => (
                        <OptRow key={o.id} o={o} checked={selected.has(o.id)} onToggle={() => toggle(o.id)} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Capability-Based Routing (replaces AI-Assisted) */}
            <label className="mt-2.5 flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={capRouting} onChange={e => setCapRouting(e.target.checked)} className="mt-0.5 accent-[var(--color-steel)]" />
              <span className="text-sm" style={{ color: 'var(--color-navy)' }}>
                <span className="font-semibold inline-flex items-center gap-1">Capability-Based Routing
                  <span className="group relative inline-flex">
                    <Info className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
                    <span className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-72 p-2.5 rounded-lg text-[11px] leading-relaxed shadow-xl z-10" style={{ backgroundColor: 'var(--color-navy)', color: 'white' }}>
                      Bridge AI consults the AI agents of people in your network to determine whether they may be able to help and how. The ask is only delivered when a meaningful opportunity to contribute is identified.
                    </span>
                  </span>
                </span>
                <span className="block text-xs" style={{ color: 'var(--color-warm-gray)' }}>Deliver only to people who can meaningfully contribute.</span>
              </span>
            </label>
          </div>

          {/* Identity — auto-populated for Bridge users, editable */}
          {isPublicAsk && (
            <div className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-xs font-semibold" style={{ color: 'var(--color-navy)' }}>Public asks. Private contact.</div>
              <div className="grid grid-cols-3 gap-2">
                <input value={identity.name} onChange={e => setIdentity(i => ({ ...i, name: e.target.value }))} placeholder="Name" className="px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                <input value={identity.email} onChange={e => setIdentity(i => ({ ...i, email: e.target.value }))} placeholder="Email" className="px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
                <input value={identity.phone} onChange={e => setIdentity(i => ({ ...i, phone: e.target.value }))} placeholder="Phone" className="px-2 py-1.5 border rounded-md text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
              </div>
              <p className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Auto-filled from your Bridge profile — edit before posting. Contact stays private unless you allow direct contact.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Public asks. Private contact.</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium rounded-lg" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
            <button onClick={submit} disabled={!title.trim()} className="px-4 py-1.5 text-sm font-semibold rounded-lg text-white disabled:opacity-40 shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }}>Share ask</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OptRow({ o, checked, onToggle }: { o: Opt; checked: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}>
      <span className="w-4 h-4 rounded border flex items-center justify-center shrink-0" style={{ borderColor: checked ? 'var(--color-steel)' : 'var(--color-border)', backgroundColor: checked ? 'var(--color-steel)' : 'white' }}>{checked && <Check className="w-3 h-3 text-white" />}</span>
      <span className="truncate">{o.name}</span>
      {o.public && <span className="text-xs" style={{ color: 'var(--color-sage)' }}>(Public)</span>}
      {o.locked && <Lock className="w-3 h-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />}
    </button>
  );
}
