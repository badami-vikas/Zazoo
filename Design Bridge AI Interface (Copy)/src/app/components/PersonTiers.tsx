import { useState } from 'react';
import {
  Globe, Lock, ShieldCheck, Check, X, Users, User, Building2,
  Eye, EyeOff, ArrowLeftRight, Sparkles, Handshake, Info, MapPin,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';

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

// ─────────────────────────────────────────────────────────────────────────────
// F4c — Sender-approved intro flow (ADR-026, ruling 2026-07-06: both-party consent is
// NOT required). An intro is a governed draft the SENDER (the person making the intro)
// approves themselves — a single human approval, same as any other outbound send. It is
// NOT gated on the other party approving first: the user already holds trust with both
// sides and can vet the match themselves. State machine: drafted → sent | declined.
// Still private-by-default and still human-approved before anything goes out — no
// silent enrichment, no auto-send.
// ─────────────────────────────────────────────────────────────────────────────

type IntroState = 'drafted' | 'sent' | 'declined';

export function IntroConsentCard({ personName }: { personName: string }) {
  const requester = 'You';
  const partyA = personName;        // the person whose page we're on
  const partyB = 'Dana Cole';       // the other side of the intro
  const [state, setState] = useState<IntroState>('drafted');

  const stateMeta: Record<IntroState, { label: string; token: string }> = {
    drafted: { label: 'Draft — awaiting your approval', token: 'var(--color-warm-gray)' },
    sent: { label: 'Introduction sent', token: 'var(--success)' },
    declined: { label: 'Declined', token: 'var(--danger)' },
  };

  return (
    <div className="rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <Handshake className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
        <span className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>Introduction</span>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${stateMeta[state].token} 14%, transparent)`, color: stateMeta[state].token }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stateMeta[state].token }} /> {stateMeta[state].label}
        </span>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{requester}</span> drafted an introduction connecting <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{partyA}</span> and <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{partyB}</span>. You know and trust both sides, so you can vet this match yourself — no separate approval from either party is required before you send it.
        </div>

        {/* state machine ribbon */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-warm-gray)' }}>
          {(['drafted', 'sent'] as IntroState[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <span style={{ color: 'var(--color-border)' }}>→</span>}
              <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: state === s ? `color-mix(in srgb, ${stateMeta[s].token} 16%, transparent)` : 'transparent', color: state === s ? stateMeta[s].token : 'var(--color-warm-gray)', fontWeight: state === s ? 700 : 500 }}>{stateMeta[s].label}</span>
            </span>
          ))}
        </div>

        {/* what will be shared */}
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
          <span>On send, each party is shared only their <span className="font-medium">name, role, and the reason for the intro</span>. No private notes or warmth are ever shared.</span>
        </div>

        {/* your approval — single sender approval, not both-party */}
        {state === 'drafted' && (
          <div className="flex gap-1.5">
            <button onClick={() => setState('sent')} className="flex-1 text-xs font-semibold py-1.5 rounded-md text-white" style={{ backgroundColor: 'var(--success)' }}>Approve & send</button>
            <button onClick={() => setState('declined')} className="flex-1 text-xs font-semibold py-1.5 rounded-md border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>Discard draft</button>
          </div>
        )}

        {/* hard rule / outcome */}
        <AnimatePresence mode="wait">
          {state === 'sent' ? (
            <motion.div key="sent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)' }}>
              <Check className="w-3.5 h-3.5" /> You approved and sent it — the introduction is now active.
            </motion.div>
          ) : state === 'declined' ? (
            <motion.div key="declined" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
              <X className="w-3.5 h-3.5" /> Discarded — nothing was shared.
            </motion.div>
          ) : (
            <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)', color: 'var(--warning)' }}>
              <Lock className="w-3.5 h-3.5" /> Not sent yet — awaiting your approval. No silent enrichment, no auto-send.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
