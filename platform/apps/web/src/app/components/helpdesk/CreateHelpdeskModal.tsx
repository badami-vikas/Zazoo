import { useState } from 'react';
import { X, Check, Copy, LifeBuoy, Link2, Globe, CloudOff } from 'lucide-react';
import { createOrganization, setOrganizationVisibility, type HelpOrganization } from '../../data/helpdesk';
import { remoteCreateOrganization, remoteSetOrganizationVisibility, type RemoteOrganization } from '../../data/helpdeskRemote';

export function CreateHelpdeskModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [makePublic, setMakePublic] = useState(false);       // NOT public by default
  const [created, setCreated] = useState<HelpOrganization | null>(null);
  const [remoteWs, setRemoteWs] = useState<RemoteOrganization | null>(null); // Supabase row (cross-device)
  const [isPublic, setIsPublic] = useState(false);            // post-create toggle state
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const visibility = makePublic ? 'public' : 'unlisted';
    // Local store powers the owner's in-app list. Supabase persists it so the shareable
    // link resolves for testers on OTHER devices. Remote is best-effort: if it fails
    // (offline / signed-out) the link still works on this device via the local store.
    const ws = createOrganization({ name, description, visibility, broadcastDefault: makePublic });
    const remote = await remoteCreateOrganization({ name, description, visibility, broadcastDefault: makePublic });
    setCreated(ws); setRemoteWs(remote); setIsPublic(makePublic); setBusy(false);
  };
  // Shareable link uses the deployed public base URL when set, else the current origin.
  const baseUrl = (import.meta as any).env?.VITE_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  const link = created ? `${baseUrl}/help/${created.slug}` : '';
  const copy = () => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const togglePublic = (on: boolean) => {
    if (!created) return;
    setIsPublic(on);
    setOrganizationVisibility(created.id, on ? 'public' : 'unlisted');
    if (remoteWs) remoteSetOrganizationVisibility(remoteWs.id, on ? 'public' : 'unlisted');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[460px] max-w-full rounded-2xl border bg-white shadow-2xl overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}><LifeBuoy className="w-4 h-4" style={{ color: 'var(--color-steel)' }} /> Create Helpdesk</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--color-surface)]"><X className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></button>
        </div>

        {!created ? (
          <div className="p-5 flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Helpdesk name</label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Entrepreneurship Hub" className="mt-1.5 w-full px-3 py-2 border rounded-lg text-sm outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Description <span className="font-normal lowercase">(optional)</span></label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Who is this helpdesk for and what kinds of asks belong here?" className="mt-1.5 w-full px-3 py-2 border rounded-lg text-sm outline-none" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
            </div>
            {/* Visibility — invite-by-link (default) vs public */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Who can join</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {([[false, Link2, 'Invite via link', 'Only people you share the link with'], [true, Globe, 'Public', 'Discoverable in Public Helpdesks']] as const).map(([val, Icon, label, sub]) => (
                  <button key={label} onClick={() => setMakePublic(val)} className="flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-colors" style={{ borderColor: makePublic === val ? 'var(--color-steel)' : 'var(--color-border)', backgroundColor: makePublic === val ? 'color-mix(in srgb, var(--color-steel) 6%, white)' : 'white' }}>
                    <Icon className="w-4 h-4" style={{ color: makePublic === val ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{label}</span>
                    <span className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>{sub}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-warm-gray)' }}>You can change this any time — including making it public later.</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium rounded-lg" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
              <button onClick={create} disabled={!name.trim() || busy} className="px-4 py-1.5 text-sm font-semibold rounded-lg text-white disabled:opacity-40 shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }}>{busy ? 'Creating…' : 'Create Helpdesk'}</button>
            </div>
          </div>
        ) : (
          <div className="p-5 flex flex-col gap-4 items-center text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-sage) 20%, white)' }}><Check className="w-6 h-6" style={{ color: 'var(--color-sage)' }} /></div>
            <div>
              <h4 className="text-base font-bold" style={{ color: 'var(--color-navy)' }}>Your helpdesk is ready.</h4>
              <p className="text-sm mt-1" style={{ color: 'var(--color-warm-gray)' }}>Share this link to start receiving asks.</p>
            </div>
            {!remoteWs && (
              <div className="w-full flex items-start gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>
                <CloudOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Saved on this device only — sign in to sync so the link works for people on other devices.</span>
              </div>
            )}
            <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <span className="text-xs truncate flex-1 text-left" style={{ color: 'var(--color-navy-mid)' }}>{link}</span>
              <button onClick={copy} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md text-white shrink-0" style={{ backgroundColor: 'var(--color-steel)' }}>{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy Link'}</button>
            </div>
            {/* Make public — also available after creation */}
            <label className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--color-border)' }}>
              <Globe className="w-4 h-4" style={{ color: isPublic ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
              <span className="text-left flex-1">
                <span className="text-sm font-medium block" style={{ color: 'var(--color-navy)' }}>Make public</span>
                <span className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>List it in Public Helpdesks so anyone can find it</span>
              </span>
              <input type="checkbox" checked={isPublic} onChange={e => togglePublic(e.target.checked)} className="accent-[var(--color-steel)]" />
            </label>
            <button onClick={onClose} className="text-sm font-medium" style={{ color: 'var(--color-steel)' }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
