import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Target, Repeat, PenTool, Plus, Zap, Clock, GitBranch, Play, Pause, ArrowRight } from 'lucide-react';
import { Header } from '../components/Header';
import { ListPillRow } from '../components/ListPillRow';

// Clean Rituals index — replaces the retired RitualsEngine (the old Rituals/Agents/Skills/Integrations
// toggle). Each ritual opens its non-linear canvas at /ritual/:id. Agents/Skills/Integrations now live
// under Intelligence, where they belong.

type Cadence = 'Scheduled' | 'Triggered' | 'Paused';
interface RitualCard { name: string; cadence: Cadence; trigger: string; nextRun: string; steps: number; status: 'Active' | 'Paused'; tone: string }

const rituals: RitualCard[] = [
  { name: 'Monthly inner-ring check-in', cadence: 'Scheduled', trigger: 'First Monday each month', nextRun: 'In 9 days', steps: 4, status: 'Active', tone: 'var(--color-steel)' },
  { name: 'Dormant tie reconnect', cadence: 'Triggered', trigger: 'Trust high · warmth cooling', nextRun: 'On signal', steps: 5, status: 'Active', tone: 'var(--info)' },
  { name: 'Inbound thread closer', cadence: 'Triggered', trigger: 'Inbound with no reply', nextRun: 'On signal', steps: 3, status: 'Active', tone: 'var(--color-sage)' },
  { name: 'Intro batch', cadence: 'Scheduled', trigger: 'Weekly · vetted intros', nextRun: 'Friday', steps: 4, status: 'Active', tone: 'var(--color-steel-light)' },
  { name: 'Community gathering planner', cadence: 'Triggered', trigger: 'Densest community movement', nextRun: 'On signal', steps: 6, status: 'Paused', tone: 'var(--warning)' },
  { name: 'Milestone watch', cadence: 'Triggered', trigger: 'Role change · raise · launch', nextRun: 'On signal', steps: 4, status: 'Active', tone: 'var(--color-navy-mid)' },
];

const lists = ['All', 'Scheduled', 'Triggered', 'Paused'];

export function RitualsPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  const headerTabs = [
    { id: 'Initiatives', icon: Target },
    { id: 'Rituals', icon: Repeat },
    { id: 'Tools', icon: PenTool },
  ];
  const onTab = (t: string) => { if (t === 'Rituals') return; navigate(t === 'Tools' ? '/tools' : '/work'); };

  const filtered = rituals.filter(r =>
    !selected || selected === 'All' ||
    (selected === 'Paused' ? r.status === 'Paused' : r.cadence === selected && r.status !== 'Paused')
  );

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-hidden border-r w-full relative min-w-0"
      style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}>
      <Header tabs={headerTabs} activeTab="Rituals" onTabChange={onTab} indicatorId="workSegmentIndicator" />

      <ListPillRow pills={lists.filter(l => l !== 'All')} selected={selected === 'All' ? null : selected} onSelect={(v) => setSelected(v ?? 'All')} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 shadow-sm z-20 w-full"
        style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}>
        <div className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>{filtered.length}</span> rituals · every step runs through draft-then-approve
        </div>
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 shadow-sm whitespace-nowrap"
          style={{ backgroundColor: 'var(--color-steel)' }}>
          <Plus className="w-3.5 h-3.5" /> New Ritual
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="grid grid-cols-1 @[600px]:grid-cols-2 @[1000px]:grid-cols-3 gap-4">
          {filtered.map(r => (
            <Link key={r.name} to={`/ritual/${encodeURIComponent(r.name)}`}
              className="block border rounded-xl p-5 bg-white transition-all shadow-sm hover:shadow-md group"
              style={{ borderColor: 'var(--color-border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-steel-light)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center border shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${r.tone} 12%, white)`, borderColor: `color-mix(in srgb, ${r.tone} 25%, transparent)` }}>
                  <Repeat className="w-5 h-5" style={{ color: r.tone }} />
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md border"
                  style={r.status === 'Active'
                    ? { backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }
                    : { backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)', color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }}>
                  {r.status === 'Active' ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />} {r.status}
                </span>
              </div>
              <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>{r.name}</h3>
              <div className="flex items-center gap-2 text-xs mb-3" style={{ color: 'var(--color-warm-gray)' }}>
                <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" /> {r.trigger}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-3 border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                <span className="inline-flex items-center gap-1"><GitBranch className="w-3 h-3" /> {r.steps} steps</span>
                <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {r.nextRun}</span>
                <span className="inline-flex items-center gap-1 font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-steel)' }}>Open <ArrowRight className="w-3 h-3" /></span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
