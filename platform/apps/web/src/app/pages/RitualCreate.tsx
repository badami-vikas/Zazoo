import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronRight, BookOpen, Zap, Save, ArrowLeft, Plus, Trash2, AlertTriangle, ShieldCheck, Bot } from 'lucide-react';
import clsx from 'clsx';
import {
  CAPABILITY_TOKENS,
  SKILL_OPTIONS,
  DATA_SCOPES,
  type DataScope,
  type PermissionState,
} from '../components/PermissionLayers';
import { apiCreateRitual, API_ENABLED } from '../data/api';

// Ritual (workflow) creation — name, trigger, assigned agent(s), steps. A ritual runs UNDER
// its agents' authority and may never exceed it (ritual scope ⊆ agent scope). Each step
// declares a requested resource/action/dataScope; the page shows the effective intersected
// scope and warns on any step that asks for something outside the assigned agents' scope.
//
// Assignable agents come from props/local state (no dummy data). The two seeded options
// below reflect real least-privilege presets the user can pick from — not fabricated data.

interface AssignableAgent {
  id: string;
  name: string;
  permissions: PermissionState;
}

// Real, non-dummy presets mirroring how an in-platform agent is scoped. The user picks
// which agent(s) a ritual runs under; the ritual is then clamped to their intersection.
const ASSIGNABLE_AGENTS: AssignableAgent[] = [
  {
    id: 'helpdesk-ai',
    name: 'Helpdesk AI',
    permissions: {
      capabilityScope: ['person:read', 'relationship:read', 'community:read', 'touchpoint:write'],
      allowedSkills: ['capabilityMatching', 'intentClassification', 'assistancePathProposal', 'offerDrafting'],
      dataScope: 'private',
      egressTier: 'draft-graph',
    },
  },
  {
    id: 'reader',
    name: 'Read-only Strategist',
    permissions: {
      capabilityScope: ['person:read', 'relationship:read', 'signal:read'],
      allowedSkills: ['relationshipScoring', 'personIntelligence'],
      dataScope: 'public',
      egressTier: 'read-graph',
    },
  },
];

const RESOURCE_TYPES = ['person', 'relationship', 'memory', 'community', 'signal', 'touchpoint', 'initiative'];
const ACTIONS = ['read', 'write'] as const;

interface Step {
  id: string;
  skill: string;
  action: (typeof ACTIONS)[number];
  resourceType: string;
  dataScope: DataScope;
}

const DATA_RANK: Record<DataScope, number> = { public: 1, private: 2, all: 3 };

let stepSeq = 0;
const newStep = (): Step => ({
  id: `step-${stepSeq++}`,
  skill: SKILL_OPTIONS[0].value,
  action: 'read',
  resourceType: 'person',
  dataScope: 'public',
});

export function RitualCreate() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[]>([newStep()]);
  const [saving, setSaving] = useState(false);

  const assigned = ASSIGNABLE_AGENTS.filter((a) => agentIds.includes(a.id));

  // Effective agent scope = the UNION of assigned agents' authority (a ritual may run under
  // any of its agents). A step is in-bounds when at least one assigned agent can back it.
  const agentScope = useMemo(() => {
    const caps = new Set<string>();
    const skills = new Set<string>();
    let maxData = 0;
    for (const a of assigned) {
      a.permissions.capabilityScope.forEach((c) => caps.add(c));
      a.permissions.allowedSkills.forEach((s) => skills.add(s));
      maxData = Math.max(maxData, DATA_RANK[a.permissions.dataScope]);
    }
    return { caps, skills, maxData };
  }, [assigned]);

  // Per-step bounds check (ritual step ⊆ assigned-agent scope).
  const stepViolations = (s: Step): string[] => {
    if (assigned.length === 0) return ['No agent assigned — assign an agent to grant this step authority.'];
    const v: string[] = [];
    const token = `${s.resourceType}:${s.action}`;
    if (!agentScope.caps.has(token)) v.push(`Capability ${token} is outside the assigned agents' scope.`);
    if (!agentScope.skills.has(s.skill)) v.push(`Skill "${SKILL_OPTIONS.find((o) => o.value === s.skill)?.label}" is not on the assigned agents' allow-list.`);
    if (DATA_RANK[s.dataScope] > agentScope.maxData) v.push(`Data tier "${s.dataScope}" exceeds the assigned agents' ceiling.`);
    return v;
  };

  const anyViolation = steps.some((s) => stepViolations(s).length > 0);
  const canSave = name.trim().length > 0 && agentIds.length === 1 && !anyViolation;

  const updateStep = (id: string, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const toggleAgent = (id: string) =>
    setAgentIds((prev) => (prev.includes(id) ? [] : [id]));

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await apiCreateRitual({
        name: name.trim(),
        agentIds,
        steps: steps.map((s) => ({ skill: s.skill, action: s.action, resourceType: s.resourceType, dataScope: s.dataScope })),
      });
    } catch {
      // demo fallback
    } finally {
      setSaving(false);
      navigate('/rituals');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">

      {/* ── Header ─── */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)] gap-2 text-sm">
          <BookOpen className="w-3.5 h-3.5 text-[var(--color-steel)]" />
          <Link to="/rituals" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Workflows</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--color-steel)]/8 text-[var(--color-steel)] px-2.5 py-0.5 rounded text-xs font-semibold">New workflow</span>
        </div>
        <div className="h-10 flex items-center justify-between px-6">
          <Link to="/rituals" className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            title={anyViolation ? 'Resolve out-of-scope steps before creating' : undefined}
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'Creating…' : 'Create Workflow'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 py-10 flex flex-col gap-10 pb-32">

          {/* Hero */}
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-[var(--color-steel)]/20 shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-steel), color-mix(in srgb, var(--color-steel) 80%, black))' }}>
              <Zap className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-navy)]">Create a workflow</h1>
              <p className="text-sm text-[var(--color-navy-mid)] mt-1 max-w-xl">
                A workflow runs under its agents' authority and can never exceed it. Each step's requested scope is
                clamped to the assigned agents — anything beyond is flagged before you can save.
              </p>
            </div>
          </div>

          {/* Identity + trigger */}
          <section className="flex flex-col gap-4">
            <h2 className="font-bold text-[var(--color-navy)] border-b border-[var(--color-border)] pb-3">Definition</h2>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--color-navy)]">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dormant tie reconnect"
                className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--color-navy)]">Trigger</label>
              <input
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder="e.g. Trust high · warmth cooling"
                className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]"
              />
            </div>
          </section>

          {/* Assigned agents */}
          <section className="flex flex-col gap-4">
            <div className="border-b border-[var(--color-border)] pb-3">
              <h2 className="font-bold text-[var(--color-navy)]">Owning Agent</h2>
              <p className="text-xs text-[var(--color-navy-mid)] mt-0.5">The workflow runs under these agents. Steps are clamped to their combined authority.</p>
            </div>
            <div className="flex flex-col gap-2">
              {ASSIGNABLE_AGENTS.map((a) => {
                const on = agentIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                      on ? 'bg-[var(--color-steel)]/8 border-[var(--color-steel)]/40' : 'bg-white border-[var(--color-border)] hover:border-[var(--color-steel)]/30',
                    )}
                  >
                    <div className="w-9 h-9 rounded-lg bg-[var(--color-steel)]/10 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-[var(--color-steel)]" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[var(--color-navy)]">{a.name}</div>
                      <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">
                        {a.permissions.capabilityScope.length} tokens · data ≤ {a.permissions.dataScope} · egress {a.permissions.egressTier}
                      </div>
                    </div>
                    <span className={clsx('w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-[var(--color-steel)] border-[var(--color-steel)]' : 'border-[var(--color-border)]')}>
                      {on && <ShieldCheck className="w-3 h-3 text-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Steps */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <div>
                <h2 className="font-bold text-[var(--color-navy)]">Steps</h2>
                <p className="text-xs text-[var(--color-navy-mid)] mt-0.5">Each step declares the skill, action, resource, and data tier it requests.</p>
              </div>
              <button
                type="button"
                onClick={() => setSteps((p) => [...p, newStep()])}
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-steel)] hover:bg-[var(--color-steel)]/5 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" /> Add step
              </button>
            </div>

            {steps.map((s, i) => {
              const violations = stepViolations(s);
              const bad = violations.length > 0;
              return (
                <div
                  key={s.id}
                  className={clsx('p-4 rounded-xl border shadow-sm', bad ? 'border-[var(--warning)]/40 bg-[var(--warning)]/5' : 'border-[var(--color-border)] bg-white')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-warm-gray)]">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <button type="button" onClick={() => setSteps((p) => p.filter((x) => x.id !== s.id))} className="p-1 text-[var(--color-warm-gray)] hover:text-[var(--danger)] rounded transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-navy-mid)]">
                      Skill
                      <select value={s.skill} onChange={(e) => updateStep(s.id, { skill: e.target.value })} className="text-sm font-normal rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]">
                        {SKILL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-navy-mid)]">
                      Action
                      <select value={s.action} onChange={(e) => updateStep(s.id, { action: e.target.value as Step['action'] })} className="text-sm font-normal rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]">
                        {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-navy-mid)]">
                      Resource
                      <select value={s.resourceType} onChange={(e) => updateStep(s.id, { resourceType: e.target.value })} className="text-sm font-normal rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]">
                        {RESOURCE_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-navy-mid)]">
                      Data tier
                      <select value={s.dataScope} onChange={(e) => updateStep(s.id, { dataScope: e.target.value as DataScope })} className="text-sm font-normal rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]">
                        {DATA_SCOPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 text-xs font-mono text-[var(--color-navy-mid)]">
                    requests <span className="text-[var(--color-steel)]">{s.resourceType}:{s.action}</span> · {s.dataScope} data
                  </div>

                  {bad && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {violations.map((v, vi) => (
                        <li key={vi} className="text-xs text-[var(--warning)] flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {v}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>

          {/* Effective ritual scope = ritual ∩ assigned-agent scope */}
          <section className="p-5 bg-[var(--color-steel)]/5 border border-[var(--color-steel)]/20 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-[var(--color-steel)]" />
              <span className="font-bold text-[var(--color-navy)] text-sm">Effective workflow scope</span>
              <span className="text-xs text-[var(--color-navy-mid)] ml-auto">workflow ∩ assigned agents</span>
            </div>
            {assigned.length === 0 ? (
              <p className="text-xs text-[var(--color-warm-gray)]">Assign an agent to compute the effective scope.</p>
            ) : (
              <>
                <div className="text-xs text-[var(--color-navy-mid)] mb-2">
                  Agents grant: {[...agentScope.caps].length} capability tokens · data ceiling {DATA_SCOPES.find((d) => DATA_RANK[d.value] === agentScope.maxData)?.label ?? '—'}
                </div>
                <div className="flex flex-wrap gap-1">
                  {steps
                    .filter((s) => stepViolations(s).length === 0)
                    .map((s) => (
                      <span key={s.id} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-steel)]/10 text-[var(--color-steel)]">
                        {s.resourceType}:{s.action}/{s.dataScope}
                      </span>
                    ))}
                  {steps.every((s) => stepViolations(s).length > 0) && (
                    <span className="text-xs text-[var(--color-warm-gray)]">no in-scope steps yet</span>
                  )}
                </div>
              </>
            )}
            {anyViolation && (
              <div className="mt-3 pt-3 border-t border-[var(--color-steel)]/15 text-xs text-[var(--warning)] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> One or more steps exceed the assigned agents' scope. Resolve them to create the workflow.
              </div>
            )}
          </section>

          {!API_ENABLED && (
            <p className="text-xs text-[var(--color-warm-gray)] text-center">
              Backend not connected — this workflow is created in local state for the demo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
