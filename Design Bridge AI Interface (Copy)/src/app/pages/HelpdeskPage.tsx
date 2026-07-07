import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  LifeBuoy, Plus, Table as TableIcon, LayoutGrid, Check, Gift, Info,
} from 'lucide-react';
import {
  useRequests, useOffers, useAiMode, useAskPins,
  myHelpdesks, publicHelpdesks, getStreak, getBadges, peopleHelpedCount, shouldShowImpactReport,
  isMine, isAskPinned, getAiFlags, setAiRecommendation, setAiScreening, AI_FLAG_TOOLTIPS,
  type HelpRequest, type Audience,
} from '../data/helpdesk';
import { GlideTable } from '../components/GlideTable';
import { CardGrid } from '../components/shared/NotionCard';
import { ListPillRow } from '../components/ListPillRow';
import { ToolPageHeader } from '../components/shared/ToolPageHeader';
import { StandardToolbar } from '../components/shared/StandardToolbar';
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [askOpen, setAskOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);

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

  const tableRows = visible.map(r => ({
    id: r.id, name: r.title,
    requester: isMine(r) ? 'You' : r.requesterName,
    audience: audienceSummary(r.audience),
    status: r.status[0].toUpperCase() + r.status.slice(1),
    responses: offersCount(r.id),
  }));

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#FAF9F5' }}>
      <ToolPageHeader icon={LifeBuoy} title="Helpdesk" />

      <ListPillRow
        pills={[LIST_NETWORK, LIST_MINE, LIST_PUBLIC]}
        selected={selectedList}
        onSelect={setSelectedList}
        allLabel="All Requests"
        addLabel="Add List"
        onAddList={() => setCreateOpen(true)}
      />

      <StandardToolbar
        view={view}
        views={[{ id: 'card', label: 'Card', icon: LayoutGrid }, { id: 'table', label: 'Table', icon: TableIcon }]}
        onViewChange={(id) => setView(id as ViewId)}
        search={query}
        onSearchChange={setQuery}
        onFilterClick={() => setFiltersOpen((o) => !o)}
        filterCount={activeFilterCount}
        filterOpen={filtersOpen}
        filterPanel={
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
        }
        customActions={
          <>
            <StatsCard streak={streak} peopleHelped={peopleHelped} />
            <BadgeRow badges={badges} />
            <button onClick={() => setMineOnly(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-medium shadow-sm shrink-0" style={{ backgroundColor: mineOnly ? 'color-mix(in srgb, var(--color-steel) 10%, white)' : 'white', borderColor: 'var(--color-border)', color: mineOnly ? 'var(--color-steel)' : 'var(--color-navy-mid)' }}>
              My Asks
            </button>
            <button onClick={() => setImpactOpen(true)} title="Your Impact Report" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shadow-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white', color: 'var(--color-navy-mid)' }}>
              <Gift className="w-3.5 h-3.5" style={{ color: 'var(--color-steel)' }} /> Impact
            </button>
            {onMyHelpdesk && (
              <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border shadow-sm active:scale-95 transition-transform" style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)', backgroundColor: 'white' }}>
                <Plus className="w-4 h-4" /> Create Helpdesk
              </button>
            )}
            <button onClick={() => setAskOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform" style={{ backgroundColor: 'var(--color-steel)' }}>
              <Plus className="w-4 h-4" /> Add Ask
            </button>
          </>
        }
        moreMenu={
          <>
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
          </>
        }
      />

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
          <CardGrid>
            {visible.map(r => <HelpdeskCard key={r.id} req={r} offersCount={offersCount(r.id)} onOpen={() => navigate(`/helpdesk/ask/${r.id}`)} />)}
          </CardGrid>
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
