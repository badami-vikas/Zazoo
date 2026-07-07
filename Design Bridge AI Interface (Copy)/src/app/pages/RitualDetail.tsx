import { useState } from 'react';
import { ChevronRight, Play, Pause, Edit2, Trash2, Plus, Zap, Clock, CheckCircle, AlertCircle, TrendingUp, Users, ArrowRight, ToggleLeft, ToggleRight, BarChart2, Settings, Mail, MessageSquare, Calendar, Bell, Filter, GitBranch, Activity, ChevronDown, Copy, MoreHorizontal, BookOpen } from 'lucide-react';
import { Link, useParams } from 'react-router';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import { RitualCanvas } from '../components/RitualCanvas';

// No placeholder rituals ship. Real rituals are user-created (see WorkPage's New Ritual flow /
// RitualCreate) and their run history/analytics reflect actual executions — until a ritual has
// run, its detail page shows honest zero/empty values rather than invented performance numbers.
const playbookDetails: Record<string, any> = {};

const defaultPlaybook = {
  name: 'Untitled ritual',
  type: 'Custom',
  status: 'Active',
  description: 'A ritual that runs a structured sequence of touchpoints. No runs recorded yet.',
  owner: '',
  created: '',
  lastModified: '',
  successRate: 0,
  totalRuns: 0,
  avgDuration: '—',
  triggers: [] as { id: string; type: string; condition: string; icon: any; color: string }[],
  steps: [] as { id: string; order: number; type: string; name: string; description: string; delay: string; icon: any; status: string }[],
  analytics: {
    runs: [0, 0, 0, 0, 0, 0, 0],
    successRates: [0, 0, 0, 0, 0, 0, 0],
    months: ['', '', '', '', '', '', ''],
    topDropoff: '—',
    avgTimeToComplete: '—',
    emailOpenRate: '—',
    meetingBookRate: '—',
  },
};

export function RitualDetail() {
  const { id } = useParams();
  const decodedId = id ? decodeURIComponent(id) : '';
  const pb = playbookDetails[decodedId] || { ...defaultPlaybook, name: decodedId || defaultPlaybook.name };

  const [activeTab, setActiveTab] = useState('Overview');
  const [isActive, setIsActive] = useState(pb.status === 'Active');
  const [steps, setSteps] = useState(pb.steps);

  const sections = ['Overview', 'Triggers', 'Steps', 'Analytics', 'Settings'];

  const scrollTo = (section: string) => {
    setActiveTab(section);
    const el = document.getElementById(`pb-${section.toLowerCase()}`);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const stepTypeColor: Record<string, string> = {
    Email: 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/30',
    Wait: 'bg-[var(--color-surface)] text-[var(--color-navy-mid)] border-[var(--color-border)]',
    Touchpoint: 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/30',
    Condition: 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30',
    Notification: 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30',
    Action: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30',
  };

  const maxBarValue = Math.max(1, ...pb.analytics.runs);

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden relative">
      {/* Two-row header */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        {/* Row 1: Breadcrumb */}
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/rituals" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Rituals</Link>
            <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
            <div className="bg-[var(--color-surface)] text-[var(--color-navy)] px-2.5 py-1 rounded text-xs font-semibold shadow-sm">{pb.name}</div>
          </div>
        </div>
        {/* Row 2: Actions */}
        <div className="h-10 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsActive(!isActive)}
              className={clsx('flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all active:scale-95', isActive ? 'bg-[var(--warning)]/10 border-[var(--warning)]/30 text-[var(--warning)] hover:bg-[var(--warning)]/15' : 'bg-[var(--success)]/10 border-[var(--success)]/30 text-[var(--success)] hover:bg-[var(--success)]/15')}
            >
              {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isActive ? 'Pause Ritual' : 'Activate Ritual'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] rounded-lg transition-colors" title="Duplicate"><Copy className="w-4 h-4" /></button>
            <button className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors active:scale-95">
              <Edit2 className="w-3.5 h-3.5" /> Edit Ritual
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white relative">
        {/* Sticky nav tabs */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-[var(--color-border)] z-20 px-8 pt-4 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-8 py-3 text-sm font-medium overflow-x-auto scrollbar-hide max-w-5xl mx-auto">
            {sections.map(tab => (
              <button
                key={tab}
                onClick={() => scrollTo(tab)}
                className={clsx('cursor-pointer transition-colors whitespace-nowrap pb-1 border-b-2', activeTab === tab ? 'text-[var(--color-navy)] border-[var(--color-steel-light)]' : 'text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] border-transparent')}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-5xl mx-auto w-full px-8 py-10 flex flex-col gap-14 pb-32">

          {/* 1. Overview */}
          <div id="pb-overview" className="scroll-mt-28">
            {/* Hero */}
            <div className="flex items-start gap-5 mb-8">
              <div className="w-14 h-14 rounded-xl bg-[var(--color-steel)]/10 border border-[var(--color-steel)]/20 flex items-center justify-center shrink-0">
                <Zap className="w-7 h-7 text-[var(--color-steel)]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-[var(--color-navy)]">{pb.name}</h1>
                  <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border', isActive ? 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30' : 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30')}>
                    {isActive ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {isActive ? 'Active' : 'Paused'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[var(--info)]/10 text-[var(--info)] text-xs font-medium">{pb.type}</span>
                </div>
                <p className="text-[var(--color-navy-mid)] max-w-2xl">{pb.description}</p>
                <div className="flex gap-4 mt-3 text-sm text-[var(--color-navy-mid)]">
                  <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {pb.owner}</span>
                  <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Created {pb.created}</span>
                  <span className="flex items-center gap-1.5"><Edit2 className="w-3.5 h-3.5" /> Modified {pb.lastModified}</span>
                </div>
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Runs', value: pb.totalRuns.toLocaleString(), icon: Activity, color: 'text-[var(--color-steel)]', bg: 'bg-[var(--color-steel)]/5' },
                { label: 'Success Rate', value: `${pb.successRate}%`, icon: TrendingUp, color: 'text-[var(--color-steel-light)]', bg: 'bg-[var(--color-steel-light)]/5' },
                { label: 'Avg Duration', value: pb.avgDuration, icon: Clock, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/10' },
                { label: 'Active Steps', value: pb.steps.length, icon: CheckCircle, color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10' },
              ].map(m => (
                <div key={m.label} className="bg-white border border-[var(--color-border)] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center mb-3', m.bg)}>
                    <m.icon className={clsx('w-4 h-4', m.color)} />
                  </div>
                  <div className={clsx('text-2xl font-bold mb-1', m.color)}>{m.value}</div>
                  <div className="text-xs text-[var(--color-navy-mid)] font-medium">{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Triggers */}
          <div id="pb-triggers" className="scroll-mt-28">
            <div className="flex items-center justify-between mb-6 border-b border-[var(--color-border)] pb-4">
              <h2 className="text-xl font-bold text-[var(--color-navy)]">Triggers</h2>
              <button className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-steel)] hover:bg-[var(--color-steel)]/5 px-3 py-1.5 rounded-lg transition-colors">
                <Plus className="w-4 h-4" /> Add Trigger
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {pb.triggers.map((trigger: any, idx: number) => (
                <motion.div
                  key={trigger.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={clsx('flex items-center gap-4 p-4 rounded-xl border bg-white shadow-sm hover:shadow-md transition-all group', trigger.color.split(' ').slice(1).join(' '))}
                >
                  <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border', trigger.color)}>
                    <trigger.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-[var(--color-navy)] text-sm">{trigger.type}</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">{trigger.condition}</div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--color-steel)] hover:bg-[var(--color-steel)]/5 rounded-lg transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button className="p-1.5 text-[var(--color-warm-gray)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </motion.div>
              ))}
              {pb.triggers.length > 1 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-[var(--color-surface)] rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-navy-mid)]">
                  <GitBranch className="w-4 h-4 text-[var(--color-warm-gray)]" />
                  All triggers use <span className="font-semibold text-[var(--color-navy-mid)] px-1">OR</span> logic — any single trigger will activate the ritual.
                </div>
              )}
            </div>
          </div>

          {/* 3. Steps */}
          <div id="pb-steps" className="scroll-mt-28">
            <div className="flex items-center justify-between mb-6 border-b border-[var(--color-border)] pb-4">
              <h2 className="text-xl font-bold text-[var(--color-navy)]">Steps</h2>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>Open canvas</span>
            </div>
            <RitualCanvas steps={steps} triggerName={pb.triggers?.[0]?.type || 'Trigger'} />
            <p className="mt-3 text-xs text-[var(--color-warm-gray)]">Steps are non-linear — branch on a Condition, run paths in parallel, and arrange the flow on an open canvas.</p>
          </div>

          {/* 4. Analytics */}
          <div id="pb-analytics" className="scroll-mt-28">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Analytics</h2>

            {/* Key metrics row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Email Open Rate', value: pb.analytics.emailOpenRate, color: 'text-[var(--info)]' },
                { label: 'Meeting Book Rate', value: pb.analytics.meetingBookRate, color: 'text-[var(--color-steel)]' },
                { label: 'Avg Time to Complete', value: pb.analytics.avgTimeToComplete, color: 'text-[var(--warning)]' },
                { label: 'Top Drop-off', value: pb.analytics.topDropoff, color: 'text-[var(--danger)]' },
              ].map(m => (
                <div key={m.label} className="bg-white border border-[var(--color-border)] rounded-xl p-4 shadow-sm">
                  <div className={clsx('text-xl font-bold mb-1', m.color)}>{m.value}</div>
                  <div className="text-xs text-[var(--color-navy-mid)] font-medium">{m.label}</div>
                </div>
              ))}
            </div>

            {/* Bar chart */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Monthly Runs & Success Rate</h3>
                <span className="text-xs text-[var(--color-warm-gray)]">Last 7 months</span>
              </div>
              <div className="flex items-end gap-3 h-36">
                {pb.analytics.months.map((month: string, i: number) => (
                  <div key={month} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col items-center gap-1 relative">
                      {/* Success rate tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--color-navy)] text-white text-xs px-2 py-1 rounded whitespace-nowrap font-medium z-10">
                        {pb.analytics.successRates[i]}% success
                      </div>
                      {/* Bar */}
                      <div
                        className="w-full rounded-t-md bg-[var(--color-steel)]/20 hover:bg-[var(--color-steel)]/40 transition-colors cursor-pointer relative overflow-hidden"
                        style={{ height: `${(pb.analytics.runs[i] / maxBarValue) * 120}px` }}
                      >
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-[var(--color-steel)] rounded-t-md transition-all"
                          style={{ height: `${pb.analytics.successRates[i]}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-[var(--color-warm-gray)] font-medium">{month}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs text-[var(--color-navy-mid)]">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-[var(--color-steel)]/20" /> Total Runs</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-[var(--color-steel)]" /> Successful</div>
              </div>
            </div>

            {/* Drop-off */}
            <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-[var(--danger)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--danger)] text-sm">Top Drop-off Point</div>
                <div className="text-sm text-[var(--danger)]">{pb.analytics.topDropoff}</div>
              </div>
              <button className="ml-auto text-xs font-semibold text-[var(--danger)] hover:text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg px-3 py-1.5 hover:bg-[var(--danger)]/15 transition-colors">
                Investigate
              </button>
            </div>
          </div>

          {/* 5. Settings */}
          <div id="pb-settings" className="scroll-mt-28">
            <h2 className="text-xl font-bold text-[var(--color-navy)] mb-6 border-b border-[var(--color-border)] pb-4">Settings</h2>
            <div className="flex flex-col gap-6">
              {/* Toggle settings */}
              {[
                { label: 'Ritual Active', desc: 'Enable or disable this ritual from running automatically', value: isActive, onChange: () => setIsActive(!isActive) },
                { label: 'Email Notifications', desc: 'Send Slack & email notifications when ritual completes', value: true, onChange: () => {} },
                { label: 'Duplicate Prevention', desc: 'Prevent the same person from entering this ritual twice', value: true, onChange: () => {} },
                { label: 'AI Optimization', desc: 'Allow Bridge AI to automatically tune send times and copy', value: false, onChange: () => {} },
              ].map(setting => (
                <div key={setting.label} className="flex items-center justify-between p-4 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div>
                    <div className="font-semibold text-[var(--color-navy)] text-sm">{setting.label}</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">{setting.desc}</div>
                  </div>
                  <button
                    onClick={setting.onChange}
                    className={clsx('flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all', setting.value ? 'bg-[var(--color-steel)]/10 text-[var(--color-steel)] border-[var(--color-steel)]/20' : 'bg-[var(--color-surface)] text-[var(--color-navy-mid)] border-[var(--color-border)]')}
                  >
                    {setting.value ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {setting.value ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              ))}

              {/* Danger zone */}
              <div className="border border-[var(--danger)]/30 rounded-xl p-5 bg-[var(--danger)]/10">
                <h3 className="font-semibold text-[var(--danger)] text-sm mb-3">Danger Zone</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-[var(--color-navy)] text-sm">Delete Ritual</div>
                    <div className="text-xs text-[var(--color-navy-mid)]">Permanently delete this ritual and all its run history.</div>
                  </div>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/15 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
