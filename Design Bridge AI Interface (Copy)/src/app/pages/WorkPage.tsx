import { useState } from 'react';
import { Table, Kanban, Calendar, Search, Filter, ArrowUpDown, Plus, MoreVertical, ChevronLeft, ChevronRight, ChevronDown, LayoutGrid, ListIcon, Target, Repeat, PenTool, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link, useNavigate } from 'react-router';
import { ListPillRow } from '../components/ListPillRow';
import { Header } from '../components/Header';
import { useInitiatives, createInitiative, deleteInitiative, type Initiative } from '../data/initiatives';

// Initiatives now come from the user-created store (data/initiatives.ts) — no dummy data.

// Rituals mock data
const ritualsData = Array.from({ length: 18 }).map((_, i) => ({
  id: `RIT-${2000 + i}`,
  name: [
    'dummy_Weekly Team Standup',
    'dummy_Monthly Review',
    'dummy_Quarterly Planning',
    'dummy_Daily Journaling',
    'dummy_Friday Reflection',
    'dummy_Morning Exercise'
  ][i % 6],
  frequency: ['dummy_Weekly', 'dummy_Monthly', 'dummy_Quarterly', 'dummy_Daily', 'dummy_Weekly', 'dummy_Daily'][i % 6],
  nextRun: ['dummy_Tomorrow', 'dummy_Jun 9009', 'dummy_Aug 9009', 'dummy_Tomorrow', 'dummy_Friday', 'dummy_Tomorrow'][i % 6],
  status: ['dummy_Active', 'dummy_Active', 'dummy_Planning', 'dummy_Active', 'dummy_Active', 'dummy_Paused'][i % 6],
  list: ['Work', 'Work', 'Work', 'Personal', 'Personal', 'Personal'][i % 6],
}));

// Tools mock data
const toolsData = Array.from({ length: 20 }).map((_, i) => ({
  id: `TOOL-${3000 + i}`,
  name: [
    'dummy_Reconnect',
    'dummy_Memory Search',
    'dummy_Community Pulse',
    'dummy_Milestones',
    'dummy_Career Moves',
    'dummy_Open Threads',
    'dummy_Meeting Notes',
    'dummy_Person Enrichment'
  ][i % 8],
  category: ['dummy_Relationships', 'dummy_Search', 'dummy_Analytics', 'dummy_Tracking', 'dummy_Intelligence', 'dummy_Communication', 'dummy_Productivity', 'dummy_Data'][i % 8],
  lastUsed: ['dummy_9009 hours ago', 'dummy_Yesterday', 'dummy_9009 days ago', 'dummy_9009 week ago', 'dummy_Today', 'dummy_9009 days ago', 'dummy_Yesterday', 'dummy_9009 hours ago'][i % 8],
  usageCount: [9009, 9009, 9009, 9009, 9009, 9009, 9009, 9009][i % 8],
  list: ['Favorites', 'Favorites', 'All Tools', 'All Tools', 'Favorites', 'All Tools', 'Favorites', 'All Tools'][i % 8],
}));

export function WorkPage() {
  const [activeTab, setActiveTab] = useState('Initiatives');
  const [activeView, setActiveView] = useState('card');
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [selectedList, setSelectedList] = useState('All');
  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;
  const initiatives = useInitiatives();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<{ name: string; status: Initiative['status']; list: string; goal: string }>({ name: '', status: 'Planning', list: 'Work', goal: '' });
  const submitInitiative = () => { if (!draft.name.trim()) return; createInitiative(draft); setDraft({ name: '', status: 'Planning', list: 'Work', goal: '' }); setCreateOpen(false); };

  const navigate = useNavigate();
  const headerTabs = [
    { id: 'Initiatives', icon: Target },
    { id: 'Rituals', icon: Repeat },
    { id: 'Tools', icon: PenTool },
  ];
  const views = [
    { id: 'card', icon: LayoutGrid, label: 'Card' },
    { id: 'table', icon: Table, label: 'Table' },
    { id: 'kanban', icon: Kanban, label: 'Board' },
    { id: 'calendar', icon: Calendar, label: 'Calendar' },
  ];

  // Lists for each tab
  const initiativesLists = ['All', 'Work', 'Academics', 'Personal'];
  const ritualsLists = ['All', 'Work', 'Personal', 'Health'];
  const toolsLists = ['All', 'Favorites', 'Recently Used', 'Intelligence'];

  const getCurrentLists = () => {
    switch (activeTab) {
      case 'Initiatives': return initiativesLists;
      case 'Rituals': return ritualsLists;
      case 'Tools': return toolsLists;
      default: return ['All'];
    }
  };

  const getCurrentData = () => {
    let data;
    switch (activeTab) {
      case 'Initiatives': data = initiatives; break;
      case 'Rituals': data = ritualsData; break;
      case 'Tools': data = toolsData; break;
      default: data = [];
    }

    // Filter by list
    if (selectedList !== 'All') {
      data = data.filter((item: any) => item.list === selectedList);
    }

    return data;
  };

  const mockData = getCurrentData();
  const totalPages = Math.ceil(mockData.length / rowsPerPage);
  const currentData = mockData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  const ActiveViewIcon = views.find(v => v.id === activeView)?.icon || LayoutGrid;
  const ActiveViewLabel = views.find(v => v.id === activeView)?.label || 'Card';

  // Tools + Rituals each have a dedicated page (Rituals = the single ritual factory with New Ritual);
  // only Initiatives renders in-page. This keeps the Rituals surface consistent everywhere.
  const handleTabChange = (tab: string) => {
    if (tab === 'Tools') { navigate('/tools'); return; }
    if (tab === 'Rituals') { navigate('/rituals'); return; }
    setActiveTab(tab);
    setSelectedList('All');
    setCurrentPage(1);
  };

  const renderCard = (item: any) => {
    if (activeTab === 'Initiatives') {
      return (
        <Link
          to={`/initiative/${item.id}`}
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
            <h3 className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>
              {item.name}
            </h3>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1 rounded-md transition-colors" style={{ color: 'var(--color-warm-gray)' }}
                  onClick={(e) => e.preventDefault()}>
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: item.status === 'Active' ? 'var(--color-steel)' :
                               item.status === 'Planning' ? 'var(--color-sage)' :
                               item.status === 'Completed' ? 'var(--color-trust)' :
                               'var(--color-warm-gray)'
              }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--color-navy-mid)' }}>{item.status}</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${item.progress}%`,
                  backgroundColor: item.progress >= 80 ? 'var(--color-steel)' : item.progress >= 40 ? 'var(--color-sage)' : 'var(--color-amber-soft)'
                }}
              />
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-navy-mid)' }}>{item.progress}%</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--color-warm-gray)' }}>Owner: {item.owner}</span>
            <span style={{ color: 'var(--color-warm-gray)' }}>Due: {item.deadline}</span>
          </div>
        </Link>
      );
    } else if (activeTab === 'Rituals') {
      return (
        <Link
          to={`/ritual/${item.id}`}
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
            <h3 className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>
              {item.name}
            </h3>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1 rounded-md transition-colors" style={{ color: 'var(--color-warm-gray)' }}
                  onClick={(e) => e.preventDefault()}>
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-navy-mid)'
              }}>
              {item.frequency}
            </span>
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-warm-gray)' }} />
            <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{item.status}</span>
          </div>
          <div className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>
            Next run: <span style={{ color: 'var(--color-navy-mid)', fontWeight: 500 }}>{item.nextRun}</span>
          </div>
        </Link>
      );
    } else {
      // Tools
      return (
        <Link
          to={`/tool/${item.id}`}
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
            <h3 className="text-base font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>
              {item.name}
            </h3>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1 rounded-md transition-colors" style={{ color: 'var(--color-warm-gray)' }}
                  onClick={(e) => e.preventDefault()}>
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full inline-block mb-3"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-navy-mid)'
            }}>
            {item.category}
          </span>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--color-warm-gray)' }}>Used: {item.lastUsed}</span>
            <span style={{ color: 'var(--color-navy-mid)', fontWeight: 500 }}>{item.usageCount} times</span>
          </div>
        </Link>
      );
    }
  };

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-hidden border-r w-full relative min-w-0"
      style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}>

      <Header tabs={headerTabs} activeTab={activeTab} onTabChange={handleTabChange} indicatorId="workSegmentIndicator" />

      <ListPillRow
        pills={getCurrentLists().filter(l => l !== 'All')}
        selected={selectedList === 'All' ? null : selectedList}
        onSelect={(v) => { setSelectedList(v ?? 'All'); setCurrentPage(1); }}
      />

      {/* Toolbar - continuing in next message due to length */}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 shadow-sm z-20 w-full"
        style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 flex-1 overflow-hidden">

          {/* View Dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold transition-colors shadow-inner"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-navy-mid)'
              }}
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
                        onClick={() => {
                          setActiveView(view.id);
                          setViewDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors"
                        style={{
                          backgroundColor: activeView === view.id ? 'var(--color-surface)' : 'transparent',
                          color: activeView === view.id ? 'var(--color-steel)' : 'var(--color-navy-mid)'
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

          {/* Search Bar */}
          <div className="relative group shrink flex-1 max-w-[400px] min-w-[32px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 transition-colors"
              style={{ color: 'var(--color-warm-gray)' }} />
            <input
              type="text"
              placeholder="Search..."
              className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm transition-all outline-none shadow-inner"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-navy-mid)'
              }}
            />
          </div>

          {/* Action Icons */}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <button className="@[500px]:flex hidden items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border rounded-lg transition-colors shadow-sm whitespace-nowrap"
              style={{
                backgroundColor: 'var(--color-background)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-navy-mid)'
              }}>
              <Filter className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
              <span className="@[850px]:inline hidden">Filter</span>
            </button>
            <button className="@[550px]:flex hidden items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border rounded-lg transition-colors shadow-sm whitespace-nowrap"
              style={{
                backgroundColor: 'var(--color-background)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-navy-mid)'
              }}>
              <ArrowUpDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
              <span className="@[850px]:inline hidden">Sort</span>
            </button>

            {activeTab === 'Initiatives' && (
              <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 shadow-sm whitespace-nowrap" style={{ backgroundColor: 'var(--color-steel)' }}>
                <Plus className="w-3.5 h-3.5" /> <span className="@[700px]:inline hidden">New initiative</span>
              </button>
            )}
            <div className="w-px h-6 shrink-0 mx-1 @[400px]:block hidden" style={{ backgroundColor: 'var(--color-border)' }} />

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="p-1.5 rounded-lg transition-colors border border-transparent shrink-0 z-20 shadow-sm"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-warm-gray)'
                  }}>
                  <MoreVertical className="w-5 h-5" />
                </button>
              </DropdownMenu.Trigger>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>

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
              {currentData.length === 0 ? (
                <EmptyState tab={activeTab} onNew={() => setCreateOpen(true)} />
              ) : (
                <div className="grid grid-cols-1 @[600px]:grid-cols-2 @[900px]:grid-cols-3 @[1200px]:grid-cols-4 gap-4">
                  {currentData.map(item => renderCard(item))}
                </div>
              )}
            </motion.div>
          )}

          {activeView === 'table' && (
            <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-auto">
              {currentData.length === 0 ? (
                <div className="p-6"><EmptyState tab={activeTab} onNew={() => setCreateOpen(true)} /></div>
              ) : (
                <WorkTable tab={activeTab} rows={currentData} onOpen={(id) => navigate(activeTab === 'Initiatives' ? `/initiative/${id}` : activeTab === 'Rituals' ? `/ritual/${id}` : `/tool/${id}`)} onDelete={activeTab === 'Initiatives' ? deleteInitiative : undefined} />
              )}
            </motion.div>
          )}

          {/* Other Views Placeholder */}
          {activeView !== 'card' && activeView !== 'table' && (
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

      {/* New-initiative modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 px-4" onClick={() => setCreateOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-[440px] max-w-full rounded-2xl border bg-white shadow-2xl overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-base font-bold" style={{ color: 'var(--color-navy)' }}>New initiative</h3>
              <button onClick={() => setCreateOpen(false)} className="p-1 rounded-md hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-warm-gray)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Name</label>
                <input autoFocus value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') submitInitiative(); }} placeholder="e.g. Q2 fund close" className="mt-1 w-full px-3 py-2 border rounded-lg text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Goal</label>
                <input value={draft.goal} onChange={e => setDraft(d => ({ ...d, goal: e.target.value }))} placeholder="What does done look like?" className="mt-1 w-full px-3 py-2 border rounded-lg text-sm outline-none" style={{ borderColor: 'var(--color-border)' }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Status</label>
                  <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as Initiative['status'] }))} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm outline-none bg-white" style={{ borderColor: 'var(--color-border)' }}>{['Planning', 'Active', 'On Hold', 'Completed'].map(s => <option key={s}>{s}</option>)}</select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>List</label>
                  <select value={draft.list} onChange={e => setDraft(d => ({ ...d, list: e.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm outline-none bg-white" style={{ borderColor: 'var(--color-border)' }}>{['Work', 'Academics', 'Personal'].map(s => <option key={s}>{s}</option>)}</select>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={() => setCreateOpen(false)} className="px-3 py-2 text-sm font-medium" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
              <button onClick={submitInitiative} disabled={!draft.name.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>Create initiative</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab, onNew }: { tab: string; onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      <div className="w-14 h-14 rounded-2xl border flex items-center justify-center mb-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><Target className="w-7 h-7" style={{ color: 'var(--color-warm-gray)' }} /></div>
      <h3 className="text-lg font-semibold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>No {tab.toLowerCase()} yet</h3>
      <p className="text-sm max-w-sm mt-1.5 mb-4" style={{ color: 'var(--color-warm-gray)' }}>{tab === 'Initiatives' ? 'Create an initiative to organise touchpoints toward a goal.' : `No ${tab.toLowerCase()} to show.`}</p>
      {tab === 'Initiatives' && <button onClick={onNew} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-4 h-4" /> New initiative</button>}
    </div>
  );
}

function WorkTable({ tab, rows, onOpen, onDelete }: { tab: string; rows: any[]; onOpen: (id: string) => void; onDelete?: (id: string) => void }) {
  const cols = tab === 'Initiatives' ? ['Name', 'Status', 'Progress', 'Owner', 'Deadline'] : tab === 'Rituals' ? ['Name', 'Frequency', 'Next run', 'Status'] : ['Name', 'Category', 'Last used', 'Usage'];
  const cell = (item: any, col: string) => {
    switch (col) {
      case 'Name': return item.name;
      case 'Status': return item.status;
      case 'Progress': return `${item.progress ?? 0}%`;
      case 'Owner': return item.owner;
      case 'Deadline': return item.deadline;
      case 'Frequency': return item.frequency;
      case 'Next run': return item.nextRun;
      case 'Category': return item.category;
      case 'Last used': return item.lastUsed;
      case 'Usage': return item.usageCount;
      default: return '';
    }
  };
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
        <tr>
          {cols.map(c => <th key={c} className="text-left px-6 py-2.5 border-b border-r font-semibold text-xs uppercase tracking-wider" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>{c}</th>)}
          <th className="border-b" style={{ borderColor: 'var(--color-border)' }} />
        </tr>
      </thead>
      <tbody>
        {rows.map(item => (
          <tr key={item.id} className="hover:bg-[var(--color-surface)] cursor-pointer transition-colors" onClick={() => onOpen(item.id)}>
            {cols.map((c, i) => <td key={c} className="px-6 py-3 border-b border-r truncate max-w-[320px]" style={{ borderColor: 'var(--color-border)', color: i === 0 ? 'var(--color-navy)' : 'var(--color-navy-mid)', fontWeight: i === 0 ? 600 : 400 }}>{cell(item, c)}</td>)}
            <td className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>{onDelete && <button onClick={e => { e.stopPropagation(); onDelete(item.id); }} className="p-1.5 rounded-md hover:bg-[var(--danger)]/10" style={{ color: 'var(--color-warm-gray)' }} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
