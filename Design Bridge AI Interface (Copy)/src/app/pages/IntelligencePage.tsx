import { useState } from 'react';
import { Table, Plus, MoreVertical, ChevronLeft, ChevronRight, LayoutGrid, Bot, Zap, Puzzle, ShieldCheck, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link, useNavigate } from 'react-router';
import { Header } from '../components/Header';
import { ListPillRow } from '../components/ListPillRow';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { pendingCount } from '../data/governance';

// Agents. Helpdesk AI is real (powers the Helpdesk Tool); the rest are placeholders until the runtime.
const agentsData = [
  { id: 'helpdesk-ai', name: 'Helpdesk AI', description: 'Support strategist — routes a need to people who can help (by capability), proposes actionable ways to contribute.', status: 'Active', lastRun: 'Live', accuracy: 0, list: 'Active' },
  { id: 'AGT-9009', name: 'dummy_Agent One', description: 'dummy_ placeholder agent', status: 'Active', lastRun: '9009h ago', accuracy: 9009, list: 'Active' },
  { id: 'AGT-9010', name: 'dummy_Agent Two', description: 'dummy_ placeholder agent', status: 'Training', lastRun: '9009h ago', accuracy: 9009, list: 'Training' },
];

// Skills — placeholder (dummy_ labeled).
const skillsData = [
  { id: 'SKL-9009', name: 'dummy_Skill One', description: 'dummy_ placeholder skill', category: 'dummy_', status: 'Enabled', uses: 9009, list: 'Enabled' },
  { id: 'SKL-9010', name: 'dummy_Skill Two', description: 'dummy_ placeholder skill', category: 'dummy_', status: 'Beta', uses: 9009, list: 'Beta' },
];

// Integrations — LinkedIn, Gmail, Google Calendar featured (connected), plus others.
const integrationsData = [
  { id: 'INT-3001', name: 'LinkedIn', description: 'Sync connections, profiles, and conversations from LinkedIn', status: 'Connected', lastSync: '1 hour ago', dataPoints: 21792, list: 'Connected' },
  { id: 'INT-3002', name: 'Gmail', description: 'Source email threads into Touchpoints, Memories & Signals — by approval', status: 'Connected', lastSync: '12 min ago', dataPoints: 8431, list: 'Connected', route: 'google' },
  { id: 'INT-3003', name: 'Google Calendar', description: 'Source meetings into Touchpoints — by approval; draft invites, send on approval', status: 'Connected', lastSync: '30 min ago', dataPoints: 1204, list: 'Connected', route: 'google' },
  { id: 'INT-3004', name: 'Slack', description: 'Track conversations and channels across your workspace', status: 'Disconnected', lastSync: '2 weeks ago', dataPoints: 0, list: 'Disconnected' },
  { id: 'INT-3005', name: 'GitHub', description: 'Track collaborative projects and contributors', status: 'Pending', lastSync: 'Never', dataPoints: 0, list: 'Pending' },
  { id: 'INT-3006', name: 'X / Twitter', description: 'Monitor social interactions and public mentions', status: 'Disconnected', lastSync: 'Never', dataPoints: 0, list: 'Disconnected' },
  { id: 'INT-3007', name: 'Instagram', description: 'Source posts and DMs into governed touchpoints', status: 'Connected', lastSync: '45 min ago', dataPoints: 312, list: 'Connected' },
  { id: 'INT-3008', name: 'Facebook', description: 'Track Page messages and engagement as touchpoints', status: 'Disconnected', lastSync: 'Never', dataPoints: 0, list: 'Disconnected' },
];

export function IntelligencePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('Agents');
  const [activeView, setActiveView] = useState('card');
  const [selectedList, setSelectedList] = useState('All');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

  const headerTabs = [
    { id: 'Agents', icon: Bot },
    { id: 'Skills', icon: Zap },
    { id: 'Apps', icon: Puzzle },
  ];
  const views = [
    { id: 'card', label: 'Card', icon: LayoutGrid },
    { id: 'table', label: 'Table', icon: Table },
  ];

  // Lists for each tab
  const agentsLists = ['All', 'Active', 'Training', 'Archived'];
  const skillsLists = ['All', 'Enabled', 'Disabled', 'Beta'];
  const integrationsLists = ['All', 'Connected', 'Disconnected', 'Pending'];

  const getCurrentLists = () => {
    switch (activeTab) {
      case 'Agents': return agentsLists;
      case 'Skills': return skillsLists;
      case 'Apps': return integrationsLists;
      default: return ['All'];
    }
  };

  const getCurrentData = () => {
    let data: any[];
    switch (activeTab) {
      case 'Agents': data = agentsData; break;
      case 'Skills': data = skillsData; break;
      case 'Apps': data = integrationsData; break;
      default: data = [];
    }

    // Filter by list
    if (selectedList !== 'All') {
      data = data.filter((item: any) => item.list === selectedList);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      data = data.filter((item: any) => `${item.name} ${item.description}`.toLowerCase().includes(q));
    }

    return data;
  };

  const mockData = getCurrentData();
  const totalPages = Math.ceil(mockData.length / rowsPerPage);
  const currentData = mockData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  const ActiveViewIcon = views.find(v => v.id === activeView)?.icon || LayoutGrid;

  // Reset list when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedList('All');
    setSearch('');
    setCurrentPage(1);
  };

  const renderCard = (item: any) => {
    if (activeTab === 'Agents') {
      return (
        <Link
          to={`/agent/${item.id}`}
          key={item.id}
          className="block border rounded-xl p-5 transition-all shadow-sm"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-steel-light)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgb(from var(--color-steel) r g b / 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.boxShadow = '';
          }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-steel-light)' + '30' }}>
                <Bot className="w-5 h-5" style={{ color: 'var(--color-steel)' }} />
              </div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>
                {item.name}
              </h3>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1 rounded-md transition-colors" style={{ color: 'var(--color-warm-gray)' }}
                  onClick={(e) => e.preventDefault()}>
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--color-warm-gray)' }}>{item.description}</p>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: item.status === 'Active' ? 'var(--color-steel)' :
                               item.status === 'Training' ? 'var(--color-sage)' :
                               'var(--color-warm-gray)'
              }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--color-navy-mid)' }}>{item.status}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--color-warm-gray)' }}>Last run: {item.lastRun}</span>
            <span style={{ color: 'var(--color-navy-mid)', fontWeight: 500 }}>{item.accuracy}% accuracy</span>
          </div>
        </Link>
      );
    } else if (activeTab === 'Skills') {
      return (
        <Link
          to={`/skill/${item.id}`}
          key={item.id}
          className="block border rounded-xl p-5 transition-all shadow-sm"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-steel-light)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgb(from var(--color-steel) r g b / 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.boxShadow = '';
          }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-sage)' + '30' }}>
                <Zap className="w-5 h-5" style={{ color: 'var(--color-sage)' }} />
              </div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>
                {item.name}
              </h3>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1 rounded-md transition-colors" style={{ color: 'var(--color-warm-gray)' }}
                  onClick={(e) => e.preventDefault()}>
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--color-warm-gray)' }}>{item.description}</p>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-navy-mid)'
              }}>
              {item.category}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: item.status === 'Enabled' ? 'var(--color-steel)' + '20' :
                                item.status === 'Beta' ? 'var(--color-amber-soft)' + '20' :
                                'var(--color-surface)',
                color: item.status === 'Enabled' ? 'var(--color-steel)' :
                       item.status === 'Beta' ? 'var(--color-amber-soft)' :
                       'var(--color-warm-gray)'
              }}>
              {item.status}
            </span>
          </div>
          <div className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>
            Used <span style={{ color: 'var(--color-navy-mid)', fontWeight: 500 }}>{item.uses}</span> times
          </div>
        </Link>
      );
    } else {
      // Integrations
      return (
        <Link
          to={`/integration/${item.route ?? item.id}`}
          key={item.id}
          className="block border rounded-xl p-5 transition-all shadow-sm"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-steel-light)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgb(from var(--color-steel) r g b / 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.boxShadow = '';
          }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-amber-soft)' + '30' }}>
                <Puzzle className="w-5 h-5" style={{ color: 'var(--color-amber-soft)' }} />
              </div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>
                {item.name}
              </h3>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1 rounded-md transition-colors" style={{ color: 'var(--color-warm-gray)' }}
                  onClick={(e) => e.preventDefault()}>
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--color-warm-gray)' }}>{item.description}</p>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: item.status === 'Connected' ? 'var(--color-steel)' :
                               item.status === 'Pending' ? 'var(--color-sage)' :
                               'var(--color-warm-gray)'
              }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--color-navy-mid)' }}>{item.status}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--color-warm-gray)' }}>Last sync: {item.lastSync}</span>
            <span style={{ color: 'var(--color-navy-mid)', fontWeight: 500 }}>{item.dataPoints} data points</span>
          </div>
        </Link>
      );
    }
  };

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-hidden border-r w-full relative min-w-0"
      style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}>

      <Header
        tabs={headerTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        indicatorId="intelligenceSegmentIndicator"
      />

      <ListPillRow
        pills={getCurrentLists().filter(l => l !== 'All')}
        selected={selectedList === 'All' ? null : selectedList}
        onSelect={(v) => { setSelectedList(v ?? 'All'); setCurrentPage(1); }}
      />

      <StandardToolbar
        view={activeView}
        views={views}
        onViewChange={setActiveView}
        search={search}
        onSearchChange={(v) => { setSearch(v); setCurrentPage(1); }}
        onFilterClick={() => {}}
        onSortClick={() => {}}
        customActions={activeTab === 'Agents' && (
          <button onClick={() => navigate('/agent/create')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 shadow-sm whitespace-nowrap"
            style={{ backgroundColor: 'var(--color-steel)' }}>
            <Plus className="w-3.5 h-3.5" />
            New Agent
          </button>
        )}
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />

      {/* Approvals widget — the governance queue, surfaced where agents live (F2). Agents-only. */}
      {activeTab === 'Agents' && pendingCount > 0 && (
        <Link
          to="/approvals"
          className="mx-6 mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-sm transition-colors group"
          style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 8%, white)', borderColor: 'color-mix(in srgb, var(--warning) 30%, var(--color-border))' }}
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 16%, transparent)' }}>
            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--warning)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>
              {pendingCount} action{pendingCount === 1 ? '' : 's'} awaiting your review
            </div>
            <div className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>
              Agents paused these for approval before anything leaves your workspace.
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-sm font-semibold shrink-0" style={{ color: 'var(--warning)' }}>
            Review <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto relative flex flex-col" style={{ backgroundColor: 'var(--color-background)' }}>
        <AnimatePresence mode="wait">
          {activeView === 'card' && (
            <motion.div
              key="card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-6"
            >
              <div className="grid grid-cols-1 @[600px]:grid-cols-2 @[900px]:grid-cols-3 @[1200px]:grid-cols-4 gap-4">
                {currentData.map(item => renderCard(item))}
              </div>
            </motion.div>
          )}

          {/* Other Views Placeholder */}
          {activeView !== 'card' && (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center p-6"
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              <div className="w-16 h-16 rounded-2xl shadow-sm border flex items-center justify-center mb-4"
                style={{
                  backgroundColor: 'var(--color-background)',
                  borderColor: 'var(--color-border)'
                }}>
                <ActiveViewIcon className="w-8 h-8" style={{ color: 'var(--color-warm-gray)' }} />
              </div>
              <h3 className="text-lg font-semibold capitalize" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>
                {activeView} View
              </h3>
              <p className="text-sm max-w-sm mt-2" style={{ color: 'var(--color-warm-gray)' }}>
                Switch back to card view to interact with your {activeTab.toLowerCase()}.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pagination Footer */}
      {activeView === 'card' && mockData.length > rowsPerPage && (
        <div className="h-14 border-t flex items-center justify-between px-6 shrink-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.02)]"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)'
          }}>
          <div className="text-sm font-medium hidden sm:block" style={{ color: 'var(--color-warm-gray)' }}>
            Showing <span style={{ color: 'var(--color-navy)', fontWeight: 600 }}>{((currentPage - 1) * rowsPerPage) + 1}</span> to{' '}
            <span style={{ color: 'var(--color-navy)', fontWeight: 600 }}>{Math.min(currentPage * rowsPerPage, mockData.length)}</span> of{' '}
            <span style={{ color: 'var(--color-navy)', fontWeight: 600 }}>{mockData.length}</span> {activeTab.toLowerCase()}
          </div>

          <div className="flex items-center gap-1 border p-1 rounded-lg shadow-inner ml-auto"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)'
            }}>
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="p-1.5 rounded-md transition-all disabled:opacity-50"
              style={{ color: 'var(--color-warm-gray)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center px-2 gap-1 text-sm font-medium">
              {[...Array(Math.min(5, totalPages))].map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className="w-7 h-7 flex items-center justify-center rounded-md transition-all"
                  style={{
                    backgroundColor: currentPage === i + 1 ? 'var(--color-steel)' : 'transparent',
                    color: currentPage === i + 1 ? 'var(--color-background)' : 'var(--color-navy-mid)',
                    boxShadow: currentPage === i + 1 ? '0 2px 4px rgb(from var(--color-steel) r g b / 0.2)' : 'none'
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-md transition-all disabled:opacity-50"
              style={{ color: 'var(--color-warm-gray)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
