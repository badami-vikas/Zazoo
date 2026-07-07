import { useState } from 'react';
import {
  Globe, Lock, ShieldCheck, Users, Eye,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// F4a — Two-tier Person view.  Canonical (public, researched, platform-stored,
// no tenant linkage) vs. Private (your per-(workspace,user) relationship: warmth,
// ring, notes — the tier bound for client-side / E2EE in Phase 6).  The two tiers
// must read as SEPARATE, never blended.  F4b visibility control lives in the
// private zone.  No naked relationship scores — warmth is a qualitative state.
// ─────────────────────────────────────────────────────────────────────────────

type Visibility = 'private' | 'team' | 'workspace';

const visibilityMeta: Record<Visibility, { icon: any; label: string; blast: string }> = {
  private: { icon: Lock, label: 'Only you', blast: 'No one else can see this relationship or its notes.' },
  team: { icon: Users, label: 'Your team', blast: 'Everyone on your team can see this relationship.' },
  workspace: { icon: Globe, label: 'Whole workspace', blast: 'Everyone in the workspace can see this relationship.' },
};

function SourceTag({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-warm-gray)' }}>
      <Globe className="w-2.5 h-2.5" /> {source}
    </span>
  );
}

function CanonicalField({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>{label}</span>
        <SourceTag source={source} />
      </div>
      <span className="text-sm" style={{ color: 'var(--color-navy)' }}>{value}</span>
    </div>
  );
}

export function PersonTiers({ name, person }: { name: string; person?: any }) {
  const [visibility, setVisibility] = useState<Visibility>('team');
  const workspaceDefault: Visibility = 'team'; // from workspace_settings.default_visibility
  const [note, setNote] = useState('Add your private notes about this relationship here — only you can see them.');
  const [editingNote, setEditingNote] = useState(false);

  // warmth/ring derived from the same data as the table; qualitative, never a number (invariant #8)
  const w = person?.warmth ?? 64;
  const warmth = w >= 80 ? { label: 'Hot', token: 'var(--color-steel)', desc: 'Recently active, historically close' }
    : w >= 62 ? { label: 'Warm', token: 'var(--color-sage)', desc: 'Active relationship' }
    : w >= 50 ? { label: 'Cooling', token: 'var(--color-amber-soft, var(--warning))', desc: 'Going quiet — worth a touchpoint' }
    : { label: 'Dormant', token: 'var(--color-warm-gray)', desc: 'Long-dormant tie' };
  const ring = { label: `${person?.ring || 'Active'} ring`, desc: 'Among your inner network' };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* ── Canonical / Public ──────────────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden shadow-sm flex flex-col" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <Globe className="w-4 h-4" style={{ color: 'var(--color-navy-mid)' }} />
          <div className="flex flex-col">
            <span className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>Public · Canonical</span>
            <span className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Researched from public sources — not yours. Read-only.</span>
          </div>
        </div>
        <div className="px-4 py-1">
          <CanonicalField label="Role" value={person?.position || '—'} source="LinkedIn" />
          <CanonicalField label="Company" value={person?.company || '—'} source="LinkedIn" />
          <CanonicalField label="Location" value={person?.location || '—'} source="Public web" />
          <CanonicalField label="LinkedIn" value={person?.url ? person.url.replace(/^https?:\/\/(www\.)?linkedin\.com\//, '') : '—'} source="LinkedIn" />
        </div>
      </div>

      {/* ── Private / Your relationship ─────────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden shadow-sm flex flex-col" style={{ borderColor: 'color-mix(in srgb, var(--color-steel) 30%, var(--color-border))', backgroundColor: 'color-mix(in srgb, var(--color-steel) 3%, white)' }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 8%, transparent)' }}>
          <Lock className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
          <div className="flex flex-col flex-1">
            <span className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>Private · Your relationship</span>
            <span className="text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Yours only. End-to-end encryptable — Phase 6.</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>
            <ShieldCheck className="w-3 h-3" /> E2EE-bound
          </span>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* qualitative warmth + ring — NO numbers */}
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-warm-gray)' }}>Warmth</div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: warmth.token }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{warmth.label}</span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>{warmth.desc}</div>
            </div>
            <div className="flex-1 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-warm-gray)' }}>Orbit</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{ring.label}</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-warm-gray)' }}>{ring.desc}</div>
            </div>
          </div>

          {/* private note */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Private note</span>
              <button onClick={() => setEditingNote(v => !v)} className="text-[11px] font-semibold" style={{ color: 'var(--color-steel)' }}>{editingNote ? 'Done' : 'Edit'}</button>
            </div>
            {editingNote ? (
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full text-sm p-2 rounded-lg border outline-none resize-none" style={{ borderColor: 'var(--color-steel)', color: 'var(--color-navy)' }} />
            ) : (
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>{note}</p>
            )}
          </div>

          {/* F4b — per-relationship visibility */}
          <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Eye className="w-3.5 h-3.5" style={{ color: 'var(--color-navy-mid)' }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-navy-mid)' }}>Who can see this relationship</span>
            </div>
            <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
              {(Object.keys(visibilityMeta) as Visibility[]).map(v => {
                const M = visibilityMeta[v];
                const active = visibility === v;
                return (
                  <button
                    key={v}
                    onClick={() => setVisibility(v)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors"
                    style={{ backgroundColor: active ? 'white' : 'transparent', color: active ? 'var(--color-steel)' : 'var(--color-warm-gray)', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}
                  >
                    <M.icon className="w-3.5 h-3.5" /> {M.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px]" style={{ color: 'var(--color-navy-mid)' }}>{visibilityMeta[visibility].blast}</span>
              {visibility === workspaceDefault && (
                <span className="text-[11px] font-medium shrink-0 ml-2" style={{ color: 'var(--color-warm-gray)' }}>workspace default</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// NOTE (ADR-026, consent reset): the prior IntroConsentCard here implemented a both-party-consent
// state machine (requested → awaiting_both → active | declined) — superseded. Per ADR-026, an
// intro is a governed draft approved by the SENDER only (see data/signals.ts introSignals() /
// PersonTiers's "Suggest introductions" boundary copy); there is no "awaiting both parties" state.
// Removed as dead code (never imported) rather than left as a stale, contradictory component.
