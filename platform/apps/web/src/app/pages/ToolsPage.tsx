import { useState } from 'react';
import { LayoutGrid, Table as TableIcon, Target, Repeat, PenTool, Pin, PinOff, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Header } from '../components/shared/Header';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { CollapsibleInsights } from '../components/shared/CollapsibleInsights';
import { usePinnedTools } from '../lib/usePinnedTools';
import { tools, toolLists, type ToolList } from '../data/tools';

export function ToolsPage() {
  const navigate = useNavigate();
  const { togglePin, isPinned } = usePinnedTools();

  const [activeTab] = useState('Tools');
  const [selectedList, setSelectedList] = useState<ToolList | null>('My Tools');
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<'table' | 'card'>('table');
  const [insightsOpen, setInsightsOpen] = useState(true);

  const headerTabs = [
    { id: 'Initiatives', icon: Target },
    { id: 'Rituals', icon: Repeat },
    { id: 'Tools', icon: PenTool },
  ];

  const views = [
    { id: 'table' as const, icon: TableIcon, label: 'Table' },
    { id: 'card' as const, icon: LayoutGrid, label: 'Card' },
  ];

  const handleTabChange = (tab: string) => {
    if (tab === 'Tools') return;
    navigate(tab === 'Rituals' ? '/rituals' : '/work');
  };

  const open = (id: string) => { const t = tools.find(x => x.id === id); navigate(t?.route ?? `/tool/${id}`); };

  const filtered = tools.filter(r =>
    (selectedList === null || r.list === selectedList) &&
    (!search || r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase()))
  );


  return (
    <div
      className="@container flex-1 flex flex-col h-full overflow-hidden border-r w-full relative min-w-0"
      style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}
    >
      <Header
        tabs={headerTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <StandardToolbar
        lists={[{ id: '__all', label: 'All Tools' }, ...toolLists.map(l => ({ id: l, label: l }))]}
        activeListId={selectedList ?? '__all'}
        onListSelect={(id) => setSelectedList(id === '__all' ? null : (id as ToolList))}
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen(o => !o)}
        view={activeView}
        views={views}
        onViewChange={(id) => setActiveView(id as 'table' | 'card')}
        search={search}
        onSearchChange={setSearch}
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: 'shown', label: 'Tools shown', value: String(filtered.length) },
          { id: 'pinned', label: 'Pinned', value: String(tools.filter(t => isPinned(t.id)).length), hint: 'in sidebar' },
        ]}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--color-background)' }}>
        {activeView === 'table' ? (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
              <tr>
                {['Name', 'Description', 'Category', 'Status', 'Last used', ''].map((h, i) => (
                  <th
                    key={i}
                    className="text-left px-6 py-2.5 border-b border-r font-semibold text-xs uppercase tracking-wider"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const pinned = isPinned(r.id);
                const Icon = r.icon;
                return (
                  <tr key={r.id} onClick={() => open(r.id)} className="hover:bg-[var(--color-surface)] transition-colors cursor-pointer">
                    <td className="px-6 py-3 border-b border-r" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4 shrink-0" style={{ color: r.color }} />
                        <span className="font-medium truncate" style={{ color: 'var(--color-navy)' }}>{r.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 border-b border-r truncate max-w-[420px]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                      {r.description}
                    </td>
                    <td className="px-6 py-3 border-b border-r" style={{ borderColor: 'var(--color-border)' }}>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>
                        {r.category}
                      </span>
                    </td>
                    <td className="px-6 py-3 border-b border-r" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
                      {r.status}
                    </td>
                    <td className="px-6 py-3 border-b border-r" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
                      {r.lastUsed}
                    </td>
                    <td className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                        className="p-1.5 rounded-md transition-colors hover:bg-[var(--color-background)]"
                        style={{ color: pinned ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}
                        title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                      >
                        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center" style={{ color: 'var(--color-warm-gray)' }}>
                    No tools match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="p-6 grid grid-cols-1 @[600px]:grid-cols-2 @[900px]:grid-cols-3 gap-4">
            {filtered.map(r => {
              const pinned = isPinned(r.id);
              const Icon = r.icon;
              return (
                <div
                  key={r.id}
                  onClick={() => open(r.id)}
                  className="border rounded-xl bg-white p-4 hover:shadow-md hover:border-[var(--color-steel)]/40 transition-all flex flex-col gap-3 cursor-pointer"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${r.color} 12%, transparent)` }}>
                        <Icon className="w-4 h-4" style={{ color: r.color }} />
                      </div>
                      <h3 style={{ fontFamily: 'var(--font-editorial)', fontSize: '14px', fontWeight: 600, color: 'var(--color-navy)' }}>
                        {r.name}
                      </h3>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                      className="p-1.5 rounded-md hover:bg-[var(--color-surface)]"
                      style={{ color: pinned ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}
                      title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                    >
                      {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>{r.description}</p>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>
                    <span>{r.category}</span>
                    <span>·</span>
                    <span>{r.status}</span>
                    <span className="ml-auto">{r.lastUsed}</span>
                  </div>
                  <span
                    className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                    style={{ backgroundColor: 'var(--color-steel)' }}
                  >
                    Open <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
