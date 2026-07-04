import { useMemo, useState } from 'react';
import { Handshake, LayoutGrid, Kanban as KanbanIcon, List as ListIcon } from 'lucide-react';
import {
  LISTINGS, useThesisProfile, useDeals, dealForListing, addToPipeline, advanceDeal, scoreThesisFit,
  DEAL_STAGE_LABEL, type DealStage, type Deal, type TriageColor,
} from '../data/dealpilot';
import { CardGrid, NotionCard } from '../components/shared/NotionCard';
import { FlagIcon } from '../components/shared/FlagIcon';
import { KanbanBoard, type KanbanLane } from '../components/shared/KanbanBoard';
import { ListView } from '../components/shared/ListView';
import { ToolPageHeader } from '../components/shared/ToolPageHeader';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { ListBar } from '../components/shared/ListBar';
import { useLists, toggleMember, seedListsIfEmpty } from '../data/lists';
import { Check } from 'lucide-react';
import { useEffect } from 'react';

type ViewId = 'card' | 'kanban' | 'list';
const VIEWS = [
  { id: 'card', label: 'Card', icon: LayoutGrid },
  { id: 'kanban', label: 'Kanban', icon: KanbanIcon },
  { id: 'list', label: 'List', icon: ListIcon },
];

const STAGES: DealStage[] = ['sourced', 'reviewing', 'diligence', 'offer', 'closed', 'passed'];
const NEXT_STAGE: Partial<Record<DealStage, DealStage>> = { sourced: 'reviewing', reviewing: 'diligence', diligence: 'offer', offer: 'closed' };

const SCOPE = 'dealpilot';

export function DealPilotPage() {
  const thesis = useThesisProfile();
  const deals = useDeals();
  const [view, setView] = useState<ViewId>('card');
  const [search, setSearch] = useState('');
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const lists = useLists(SCOPE);
  const activeList = lists.find((l) => l.id === selectedList) ?? null;

  // Seed the two lists the sourcing workflow is organized around, once, if none exist yet.
  useEffect(() => {
    seedListsIfEmpty(SCOPE, [
      { name: 'Brokerages', instruction: 'Only surface listings sourced from a brokerage — hold anything unverified for manual review.' },
      { name: 'Market Intelligence', instruction: 'Track competitive/market-signal listings — informational, not for active pipeline pursuit.' },
    ]);
  }, []);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return LISTINGS
      .filter((l) => !q || `${l.name} ${l.industry}`.toLowerCase().includes(q))
      .map((listing) => ({ listing, fit: scoreThesisFit(listing, thesis) }));
  }, [thesis, search]);
  const scored = useMemo(
    () => (view === 'list' ? searched : searched.filter(({ listing }) => !activeList || activeList.memberIds.includes(listing.id))),
    [searched, activeList, view],
  );

  // Same universal rule as JobPilot: the flag is the action. Green sources into the pipeline,
  // yellow sources but holds for manual review before any stage change, red is a pass (no-op).
  function onFlagAction(listingId: string, color: TriageColor) {
    if (color === 'red') return;
    const listing = LISTINGS.find((l) => l.id === listingId);
    if (listing) addToPipeline(listing);
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#FAF9F5' }}>
      <ToolPageHeader icon={Handshake} title="DealPilot" />
      <ListBar scope={SCOPE} selected={selectedList} onSelect={setSelectedList} allLabel="All Deals" />
      <StandardToolbar
        view={view}
        views={VIEWS}
        onViewChange={(id) => setView(id as ViewId)}
        search={search}
        onSearchChange={setSearch}
        onFilterClick={() => {}}
        onSortClick={() => {}}
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />

      <div className="flex-1 overflow-auto">
        {view === 'card' && (
          <CardGrid>
            {scored.map(({ listing, fit }) => {
              const deal = dealForListing(listing.id);
              return (
                <NotionCard
                  key={listing.id}
                  title={listing.name}
                  subtitle={`${listing.industry} · ${listing.geo}`}
                  cornerBadge={<FlagIcon color={fit.triage} kind="ai_inference" matched={fit.matched} unmatched={fit.unmatched} onClick={deal ? undefined : (c) => onFlagAction(listing.id, c)} disabled={!!deal} />}
                  bodyLines={[...fit.matched.map((text) => ({ text, matched: true })), ...fit.unmatched.map((text) => ({ text, matched: false }))]}
                  metaChips={[listing.source, `SDE $${listing.sde.toLocaleString()}`, `rev $${listing.revenue.toLocaleString()}`]}
                  footer={<span className="text-xs font-medium" style={{ color: deal ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}>{deal ? `${DEAL_STAGE_LABEL[deal.stage]} — in pipeline` : 'Not sourced — click the flag'}</span>}
                />
              );
            })}
          </CardGrid>
        )}

        {view === 'kanban' && (
          <KanbanBoard<Deal>
            keyFor={(d) => d.id}
            lanes={STAGES.map((stage): KanbanLane<Deal> => ({ key: stage, label: DEAL_STAGE_LABEL[stage], items: deals.filter((d) => d.stage === stage) }))}
            renderCard={(deal) => <DealCard deal={deal} />}
          />
        )}

        {view === 'list' && (
          <ListView
            items={scored}
            keyFor={({ listing }) => listing.id}
            renderRow={({ listing, fit }) => {
              const deal = dealForListing(listing.id);
              return (
                <>
                  {lists.length > 0 && (
                    <button
                      title={!activeList ? 'Pick a list first to add deals to it' : activeList.memberIds.includes(listing.id) ? 'Remove from this list' : 'Add to this list'}
                      disabled={!activeList}
                      onClick={(e) => { e.stopPropagation(); if (activeList) toggleMember(SCOPE, activeList.id, listing.id); }}
                      className="w-4 h-4 shrink-0 rounded border flex items-center justify-center disabled:opacity-30"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: activeList?.memberIds.includes(listing.id) ? 'var(--color-steel)' : 'white' }}
                    >
                      {activeList?.memberIds.includes(listing.id) && <Check className="w-3 h-3 text-white" />}
                    </button>
                  )}
                  <FlagIcon color={fit.triage} kind="ai_inference" matched={fit.matched} unmatched={fit.unmatched} onClick={deal ? undefined : (c) => onFlagAction(listing.id, c)} disabled={!!deal} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-navy)' }}>{listing.name}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--color-warm-gray)' }}>{listing.industry} · {listing.geo}</div>
                  </div>
                  {activeList?.origin?.[listing.id] && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border shrink-0" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>{activeList.origin[listing.id]}</span>
                  )}
                  <span className="text-xs shrink-0" style={{ color: 'var(--color-navy-mid)' }}>SDE ${listing.sde.toLocaleString()}</span>
                  <span className="text-xs font-medium w-40 shrink-0 text-right" style={{ color: deal ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}>{deal ? DEAL_STAGE_LABEL[deal.stage] : 'Not in pipeline'}</span>
                </>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const next = NEXT_STAGE[deal.stage];
  return (
    <div className="rounded-lg border bg-white p-2.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>
      <div className="font-semibold truncate" style={{ color: 'var(--color-navy)' }}>{deal.name}</div>
      <div className="truncate mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>{deal.industry} · {deal.geo}</div>
      <div className="flex gap-1">
        {next && <button onClick={() => advanceDeal(deal.id, next)} className="flex-1 rounded px-1.5 py-1 text-white font-semibold" style={{ backgroundColor: 'var(--color-steel)' }}>Advance</button>}
        {deal.stage !== 'passed' && deal.stage !== 'closed' && <button onClick={() => advanceDeal(deal.id, 'passed')} className="flex-1 rounded px-1.5 py-1 font-semibold border" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Pass</button>}
      </div>
    </div>
  );
}

export default DealPilotPage;
