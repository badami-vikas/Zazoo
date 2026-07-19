import { useMemo } from 'react';
import clsx from 'clsx';
import { Key, ListChecks, Database, Send, Lock, ShieldCheck, ShieldX } from 'lucide-react';

// ─── Layered, gated agent authority ───────────────────────────────────────────
// Modeled on Google's incremental/layered OAuth scopes: least-privilege by default,
// each layer widens authority only when the human explicitly grants it.
//
// In-platform agents DRAFT only. They can NEVER send externally and can NEVER approve
// a proposal — these are non-removable "agent-floor" denials enforced server-side.
// The UI surfaces those as locked rows, not editable switches.
//
// Layer order (narrow → wide):
//   1. Capability scope tokens   (person:read, touchpoint:write, …)
//   2. Allowed skills allow-list
//   3. Data tier ceiling          (all | public | private)
//   4. Egress tier                (none | read-graph | draft-graph | source-internet)
// "send" is NEVER an agent option — human-only, with approval.

export type DataScope = 'all' | 'public' | 'private';
export type EgressTier = 'none' | 'read-graph' | 'draft-graph' | 'source-internet';

export interface PermissionState {
  capabilityScope: string[];
  allowedSkills: string[];
  dataScope: DataScope;
  egressTier: EgressTier;
}

// Canonical capability tokens an agent may hold. Read tokens are least-privilege; write
// tokens stage drafts only (the pipeline forces draft-then-approve on any write).
export const CAPABILITY_TOKENS: { value: string; label: string; kind: 'read' | 'write' }[] = [
  { value: 'person:read', label: 'person:read', kind: 'read' },
  { value: 'relationship:read', label: 'relationship:read', kind: 'read' },
  { value: 'memory:read', label: 'memory:read', kind: 'read' },
  { value: 'community:read', label: 'community:read', kind: 'read' },
  { value: 'signal:read', label: 'signal:read', kind: 'read' },
  { value: 'touchpoint:write', label: 'touchpoint:write', kind: 'write' },
  { value: 'memory:write', label: 'memory:write', kind: 'write' },
  { value: 'initiative:write', label: 'initiative:write', kind: 'write' },
];

// Skills an agent may be allowed to run. Allow-list is intersected against the agent's
// capability scope at run time, so granting a skill never widens authority on its own.
export const SKILL_OPTIONS: { value: string; label: string }[] = [
  { value: 'capabilityMatching', label: 'Capability Matching' },
  { value: 'intentClassification', label: 'Intent Classification' },
  { value: 'assistancePathProposal', label: 'Assistance-Path Proposal' },
  { value: 'offerDrafting', label: 'Offer Drafting' },
  { value: 'relationshipScoring', label: 'Relationship Scoring' },
  { value: 'stageMutation', label: 'Stage Mutation (draft a write)' },
  { value: 'webResearch', label: 'Web Research (source-internet)' },
  { value: 'personIntelligence', label: 'Person Intelligence' },
];

export const DATA_SCOPES: { value: DataScope; label: string; desc: string }[] = [
  { value: 'public', label: 'Public data', desc: 'Canonical / public facts only' },
  { value: 'private', label: 'Private data', desc: 'Your relationship tier' },
  { value: 'all', label: 'All data', desc: 'Public + private (widest)' },
];

// Egress tiers, narrow → wide. "send" is intentionally absent: external send is human-only.
export const EGRESS_TIERS: { value: EgressTier; label: string; desc: string }[] = [
  { value: 'none', label: 'None', desc: 'No egress. Reasoning only.' },
  { value: 'read-graph', label: 'Read graph', desc: 'May read the relationship graph.' },
  { value: 'draft-graph', label: 'Draft into graph', desc: 'May stage drafts (draft-then-approve).' },
  { value: 'source-internet', label: 'Source from internet', desc: 'May fetch public web (external:fetch).' },
];

// Non-removable agent-floor denials — enforced server-side, shown as locked rows.
export const AGENT_FLOOR_DENIALS: { label: string; desc: string }[] = [
  { label: 'external:send', desc: 'Agents can never send externally. Send is human-only, with approval.' },
  { label: 'action:approve', desc: 'Agents can never approve a proposal. Approvals are human-only.' },
];

// Least-privilege preview: the effective scope an agent will actually wield. Capability
// tokens are gated by the data ceiling (private tokens fall away when scope is public-only)
// and the egress tier (write tokens require at least draft-graph egress to take effect).
export function computeEffective(state: PermissionState): {
  effectiveCapabilities: string[];
  effectiveSkills: string[];
  notes: string[];
} {
  const notes: string[] = [];
  let caps = [...state.capabilityScope];

  // Egress gating: write capability tokens are inert below draft-graph egress.
  const canWrite = state.egressTier === 'draft-graph' || state.egressTier === 'source-internet';
  if (!canWrite) {
    const dropped = caps.filter((c) => c.endsWith(':write'));
    if (dropped.length) {
      caps = caps.filter((c) => !c.endsWith(':write'));
      notes.push(`Write tokens (${dropped.join(', ')}) are inert — egress tier is below "Draft into graph".`);
    }
  }

  // Skills are intersected with capability scope — a skill with no backing token can't run.
  const skills = [...state.allowedSkills];
  if (state.egressTier === 'source-internet' && !skills.includes('webResearch')) {
    notes.push('Source-internet egress is granted but no web-sourcing skill is on the allow-list.');
  }

  return { effectiveCapabilities: caps, effectiveSkills: skills, notes };
}

// ─── Row scaffold (icon + label + description + control), mirrors AgentDetail Settings ──

function LayerRow({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: any;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[var(--color-steel)]/10">
          <Icon className="w-4 h-4 text-[var(--color-steel)]" />
        </div>
        <div>
          <div className="font-semibold text-[var(--color-navy)] text-sm">{title}</div>
          <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Shared layered-scope control ─────────────────────────────────────────────
// Used by AgentCreate and AgentDetail (edit).

export function PermissionLayers({
  value,
  onChange,
  readOnly = false,
}: {
  value: PermissionState;
  onChange?: (next: PermissionState) => void;
  readOnly?: boolean;
}) {
  const set = (patch: Partial<PermissionState>) => onChange?.({ ...value, ...patch });

  const toggleToken = (token: string) => {
    if (readOnly) return;
    const has = value.capabilityScope.includes(token);
    set({ capabilityScope: has ? value.capabilityScope.filter((t) => t !== token) : [...value.capabilityScope, token] });
  };
  const toggleSkill = (skill: string) => {
    if (readOnly) return;
    const has = value.allowedSkills.includes(skill);
    set({ allowedSkills: has ? value.allowedSkills.filter((s) => s !== skill) : [...value.allowedSkills, skill] });
  };

  const effective = useMemo(() => computeEffective(value), [value]);

  return (
    <div className="flex flex-col gap-4">

      {/* Layer 1 — capability scope tokens */}
      <LayerRow
        icon={Key}
        title="Layer 1 · Capability scope"
        desc="Least-privilege tokens this agent may hold. Read tokens are safest; write tokens only ever stage drafts."
      >
        <div className="flex flex-wrap gap-2">
          {CAPABILITY_TOKENS.map((t) => {
            const on = value.capabilityScope.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                disabled={readOnly}
                onClick={() => toggleToken(t.value)}
                className={clsx(
                  'flex items-center gap-1.5 text-xs font-mono font-medium px-2.5 py-1.5 rounded-lg border transition-all',
                  readOnly && 'cursor-default',
                  !readOnly && 'active:scale-95',
                  on
                    ? 'bg-[var(--color-steel)]/10 border-[var(--color-steel)]/40 text-[var(--color-steel)]'
                    : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-navy-mid)] hover:border-[var(--color-steel)]/30',
                )}
              >
                <span className={clsx('w-1.5 h-1.5 rounded-full', t.kind === 'write' ? 'bg-[var(--warning)]' : 'bg-[var(--success)]')} />
                {t.label}
              </button>
            );
          })}
        </div>
      </LayerRow>

      {/* Layer 2 — allowed skills allow-list */}
      <LayerRow
        icon={ListChecks}
        title="Layer 2 · Allowed skills"
        desc="An allow-list of skills the agent may run. Each skill is intersected with the capability scope above — granting a skill never widens authority."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SKILL_OPTIONS.map((s) => {
            const on = value.allowedSkills.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                disabled={readOnly}
                onClick={() => toggleSkill(s.value)}
                className={clsx(
                  'flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg border text-left transition-all',
                  readOnly && 'cursor-default',
                  on
                    ? 'bg-[var(--color-steel)]/8 border-[var(--color-steel)]/40 text-[var(--color-navy)]'
                    : 'bg-white border-[var(--color-border)] text-[var(--color-navy-mid)] hover:border-[var(--color-steel)]/30',
                )}
              >
                <span
                  className={clsx(
                    'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    on ? 'bg-[var(--color-steel)] border-[var(--color-steel)]' : 'border-[var(--color-border)]',
                  )}
                >
                  {on && <ListChecks className="w-3 h-3 text-white" />}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>
      </LayerRow>

      {/* Layer 3 — data tier ceiling */}
      <LayerRow
        icon={Database}
        title="Layer 3 · Data tier ceiling"
        desc="The widest data tier this agent may reach. Public = canonical facts · Private = your relationship data."
      >
        <select
          value={value.dataScope}
          disabled={readOnly}
          onChange={(e) => set({ dataScope: e.target.value as DataScope })}
          className="text-sm font-medium rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)] disabled:cursor-default w-full sm:w-auto"
          title="Widest data tier this agent can reach"
        >
          {DATA_SCOPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label} — {d.desc}
            </option>
          ))}
        </select>
      </LayerRow>

      {/* Layer 4 — egress tier (with send locked) */}
      <LayerRow
        icon={Send}
        title="Layer 4 · Egress tier"
        desc="How far the agent's output may travel. Each step up widens reach. External send is never an option."
      >
        <div className="flex flex-col gap-2">
          {EGRESS_TIERS.map((tier) => {
            const on = value.egressTier === tier.value;
            return (
              <button
                key={tier.value}
                type="button"
                disabled={readOnly}
                onClick={() => !readOnly && set({ egressTier: tier.value })}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all',
                  readOnly && 'cursor-default',
                  on
                    ? 'bg-[var(--color-steel)]/8 border-[var(--color-steel)]/40'
                    : 'bg-white border-[var(--color-border)] hover:border-[var(--color-steel)]/30',
                )}
              >
                <span
                  className={clsx(
                    'w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
                    on ? 'border-[var(--color-steel)]' : 'border-[var(--color-border)]',
                  )}
                >
                  {on && <span className="w-2 h-2 rounded-full bg-[var(--color-steel)]" />}
                </span>
                <span className="flex-1">
                  <span className="text-sm font-semibold text-[var(--color-navy)]">{tier.label}</span>
                  <span className="text-xs text-[var(--color-navy-mid)] ml-2">{tier.desc}</span>
                </span>
              </button>
            );
          })}

          {/* Locked: external send — human-only */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] opacity-90">
            <Lock className="w-4 h-4 text-[var(--color-warm-gray)] shrink-0" />
            <span className="flex-1">
              <span className="text-sm font-semibold text-[var(--color-navy-mid)]">Send externally</span>
              <span className="text-xs text-[var(--color-warm-gray)] ml-2">Human-only, with approval — never an agent option.</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-warm-gray)] px-2 py-0.5 rounded bg-[var(--color-border)]/60">Locked</span>
          </div>
        </div>
      </LayerRow>

      {/* Non-removable agent-floor denials */}
      <div className="p-5 bg-[var(--danger)]/8 border border-[var(--danger)]/25 rounded-xl">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[var(--danger)]/12">
            <ShieldX className="w-4 h-4 text-[var(--danger)]" />
          </div>
          <div>
            <div className="font-semibold text-[var(--color-navy)] text-sm">Agent-floor denials</div>
            <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">
              Non-removable, enforced server-side. These can never be toggled on for any in-platform agent.
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {AGENT_FLOOR_DENIALS.map((d) => (
            <div key={d.label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--danger)]/20 bg-white">
              <Lock className="w-4 h-4 text-[var(--danger)] shrink-0" />
              <span className="flex-1">
                <span className="text-sm font-mono font-semibold text-[var(--color-navy)]">{d.label}</span>
                <span className="text-xs text-[var(--color-navy-mid)] ml-2 block sm:inline">{d.desc}</span>
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--danger)] px-2 py-0.5 rounded bg-[var(--danger)]/10 shrink-0">Denied</span>
            </div>
          ))}
        </div>
      </div>

      {/* Effective permissions summary (least-privilege preview) */}
      <div className="p-5 bg-[var(--color-steel)]/5 border border-[var(--color-steel)]/20 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-[var(--color-steel)]" />
          <span className="font-bold text-[var(--color-navy)] text-sm">Effective permissions</span>
          <span className="text-xs text-[var(--color-navy-mid)] ml-auto">recomputed live · least-privilege</span>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide mb-1">Capabilities</dt>
            <dd className="flex flex-wrap gap-1">
              {effective.effectiveCapabilities.length === 0 ? (
                <span className="text-xs text-[var(--color-warm-gray)]">none</span>
              ) : (
                effective.effectiveCapabilities.map((c) => (
                  <span key={c} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-steel)]/10 text-[var(--color-steel)]">{c}</span>
                ))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide mb-1">Skills</dt>
            <dd className="flex flex-wrap gap-1">
              {effective.effectiveSkills.length === 0 ? (
                <span className="text-xs text-[var(--color-warm-gray)]">none</span>
              ) : (
                effective.effectiveSkills.map((s) => (
                  <span key={s} className="text-[11px] px-1.5 py-0.5 rounded bg-white border border-[var(--color-border)] text-[var(--color-navy-mid)]">{s}</span>
                ))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide mb-1">Data ceiling</dt>
            <dd className="text-[var(--color-navy)] font-medium capitalize">{value.dataScope}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide mb-1">Egress tier</dt>
            <dd className="text-[var(--color-navy)] font-medium">{EGRESS_TIERS.find((e) => e.value === value.egressTier)?.label}</dd>
          </div>
        </dl>
        {effective.notes.length > 0 && (
          <ul className="mt-3 pt-3 border-t border-[var(--color-steel)]/15 flex flex-col gap-1">
            {effective.notes.map((n, i) => (
              <li key={i} className="text-xs text-[var(--warning)] flex items-start gap-1.5">
                <span className="mt-0.5">•</span> {n}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 pt-3 border-t border-[var(--color-steel)]/15 text-xs text-[var(--color-navy-mid)] flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--success)]" />
          Approvals are human-only. This agent drafts; you decide.
        </div>
      </div>

    </div>
  );
}
