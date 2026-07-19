import { useState, useCallback } from 'react';
import { ChevronRight, Edit2, Trash2, Plus, Zap, Clock, CheckCircle, AlertCircle, TrendingUp, Users, Activity, Copy, Bot, Sparkles, Link2, Play, Pause, MoreHorizontal, ArrowRight, Calendar, BookOpen, Cpu, Database, X, Save } from 'lucide-react';
import { Link, useParams } from 'react-router';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import { PermissionLayers, type PermissionState } from '../components/PermissionLayers';
import { apiUpdateAgent } from '../data/api';

// ─── Agent Data ──────────────────────────────────────────────────────────────

const agentDetails: Record<string, any> = {
  'helpdesk-ai': {
    name: 'Helpdesk AI', specialization: 'Support strategist', model: 'ModelProvider (local default)', status: 'Active',
    desc: 'Helpdesk AI is the routing Engine of the Helpdesk Module. For every request it asks one question — “how could this person realistically help?” — matching needs to capabilities across the relationship graph (capability, not topic), and proposing concrete ways to contribute (intro, feedback, resources, hiring, funding, expertise). It proposes; humans decide. Every offer is drafted for review, never auto-sent.',
    avatar: 'H', color: '#4D7EA8',
    accuracy: 96, runs: 0, automations: 0, lastActive: 'Live',
    goal: 'Route each request to people who can meaningfully help, and propose actionable assistance — while keeping noise out of everyone else’s way.',
    memory: 'Per-recipient capability profile (role/company/expertise/communities) + offer history. Classification-gated; reads only what policy allows.',
    permissions: 'Deny-default. May READ the relationship graph and DRAFT help proposals (help:route, help:offer). May NOT send, contact, or commit without human approval (agent-floor).',
    skills: [
      { id: 'SK-HD1', name: 'Capability Matching', category: 'Reasoning', strength: 95, locked: false },
      { id: 'SK-HD2', name: 'Intent Classification', category: 'Language', strength: 93, locked: false },
      { id: 'SK-HD3', name: 'Assistance-Path Proposal', category: 'Reasoning', strength: 90, locked: false },
      { id: 'SK-HD4', name: 'Offer Drafting', category: 'Communication', strength: 88, locked: false },
      { id: 'SK-HD5', name: 'Auto-Filter (noise control)', category: 'Analytics', strength: 91, locked: false },
    ],
    connectedAutomations: ['Helpdesk — AI-assisted routing', 'Helpdesk — Broadcast + auto-filter', 'Helpdesk — Offer → Approvals → Touchpoint'],
    activity: [
      { time: 'Live', event: 'Routes requests on capability, not topic', type: 'run' },
      { time: 'Live', event: 'Proposes assistance paths to candidate helpers', type: 'output' },
      { time: 'Live', event: 'Drafts offers into Approvals (draft-then-approve)', type: 'output' },
    ],
    analytics: { runs: [0, 0, 0, 0, 0, 0, 0], months: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'] },
  },
};

// No matching record → an honest "not configured yet" state rather than fabricated metrics.
// helpdesk-ai is currently the only real, live agent; everything else routes here until the
// agent runtime (P0 Kernel) ships real agents with real run history.
const defaultAgent = {
  name: 'Agent', specialization: 'Not yet configured', model: '—', status: 'Inactive',
  desc: 'This agent has not been created yet. Once the agent runtime is connected, its skills, activity, and run history will appear here.',
  avatar: '?', color: '#B8B4A8',
  accuracy: 0, runs: 0, automations: 0, lastActive: 'Never',
  skills: [],
  connectedAutomations: [],
  activity: [],
  analytics: { runs: [0, 0, 0, 0, 0, 0, 0], months: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'] },
};

const navTabs = ['Overview', 'Skill Matrix', 'Activity', 'Connections', 'Settings'];

// ─── Skill Slider ─────────────────────────────────────────────────────────────

function SkillSlider({ skill, onChange }: { skill: any; onChange: (id: string, val: number) => void }) {
  const val = skill.strength;
  const tier = val >= 85 ? { label: 'Expert', color: '#4D7EA8', bg: 'bg-[var(--color-steel)]/10 text-[var(--color-steel)]' }
    : val >= 70 ? { label: 'Proficient', color: '#4D7EA8', bg: 'bg-[var(--info)]/10 text-[var(--info)]' }
    : val >= 50 ? { label: 'Developing', color: '#C4955A', bg: 'bg-[var(--warning)]/10 text-[var(--warning)]' }
    : { label: 'Basic', color: '#B8B4A8', bg: 'bg-[var(--color-surface)] text-[var(--color-navy-mid)]' };

  const catColors: Record<string, string> = { Language: 'bg-[var(--info)]/10 text-[var(--info)]', Data: 'bg-[var(--success)]/10 text-[var(--success)]', Communication: 'bg-[var(--info)]/10 text-[var(--info)]', Analytics: 'bg-[var(--warning)]/10 text-[var(--warning)]' };

  return (
    <div className="group p-4 bg-white border border-[var(--color-border)] rounded-xl hover:border-[var(--color-steel)]/30 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-steel)]/8 flex items-center justify-center border border-[var(--color-steel)]/10 shrink-0">
            <Sparkles className="w-4 h-4 text-[var(--color-steel)]" />
          </div>
          <div>
            <div className="font-semibold text-[var(--color-navy)] text-sm">{skill.name}</div>
            <span className={clsx('text-xs font-semibold px-1.5 py-0.5 rounded', catColors[skill.category] || 'bg-[var(--color-surface)] text-[var(--color-navy-mid)]')}>
              {skill.category}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs font-bold px-2 py-0.5 rounded-full', tier.bg)}>{tier.label}</span>
          <span className="text-lg font-semibold" style={{ color: tier.color }}>{val}</span>
        </div>
      </div>

      {/* Styled range slider */}
      <div className="relative mt-1">
        <div className="relative h-2 bg-[var(--color-surface)] rounded-full overflow-visible border border-[var(--color-border)]/50">
          {/* Fill track */}
          <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${val}%`, backgroundColor: tier.color }} />
          {/* Tier markers */}
          {[50, 70, 85].map(m => (
            <div key={m} className="absolute top-0 h-full w-px bg-white/60" style={{ left: `${m}%` }} />
          ))}
        </div>
        <input
          type="range" min={0} max={100} value={val}
          onChange={e => onChange(skill.id, parseInt(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-grab active:cursor-grabbing h-2"
          style={{ margin: 0, padding: 0 }}
          title={`Drag to calibrate ${skill.name} strength`}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 shadow-md transition-all group-hover:scale-110 pointer-events-none"
          style={{ left: `calc(${val}% - 10px)`, borderColor: tier.color }}
        />
      </div>

      {/* Tier labels */}
      <div className="flex justify-between mt-2 text-xs text-[var(--color-warm-gray)] font-medium">
        <span>Basic</span><span>Developing</span><span>Proficient</span><span>Expert</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentDetail() {
  const { id } = useParams();
  const decoded = id ? decodeURIComponent(id) : '';
  const raw = agentDetails[decoded] || { ...defaultAgent, name: decoded || defaultAgent.name };

  const [activeTab, setActiveTab] = useState('Overview');
  const [isActive, setIsActive] = useState(raw.status === 'Active');
  const [dataAccess, setDataAccess] = useState<'all' | 'public' | 'private'>('public');
  const [skills, setSkills] = useState(raw.skills);

  // Edit Agent — scope editor reusing the shared layered controls. Seeded from the
  // agent's current (read-only) authority; least-privilege defaults when unknown.
  const [editingScope, setEditingScope] = useState(false);
  const [savingScope, setSavingScope] = useState(false);
  const [perms, setPerms] = useState<PermissionState>({
    capabilityScope: [],
    allowedSkills: [],
    dataScope: dataAccess,
    egressTier: 'draft-graph',
  });

  const openScopeEditor = () => {
    setPerms((p) => ({ ...p, dataScope: dataAccess }));
    setEditingScope(true);
  };
  const saveScope = async () => {
    setSavingScope(true);
    try {
      await apiUpdateAgent(decoded, {
        name: raw.name,
        capabilityScope: perms.capabilityScope,
        allowedSkills: perms.allowedSkills,
        dataScope: perms.dataScope,
        egressTier: perms.egressTier,
      });
    } catch {
      // demo fallback — keep local state
    } finally {
      setDataAccess(perms.dataScope);
      setSavingScope(false);
      setEditingScope(false);
    }
  };

  const handleSkillChange = useCallback((skillId: string, val: number) => {
    setSkills((prev: any[]) => prev.map(s => s.id === skillId ? { ...s, strength: val } : s));
  }, []);

  const scrollTo = (tab: string) => {
    setActiveTab(tab);
    document.getElementById(`ag-${tab.toLowerCase().replace(' ', '-')}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const maxBar = Math.max(1, ...raw.analytics.runs);

  const avgStrength = skills.length ? Math.round(skills.reduce((a: number, s: any) => a + s.strength, 0) / skills.length) : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">

      {/* ── Header ─── */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        {/* Breadcrumb */}
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)] gap-2 text-sm">
          <BookOpen className="w-3.5 h-3.5 text-[var(--color-steel)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Intelligence</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Agents</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--color-steel)]/8 text-[var(--color-steel)] px-2.5 py-0.5 rounded text-xs font-semibold">{raw.name}</span>
        </div>
        {/* Actions row */}
        <div className="h-10 flex items-center justify-between px-6">
          <button
            onClick={() => setIsActive(!isActive)}
            className={clsx('flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all active:scale-95',
              isActive ? 'bg-[var(--warning)]/10 border-[var(--warning)]/30 text-[var(--warning)]' : 'bg-[var(--success)]/10 border-[var(--success)]/30 text-[var(--success)]')}
          >
            {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isActive ? 'Pause Agent' : 'Activate Agent'}
          </button>
          <div className="flex items-center gap-2">
            <button className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] rounded-lg transition-colors"><Copy className="w-4 h-4" /></button>
            <button onClick={openScopeEditor} className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors active:scale-95">
              <Edit2 className="w-3.5 h-3.5" /> Edit Agent
            </button>
          </div>
        </div>
      </div>

      {/* ── Secondary Nav ─── */}
      <div className="sticky top-0 bg-white/96 backdrop-blur border-b border-[var(--color-border)] z-10 px-8 shrink-0">
        <div className="flex items-center gap-8 py-2.5 text-sm font-medium overflow-x-auto scrollbar-hide max-w-5xl mx-auto">
          {navTabs.map(tab => (
            <button key={tab} onClick={() => scrollTo(tab)}
              className={clsx('transition-colors whitespace-nowrap pb-1 border-b-2 cursor-pointer', activeTab === tab ? 'text-[var(--color-navy)] border-[var(--color-steel-light)]' : 'text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] border-transparent')}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 py-10 flex flex-col gap-14 pb-32">

          {/* ── OVERVIEW ─── */}
          <section id="ag-overview" className="scroll-mt-24 flex flex-col gap-8">
            {/* Hero */}
            <div className="flex items-start gap-5">
              <div className="relative shrink-0">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-semibold shadow-lg shadow-[var(--color-steel)]/20" style={{ background: `linear-gradient(135deg, ${raw.color}, ${raw.color}cc)` }}>
                  {raw.avatar}
                </div>
                {isActive && <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[var(--success)] rounded-full border-2 border-white shadow-sm" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-[var(--color-navy)]">{raw.name}</h1>
                  <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border', isActive ? 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30' : 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30')}>
                    {isActive ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {isActive ? 'Active' : 'Paused'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[var(--color-steel)]/8 text-[var(--color-steel)] text-xs font-semibold">{raw.specialization}</span>
                </div>
                <p className="text-[var(--color-navy-mid)] max-w-2xl text-sm">{raw.desc}</p>
                <div className="flex gap-4 mt-3 text-sm text-[var(--color-navy-mid)] flex-wrap">
                  <span className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> {raw.model}</span>
                  <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Last active {raw.lastActive}</span>
                  <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> {skills.length} skills loaded</span>
                </div>
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Runs', value: raw.runs.toLocaleString(), icon: Activity, color: 'text-[var(--color-steel)]', bg: 'bg-[var(--color-steel)]/5' },
                { label: 'Accuracy', value: `${raw.accuracy}%`, icon: TrendingUp, color: 'text-[var(--color-steel-light)]', bg: 'bg-[var(--color-steel-light)]/5' },
                { label: 'Automations', value: raw.automations, icon: Zap, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/10' },
                { label: 'Avg Skill Strength', value: `${avgStrength}`, icon: Sparkles, color: 'text-[var(--color-steel)]', bg: 'bg-[var(--info)]/10' },
              ].map(m => (
                <div key={m.label} className="bg-white border border-[var(--color-border)] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center mb-3', m.bg)}>
                    <m.icon className={clsx('w-4 h-4', m.color)} />
                  </div>
                  <div className={clsx('text-2xl font-bold mb-1', m.color)}>{m.value}</div>
                  <div className="text-xs text-[var(--color-navy-mid)] font-medium">{m.label}</div>
                </div>
              ))}
            </div>

            {/* Quick skill snapshot */}
            <div>
              <div className="flex items-center justify-between mb-4 border-b border-[var(--color-border)] pb-3">
                <h2 className="font-bold text-[var(--color-navy)]">Top Skills</h2>
                <button onClick={() => scrollTo('Skill Matrix')} className="text-xs font-semibold text-[var(--color-steel)] hover:underline">View full matrix →</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.sort((a: any, b: any) => b.strength - a.strength).slice(0, 5).map((s: any) => {
                  const pct = s.strength;
                  return (
                    <div key={s.id} className="flex items-center gap-2 bg-white border border-[var(--color-border)] rounded-lg px-3 py-1.5 shadow-sm hover:border-[var(--color-steel)]/30 transition-colors">
                      <Sparkles className="w-3 h-3 text-[var(--color-steel)]" />
                      <span className="text-sm font-medium text-[var(--color-navy)]">{s.name}</span>
                      <span className="text-xs font-bold text-[var(--color-warm-gray)]">{pct}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── SKILL MATRIX ─── */}
          <section id="ag-skill-matrix" className="scroll-mt-24">
            <div className="flex items-center justify-between mb-6 border-b border-[var(--color-border)] pb-4">
              <div>
                <h2 className="text-xl font-bold text-[var(--color-navy)]">Skill Matrix</h2>
                <p className="text-sm text-[var(--color-navy-mid)] mt-0.5">Drag sliders to manually calibrate this agent's skill strengths. Changes are saved automatically.</p>
              </div>
              <button className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-steel)] hover:bg-[var(--color-steel)]/5 px-3 py-1.5 rounded-lg transition-colors">
                <Plus className="w-4 h-4" /> Add Skill
              </button>
            </div>

            {/* Radar-style summary bar */}
            <div className="mb-6 p-4 bg-[var(--color-steel)]/4 border border-[var(--color-steel)]/10 rounded-xl flex items-center gap-6">
              <div className="text-center px-4 border-r border-[var(--color-steel)]/10">
                <div className="text-2xl font-semibold text-[var(--color-steel)]">{avgStrength}</div>
                <div className="text-xs text-[var(--color-navy-mid)] font-medium">Avg Strength</div>
              </div>
              <div className="flex-1 flex items-center gap-3">
                <span className="text-xs text-[var(--color-navy-mid)] font-medium w-20 shrink-0">Overall</span>
                <div className="flex-1 h-2 bg-white border border-[var(--color-steel)]/20 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--color-steel)] transition-all" style={{ width: `${avgStrength}%` }} />
                </div>
                <span className="text-xs font-bold text-[var(--color-steel)] w-8">{avgStrength}%</span>
              </div>
              <div className="text-xs text-[var(--color-warm-gray)] px-4 border-l border-[var(--color-steel)]/10">
                <span className="font-semibold text-[var(--color-navy-mid)]">{skills.filter((s: any) => s.strength >= 85).length}</span> Expert<br />
                <span className="font-semibold text-[var(--color-navy-mid)]">{skills.filter((s: any) => s.strength >= 70 && s.strength < 85).length}</span> Proficient
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {skills.map((skill: any) => (
                <motion.div key={skill.id} layout>
                  <SkillSlider skill={skill} onChange={handleSkillChange} />
                </motion.div>
              ))}
            </div>

            <div className="mt-4 p-3 bg-[var(--info)]/10 border border-[var(--info)]/30 rounded-lg flex items-center gap-2 text-xs text-[var(--info)]">
              <AlertCircle className="w-4 h-4 shrink-0 text-[var(--info)]" />
              Skill calibration overrides only affect inference priority weighting, not the underlying model weights.
              <button className="ml-auto font-semibold hover:underline">Save Changes</button>
            </div>
          </section>

          {/* ── ACTIVITY ─── */}
          <section id="ag-activity" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Activity Log</h2>
            <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
                <span className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide">Today · {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                <span className="text-xs text-[var(--color-warm-gray)]">{raw.runs} total events</span>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {raw.activity.map((ev: any, i: number) => {
                  const typeColor: Record<string, string> = { run: 'bg-[var(--color-steel)]', data: 'bg-[var(--info)]', output: 'bg-[var(--success)]', system: 'bg-[var(--color-warm-gray)]' };
                  return (
                    <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--color-surface)] transition-colors">
                      <div className={clsx('w-2 h-2 rounded-full shrink-0', typeColor[ev.type] || 'bg-[var(--color-warm-gray)]')} />
                      <span className="text-xs font-mono text-[var(--color-warm-gray)] w-20 shrink-0">{ev.time}</span>
                      <span className="text-sm text-[var(--color-navy-mid)]">{ev.event}</span>
                      <span className="ml-auto text-xs font-semibold text-[var(--color-warm-gray)] uppercase">{ev.type}</span>
                    </div>
                  );
                })}
                {raw.activity.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">No activity yet — this agent hasn't run.</div>
                )}
              </div>
            </div>

            {/* Bar chart */}
            <div className="mt-6 bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Cumulative Runs</h3>
                <span className="text-xs text-[var(--color-warm-gray)]">Last 7 months</span>
              </div>
              <div className="flex items-end gap-3 h-28">
                {raw.analytics.months.map((m: string, i: number) => (
                  <div key={m} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="relative w-full" style={{ height: `${(raw.analytics.runs[i] / maxBar) * 104}px` }}>
                      <div className="absolute inset-x-0 bottom-0 bg-[var(--color-steel)]/15 rounded-t-md group-hover:bg-[var(--color-steel)]/30 transition-colors w-full h-full" />
                      <div className="absolute inset-x-0 bottom-0 bg-[var(--color-steel)] rounded-t-md" style={{ height: `${(raw.analytics.runs[i] / maxBar) * 60}%` }} />
                    </div>
                    <span className="text-xs text-[var(--color-warm-gray)] font-medium">{m}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── CONNECTIONS ─── */}
          <section id="ag-connections" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Connections</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Automations */}
              <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[var(--color-steel)]" />
                  <span className="font-semibold text-[var(--color-navy)] text-sm">Automations</span>
                  <span className="ml-auto text-xs text-[var(--color-warm-gray)]">{raw.connectedAutomations.length}</span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {raw.connectedAutomations.map((automationName: string) => (
                    <div key={automationName}
                      className="flex items-center gap-3 px-5 py-3">
                      <div className="w-7 h-7 rounded-md bg-[var(--color-steel)]/10 flex items-center justify-center"><Zap className="w-3.5 h-3.5 text-[var(--color-steel)]" /></div>
                      <span className="text-sm font-medium text-[var(--color-navy)]">{automationName}</span>
                    </div>
                  ))}
                  {raw.connectedAutomations.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">No Automations connected yet.</div>
                  )}
                </div>
              </div>
              {/* Skills */}
              <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[var(--success)]" />
                  <span className="font-semibold text-[var(--color-navy)] text-sm">Loaded Skills</span>
                  <span className="ml-auto text-xs text-[var(--color-warm-gray)]">{skills.length}</span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {skills.map((s: any) => (
                    <Link key={s.id} to={`/skill/${encodeURIComponent(s.id)}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface)] transition-colors group">
                      <div className="w-7 h-7 rounded-md bg-[var(--success)]/10 flex items-center justify-center"><Sparkles className="w-3.5 h-3.5 text-[var(--success)]" /></div>
                      <span className="text-sm font-medium text-[var(--color-navy)]">{s.name}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <div className="w-12 h-1 bg-[var(--color-surface)] rounded-full overflow-hidden"><div className="h-full bg-[var(--color-steel)] rounded-full" style={{ width: `${s.strength}%` }} /></div>
                        <span className="text-xs font-bold text-[var(--color-warm-gray)] w-6">{s.strength}</span>
                      </div>
                    </Link>
                  ))}
                  {skills.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">No skills loaded yet.</div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ── SETTINGS ─── */}
          <section id="ag-settings" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Settings</h2>
            <div className="flex flex-col gap-4">
              {/* Data access — the tier this agent may reach (governed data-scope). */}
              <div className="flex items-center justify-between p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[var(--color-steel)]/10">
                    <Database className="w-4 h-4 text-[var(--color-steel)]" />
                  </div>
                  <div>
                    <div className="font-semibold text-[var(--color-navy)] text-sm">Data access</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">
                      Which tier this agent can reach. Public = canonical facts · Private = your relationship data.
                    </div>
                  </div>
                </div>
                <select
                  value={dataAccess}
                  onChange={(e) => setDataAccess(e.target.value as 'all' | 'public' | 'private')}
                  className="text-sm font-medium rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]"
                  title="Data this agent can access"
                >
                  <option value="all">All data</option>
                  <option value="public">Public data</option>
                  <option value="private">Private data</option>
                </select>
              </div>
              {[
                { label: 'Agent Active', desc: 'Enable automatic triggering for this agent', value: isActive, fn: () => setIsActive(!isActive) },
                { label: 'Autonomous Mode', desc: 'Allow agent to take actions without approval prompts', value: false, fn: () => {} },
                { label: 'AI Skill Auto-Calibration', desc: 'Let Bridge AI automatically tune skill weights based on outcomes', value: true, fn: () => {} },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div>
                    <div className="font-semibold text-[var(--color-navy)] text-sm">{s.label}</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">{s.desc}</div>
                  </div>
                  <button onClick={s.fn} className={clsx('relative w-11 h-6 rounded-full transition-all duration-200', s.value ? 'bg-[var(--color-steel)]' : 'bg-[var(--color-border)]')}>
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200', s.value ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
              ))}
              <div className="border border-[var(--danger)]/30 rounded-xl p-5 bg-[var(--danger)]/10 flex items-center justify-between">
                <div>
                  <div className="font-medium text-[var(--color-navy)] text-sm">Delete Agent</div>
                  <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Permanently delete this agent and all run history.</div>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/15 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* ── Edit Agent — layered scope editor (shared PermissionLayers) ─── */}
      <AnimatePresence>
        {editingScope && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
            onClick={() => setEditingScope(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
              className="bg-white rounded-2xl shadow-2xl border border-[var(--color-border)] w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
                <div>
                  <h2 className="font-bold text-[var(--color-navy)]">Edit agent scope</h2>
                  <p className="text-xs text-[var(--color-navy-mid)] mt-0.5">Adjust {raw.name}'s layered authority. Least-privilege; agent-floor denials are non-removable.</p>
                </div>
                <button onClick={() => setEditingScope(false)} className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto px-6 py-5">
                <PermissionLayers value={perms} onChange={setPerms} />
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)] shrink-0">
                <button onClick={() => setEditingScope(false)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] transition-colors">
                  Cancel
                </button>
                <button onClick={saveScope} disabled={savingScope} className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors active:scale-95 disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> {savingScope ? 'Saving…' : 'Save scope'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}