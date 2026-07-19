import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Target, Flag, Ban, Plus, Trash2, Edit2, MoreVertical, SlidersHorizontal } from 'lucide-react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { normalizeViewKind, type TableSpec, type ViewConfig } from '@bridge/tables';
import { useInitiatives, updateInitiative } from '../data/initiatives';
import { Breadcrumb } from '../components/Breadcrumb';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { ModuleFilesSection } from '../components/shared/ModuleFilesSection';
import { DataViews } from '../dataviews/DataViews';
import { computeEligibleKinds, viewConfigForKind } from '../dataviews/eligibility';
import type { DataRow } from '../dataviews/types';

// Small inline-editable text (click to edit, Enter/blur to save).
function Editable({ text, onSave, multiline = false, className, placeholder }: { text: string; onSave: (v: string) => void; multiline?: boolean; className?: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(text);
  useEffect(() => setVal(text), [text]);
  if (editing) {
    const save = () => { onSave(val.trim()); setEditing(false); };
    return multiline
      ? <textarea autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} rows={3} className={clsx('w-full bg-white border border-[var(--color-steel)] rounded-md p-2 outline-none resize-none shadow-sm', className)} />
      : <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} className={clsx('bg-white border border-[var(--color-steel)] rounded-md px-2 py-1 outline-none shadow-sm max-w-full', className)} />;
  }
  return (
    <span className="group/edit inline-flex items-start gap-1 cursor-text" onClick={() => setEditing(true)}>
      <span className={clsx(!text && 'text-[var(--color-warm-gray)]', className)}>{text || placeholder || 'Add…'}</span>
      <Edit2 className="w-3 h-3 mt-1 opacity-0 group-hover/edit:opacity-60 transition-opacity shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
    </span>
  );
}

// Vocabulary: a Touchpoint is the work node (the to-do/task unit). It nests to any depth.
interface Touchpoint { id: string; name: string; done: boolean; parentId: string | null; collapsed?: boolean }
interface Overview { brief: string; objectives: string[]; boundaries: string[]; metrics: { label: string; value: string }[] }

function load<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key: string, v: any) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

const DEFAULT_OVERVIEW: Overview = {
  brief: '',
  objectives: [],
  boundaries: [],
  metrics: [
    { label: 'Start date', value: '—' },
    { label: 'Target completion', value: '—' },
    { label: 'Owner', value: 'You' },
    { label: 'Status', value: 'Planning' },
  ],
};

const INITIATIVE_PAGES = [
  { slug: 'overview', label: 'Overview' },
  { slug: 'touchpoints', label: 'Touchpoints' },
  { slug: 'files', label: 'Files' },
] as const;

const TOUCHPOINT_SPEC: TableSpec = {
  id: 'initiative-touchpoints',
  columns: [
    { id: 'name', label: 'Touchpoint', kind: 'text', required: true, editable: true },
    { id: 'done', label: 'Done', kind: 'checkbox', editable: true, defaultValue: false },
    {
      id: 'parentId',
      label: 'Parent Touchpoint',
      kind: 'relation',
      relationTarget: 'initiative-touchpoints',
      relationParent: true,
      editable: false,
    },
  ],
};

export function InitiativeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const iid = id ? decodeURIComponent(id) : 'new';
  const initiatives = useInitiatives();
  const stored = initiatives.find(x => x.id === iid);

  const counter = useRef(0);

  const name = stored?.name || iid;
  const [overview, setOverview] = useState<Overview>(() => ({ ...DEFAULT_OVERVIEW, ...load(`bridge.initiative.${iid}.overview`, DEFAULT_OVERVIEW) }));
  // Storage key kept as `.tasks` to preserve any existing local data; the model is Touchpoints.
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>(() => load(`bridge.initiative.${iid}.tasks`, []));
  const requestedView = searchParams.get('view');
  const normalizedView = normalizeViewKind(requestedView);
  const initialTouchpointKind = normalizedView && computeEligibleKinds(TOUCHPOINT_SPEC).includes(normalizedView)
    ? normalizedView
    : 'tree';
  const [touchpointsView, setTouchpointsView] = useState<ViewConfig>(
    viewConfigForKind(TOUCHPOINT_SPEC, initialTouchpointKind, { id: `initiative-touchpoints:${iid}` }),
  );
  const [touchpointFormRecord, setTouchpointFormRecord] = useState<DataRow | null>(null);

  const persistOverview = (o: Overview) => { setOverview(o); save(`bridge.initiative.${iid}.overview`, o); };
  const persistTouchpoints = (t: Touchpoint[]) => { setTouchpoints(t); save(`bridge.initiative.${iid}.tasks`, t); };

  const pageParam = searchParams.get('page');
  const activeTab = INITIATIVE_PAGES.find((page) => page.slug === pageParam)?.label ?? INITIATIVE_PAGES[0].label;
  function selectPage(page: (typeof INITIATIVE_PAGES)[number]) {
    const next = new URLSearchParams(searchParams);
    next.set('page', page.slug);
    if (page.slug !== 'touchpoints') next.delete('view');
    setSearchParams(next);
  }
  function selectTouchpointsView(view: ViewConfig, preserveFormRecord = false) {
    setTouchpointsView(view);
    if (!preserveFormRecord) setTouchpointFormRecord(null);
    const next = new URLSearchParams(searchParams);
    next.set('page', 'touchpoints');
    next.set('view', view.kind);
    setSearchParams(next);
  }

  const nid = () => `t-${++counter.current}-${touchpoints.length}`;
  const progress = (() => { const total = touchpoints.length; const done = touchpoints.filter(t => t.done).length; return total ? Math.round((done / total) * 100) : 0; })();

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Header */}
      <div className="border-b px-6 py-4 bg-white" style={{ borderColor: 'var(--color-border)' }}>
        <Breadcrumb className="mb-3" segments={[{ label: 'Work', to: '/work' }, { label: name || 'Initiative' }]} />
        <div className="flex items-center gap-3 mb-4">
          <Link to="/work" className="p-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors" title="Back to Work"><ChevronLeft className="w-5 h-5" style={{ color: 'var(--color-navy-mid)' }} /></Link>
          <div className="flex-1 min-w-0">
            <Editable text={name} onSave={v => stored && updateInitiative(stored.id, { name: v || 'Untitled initiative' })} className="text-2xl font-bold" />
            <div className="flex items-center gap-3 mt-1 text-sm" style={{ color: 'var(--color-warm-gray)' }}>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-steel)' }} />{stored?.status || 'Planning'}</span>
              <span>·</span>
              <span>{progress}% complete · {touchpoints.filter(t => t.done).length}/{touchpoints.length} touchpoints</span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors" title="Page actions" aria-label="Page actions">
                <MoreVertical className="w-5 h-5" style={{ color: 'var(--color-warm-gray)' }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/initiative/${encodeURIComponent(iid)}/control-panel`}>
                  <SlidersHorizontal className="w-4 h-4" />
                  Control Panel
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 border-b -mb-4" style={{ borderColor: 'var(--color-border)' }}>
          {INITIATIVE_PAGES.map(page => (
            <button key={page.slug} onClick={() => selectPage(page)} className="pb-3 px-4 text-sm font-medium transition-colors relative" style={{ color: activeTab === page.label ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}>
              {page.label}
              {activeTab === page.label && <motion.div layoutId="initiativeTabIndicator" className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: 'var(--color-steel)', boxShadow: '0 0 8px rgb(from var(--color-steel) r g b / 0.3)' }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {activeTab === 'Overview' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Goal — what done looks like (front and center, from the initiative store) */}
              <div className="border rounded-xl p-6 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Flag className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
                  <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>Goal</h3>
                </div>
                <Editable multiline text={stored?.goal || ''} placeholder="What does done look like? Click to write…" onSave={v => stored && updateInitiative(stored.id, { goal: v })} className="text-sm leading-relaxed block w-full" />
              </div>

              <div className="border rounded-xl p-6 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>Brief</h3>
                <Editable multiline text={overview.brief} placeholder="Context, background, the why. Click to write…" onSave={v => persistOverview({ ...overview, brief: v })} className="text-sm leading-relaxed block w-full" />
                <div className="flex items-center justify-between mt-6 mb-2">
                  <h4 className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>Objectives</h4>
                  <button onClick={() => persistOverview({ ...overview, objectives: [...overview.objectives, 'New objective'] })} className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-steel)' }}><Plus className="w-3.5 h-3.5" /> Add</button>
                </div>
                {overview.objectives.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>No objectives yet.</p> : (
                  <ul className="space-y-1.5">
                    {overview.objectives.map((obj, i) => (
                      <li key={i} className="group flex items-start gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}>
                        <Target className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
                        <Editable text={obj} onSave={v => persistOverview({ ...overview, objectives: overview.objectives.map((o, j) => j === i ? v : o) })} className="flex-1" />
                        <button onClick={() => persistOverview({ ...overview, objectives: overview.objectives.filter((_, j) => j !== i) })} className="opacity-0 group-hover:opacity-100 text-[var(--color-warm-gray)] hover:text-[var(--danger)] transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Boundaries — what this initiative explicitly will NOT do */}
              <div className="border rounded-xl p-6 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Ban className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} />
                    <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>Boundaries</h3>
                  </div>
                  <button onClick={() => persistOverview({ ...overview, boundaries: [...overview.boundaries, 'Out of scope: …'] })} className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-steel)' }}><Plus className="w-3.5 h-3.5" /> Add</button>
                </div>
                <p className="text-xs mb-2" style={{ color: 'var(--color-warm-gray)' }}>What this initiative will NOT do — keeps scope honest.</p>
                {overview.boundaries.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>No boundaries set.</p> : (
                  <ul className="space-y-1.5">
                    {overview.boundaries.map((b, i) => (
                      <li key={i} className="group flex items-start gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}>
                        <Ban className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
                        <Editable text={b} onSave={v => persistOverview({ ...overview, boundaries: overview.boundaries.map((o, j) => j === i ? v : o) })} className="flex-1" />
                        <button onClick={() => persistOverview({ ...overview, boundaries: overview.boundaries.filter((_, j) => j !== i) })} className="opacity-0 group-hover:opacity-100 text-[var(--color-warm-gray)] hover:text-[var(--danger)] transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Timeline & key data points */}
              <div className="border rounded-xl p-6 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>Timeline &amp; key data</h3>
                <div className="grid grid-cols-2 gap-4">
                  {overview.metrics.map((m, i) => (
                    <div key={i} className="flex flex-col">
                      <span className="text-xs font-medium mb-1" style={{ color: 'var(--color-warm-gray)' }}>{m.label}</span>
                      <Editable text={m.value} onSave={v => persistOverview({ ...overview, metrics: overview.metrics.map((x, j) => j === i ? { ...x, value: v } : x) })} className="text-base font-semibold" />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'Touchpoints' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <DataViews
                spec={TOUCHPOINT_SPEC}
                view={touchpointsView}
                data={touchpoints.map((touchpoint) => ({ ...touchpoint }))}
                onViewChange={selectTouchpointsView}
                formRecord={touchpointFormRecord}
                onInsert={async (draft) => {
                  const touchpointName = typeof draft['name'] === 'string' ? draft['name'].trim() : '';
                  if (!touchpointName) throw new Error('Touchpoint is required.');
                  persistTouchpoints([
                    ...touchpoints,
                    {
                      id: nid(),
                      name: touchpointName,
                      done: draft['done'] === true,
                      parentId: null,
                      collapsed: false,
                    },
                  ]);
                }}
                onUpdate={async (touchpointId, draft) => {
                  persistTouchpoints(touchpoints.map((touchpoint) => touchpoint.id === touchpointId
                    ? {
                        ...touchpoint,
                        ...(typeof draft['name'] === 'string' && draft['name'].trim()
                          ? { name: draft['name'].trim() }
                          : {}),
                        ...(typeof draft['done'] === 'boolean' ? { done: draft['done'] } : {}),
                      }
                    : touchpoint));
                }}
                onEditRecord={(row) => {
                  setTouchpointFormRecord(row);
                  selectTouchpointsView(
                    viewConfigForKind(TOUCHPOINT_SPEC, 'form', touchpointsView),
                    true,
                  );
                }}
              />
            </motion.div>
          )}

          {activeTab === 'Files' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <ModuleFilesSection moduleName={`initiative-${iid}`} />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
