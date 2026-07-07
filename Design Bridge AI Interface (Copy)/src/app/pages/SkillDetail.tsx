import { useState } from 'react';
import { ChevronRight, Edit2, Trash2, Plus, Brain, Clock, CheckCircle, AlertCircle, TrendingUp, Activity, Copy, Bot, ArrowRight, BookOpen, Zap, Code2, FileCode, BarChart2 } from 'lucide-react';
import { Link, useParams } from 'react-router';
import clsx from 'clsx';
import { motion } from 'motion/react';

const skillDetails: Record<string, any> = {};

// No matching record → an honest "not configured yet" state. The skill runtime hasn't shipped
// yet (see roadmap P0 Kernel), so there is no real skill catalog to show.
const defaultSkill = {
  name: 'Skill', category: 'Not yet configured', version: '—', status: 'Not available',
  desc: 'This skill has not been created yet. Once the skill runtime is connected, its performance, logs, and connected agents will appear here.',
  agentsUsing: 0, avgPerformance: 0, callsToday: 0, latencyP99: '—', tokenLimit: '—',
  providers: [],
  agentList: [],
  metadata: { inputSchema: '—', outputSchema: '—', costPer1k: '—', cacheHitRate: '—' },
  logs: [],
  analytics: { calls: [0, 0, 0, 0, 0, 0, 0], perf: [0, 0, 0, 0, 0, 0, 0], months: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'] },
};

const navTabs = ['Overview', 'Activity', 'Connections', 'Settings'];

export function SkillDetail() {
  const { id } = useParams();
  const decoded = id ? decodeURIComponent(id) : '';
  const sk = skillDetails[decoded] || { ...defaultSkill, name: decoded || defaultSkill.name };

  const [activeTab, setActiveTab] = useState('Overview');

  const scrollTo = (tab: string) => {
    setActiveTab(tab);
    document.getElementById(`sk-${tab.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const maxCalls = Math.max(1, ...sk.analytics.calls);

  const statusStyle: Record<string, string> = { ok: 'text-[var(--success)]', slow: 'text-[var(--warning)]', cached: 'text-[var(--info)]', error: 'text-[var(--danger)]' };

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)] gap-2 text-sm">
          <BookOpen className="w-3.5 h-3.5 text-[var(--color-sage)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Intelligence</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Skills</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--success)]/10 text-[var(--success)] px-2.5 py-0.5 rounded text-xs font-semibold">{sk.name}</span>
        </div>
        <div className="h-10 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border', sk.status === 'Stable' ? 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30' : sk.status === 'Beta' ? 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/30' : 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30')}>
              <CheckCircle className="w-3 h-3" />{sk.status}
            </span>
            <span className="text-xs font-mono bg-[var(--color-surface)] px-2 py-0.5 rounded text-[var(--color-navy-mid)]">{sk.version}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] rounded-lg transition-colors"><Copy className="w-4 h-4" /></button>
            <button className="flex items-center gap-1.5 bg-[var(--color-sage)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#6B7C65] transition-colors">
              <Edit2 className="w-3.5 h-3.5" /> Edit Skill
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Nav */}
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

          {/* OVERVIEW */}
          <section id="sk-overview" className="scroll-mt-24 flex flex-col gap-8">
            {/* Hero */}
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-xl bg-[var(--success)]/10 border border-[var(--success)]/30 flex items-center justify-center shrink-0">
                <Brain className="w-7 h-7 text-[var(--success)]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-[var(--color-navy)]">{sk.name}</h1>
                  <span className="px-2 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)] text-xs font-semibold">{sk.category}</span>
                </div>
                <p className="text-[var(--color-navy-mid)] max-w-2xl text-sm">{sk.desc}</p>
                <div className="flex gap-4 mt-3 text-sm text-[var(--color-navy-mid)] flex-wrap">
                  <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> P99 latency: {sk.latencyP99}</span>
                  <span className="flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5" /> Token limit: {sk.tokenLimit}</span>
                  <span className="flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" /> {sk.agentsUsing} agents using</span>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Calls Today', value: sk.callsToday.toLocaleString(), icon: Activity, color: 'text-[var(--color-sage)]', bg: 'bg-[var(--success)]/10' },
                { label: 'Avg Performance', value: `${sk.avgPerformance}%`, icon: TrendingUp, color: 'text-[var(--color-steel-light)]', bg: 'bg-[var(--color-steel-light)]/5' },
                { label: 'Agents Using', value: sk.agentsUsing, icon: Bot, color: 'text-[var(--color-steel)]', bg: 'bg-[var(--color-steel)]/5' },
                { label: 'Cache Hit Rate', value: sk.metadata.cacheHitRate, icon: Zap, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/10' },
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

            {/* Technical Metadata */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[var(--color-navy-mid)]" />
                <span className="font-semibold text-[var(--color-navy)] text-sm">Technical Metadata</span>
              </div>
              <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)]">
                {Object.entries({ ...sk.metadata, 'Providers': sk.providers.join(', '), 'Version': sk.version }).map(([key, val]) => (
                  <div key={key} className="px-5 py-4 flex items-start gap-3">
                    <span className="text-xs font-semibold text-[var(--color-warm-gray)] uppercase tracking-wide w-28 shrink-0 mt-0.5">{key}</span>
                    <span className="text-sm text-[var(--color-navy-mid)] font-mono">{val as string}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Performance chart */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Daily Call Volume</h3>
                <span className="text-xs text-[var(--color-warm-gray)]">Last 7 months</span>
              </div>
              <div className="flex items-end gap-3 h-28">
                {sk.analytics.months.map((m: string, i: number) => (
                  <div key={m} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="relative w-full group" style={{ height: `${(sk.analytics.calls[i] / maxCalls) * 104}px` }}>
                      <div className="absolute inset-x-0 bottom-0 bg-[var(--success)]/15 rounded-t-md group-hover:bg-[var(--success)] transition-colors w-full h-full" />
                      <div className="absolute inset-x-0 bottom-0 bg-[var(--success)] rounded-t-md" style={{ height: `${sk.analytics.perf[i]}%` }} />
                    </div>
                    <span className="text-xs text-[var(--color-warm-gray)] font-medium">{m}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--color-warm-gray)]">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-[var(--success)]/15" /> Call Volume</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-[var(--success)]" /> Performance</div>
              </div>
            </div>
          </section>

          {/* ACTIVITY */}
          <section id="sk-activity" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Activity Log</h2>
            <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
                <span className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide">Today · {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                <span className="text-xs text-[var(--color-warm-gray)]">{sk.callsToday} calls today</span>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {sk.logs.map((log: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--color-surface)] transition-colors">
                    <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0', log.status === 'ok' ? 'bg-[var(--success)]' : log.status === 'slow' ? 'bg-[var(--warning)]' : log.status === 'cached' ? 'bg-[var(--info)]' : 'bg-[var(--danger)]')} />
                    <span className="text-xs font-mono text-[var(--color-warm-gray)] w-20 shrink-0">{log.time}</span>
                    <span className="text-sm text-[var(--color-navy-mid)] flex-1">{log.event}</span>
                    <span className={clsx('text-xs font-mono font-semibold ml-auto', statusStyle[log.status])}>{log.latency}</span>
                  </div>
                ))}
                {sk.logs.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">No activity yet — this skill hasn't been invoked.</div>
                )}
              </div>
            </div>
          </section>

          {/* CONNECTIONS */}
          <section id="sk-connections" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Connections</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[var(--info)]" />
                  <span className="font-semibold text-[var(--color-navy)] text-sm">Active Agents</span>
                  <span className="ml-auto text-xs text-[var(--color-warm-gray)]">{sk.agentList.length}</span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {sk.agentList.map((ag: string) => (
                    <Link key={ag} to={`/agent/${encodeURIComponent(ag.split(' — ')[0])}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface)] transition-colors group">
                      <div className="w-7 h-7 rounded-full bg-[var(--info)]/15 flex items-center justify-center text-xs font-bold text-[var(--info)]">
                        {ag.split(' — ')[1]?.charAt(0)}
                      </div>
                      <span className="text-sm font-medium text-[var(--color-navy)]">{ag}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--color-warm-gray)] ml-auto group-hover:text-[var(--color-sage)] transition-colors" />
                    </Link>
                  ))}
                  {sk.agentList.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">No agents use this skill yet.</div>
                  )}
                </div>
              </div>
              <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-[var(--warning)]" />
                  <span className="font-semibold text-[var(--color-navy)] text-sm">Provider Health</span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {sk.providers.map((p: string) => (
                    <div key={p} className="flex items-center gap-3 px-5 py-3.5">
                      <div className="w-2 h-2 rounded-full bg-[var(--success)] shrink-0" />
                      <span className="text-sm font-medium text-[var(--color-navy)]">{p}</span>
                      <span className="ml-auto text-xs text-[var(--success)] font-semibold">Operational</span>
                    </div>
                  ))}
                  {sk.providers.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">No providers connected yet.</div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* SETTINGS */}
          <section id="sk-settings" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Settings</h2>
            <div className="flex flex-col gap-4">
              {[
                { label: 'Response Caching', desc: 'Cache identical prompt responses to reduce cost and latency', value: true },
                { label: 'Automatic Version Updates', desc: 'Automatically upgrade to stable minor versions', value: false },
                { label: 'Rate Limiting', desc: 'Enforce per-agent call limits to prevent runaway usage', value: true },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div>
                    <div className="font-semibold text-[var(--color-navy)] text-sm">{s.label}</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">{s.desc}</div>
                  </div>
                  <button className={clsx('relative w-11 h-6 rounded-full transition-all duration-200', s.value ? 'bg-[var(--color-sage)]' : 'bg-[var(--color-border)]')}>
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200', s.value ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
              ))}
              <div className="border border-[var(--danger)]/30 rounded-xl p-5 bg-[var(--danger)]/10 flex items-center justify-between">
                <div>
                  <div className="font-medium text-[var(--color-navy)] text-sm">Deprecate Skill</div>
                  <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Mark as deprecated and remove from all agent skill pools.</div>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/15 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Deprecate
                </button>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
