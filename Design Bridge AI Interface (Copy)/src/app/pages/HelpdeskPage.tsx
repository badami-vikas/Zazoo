import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  LifeBuoy, Plus, Table as TableIcon, LayoutGrid, ChevronDown, Check, Search, Filter, Gift, MoreVertical, Info,
} from 'lucide-react';
import {
  useRequests, useOffers, useAiMode, useAskPins, seedInboxIfEmpty,
  myHelpdesks, publicHelpdesks, getStreak, getBadges, peopleHelpedCount, shouldShowImpactReport,
  isMine, isAskPinned, getAiFlags, setAiRecommendation, setAiScreening, AI_FLAG_TOOLTIPS,
  type HelpRequest, type Audience,
} from '../data/helpdesk';
import { GlideTable } from '../components/GlideTable';
import { ListPillRow } from '../components/ListPillRow';
import { StatsCard, BadgeRow, HelpdeskCard } from '../components/helpdesk/HelpdeskBits';
import { AskModal, type AskScope } from '../components/helpdesk/AskModal';
import { CreateHelpdeskModal } from '../components/helpdesk/CreateHelpdeskModal';
import { ImpactReportModal } from '../components/helpdesk/ImpactReportModal';

type ViewId = 'card' | 'table';
type StatusFilter = 'all' | 'open' | 'resolved';
const LIST_NETWORK = 'Network Requests';
const LIST_MINE = 'My Helpdesk';
const LIST_PUBLIC = 'Public Helpdesks';

function audienceSummary(a?: Audience): string {
  const parts: string[] = [];
  if (!a || a.network) parts.push('My Network');
  (a?.helpdesks || []).forEach(h => parts.push(h.name + (h.public ? ' (Public)' : '')));
  return parts.length ? parts.join(', ') : 'My Network';
}

// Add Ask audience is scoped to the list you're in.
function scopeForList(list: string | null): AskScope {
  if (list === LIST_NETWORK) return 'network';
  if (list === LIST_MINE) return 'myhelpdesk';
  if (list === LIST_PUBLIC) return 'public';
  return 'all';
}

export function HelpdeskPage() {
  const navigate = useNavigate();
  const requests = useRequests();
  const offers = useOffers();
  useAiMode();         // re-render on AI flag changes
  useAskPins();        // re-render on pin changes
  const flags = getAiFlags();

  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>('card');
  const [viewOpen, setViewOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [askOpen, setAskOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);

  useEffect(() => { seedInboxIfEmpty(); }, []);
  useEffect(() => { if (shouldShowImpactReport(new Date())) setImpactOpen(true); }, []);

  const myIds = useMemo(() => new Set(myHelpdesks().map(w => w.id)), [requests]);
  const publicIds = useMemo(() => new Set(publicHelpdesks().map(w => w.id)), []);
  const offersCount = (rid: string) => offers.filter(o => o.requestId === rid).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inList = (r: HelpRequest) => {
      if (selectedList === LIST_NETWORK) return r.workspaceId === null;
      if (selectedList === LIST_MINE) return !!r.workspaceId && myIds.has(r.workspaceId);
      if (selectedList === LIST_PUBLIC) return !!r.workspaceId && publicIds.has(r.workspaceId);
      return true;
    };
    return requests
      .filter(r => (r.moderationStatus ?? 'approved') !== 'held')
      .filter(inList)
      .filter(r => !mineOnly || isMine(r))
      .filter(r => statusFilter === 'all' || r.status === statusFilter)
      .filter(r => !q || [r.title, r.body, r.requesterName].filter(Boolean).join(' ').toLowerCase().includes(q))
      // pinned (My asks pinned by default) float to the top of every list, then most recent.
      .sort((a, b) => (Number(isAskPinned(b)) - Number(isAskPinned(a))) || (b.createdAt < a.createdAt ? -1 : 1));
  }, [requests, selectedList, mineOnly, statusFilter, query, myIds, publicIds]);

  const onMyHelpdesk = selectedList === LIST_MINE;
  const streak = getStreak();
  const badges = getBadges();
  const peopleHelped = peopleHelpedCount();
  const activeFilterCount = (mineOnly ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);
  const ActiveViewIcon = view === 'card' ? LayoutGrid : TableIcon;

  const tableRows = visible.map(r => ({
    id: r.id, name: r.title,
    requester: isMine(r) ? 'You' : r.requesterName,
    audience: audienceSummary(r.audience),
    status: r.status[0].toUpperCase() + r.status.slice(1),
    responses: offersCount(r.id),
  }));

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#FAF9F5' }}>
      {/* Title + gamification */}
      <div className="flex items-center gap-3 px-5 py-3 border-b bg-white shrink-0 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 shrink-0">
          <LifeBuoy className="w-5 h-5" style={{ color: 'var(--color-steel)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>Helpdesk</h1>
        </div>
        <StatsCard streak={streak} peopleHelped={peopleHelped} />
        <BadgeRow badges={badges} />
        {/* Square Impact Report button — icon centered, 2-line label below */}
        <button onClick={() => setImpactOpen(true)} title="Your Impact Report" className="ml-auto w-[60px] h-[60px] shrink-0 flex flex-col items-center justify-center gap-1 rounded-xl border transition-colors hover:bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
          <Gift className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
          <span className="text-[9px] font-semibold leading-[1.15] text-center" style={{ color: 'var(--color-warm-gray)' }}>Impact<br />Report</span>
        </button>
      </div>

      {/* Lists */}
      <ListPillRow
        pills={[LIST_NETWORK, LIST_MINE, LIST_PUBLIC]}
        selected={selectedList}
        onSelect={setSelectedList}
        allLabel="All Requests"
        addLabel="Add List"
        onAddList={() => setCreateOpen(true)}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-white shadow-sm z-20 shrink-0 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
        {/* View dropdown (Card / Table) */}
        <div className="relative shrink-0">
          <button onClick={() => setViewOpen(o => !o)} className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
            <ActiveViewIcon className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
            <span className="hidden @[500px]:inline">{view === 'card' ? 'Card' : 'Table'}</span>
            <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
          </button>
          {viewOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setViewOpen(false)} />
              <div className="absolute top-full left-0 mt-1 w-40 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                {([['card', 'Card', LayoutGrid], ['table', 'Table', TableIcon]] as const).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => { setView(id); setViewOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium" style={{ backgroundColor: view === id ? 'var(--color-surface)' : 'transparent', color: view === id ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                    <Icon className="w-4 h-4" style={{ color: view === id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} /> {label}
                    {view === id && <Check className="w-3.5 h-3.5 ml-auto" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Filters dropdown (My Asks lives inside) */}
        <div className="relative shrink-0">
          <button onClick={() => setFiltersOpen(o => !o)} className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-medium shadow-sm" style={{ backgroundColor: activeFilterCount ? 'color-mix(in srgb, var(--color-steel) 8%, white)' : 'white', borderColor: 'var(--color-border)', color: activeFilterCount ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
            <Filter className="w-3.5 h-3.5" /> <span className="hidden @[600px]:inline">Filters</span>
            {activeFilterCount > 0 && <span className="text-[10px] font-bold px-1.5 rounded-full text-white" style={{ backgroundColor: 'var(--color-steel)' }}>{activeFilterCount}</span>}
          </button>
          {filtersOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFiltersOpen(false)} />
              <div className="absolute top-full left-0 mt-1 w-56 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}>
                  <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} className="accent-[var(--color-steel)]" /> My Asks
                </label>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Status</div>
                {(['all', 'open', 'resolved'] as StatusFilter[]).map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm capitalize hover:bg-[var(--color-surface)]" style={{ color: statusFilter === s ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
                    {statusFilter === s ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5" />} {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* My Asks quick toggle */}
        <button onClick={() => setMineOnly(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-medium shadow-sm shrink-0" style={{ backgroundColor: mineOnly ? 'color-mix(in srgb, var(--color-steel) 10%, white)' : 'white', borderColor: 'var(--color-border)', color: mineOnly ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
          <span className="hidden @[600px]:inline">My Asks</span><span className="@[600px]:hidden">Mine</span>
        </button>

        {/* 3-dots Helpdesk AI menu (AI recommendation + AI screening) */}
        <div className="relative shrink-0">
          <button onClick={() => setAiMenuOpen(o => !o)} title="Helpdesk AI" className="flex items-center justify-center w-8 h-8 border rounded-lg shadow-sm" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
            <MoreVertical className="w-4 h-4" />
          </button>
          {aiMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAiMenuOpen(false)} />
              <div className="absolute top-full left-0 mt-1 w-64 border rounded-xl shadow-lg z-50 py-1 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Helpdesk AI</div>
                {([
                  ['recommendation', 'AI recommendation', flags.recommendation, setAiRecommendation, AI_FLAG_TOOLTIPS.recommendation] as const,
                  ['screening', 'AI Screening', flags.screening, setAiScreening, AI_FLAG_TOOLTIPS.screening] as const,
                ]).map(([key, label, on, set, tip]) => (
                  <label key={key} className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy)' }}>
                    <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="mt-0.5 accent-[var(--color-steel)]" />
                    <span className="min-w-0">
                      <span className="inline-flex items-center gap-1 font-medium">{label}
                        <span className="group relative inline-flex">
                          <Info className="w-3 h-3" style={{ color: 'var(--color-warm-gray)' }} />
                          <span className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 p-2 rounded-lg text-[11px] leading-relaxed shadow-xl z-10" style={{ backgroundColor: 'var(--color-navy)', color: 'white' }}>{tip}</span>
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Search */}
        <div className="relative shrink flex-1 max-w-[300px] min-w-[100px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-warm-gray)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search asks…" className="pl-9 pr-3 py-1.5 w-full border rounded-lg text-sm outline-none shadow-inner" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }} />
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {onMyHelpdesk && (
            <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border shadow-sm active:scale-95 transition-transform" style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)', backgroundColor: 'white' }}>
              <Plus className="w-4 h-4" /> <span className="hidden @[500px]:inline">Create Helpdesk</span>
            </button>
          )}
          <button onClick={() => setAskOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform" style={{ backgroundColor: 'var(--color-steel)' }}>
            <Plus className="w-4 h-4" /> Add Ask
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-white">
        {visible.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6" style={{ color: 'var(--color-warm-gray)' }}>
            <LifeBuoy className="w-10 h-10 mb-3" style={{ color: 'var(--color-border)' }} />
            {onMyHelpdesk ? (
              <>
                <p className="text-sm">You don't have a helpdesk yet.</p>
                <button onClick={() => setCreateOpen(true)} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-4 h-4" /> Create Helpdesk</button>
              </>
            ) : (
              <>
                <p className="text-sm">No asks here yet.</p>
                <button onClick={() => setAskOpen(true)} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-4 h-4" /> Add Ask</button>
              </>
            )}
          </div>
        ) : view === 'card' ? (
          <div className="p-5 grid grid-cols-2 @[700px]:grid-cols-3 @[1000px]:grid-cols-4 @[1340px]:grid-cols-5 gap-3.5">
            {visible.map(r => <HelpdeskCard key={r.id} req={r} offersCount={offersCount(r.id)} onOpen={() => navigate(`/helpdesk/ask/${r.id}`)} />)}
          </div>
        ) : (
          <div className="h-full">
            <GlideTable
              rows={tableRows}
              fields={[
                { id: 'requester', label: 'REQUESTER', width: 180 },
                { id: 'audience', label: 'SHARED WITH', width: 260 },
                { id: 'status', label: 'STATUS', width: 120 },
                { id: 'responses', label: 'RESPONSES', width: 120 },
              ]}
              rowHeight={36}
              onOpen={(row) => navigate(`/helpdesk/ask/${row.id}`)}
            />
          </div>
        )}
      </div>

      {askOpen && <AskModal scope={scopeForList(selectedList)} onClose={() => setAskOpen(false)} onCreated={(id) => navigate(`/helpdesk/ask/${id}`)} />}
      {createOpen && <CreateHelpdeskModal onClose={() => setCreateOpen(false)} />}
      {impactOpen && <ImpactReportModal onClose={() => setImpactOpen(false)} />}
    </div>
  );
}

export default HelpdeskPage;
