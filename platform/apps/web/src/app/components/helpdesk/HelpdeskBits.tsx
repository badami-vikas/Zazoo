import { Flame, Award, Heart, Lock, Paperclip, MessageSquare, Pin, PinOff, X, ShieldCheck } from 'lucide-react';
import type { HelpRequest, Audience, HelpAttachment, Streak, Badge } from '../../data/helpdesk';
import { reputationFor, isMine, isAskPinned, toggleAskPin, useAskPins } from '../../data/helpdesk';

const SHIELD = 'polygon(50% 0%, 100% 14%, 100% 56%, 50% 100%, 0% 56%, 0% 14%)';

// ── Merged stats card: helping streak + people helped, one rectangular card ──────
export function StatsCard({ streak, peopleHelped }: { streak: Streak; peopleHelped: number }) {
  return (
    <div className="flex items-stretch rounded-xl border overflow-hidden shrink-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 pl-3 pr-3.5 py-1.5" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 8%, white)' }} title="Your helping streak">
        <Flame className="w-4 h-4 shrink-0" style={{ color: 'var(--warning)' }} />
        <div className="leading-tight">
          <div className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>{streak.count} {streak.unit}</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>helping others</div>
        </div>
      </div>
      <div className="w-px" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="flex items-center gap-2 pl-3 pr-3.5 py-1.5 bg-white" title="People you've helped">
        <Heart className="w-4 h-4 shrink-0" style={{ color: '#E0607E' }} fill="#E0607E" />
        <div className="leading-tight">
          <div className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>{peopleHelped}</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>people helped</div>
        </div>
      </div>
    </div>
  );
}

// ── Shield-shaped badges ─────────────────────────────────────────────────────────
export function BadgeRow({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {badges.map(b => (
        <span key={b.id} title={b.label} className="relative inline-flex items-center justify-center" style={{ width: 26, height: 30 }}>
          <span className="absolute inset-0" style={{ clipPath: SHIELD, backgroundColor: 'color-mix(in srgb, var(--color-steel) 16%, white)', border: '1px solid color-mix(in srgb, var(--color-steel) 30%, transparent)' }} />
          <Award className="relative w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} />
        </span>
      ))}
    </div>
  );
}

// ── Reputation badge (next to a helper's name) ──────────────────────────────────
export function ReputationBadge({ name, className = '' }: { name: string; className?: string }) {
  const rep = reputationFor(name);
  if (!rep) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${className}`} style={{ color: 'var(--color-steel)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, white)' }} title={`Helper reputation: ${rep}`}>
      <ShieldCheck className="w-2.5 h-2.5" /> {rep}
    </span>
  );
}

// ── Audience / visibility badge — "Shared with: …" ──────────────────────────────
export function AudienceBadge({ audience, compact = false }: { audience?: Audience; compact?: boolean }) {
  const a = audience;
  const targets: { label: string; public: boolean; locked: boolean }[] = [];
  if (!a || a.network) targets.push({ label: 'My Network', public: false, locked: false });
  (a?.helpdesks || []).forEach(h => targets.push({ label: h.name, public: h.public, locked: h.locked }));
  if (!targets.length) targets.push({ label: 'My Network', public: false, locked: false });
  return (
    <div className="flex items-start gap-1.5 text-[11px] min-w-0" style={{ color: 'var(--color-warm-gray)' }}>
      {!compact && <span className="shrink-0">Shared with:</span>}
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        {targets.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'var(--color-surface)' }}>
            {t.label}
            {t.public && <span style={{ color: 'var(--color-sage)' }}>(Public)</span>}
            {t.locked && <Lock className="w-2.5 h-2.5" />}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Ways-to-help checklist (helper picks what they can do) ───────────────────────
export function WaysToHelpChecklist({ ways, selected, onToggle, title = 'Bridge AI thinks you may be able to help by:' }: {
  ways: string[]; selected: string[]; onToggle: (w: string) => void; title?: string;
}) {
  if (!ways.length) return null;
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 4%, white)' }}>
      <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-steel)' }}>
        <ShieldCheck className="w-3.5 h-3.5" /> {title}
      </div>
      <div className="flex flex-col gap-1">
        {ways.map(w => (
          <label key={w} className="flex items-center gap-2 text-sm cursor-pointer py-0.5" style={{ color: 'var(--color-navy)' }}>
            <input type="checkbox" checked={selected.includes(w)} onChange={() => onToggle(w)} className="accent-[var(--color-steel)]" />
            {w}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Attachment picker (clip icon) — local-only metadata, no upload ──────────────
export function AttachmentPicker({ attachments, onAdd, onRemove }: {
  attachments: HelpAttachment[]; onAdd: (a: HelpAttachment) => void; onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer self-start" style={{ color: 'var(--color-steel)' }}>
        <Paperclip className="w-3.5 h-3.5" /> Attach a file
        <input type="file" className="hidden" onChange={e => {
          const f = e.target.files?.[0]; if (!f) return;
          const kb = Math.max(1, Math.round(f.size / 1024));
          onAdd({ id: `att-${f.name}-${kb}`, name: f.name, size: kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`, kind: f.type || 'file' });
          e.currentTarget.value = '';
        }} />
      </label>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map(a => (
            <span key={a.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'var(--color-surface)' }}>
              <Paperclip className="w-3 h-3" /> {a.name}{a.size ? ` · ${a.size}` : ''}
              <button onClick={() => onRemove(a.id)} className="ml-0.5"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: HelpRequest['status'] }) {
  const map: Record<string, { label: string; color: string }> = {
    open: { label: 'Open', color: 'var(--color-sage)' },
    resolved: { label: 'Resolved', color: 'var(--color-steel)' },
    closed: { label: 'Closed', color: 'var(--color-warm-gray)' },
  };
  const s = map[status] || map.open;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: s.color, backgroundColor: `color-mix(in srgb, ${s.color} 12%, white)` }}><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} /> {s.label}</span>;
}

// ── Help request card — Notion-style compact card (content-driven height, capped by
// line-clamp; no forced tall aspect ratio — that's what made these "too broad and long" at
// mid-size grid widths). Paired with CardGrid's auto-fill sizing in HelpdeskPage. ─────────────
export function HelpdeskCard({ req, offersCount, onOpen }: { req: HelpRequest; offersCount: number; onOpen: () => void }) {
  useAskPins(); // re-render on pin changes
  const mine = isMine(req);
  const pinned = isAskPinned(req);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }} className="cursor-pointer text-left flex flex-col rounded-xl border bg-white hover:border-[var(--color-steel)] hover:shadow-md transition-all overflow-hidden relative" style={{ borderColor: pinned ? 'var(--color-steel)' : 'var(--color-border)' }}>
      <button
        onClick={e => { e.stopPropagation(); toggleAskPin(req); }}
        title={pinned ? 'Unpin this ask' : 'Pin this ask'}
        className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-1 rounded-full border transition-colors"
        style={pinned
          ? { color: 'var(--color-steel)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 12%, white)', borderColor: 'color-mix(in srgb, var(--color-steel) 25%, transparent)' }
          : { color: 'var(--color-warm-gray)', backgroundColor: 'white', borderColor: 'var(--color-border)' }}
      >
        {pinned ? <Pin className="w-2.5 h-2.5" fill="currentColor" /> : <PinOff className="w-2.5 h-2.5" />}
        {mine ? 'My Ask' : (pinned ? 'Pinned' : 'Pin')}
      </button>
      <div className="p-3.5 flex flex-col gap-2">
        <StatusPill status={req.status} />
        <div className="font-semibold text-sm leading-snug line-clamp-2" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{req.title}</div>
        <div className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--color-navy-mid)' }}>{req.body}</div>
        <AudienceBadge audience={req.audience} />
      </div>
      <div className="px-3.5 py-2.5 border-t flex items-center gap-2 shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{(req.requesterName || '?').charAt(0)}</div>
        <span className="text-xs truncate" style={{ color: 'var(--color-navy-mid)' }}>{mine ? 'You' : req.requesterName}</span>
        <ReputationBadge name={req.requesterName} />
        <span className="ml-auto inline-flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--color-warm-gray)' }}>
          {req.attachments?.length ? <Paperclip className="w-3 h-3" /> : null}
          <MessageSquare className="w-3 h-3" /> {offersCount}
        </span>
      </div>
    </div>
  );
}
