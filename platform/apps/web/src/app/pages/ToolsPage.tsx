import { useState } from 'react';
import { Search, Filter, ArrowUpDown, MoreVertical, ChevronDown, LayoutGrid, Table as TableIcon, Target, Repeat, PenTool, Pin, PinOff, Plus, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { Header } from '../components/shared/Header';
import { ListPillRow } from '../components/ListPillRow';
import { usePinnedTools } from '../lib/usePinnedTools';
import { tools, toolLists, type ToolList } from '../data/tools';

export function ToolsPage() {
  const navigate = useNavigate();
  const { togglePin, isPinned } = usePinnedTools();

  const [activeTab] = useState('Tools');
  const [selectedList, setSelectedList] = useState<ToolList | null>('My Tools');
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<'table' | 'card'>('table');
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

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

  const ActiveViewIcon = views.find(v => v.id === activeView)?.icon || TableIcon;
  const ActiveViewLabel = views.find(v => v.id === activeView)?.label || 'Table';

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

      <ListPillRow
        pills={toolLists}
        selected={selectedList}
        onSelect={(v) => setSelectedList((v as ToolList | null) ?? 'My Tools')}
      />

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0 shadow-sm z-20 w-full"
        style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2 flex-1 overflow-hidden">
          <div className="relative shrink-0">
            <button
              onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold transition-colors shadow-inner"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
            >
              <ActiveViewIcon className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
              <span className="@[500px]:inline hidden">{ActiveViewLabel} View</span>
              <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
            </button>

            <AnimatePresence>
              {viewDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setViewDropdownOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}
                    className="absolute top-full left-0 mt-1 w-40 border rounded-xl shadow-lg z-50 overflow-hidden py-1"
                    style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}
                  >
                    {views.map(view => (
                      <button
                        key={view.id}
                        onClick={() => { setActiveView(view.id); setViewDropdownOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors"
                        style={{
                          backgroundColor: activeView === view.id ? 'var(--color-surface)' : 'transparent',
                          color: activeView === view.id ? 'var(--color-steel)' : 'var(--color-navy-mid)',
                        }}
                      >
                        <view.icon className="w-4 h-4" style={{ color: activeView === view.id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                        {view.label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="w-px h-6 shrink-0 hidden @[400px]:block mx-1" style={{ backgroundColor: 'var(--color-border)' }} />

          <div className="relative group shrink flex-1 max-w-[400px] min-w-[32px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
            <input
              type="text"
              placeholder="Search tools..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm transition-all outline-none shadow-inner"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
            />
          </div>

          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <button className="@[500px]:flex hidden items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border rounded-lg transition-colors shadow-sm whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
              <Filter className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
              <span className="@[850px]:inline hidden">Filter</span>
            </button>
            <button className="@[550px]:flex hidden items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border rounded-lg transition-colors shadow-sm whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
              <ArrowUpDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
              <span className="@[850px]:inline hidden">Sort</span>
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 shadow-sm whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-steel)' }}>
              <Plus className="w-3.5 h-3.5" />
              <span className="@[700px]:inline hidden">New</span>
            </button>
            <div className="w-px h-6 shrink-0 mx-1 @[400px]:block hidden" style={{ backgroundColor: 'var(--color-border)' }} />
            <button className="p-1.5 rounded-lg shrink-0 z-20 shadow-sm border border-transparent" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-warm-gray)' }}>
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

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
