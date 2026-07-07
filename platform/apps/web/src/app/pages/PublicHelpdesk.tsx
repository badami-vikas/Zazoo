import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { LifeBuoy, Send, ShieldCheck, Lock, Mail, Phone, Check, AlertTriangle } from 'lucide-react';
import { Captcha } from '../components/Captcha';
import { CardGrid, NotionCard } from '../components/shared/NotionCard';
import {
  workspaceBySlug, publicRequests, submitPublicRequest, submitPublicOffer, revealContact,
  findMySubmissions, offersForRequest, rateOk,
  type ContactVisibility, type MySession,
} from '../data/helpdesk';
import {
  remoteWorkspaceBySlug, remotePublicRequests, remoteSubmitPublicRequest, remoteSubmitPublicOffer,
  type RemoteWorkspace, type RemotePublicRequest,
} from '../data/helpdeskRemote';

// View model shared by the remote (Supabase) and local (fallback) paths.
interface VMWorkspace { id: string; name: string; slug: string; description: string; visibility: string; brandColor?: string }
interface VMRequest { id: string; title: string; body: string; status: string; helperCount: number; allowDirectContact: boolean }

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; area?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>{props.label}{props.required && ' *'}</span>
      {props.area
        ? <textarea value={props.value} onChange={e => props.onChange(e.target.value)} rows={3} placeholder={props.placeholder}
            className="mt-1 w-full text-sm rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
        : <input type={props.type || 'text'} value={props.value} onChange={e => props.onChange(e.target.value)} placeholder={props.placeholder}
            className="mt-1 w-full text-sm rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />}
    </label>
  );
}

// ── Offer composer on a public request (remote-first, local fallback) ────────────
function PublicOffer({ requestId, allowDirect, brand, remote, onPosted }: { requestId: string; allowDirect: boolean; brand: string; remote: boolean; onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [msg, setMsg] = useState('');
  const [solved, setSolved] = useState(false);
  const [revealed, setRevealed] = useState<{ email?: string; phone?: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    if (!rateOk(`offer:${email.toLowerCase()}`, 8)) { setNote('Rate limit — please slow down.'); return; }
    let res = remote ? await remoteSubmitPublicOffer({ requestId, name, email, message: msg }) : null;
    if (!res) res = submitPublicOffer({ requestId, name, email, message: msg }); // fallback
    setNote(res.ok ? (res.status === 'flagged' ? 'Sent — flagged for review.' : 'Sent — the requester will see your response.') : `Held: ${res.reason}`);
    if (res.ok) { setMsg(''); onPosted(); }
  };
  const reveal = () => { if (solved) setRevealed(revealContact(requestId)); };

  if (!open) return <button onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: brand }}>Offer help</button>;
  return (
    <div className="mt-2 rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Your name" value={name} onChange={setName} required />
        <Field label="Your email" value={email} onChange={setEmail} type="email" required />
      </div>
      <Field label="How you can help" value={msg} onChange={setMsg} area placeholder="A sentence on how you could help…" />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Captcha onSolved={setSolved} />
        <button onClick={send} disabled={!name || !email || !msg || !solved}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: brand }}>
          <Send className="w-3.5 h-3.5" /> Submit
        </button>
      </div>
      {allowDirect && !remote && (
        <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          {revealed
            ? <div className="text-xs" style={{ color: 'var(--color-navy)' }}>
                Direct contact:{revealed.email ? <> <Mail className="w-3 h-3 inline" /> {revealed.email}</> : ''}{revealed.phone ? <>  <Phone className="w-3 h-3 inline" /> {revealed.phone}</> : ''}
                {!revealed.email && !revealed.phone && ' (none shared)'}
              </div>
            : <button onClick={reveal} disabled={!solved} className="text-xs font-medium disabled:opacity-40" style={{ color: brand }}>Offer Direct Help — reveal contact (requester opted in)</button>}
        </div>
      )}
      {note && <div className="text-[11px]" style={{ color: note.startsWith('Held') ? 'var(--danger)' : 'var(--success)' }}>{note}</div>}
    </div>
  );
}

export function PublicHelpdesk() {
  const { slug } = useParams();
  const [ws, setWs] = useState<VMWorkspace | null | undefined>(undefined); // undefined = loading
  const [remote, setRemote] = useState(false);
  const [reqs, setReqs] = useState<VMRequest[]>([]);
  const [tab, setTab] = useState<'board' | 'ask' | 'mine'>('board');
  const brand = ws?.brandColor || '#4D7EA8';

  // Resolve workspace: Supabase (cross-device) first, then local store fallback.
  useEffect(() => {
    let live = true;
    (async () => {
      if (!slug) { setWs(null); return; }
      const r: RemoteWorkspace | null = await remoteWorkspaceBySlug(slug);
      if (!live) return;
      if (r) { setWs(r); setRemote(true); return; }
      const local = workspaceBySlug(slug);
      setWs(local ? { id: local.id, name: local.name, slug: local.slug, description: local.description, visibility: local.visibility, brandColor: local.brandColor } : null);
      setRemote(false);
    })();
    return () => { live = false; };
  }, [slug]);

  const loadReqs = useCallback(async (w: VMWorkspace, isRemote: boolean) => {
    if (isRemote) {
      const rows: RemotePublicRequest[] = await remotePublicRequests(w.id);
      setReqs(rows.map(r => ({ id: r.id, title: r.title, body: r.body, status: r.status, helperCount: r.helperCount, allowDirectContact: r.allowDirectContact })));
    } else {
      setReqs(publicRequests(w.id).map(r => ({ id: r.id, title: r.title, body: r.body, status: r.status, helperCount: r.helperCount, allowDirectContact: r.allowDirectContact })));
    }
  }, []);
  useEffect(() => { if (ws) loadReqs(ws, remote); }, [ws, remote, tab, loadReqs]);

  // ask form
  const [f, setF] = useState({ name: '', email: '', phone: '', title: '', body: '' });
  const [allowDirect, setAllowDirect] = useState(false);
  const [vis, setVis] = useState<ContactVisibility>('email');
  const [askSolved, setAskSolved] = useState(false);
  const [askNote, setAskNote] = useState<{ msg: string; kind: 'ok' | 'warn' | 'err' } | null>(null);

  // session (local-only — anon RLS keeps requester identity hidden by design)
  const [sName, setSName] = useState(''); const [sEmail, setSEmail] = useState('');
  const [session, setSession] = useState<MySession | null>(null);
  const [sErr, setSErr] = useState(false);

  if (ws === undefined) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
      <LifeBuoy className="w-7 h-7 animate-pulse" style={{ color: 'var(--color-warm-gray)' }} />
    </div>;
  }
  if (!ws || ws.visibility === 'private') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ backgroundColor: 'var(--color-background)' }}>
        <LifeBuoy className="w-8 h-8" style={{ color: 'var(--color-warm-gray)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--color-navy)' }}>Helpdesk not found</h1>
        <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>This helpdesk doesn’t exist or isn’t public.</p>
        <Link to="/" className="text-sm font-semibold" style={{ color: 'var(--color-steel)' }}>Go to Bridge →</Link>
      </div>
    );
  }

  const ask = async () => {
    if (!rateOk(`req:${f.email.toLowerCase()}`, 5)) { setAskNote({ msg: 'Rate limit — please try later.', kind: 'err' }); return; }
    const args = { workspaceId: ws.id, name: f.name, email: f.email, phone: f.phone, title: f.title, body: f.body, allowDirectContact: allowDirect, contactVisibility: vis };
    let res = remote ? await remoteSubmitPublicRequest(args) : null;
    if (!res) res = submitPublicRequest(args); // fallback
    if (!res.ok) setAskNote({ msg: `Held for review: ${res.reason}. It won’t appear publicly until approved.`, kind: 'err' });
    else if (res.status === 'flagged') setAskNote({ msg: `Posted, but flagged (${res.reason}) — an admin will review.`, kind: 'warn' });
    else setAskNote({ msg: 'Posted. Helpers in this community can now offer help.', kind: 'ok' });
    if (res.ok) { setF({ name: '', email: '', phone: '', title: '', body: '' }); loadReqs(ws, remote); }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Branded header */}
      <header className="px-6 py-5" style={{ backgroundColor: brand }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><LifeBuoy className="w-6 h-6 text-white" /></div>
          <div>
            <h1 className="text-lg font-bold text-white">{ws.name}</h1>
            {ws.description && <p className="text-sm text-white/80">{ws.description}</p>}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-5">
        {/* tabs */}
        <div className="flex items-center gap-1 mb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {(['board', 'ask', 'mine'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="px-3 py-2 text-sm font-medium border-b-2 -mb-px"
              style={tab === t ? { borderColor: brand, color: 'var(--color-navy)' } : { borderColor: 'transparent', color: 'var(--color-warm-gray)' }}>
              {t === 'board' ? 'Requests' : t === 'ask' ? 'Ask for help' : 'My posts'}
            </button>
          ))}
        </div>

        {/* Public visibility note */}
        <div className="flex items-start gap-2 mb-4 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Public view shows the request and a helper count only. Requester and helper identities, contacts, and private responses stay hidden — visible only to the people involved.</span>
        </div>

        {tab === 'board' && (
          reqs.length === 0
            ? <div className="px-4 py-12 text-center rounded-xl border border-dashed" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>No open requests yet</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-warm-gray)' }}>Be the first — tap “Ask for help”.</p>
              </div>
            : <CardGrid minWidth={280}>
                {reqs.map(r => (
                  <NotionCard
                    key={r.id}
                    title={r.title}
                    subtitle={r.body}
                    eyebrow={<span className="text-[11px] px-2 py-0.5 rounded-full border w-fit" style={{ borderColor: 'var(--color-border)', color: r.status === 'open' ? 'var(--color-navy-mid)' : 'var(--success)' }}>{r.status}</span>}
                    metaChips={[`${r.helperCount} helper${r.helperCount !== 1 ? 's' : ''}`]}
                    footer={<PublicOffer requestId={r.id} allowDirect={r.allowDirectContact} brand={brand} remote={remote} onPosted={() => loadReqs(ws, remote)} />}
                  />
                ))}
              </CardGrid>
        )}

        {tab === 'ask' && (
          <div className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" value={f.name} onChange={v => setF({ ...f, name: v })} required />
              <Field label="Email" value={f.email} onChange={v => setF({ ...f, email: v })} type="email" required />
            </div>
            <Field label="Phone (optional)" value={f.phone} onChange={v => setF({ ...f, phone: v })} />
            <Field label="What do you need?" value={f.title} onChange={v => setF({ ...f, title: v })} placeholder="I need help with…" required />
            <Field label="Context" value={f.body} onChange={v => setF({ ...f, body: v })} area />
            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-navy-mid)' }}>
                <input type="checkbox" checked={allowDirect} onChange={e => setAllowDirect(e.target.checked)} /> Allow direct contact (helpers can see your contact when they offer)
              </label>
              {allowDirect && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-navy-mid)' }}>
                  Show:
                  {(['email', 'phone', 'both'] as ContactVisibility[]).map(v => (
                    <button key={v} onClick={() => setVis(v)} className="px-2 py-0.5 rounded-full border" style={vis === v ? { borderColor: brand, color: brand } : { borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>{v}</button>
                  ))}
                </div>
              )}
              {!allowDirect && <p className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Private mode: helpers submit “how I can help”; only you see their name + contact + response.</p>}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Captcha onSolved={setAskSolved} />
              <button onClick={ask} disabled={!f.name || !f.email || !f.title || !askSolved}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: brand }}>
                <Send className="w-3.5 h-3.5" /> Post request
              </button>
            </div>
            {askNote && (
              <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2"
                style={{ backgroundColor: askNote.kind === 'ok' ? 'color-mix(in srgb, var(--success) 12%, transparent)' : askNote.kind === 'warn' ? 'color-mix(in srgb, var(--warning) 14%, transparent)' : 'color-mix(in srgb, var(--danger) 12%, transparent)', color: askNote.kind === 'ok' ? 'var(--success)' : askNote.kind === 'warn' ? 'var(--warning)' : 'var(--danger)' }}>
                {askNote.kind === 'ok' ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}{askNote.msg}
              </div>
            )}
            <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>
              <ShieldCheck className="w-3.5 h-3.5" /> Every post is screened for spam/abuse before it’s shown.
            </p>
          </div>
        )}

        {tab === 'mine' && (
          <div className="rounded-xl border bg-white p-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>Enter the exact name + email you posted with to manage your requests and see who offered to help. <span style={{ color: 'var(--color-warm-gray)' }}>(Recovers posts made on this device.)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" value={sName} onChange={setSName} />
              <Field label="Email" value={sEmail} onChange={setSEmail} type="email" />
            </div>
            <button onClick={() => { const s = findMySubmissions(sName, sEmail); setSession(s); setSErr(!s); }}
              className="text-sm font-semibold px-4 py-2 rounded-lg text-white" style={{ backgroundColor: brand }}>Find my posts</button>
            {sErr && <p className="text-xs" style={{ color: 'var(--danger)' }}>No match — name and email must match exactly. (Admins can resolve typos.)</p>}
            {session && (
              <div className="space-y-3 pt-2">
                {session.requests.length === 0 && <p className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>No requests under this identity.</p>}
                {session.requests.map(r => {
                  const ofs = offersForRequest(r.id);
                  return (
                    <div key={r.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{r.title}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>{ofs.length} offer{ofs.length !== 1 ? 's' : ''} · {r.status}</div>
                      {ofs.map(o => (
                        <div key={o.id} className="mt-2 text-xs rounded-md p-2" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy)' }}>
                          <b>{o.helperName}</b> {o.helperEmail && <span style={{ color: 'var(--color-warm-gray)' }}>· {o.helperEmail}</span>}
                          <div style={{ color: 'var(--color-navy-mid)' }}>{o.message}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>
          Powered by <Link to="/" style={{ color: brand }}>Bridge Helpdesk</Link> · routes requests to people who can help
        </div>
      </div>
    </div>
  );
}
