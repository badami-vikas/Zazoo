import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar, Target, Flag, Ban, FileText, FileSpreadsheet, Plus, Trash2, Check, Upload, LayoutList, BarChart3, Repeat, Table as TableIcon, Edit2, MoreVertical, SlidersHorizontal } from 'lucide-react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { useInitiatives, updateInitiative } from '../data/initiatives';
import { Breadcrumb } from '../components/Breadcrumb';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';

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
interface Doc { name: string; type: string; size: string }
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
  { slug: 'knowledge', label: 'Knowledge Base' },
] as const;

const TOUCHPOINT_VIEWS = [
  { id: 'list', icon: LayoutList, label: 'List' },
  { id: 'table', icon: TableIcon, label: 'Table' },
  { id: 'gantt', icon: BarChart3, label: 'Gantt' },
  { id: 'calendar', icon: Calendar, label: 'Calendar' },
] as const;

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
  const [docs, setDocs] = useState<Doc[]>(() => load(`bridge.initiative.${iid}.docs`, []));

  const persistOverview = (o: Overview) => { setOverview(o); save(`bridge.initiative.${iid}.overview`, o); };
  const persistTouchpoints = (t: Touchpoint[]) => { setTouchpoints(t); save(`bridge.initiative.${iid}.tasks`, t); };
  const persistDocs = (d: Doc[]) => { setDocs(d); save(`bridge.initiative.${iid}.docs`, d); };

  const pageParam = searchParams.get('page');
  const activeTab = INITIATIVE_PAGES.find((page) => page.slug === pageParam)?.label ?? INITIATIVE_PAGES[0].label;
  const viewParam = searchParams.get('view');
  const touchpointsView = TOUCHPOINT_VIEWS.find((view) => view.id === viewParam)?.id ?? TOUCHPOINT_VIEWS[0].id;
  function selectPage(page: (typeof INITIATIVE_PAGES)[number]) {
    const next = new URLSearchParams(searchParams);
    next.set('page', page.slug);
    if (page.slug !== 'touchpoints') next.delete('view');
    setSearchParams(next);
  }
  function selectTouchpointsView(view: (typeof TOUCHPOINT_VIEWS)[number]['id']) {
    const next = new URLSearchParams(searchParams);
    next.set('page', 'touchpoints');
    next.set('view', view);
    setSearchParams(next);
  }

  // ── Touchpoint tree ops (flat model with parentId → arbitrary depth) ──────────────────────────
  const nid = () => `t-${++counter.current}-${touchpoints.length}`;
  const addTouchpoint = (parentId: string | null) => persistTouchpoints([...touchpoints, { id: nid(), name: 'New touchpoint', done: false, parentId, collapsed: false }]);
  const renameTouchpoint = (tid: string, v: string) => persistTouchpoints(touchpoints.map(t => t.id === tid ? { ...t, name: v } : t));
  const toggleDone = (tid: string) => persistTouchpoints(touchpoints.map(t => t.id === tid ? { ...t, done: !t.done } : t));
  const toggleCollapse = (tid: string) => persistTouchpoints(touchpoints.map(t => t.id === tid ? { ...t, collapsed: !t.collapsed } : t));
  const deleteTouchpoint = (tid: string) => {
    const drop = new Set<string>([tid]);
    let changed = true;
    while (changed) { changed = false; for (const t of touchpoints) { if (t.parentId && drop.has(t.parentId) && !drop.has(t.id)) { drop.add(t.id); changed = true; } } }
    persistTouchpoints(touchpoints.filter(t => !drop.has(t.id)));
  };
  const childrenOf = (pid: string | null) => touchpoints.filter(t => t.parentId === pid);
  const progress = (() => { const total = touchpoints.length; const done = touchpoints.filter(t => t.done).length; return total ? Math.round((done / total) * 100) : 0; })();

  const TouchpointRow = ({ tp, depth }: { tp: Touchpoint; depth: number }): ReactNode => {
    const kids = childrenOf(tp.id);
    return (
      <div>
        <div className="group flex items-center gap-2 py-1.5 pr-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors" style={{ paddingLeft: 8 + depth * 22 }}>
          {kids.length > 0 ? (
            <button onClick={() => toggleCollapse(tp.id)} className="p-0.5 rounded hover:bg-[var(--color-border)]/50" title={tp.collapsed ? 'Expand' : 'Collapse'}>
              {tp.collapsed ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />}
            </button>
          ) : <span className="w-[18px]" />}
          <button onClick={() => toggleDone(tp.id)} className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all active:scale-90" style={{ borderColor: tp.done ? 'var(--color-steel)' : 'var(--color-border)', backgroundColor: tp.done ? 'var(--color-steel)' : 'white' }} title={tp.done ? 'Mark not done' : 'Mark done'}>
            {tp.done && <Check className="w-3 h-3 text-white" />}
          </button>
          <Editable text={tp.name} onSave={v => renameTouchpoint(tp.id, v || 'Untitled')} className={clsx('flex-1 text-sm', tp.done && 'line-through opacity-60')} />
          <button onClick={() => addTouchpoint(tp.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--color-steel)] transition-all" title="Add sub-touchpoint"><Plus className="w-3.5 h-3.5" /></button>
          <button onClick={() => deleteTouchpoint(tp.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-warm-gray)] hover:text-[var(--danger)] transition-all" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        {!tp.collapsed && kids.map(k => <TouchpointRow key={k.id} tp={k} depth={depth + 1} />)}
      </div>
    );
  };

  const onUpload = (list: FileList | null) => {
    if (!list || !list.length) return;
    const next = Array.from(list).map(f => ({ name: f.name, type: (f.name.split('.').pop() || 'file').toUpperCase(), size: `${Math.max(1, Math.round(f.size / 1024))} KB` }));
    persistDocs([...next, ...docs]);
  };

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
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  {TOUCHPOINT_VIEWS.map(view => (
                    <button key={view.id} onClick={() => selectTouchpointsView(view.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all" style={{ backgroundColor: touchpointsView === view.id ? 'var(--color-steel)' : 'var(--color-surface)', color: touchpointsView === view.id ? 'white' : 'var(--color-navy-mid)' }}>
                      <view.icon className="w-4 h-4" /> {view.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {/* Rituals are GLOBAL — this opens the single ritual factory (same screen as Tools→Rituals). */}
                  <button onClick={() => navigate(`/rituals?initiative=${encodeURIComponent(iid)}`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }} title="Attach or create a Workflow (automation) for this initiative"><Repeat className="w-4 h-4" /> Add Workflow</button>
                  <button onClick={() => addTouchpoint(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-4 h-4" /> Add Touchpoint</button>
                </div>
              </div>

              {touchpointsView === 'list' && (
                <div className="border rounded-xl p-2 bg-white" style={{ borderColor: 'var(--color-border)' }}>
                  {touchpoints.length === 0 ? (
                    <div className="py-12 text-center">
                      <p className="text-sm mb-3" style={{ color: 'var(--color-warm-gray)' }}>No touchpoints yet. Touchpoints nest into sub-touchpoints, to any depth.</p>
                      <button onClick={() => addTouchpoint(null)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-4 h-4" /> Add the first Touchpoint</button>
                    </div>
                  ) : childrenOf(null).map(t => <TouchpointRow key={t.id} tp={t} depth={0} />)}
                </div>
              )}

              {touchpointsView === 'table' && (
                <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: 'var(--color-border)' }}>
                  <table className="w-full text-sm border-collapse">
                    <thead><tr style={{ backgroundColor: 'var(--color-surface)' }}>{['Touchpoint', 'Depth', 'Done'].map(c => <th key={c} className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: 'var(--color-warm-gray)', borderColor: 'var(--color-border)' }}>{c}</th>)}</tr></thead>
                    <tbody>
                      {touchpoints.map(t => { let d = 0, p = t.parentId; while (p) { d++; p = touchpoints.find(x => x.id === p)?.parentId || null; } return (
                        <tr key={t.id} className="hover:bg-[var(--color-surface)]/50"><td className="px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', paddingLeft: 16 + d * 16, color: 'var(--color-navy)' }}>{t.name}</td><td className="px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{d === 0 ? 'Root' : `L${d}`}</td><td className="px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>{t.done ? '✓' : '—'}</td></tr>
                      ); })}
                      {touchpoints.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center" style={{ color: 'var(--color-warm-gray)' }}>No touchpoints yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              {(touchpointsView === 'gantt' || touchpointsView === 'calendar') && (
                <div className="border rounded-xl p-12 text-center bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>{TOUCHPOINT_VIEWS.find(v => v.id === touchpointsView)?.label} view coming soon — List is the standard cascaded-touchpoint view.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'Knowledge Base' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-editorial)', color: 'var(--color-navy)' }}>Documents &amp; data</h3>
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white cursor-pointer shadow-sm active:scale-95 transition-transform" style={{ backgroundColor: 'var(--color-steel)' }} title="Upload documents (stored locally in this prototype)">
                  <Upload className="w-4 h-4" /> Add document
                  <input type="file" multiple className="hidden" onChange={e => { onUpload(e.target.files); e.currentTarget.value = ''; }} />
                </label>
              </div>
              {docs.length === 0 ? (
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-14 cursor-pointer hover:border-[var(--color-steel)]/50 transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
                  <Upload className="w-7 h-7" /><span className="text-sm font-medium">Drop or upload documents to this initiative's knowledge base</span>
                  <input type="file" multiple className="hidden" onChange={e => { onUpload(e.target.files); e.currentTarget.value = ''; }} />
                </label>
              ) : (
                <div className="grid gap-3">
                  {docs.map((doc, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="group border rounded-xl p-4 flex items-center gap-4 bg-white hover:shadow-md transition-all" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-surface)' }}>{/xls/i.test(doc.type) ? <FileSpreadsheet className="w-5 h-5" style={{ color: 'var(--color-steel)' }} /> : <FileText className="w-5 h-5" style={{ color: 'var(--color-steel)' }} />}</div>
                      <div className="flex-1 min-w-0"><h4 className="font-medium text-sm truncate" style={{ color: 'var(--color-navy)' }}>{doc.name}</h4><p className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{doc.type} · {doc.size}</p></div>
                      <button onClick={() => persistDocs(docs.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-[var(--danger)]/10 transition-all" title="Remove"><Trash2 className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
