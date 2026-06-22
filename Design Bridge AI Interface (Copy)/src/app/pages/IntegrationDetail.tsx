import { useState } from 'react';
import { ChevronRight, Edit2, Trash2, CheckCircle, AlertCircle, Clock, TrendingUp, Activity, Copy, RefreshCw, Globe, Link2, ArrowRight, BookOpen, WifiOff, Wifi, Settings, BarChart2, Database, Key } from 'lucide-react';
import { Link, useParams } from 'react-router';
import clsx from 'clsx';
import { GoogleIntegrationPanel } from './GoogleIntegrationPanel';

const integrationDetails: Record<string, any> = {
  'IN-001': {
    name: 'OpenAI GPT-4o', provider: 'OpenAI', category: 'dummy_AI/LLM', status: 'Connected', region: 'dummy_US-West',
    desc: 'dummy_Core AI inference provider powering all language model calls across Bridge AI agents, rituals, and co-pilot suggestions.',
    health: 9009, lastSync: 'dummy_9009 min ago', recordsSynced: 'dummy_—', latency: 'dummy_9009ms',
    endpoint: 'dummy_https://api.openai.com/v1',
    apiVersion: 'dummy_v1', rateLimit: 'dummy_9009 TPM', costToDate: 'dummy_$9009',
    logs: [
      { time: 'dummy_10:41 AM', event: 'dummy_Chat completion — Aria (prospecting)', tokens: 9009, status: 'ok' },
      { time: 'dummy_10:43 AM', event: 'dummy_Chat completion — Nova (email draft)', tokens: 9009, status: 'ok' },
      { time: 'dummy_11:02 AM', event: 'dummy_Chat completion — Rex (qualification)', tokens: 9009, status: 'ok' },
      { time: 'dummy_11:30 AM', event: 'dummy_Embedding batch — 9009 relationships', tokens: 9009, status: 'ok' },
      { time: 'dummy_2:15 PM', event: 'dummy_Function call — CRM enrichment', tokens: 9009, status: 'ok' },
      { time: 'dummy_3:00 PM', event: 'dummy_Rate limit warning — 9009% of quota', tokens: 0, status: 'warn' },
    ],
    analytics: { calls: [9009, 9009, 9009, 9009, 9009, 9009, 9009], success: [9009, 9009, 9009, 9009, 9009, 9009, 9009], months: ['dummy_Oct', 'dummy_Nov', 'dummy_Dec', 'dummy_Jan', 'dummy_Feb', 'dummy_Mar', 'dummy_Apr'] },
    connectedAgents: ['dummy_AG-001 — Aria', 'dummy_AG-002 — Rex', 'dummy_AG-003 — Sage', 'dummy_AG-004 — Nova', 'dummy_AG-006 — Orion'],
  },
};

const defaultIntegration = {
  name: 'dummy_Integration', provider: 'dummy_Provider', category: 'dummy_General', status: 'Connected', region: 'dummy_US-East',
  desc: 'dummy_A Bridge AI integration connecting external systems to the platform.',
  health: 9009, lastSync: 'dummy_9009 min ago', recordsSynced: 'dummy_9009K', latency: 'dummy_9009ms',
  endpoint: 'dummy_https://api.provider.com/v1',
  apiVersion: 'dummy_v1', rateLimit: 'dummy_9009/min', costToDate: 'dummy_$9009',
  logs: [
    { time: 'dummy_10:00 AM', event: 'dummy_Sync completed', tokens: 0, status: 'ok' },
    { time: 'dummy_10:30 AM', event: 'dummy_Record pull — 9009 people', tokens: 0, status: 'ok' },
  ],
  analytics: { calls: [9009, 9009, 9009, 9009, 9009, 9009, 9009], success: [9009, 9009, 9009, 9009, 9009, 9009, 9009], months: ['dummy_Oct', 'dummy_Nov', 'dummy_Dec', 'dummy_Jan', 'dummy_Feb', 'dummy_Mar', 'dummy_Apr'] },
  connectedAgents: ['dummy_AG-001 — Aria'],
};

const navTabs = ['Overview', 'Activity', 'Connections', 'Settings'];

export function IntegrationDetail() {
  const { id } = useParams();
  const decoded = id ? decodeURIComponent(id) : '';

  // The real, wired Gmail + Google Calendar integration. Other ids keep the mock UI.
  if (decoded === 'google') return <GoogleIntegrationPanel />;

  const intg = integrationDetails[decoded] || { ...defaultIntegration, name: decoded || defaultIntegration.name };

  const [activeTab, setActiveTab] = useState('Overview');

  const scrollTo = (tab: string) => {
    setActiveTab(tab);
    document.getElementById(`in-${tab.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const maxCalls = Math.max(...intg.analytics.calls);
  const statusColor = intg.status === 'Connected' ? 'text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/30' : intg.status === 'Degraded' ? 'text-[var(--warning)] bg-[var(--warning)]/10 border-[var(--warning)]/30' : 'text-[var(--danger)] bg-[var(--danger)]/10 border-[var(--danger)]/30';
  const StatusIcon = intg.status === 'Connected' ? CheckCircle : intg.status === 'Degraded' ? AlertCircle : WifiOff;

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)] gap-2 text-sm">
          <BookOpen className="w-3.5 h-3.5 text-[var(--warning)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Intelligence</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Integrations</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--warning)]/10 text-[var(--warning)] px-2.5 py-0.5 rounded text-xs font-semibold">{intg.name}</span>
        </div>
        <div className="h-10 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border', statusColor)}>
              <StatusIcon className="w-3 h-3" />{intg.status}
            </span>
            <span className="text-xs text-[var(--color-warm-gray)] font-medium">{intg.region}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-navy-mid)] border border-[var(--color-border)] px-3 py-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Sync Now
            </button>
            <button className="flex items-center gap-1.5 bg-[var(--warning)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--warning)] transition-colors">
              <Edit2 className="w-3.5 h-3.5" /> Configure
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
          <section id="in-overview" className="scroll-mt-24 flex flex-col gap-8">
            {/* Hero */}
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-xl bg-[var(--warning)]/10 border border-[var(--warning)]/30 flex items-center justify-center shrink-0">
                <Globe className="w-7 h-7 text-[var(--warning)]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-[var(--color-navy)]">{intg.name}</h1>
                  <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border', statusColor)}>
                    <StatusIcon className="w-3 h-3" />{intg.status}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] text-xs font-semibold">{intg.category}</span>
                </div>
                <p className="text-[var(--color-navy-mid)] max-w-2xl text-sm">{intg.desc}</p>
                <div className="flex gap-4 mt-3 text-sm text-[var(--color-navy-mid)] flex-wrap">
                  <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> {intg.provider}</span>
                  <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Last sync: {intg.lastSync}</span>
                  <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> {intg.recordsSynced !== '—' ? `${intg.recordsSynced} records` : 'Inference API'}</span>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Health Score', value: `${intg.health}%`, icon: Activity, color: intg.health >= 90 ? 'text-[var(--success)]' : 'text-[var(--warning)]', bg: intg.health >= 90 ? 'bg-[var(--success)]/10' : 'bg-[var(--warning)]/10' },
                { label: 'Avg Latency', value: intg.latency, icon: Clock, color: 'text-[var(--color-steel-light)]', bg: 'bg-[var(--color-steel-light)]/5' },
                { label: 'Cost to Date', value: intg.costToDate, icon: TrendingUp, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/10' },
                { label: 'Connected Agents', value: intg.connectedAgents.length, icon: Link2, color: 'text-[var(--color-steel)]', bg: 'bg-[var(--color-steel)]/5' },
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

            {/* Health bar */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-[var(--color-navy)] text-sm">Health Monitor</span>
                <span className={clsx('text-sm font-bold', intg.health >= 90 ? 'text-[var(--success)]' : intg.health >= 70 ? 'text-[var(--warning)]' : 'text-[var(--danger)]')}>{intg.health}%</span>
              </div>
              <div className="h-3 bg-[var(--color-surface)] rounded-full overflow-hidden border border-[var(--color-border)]/50">
                <div className={clsx('h-full rounded-full transition-all', intg.health >= 90 ? 'bg-[var(--success)]' : intg.health >= 70 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]')} style={{ width: `${intg.health}%` }} />
              </div>
              <div className="flex justify-between mt-1 text-xs text-[var(--color-warm-gray)]">
                <span>Critical</span><span>Degraded</span><span>Healthy</span>
              </div>
            </div>

            {/* Config details */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                <Key className="w-4 h-4 text-[var(--color-navy-mid)]" />
                <span className="font-semibold text-[var(--color-navy)] text-sm">Configuration</span>
              </div>
              <div className="grid md:grid-cols-2">
                {[
                  ['Endpoint', intg.endpoint],
                  ['API Version', intg.apiVersion],
                  ['Rate Limit', intg.rateLimit],
                  ['Region', intg.region],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 px-5 py-3.5 border-b border-r border-[var(--color-border)] last:border-b-0">
                    <span className="text-xs font-semibold text-[var(--color-warm-gray)] uppercase tracking-wide w-24 shrink-0">{k}</span>
                    <span className="text-sm text-[var(--color-navy-mid)] font-mono truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Call volume chart */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Monthly API Calls</h3>
                <span className="text-xs text-[var(--color-warm-gray)]">Last 7 months</span>
              </div>
              <div className="flex items-end gap-3 h-28">
                {intg.analytics.months.map((m: string, i: number) => (
                  <div key={m} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="relative w-full" style={{ height: `${(intg.analytics.calls[i] / maxCalls) * 104}px` }}>
                      <div className="absolute inset-x-0 bottom-0 bg-[var(--warning)]/15 rounded-t-md group-hover:bg-[var(--warning)] transition-colors w-full h-full" />
                      <div className="absolute inset-x-0 bottom-0 bg-[var(--warning)] rounded-t-md" style={{ height: `${intg.analytics.success[i]}%` }} />
                    </div>
                    <span className="text-xs text-[var(--color-warm-gray)] font-medium">{m}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ACTIVITY */}
          <section id="in-activity" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Activity Log</h2>
            <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
                <span className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wide">dummy_Today · April 9009, 9009</span>
                <button className="text-xs text-[var(--color-steel)] hover:underline flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refresh</button>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {intg.logs.map((log: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--color-surface)] transition-colors">
                    <div className={clsx('w-2 h-2 rounded-full shrink-0', log.status === 'ok' ? 'bg-[var(--success)]' : log.status === 'warn' ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]')} />
                    <span className="text-xs font-mono text-[var(--color-warm-gray)] w-20 shrink-0">{log.time}</span>
                    <span className="text-sm text-[var(--color-navy-mid)] flex-1">{log.event}</span>
                    {log.tokens > 0 && <span className="text-xs text-[var(--color-warm-gray)] font-mono">{log.tokens.toLocaleString()} tok</span>}
                    <span className={clsx('text-xs font-bold uppercase ml-2', log.status === 'ok' ? 'text-[var(--success)]' : log.status === 'warn' ? 'text-[var(--warning)]' : 'text-[var(--danger)]')}>{log.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CONNECTIONS */}
          <section id="in-connections" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Connections</h2>
            <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[var(--warning)]" />
                <span className="font-semibold text-[var(--color-navy)] text-sm">Connected Agents</span>
                <span className="ml-auto text-xs text-[var(--color-warm-gray)]">{intg.connectedAgents.length}</span>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {intg.connectedAgents.map((ag: string) => (
                  <Link key={ag} to={`/agent/${encodeURIComponent(ag.split(' — ')[0])}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface)] transition-colors group">
                    <div className="w-7 h-7 rounded-full bg-[var(--info)]/15 flex items-center justify-center text-xs font-bold text-[var(--info)]">
                      {ag.split(' — ')[1]?.charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-[var(--color-navy)]">{ag}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[var(--color-warm-gray)] ml-auto group-hover:text-[var(--warning)] transition-colors" />
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* SETTINGS */}
          <section id="in-settings" className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Settings</h2>
            <div className="flex flex-col gap-4">
              {[
                { label: 'Auto-Reconnect', desc: 'Automatically retry connection when service is disrupted', value: true },
                { label: 'Health Monitoring', desc: 'Enable continuous health checks every 5 minutes', value: true },
                { label: 'Usage Alerts', desc: 'Alert when API usage exceeds 80% of rate limit', value: false },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div>
                    <div className="font-semibold text-[var(--color-navy)] text-sm">{s.label}</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">{s.desc}</div>
                  </div>
                  <button className={clsx('relative w-11 h-6 rounded-full transition-all duration-200', s.value ? 'bg-[var(--warning)]' : 'bg-[var(--color-border)]')}>
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200', s.value ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
              ))}
              <div className="border border-[var(--danger)]/30 rounded-xl p-5 bg-[var(--danger)]/10 flex items-center justify-between">
                <div>
                  <div className="font-medium text-[var(--color-navy)] text-sm">Disconnect Integration</div>
                  <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Remove this integration from all agents and rituals.</div>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/15 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Disconnect
                </button>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
