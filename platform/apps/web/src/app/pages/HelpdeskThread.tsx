import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Paperclip, MessageSquare, CornerDownRight, Send, Check, ShieldCheck } from 'lucide-react';
import {
  useRequests, useOffers, useRoutes, recordOffer, addReply, setRequestStatus,
  YOU_NAME, isMine, type HelpRequest, type HelpRoute,
} from '../data/helpdesk';
import { proposeToLedger } from '../data/ledger';
import type { LedgerEntry } from '../data/governance';
import { Breadcrumb } from '../components/Breadcrumb';
import { AudienceBadge, ReputationBadge, WaysToHelpChecklist, AttachmentPicker } from '../components/helpdesk/HelpdeskBits';
import type { HelpAttachment } from '../data/helpdesk';

// helping stays governed: an Offer drafts a proposal into Approvals + logs a Touchpoint.
function offerEntry(req: HelpRequest, route: HelpRoute | null, message: string, ways: string[]): LedgerEntry {
  const who = req.requesterName;
  return {
    id: `help-${route?.id ?? req.id}-${(message.length + ways.length) % 100000}`,
    ts: '', age: '0m', actorKind: 'agent', actor: 'Helpdesk AI',
    onBehalfOfType: 'user', onBehalfOf: 'You', delegationId: null, runId: null,
    action: 'offer', resourceType: 'help', resource: who,
    policy: 'Helpdesk · capability-routed · human-approved offer', decision: null,
    channel: 'helpdesk', prior: null,
    proposed: `Offer to help ${who} with “${req.title}”\n${message}${ways.length ? `\nWays: ${ways.join(', ')}` : ''}\nTouchpoint: Offered help to ${who}`,
    trace: {
      signals: ['Capability match', route?.reason || 'You may be able to help'],
      context: `Request: ${req.title}\n${req.body}`,
      reasoning: 'Bridge routed this on capability, not topic. Offer drafted for your review before it is sent.',
    },
  };
}

export function HelpdeskThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const requests = useRequests();
  const offers = useOffers();
  const routes = useRoutes();
  const req = requests.find(r => r.id === id);

  if (!req) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>
        <p>This ask was not found.</p>
        <button onClick={() => navigate('/helpdesk')} className="mt-2 text-sm font-semibold" style={{ color: 'var(--color-steel)' }}>← Back to Helpdesk</button>
      </div>
    );
  }

  const mine = isMine(req);
  const myRoute = routes.find(r => r.requestId === req.id) || null;
  const reqOffers = offers.filter(o => o.requestId === req.id);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="border-b px-6 py-4 bg-white" style={{ borderColor: 'var(--color-border)' }}>
        <Breadcrumb segments={[{ label: 'Helpdesk', to: '/helpdesk' }, { label: mine ? 'My Asks' : 'Requests', to: '/helpdesk' }, { label: req.title }]} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-4">
          {/* The ask */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{(req.requesterName || '?').charAt(0)}</div>
              <span className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>{mine ? 'You' : req.requesterName}</span>
              <ReputationBadge name={req.requesterName} />
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-warm-gray)' }}>{req.status}</span>
            </div>
            <h1 className="text-xl font-bold leading-snug" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{req.title}</h1>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-navy-mid)' }}>{req.body}</p>
            {req.attachments?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {req.attachments.map(a => <span key={a.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><Paperclip className="w-3 h-3" /> {a.name}</span>)}
              </div>
            ) : null}
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <AudienceBadge audience={req.audience} />
            </div>
            {mine && req.status === 'open' && (
              <button onClick={() => setRequestStatus(req.id, 'resolved')} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)' }}><Check className="w-3.5 h-3.5" /> Mark resolved</button>
            )}
          </div>

          {/* Offer composer (only on others' asks) */}
          {!mine && <OfferComposer req={req} route={myRoute} />}

          {/* Responses */}
          <div className="flex items-center gap-2 px-1 pt-1">
            <MessageSquare className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{reqOffers.length} {reqOffers.length === 1 ? 'response' : 'responses'}</span>
          </div>
          {reqOffers.length === 0 && <p className="text-sm px-1" style={{ color: 'var(--color-warm-gray)' }}>No responses yet.</p>}
          {reqOffers.map(o => <OfferThread key={o.id} offer={o} />)}
        </div>
      </div>
    </div>
  );
}

function OfferComposer({ req, route }: { req: HelpRequest; route: HelpRoute | null }) {
  const ways = req.waysToHelp || [];
  const [selected, setSelected] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<HelpAttachment[]>([]);
  const [msg, setMsg] = useState(`Happy to help with “${req.title}”.`);
  const [sent, setSent] = useState(false);
  const toggle = (w: string) => setSelected(s => s.includes(w) ? s.filter(x => x !== w) : [...s, w]);

  const send = async () => {
    setSent(true);
    await proposeToLedger(offerEntry(req, route, msg, selected));
    recordOffer({ requestId: req.id, routeId: route?.id ?? null, message: msg, contactShared: false, waysSelected: selected, attachments });
  };

  if (sent) {
    return (
      <div className="rounded-2xl border p-4 flex items-center gap-2 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-sage) 40%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-sage) 8%, white)', color: 'var(--color-navy)' }}>
        <ShieldCheck className="w-4 h-4" style={{ color: 'var(--color-sage)' }} /> Offer drafted into Approvals for your review — it will be sent once you approve.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm flex flex-col gap-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>How can you help?</div>
      <WaysToHelpChecklist ways={ways} selected={selected} onToggle={toggle} />
      <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3} className="w-full text-sm rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
      <AttachmentPicker attachments={attachments} onAdd={a => setAttachments(p => [...p, a])} onRemove={id => setAttachments(p => p.filter(x => x.id !== id))} />
      <div className="flex justify-end">
        <button onClick={send} disabled={!msg.trim()} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg text-white disabled:opacity-40 shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }}><Send className="w-3.5 h-3.5" /> Offer help</button>
      </div>
    </div>
  );
}

function OfferThread({ offer }: { offer: ReturnType<typeof useOffers>[number] }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState('');
  const replies = offer.replies || [];
  const submit = () => { if (addReply(offer.id, reply)) { setReply(''); setReplyOpen(false); } };
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{(offer.helperName || '?').charAt(0)}</div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>{offer.helperName}</span>
          <ReputationBadge name={offer.helperName} />
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-navy-mid)' }}>{offer.message}</p>
        {offer.waysSelected?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {offer.waysSelected.map(w => <span key={w} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, white)', color: 'var(--color-steel)' }}>{w}</span>)}
          </div>
        ) : null}
        {offer.attachments?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {offer.attachments.map(a => <span key={a.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><Paperclip className="w-3 h-3" /> {a.name}</span>)}
          </div>
        ) : null}
        <button onClick={() => setReplyOpen(o => !o)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-steel)' }}><CornerDownRight className="w-3 h-3" /> Reply</button>
      </div>

      {(replies.length > 0 || replyOpen) && (
        <div className="border-t px-4 py-3 flex flex-col gap-2.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          {replies.map(r => (
            <div key={r.id} className="flex items-start gap-2">
              <CornerDownRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
              <div><span className="text-xs font-semibold" style={{ color: 'var(--color-navy)' }}>{r.author}</span><p className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>{r.body}</p></div>
            </div>
          ))}
          {replyOpen && (
            <div className="flex items-center gap-2">
              <input autoFocus value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder={`Reply as ${YOU_NAME}…`} className="flex-1 px-3 py-1.5 border rounded-lg text-sm outline-none bg-white" style={{ borderColor: 'var(--color-border)' }} />
              <button onClick={submit} disabled={!reply.trim()} className="px-3 py-1.5 text-sm font-semibold rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>Reply</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
