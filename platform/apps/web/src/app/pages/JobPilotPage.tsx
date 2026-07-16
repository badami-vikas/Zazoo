import { useMemo, useState } from 'react';
import { Briefcase, LayoutGrid, Kanban as KanbanIcon, List as ListIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  JOBS, useCandidateProfile, useApplications, applicationForJob, queueJob, approveReview,
  resumeParked, runDispatch, confirmSubmitted, scoreJobFit, STAGE_LABEL,
  type ApplicationStage, type Application, type ApplyOutcome, type FlagColor,
} from '../data/jobpilot';
import { CardGrid, NotionCard } from '../components/shared/NotionCard';
import { FlagIcon } from '../components/shared/FlagIcon';
import { KanbanBoard, type KanbanLane } from '../components/shared/KanbanBoard';
import { ListView } from '../components/shared/ListView';
import { Header } from '../components/shared/Header';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { CreateListModal } from '../components/shared/ListDropdown';
import { CollapsibleInsights } from '../components/shared/CollapsibleInsights';
import { useLists, createList, toggleMember } from '../data/lists';
import { Check } from 'lucide-react';
import { BCG_APPLICATION } from '../data/bcg-application';

type ViewId = 'card' | 'kanban' | 'list';
const VIEWS = [
  { id: 'card', label: 'Card', icon: LayoutGrid },
  { id: 'kanban', label: 'Kanban', icon: KanbanIcon },
  { id: 'list', label: 'List', icon: ListIcon },
];

const LANES: { key: string; label: string; stages: ApplicationStage[] }[] = [
  { key: 'queued', label: 'Queued', stages: ['queued'] },
  { key: 'progress', label: 'Tailoring / Evaluating', stages: ['tailoring', 'evaluating'] },
  { key: 'review', label: 'Awaiting review', stages: ['awaiting_review'] },
  { key: 'applying', label: 'Applying', stages: ['approved', 'applying'] },
  { key: 'done', label: 'Submitted / Confirmed', stages: ['submitted', 'confirmed'] },
  { key: 'closed', label: 'Parked / Closed', stages: ['parked', 'rejected_by_user', 'failed', 'expired'] },
];

const SCOPE = 'jobpilot';

export function JobPilotPage() {
  const navigate = useNavigate();
  const candidate = useCandidateProfile();
  const applications = useApplications();
  const [view, setView] = useState<ViewId>('card');
  const [search, setSearch] = useState('');
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [addListOpen, setAddListOpen] = useState(false);
  const lists = useLists(SCOPE);
  const activeList = lists.find((l) => l.id === selectedList) ?? null;

  // Card/Kanban show only this list's members — List view stays unfiltered since it doubles as
  // the membership-management surface (checkboxes to add/remove jobs from the selected list).
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return JOBS
      .filter((job) => !q || `${job.title} ${job.company}`.toLowerCase().includes(q))
      .map((job) => ({ job, fit: scoreJobFit(job, candidate) }));
  }, [candidate, search]);
  const scored = useMemo(
    () => (view === 'list' ? searched : searched.filter(({ job }) => !activeList || activeList.memberIds.includes(job.id))),
    [searched, activeList, view],
  );
  const showsBcgApplication = `${BCG_APPLICATION.role} ${BCG_APPLICATION.company}`.toLowerCase().includes(search.trim().toLowerCase());
  const openBcgApplication = () => navigate(`/jobpilot/application/${BCG_APPLICATION.id}`);

  // The flag IS the action — green queues auto, yellow queues for manual review before any
  // status changes, red is a no-go (no application created). No separate buttons on the card.
  function onFlagAction(jobId: string, color: FlagColor) {
    if (color === 'red') return;
    const job = JOBS.find((j) => j.id === jobId);
    if (job) queueJob(job, color === 'yellow' ? 'review' : 'auto');
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#FAF9F5' }}>
      <Header tabs={[{ id: 'JobPilot', icon: Briefcase }]} activeTab="JobPilot" onTabChange={() => {}} />
      <StandardToolbar
        lists={[{ id: '__all', label: 'All Jobs' }, ...lists.map((l) => ({ id: l.id, label: l.name }))]}
        activeListId={selectedList ?? '__all'}
        onListSelect={(id) => setSelectedList(id === '__all' ? null : id)}
        onAddList={() => setAddListOpen(true)}
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen((o) => !o)}
        view={view}
        views={VIEWS}
        onViewChange={(id) => setView(id as ViewId)}
        search={search}
        onSearchChange={setSearch}
        onFilterClick={() => {}}
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: 'jobs', label: 'Jobs shown', value: String(scored.length + (showsBcgApplication ? 1 : 0)) },
          { id: 'tracker', label: 'In tracker', value: String(applications.length + 1) },
          { id: 'review', label: 'Awaiting review', value: String(applications.filter((a) => a.stage === 'awaiting_review').length) },
        ]}
      />
      {addListOpen && (
        <CreateListModal
          onClose={() => setAddListOpen(false)}
          onCreate={(name, instruction) => setSelectedList(createList(SCOPE, name, instruction).id)}
        />
      )}

      <div className="flex-1 overflow-auto">
        {view === 'card' && (
          scored.length > 0 || showsBcgApplication ? (
            <CardGrid>
              {showsBcgApplication && (
                <NotionCard
                  eyebrow={<span className="w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFF6DD', color: '#8A5A00' }}>Application preparation</span>}
                  title={BCG_APPLICATION.role}
                  subtitle={`${BCG_APPLICATION.company} · ${BCG_APPLICATION.location}`}
                  cornerBadge={<FlagIcon color="green" kind="ai_inference" matched={[...BCG_APPLICATION.fit.strengths]} unmatched={[...BCG_APPLICATION.fit.concerns]} disabled />}
                  bodyLines={[
                    { text: 'Founder-to-consultant story with measurable client impact', matched: true },
                    { text: 'STEM MBA · Dean’s Scholar · GMAT 98th percentile', matched: true },
                    { text: 'Office preference and three evidence conflicts remain', matched: false },
                  ]}
                  metaChips={[`${BCG_APPLICATION.artifacts.length} artifacts`, 'Human approval required']}
                  footer={<span className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--color-steel)' }}><span>Open application workspace</span><span>→</span></span>}
                  onOpen={openBcgApplication}
                />
              )}
              {scored.map(({ job, fit }) => {
                const app = applicationForJob(job.id);
                return (
                  <NotionCard
                    key={job.id}
                    title={job.title}
                    subtitle={`${job.company} · ${job.location}`}
                    cornerBadge={<FlagIcon color={fit.flag} kind="ai_inference" matched={fit.matched} unmatched={fit.unmatched} onClick={app ? undefined : (c) => onFlagAction(job.id, c)} disabled={!!app} />}
                    bodyLines={[...fit.matched.map((text) => ({ text, matched: true })), ...fit.unmatched.map((text) => ({ text, matched: false }))]}
                    metaChips={[job.ats, `to $${job.salaryMax.toLocaleString()}`]}
                    footer={<span className="text-xs font-medium" style={{ color: app ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}>{app ? `${STAGE_LABEL[app.stage]} — in tracker` : 'Not queued — click the flag'}</span>}
                  />
                );
              })}
            </CardGrid>
          ) : (
            <div className="p-10 text-center border border-dashed rounded-xl m-4" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
              No job postings yet — connect a job board to start sourcing.
            </div>
          )
        )}

        {view === 'kanban' && (
          <div>
            {showsBcgApplication && <button onClick={openBcgApplication} className="m-4 flex w-[calc(100%_-_2rem)] max-w-md items-center justify-between rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-sm" style={{ borderColor: 'var(--color-steel)' }}><div><div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#8A5A00' }}>Application preparation</div><div className="mt-1 text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{BCG_APPLICATION.role}</div><div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{BCG_APPLICATION.company}</div></div><span className="text-lg" style={{ color: 'var(--color-steel)' }}>→</span></button>}
            <KanbanBoard<Application>
              keyFor={(a) => a.id}
              lanes={LANES.map((lane): KanbanLane<Application> => ({ key: lane.key, label: lane.label, items: applications.filter((a) => lane.stages.includes(a.stage)) }))}
              renderCard={(app) => <ApplicationCard app={app} />}
            />
          </div>
        )}

        {view === 'list' && (
          <div>
          {showsBcgApplication && <button onClick={openBcgApplication} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)' }}><FlagIcon color="green" kind="ai_inference" matched={[...BCG_APPLICATION.fit.strengths]} unmatched={[...BCG_APPLICATION.fit.concerns]} disabled /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{BCG_APPLICATION.role}</div><div className="truncate text-xs" style={{ color: 'var(--color-warm-gray)' }}>{BCG_APPLICATION.company} · {BCG_APPLICATION.location}</div></div><span className="hidden text-xs sm:block" style={{ color: 'var(--color-navy-mid)' }}>{BCG_APPLICATION.artifacts.length} artifacts</span><span className="hidden w-40 shrink-0 text-right text-xs font-medium md:block" style={{ color: '#8A5A00' }}>{BCG_APPLICATION.stage}</span></button>}
          <ListView
            items={scored}
            keyFor={({ job }) => job.id}
            renderRow={({ job, fit }) => {
              const app = applicationForJob(job.id);
              return (
                <>
                  {lists.length > 0 && (
                    <button
                      title={!activeList ? 'Pick a list first to add jobs to it' : activeList.memberIds.includes(job.id) ? 'Remove from this list' : 'Add to this list'}
                      disabled={!activeList}
                      onClick={(e) => { e.stopPropagation(); if (activeList) toggleMember(SCOPE, activeList.id, job.id); }}
                      className="w-4 h-4 shrink-0 rounded border flex items-center justify-center disabled:opacity-30"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: activeList?.memberIds.includes(job.id) ? 'var(--color-steel)' : 'white' }}
                    >
                      {activeList?.memberIds.includes(job.id) && <Check className="w-3 h-3 text-white" />}
                    </button>
                  )}
                  <FlagIcon color={fit.flag} kind="ai_inference" matched={fit.matched} unmatched={fit.unmatched} onClick={app ? undefined : (c) => onFlagAction(job.id, c)} disabled={!!app} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-navy)' }}>{job.title}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--color-warm-gray)' }}>{job.company} · {job.location}</div>
                  </div>
                  {activeList?.origin?.[job.id] && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border shrink-0" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>{activeList.origin[job.id]}</span>
                  )}
                  <span className="text-xs shrink-0" style={{ color: 'var(--color-navy-mid)' }}>to ${job.salaryMax.toLocaleString()}</span>
                  <span className="text-xs font-medium w-40 shrink-0 text-right" style={{ color: app ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}>{app ? STAGE_LABEL[app.stage] : 'Not queued'}</span>
                </>
              );
            }}
          />
          </div>
        )}
      </div>
    </div>
  );
}

function ApplicationCard({ app }: { app: Application }) {
  const [outcome, setOutcome] = useState<ApplyOutcome>('APPLIED');
  return (
    <div className="rounded-lg border bg-white p-2.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>
      <div className="font-semibold truncate" style={{ color: 'var(--color-navy)' }}>{app.title}</div>
      <div className="truncate mb-1.5" style={{ color: 'var(--color-warm-gray)' }}>{app.company}</div>
      {app.stage === 'awaiting_review' && (
        <div className="flex gap-1">
          <button onClick={() => approveReview(app.id, 'approve')} className="flex-1 rounded px-1.5 py-1 text-white font-semibold" style={{ backgroundColor: 'var(--success)' }}>Approve</button>
          <button onClick={() => approveReview(app.id, 'reject')} className="flex-1 rounded px-1.5 py-1 font-semibold border" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Reject</button>
        </div>
      )}
      {app.stage === 'applying' && (
        <div className="flex gap-1">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as ApplyOutcome)} className="flex-1 border rounded px-1 py-1" style={{ borderColor: 'var(--color-border)' }}>
            {(['APPLIED', 'FAILED', 'CAPTCHA', 'LOGIN_ISSUE', 'EXPIRED'] as ApplyOutcome[]).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={() => runDispatch(app.id, outcome)} className="rounded px-2 py-1 text-white font-semibold" style={{ backgroundColor: 'var(--color-steel)' }}>Run</button>
        </div>
      )}
      {app.stage === 'parked' && <button onClick={() => resumeParked(app.id)} className="w-full rounded px-1.5 py-1 text-white font-semibold" style={{ backgroundColor: 'var(--color-steel)' }}>Resolve &amp; resume</button>}
      {app.stage === 'submitted' && <button onClick={() => confirmSubmitted(app.id)} className="w-full rounded px-1.5 py-1 font-semibold border" style={{ color: 'var(--color-steel)', borderColor: 'var(--color-steel)' }}>Simulate reply → confirmed</button>}
      {app.tier ? <div className="mt-1 text-[10px]" style={{ color: 'var(--color-warm-gray)' }}>Tier {app.tier}{app.unresolved?.length ? ` · unresolved: ${app.unresolved.join(', ')}` : ''}</div> : null}
    </div>
  );
}

export default JobPilotPage;
