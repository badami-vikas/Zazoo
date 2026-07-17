import { useEffect, useMemo, useState } from 'react';
import {
  Archive, ArrowDown, ArrowUp, Check, FileText, GripVertical, ListChecks,
  MoreVertical, Pencil, Plus, RotateCcw, Save, Trash2, X,
} from 'lucide-react';
import { Header } from '../components/shared/Header';
import { StandardToolbar } from '../components/shared/StandardToolbar';
import { CollapsibleInsights } from '../components/shared/CollapsibleInsights';
import {
  PENDING_WORK_GENERATED_AT,
  PENDING_WORK_SOURCE,
  addManualPendingWorkItem,
  applyPendingWorkEdits,
  archivePendingWorkItem,
  movePendingWorkItem,
  persistPendingWorkEdits,
  updatePendingWorkItem,
  usePendingWorkEdits,
  type PendingWorkItem,
  type PendingWorkSource,
} from '../data/pending-work';
import {
  persistTaskManagerState, reconcileTaskSchedules, updateColumnPreference, useTaskManagerState,
} from '../data/task-manager';

const SOURCE_META: Record<PendingWorkSource, { label: string; className: string }> = {
  task: { label: 'Canonical task', className: 'bg-emerald-50 text-emerald-700' },
  roadmap: { label: 'Roadmap', className: 'bg-blue-50 text-blue-700' },
  bug: { label: 'Bug', className: 'bg-red-50 text-red-700' },
  request: { label: 'Request', className: 'bg-violet-50 text-violet-700' },
  approval: { label: 'Approval', className: 'bg-amber-50 text-amber-700' },
  manual: { label: 'Added here', className: 'bg-slate-100 text-slate-700' },
};

export function PendingWorkPage({ taskView = false }: { taskView?: boolean }) {
  const edits = usePendingWorkEdits();
  const taskState = useTaskManagerState();
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<PendingWorkSource | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [lastArchived, setLastArchived] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string; cellId: string } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startWidth: number } | null>(null);

  const allItems = useMemo(() => applyPendingWorkEdits(PENDING_WORK_SOURCE, edits, true), [edits]);
  const schedules = taskState.schedules ?? {};
  const columnPrefs = taskState.columns ?? {};
  useEffect(() => {
    if (!taskView) return;
    const next = reconcileTaskSchedules(allItems.filter((item) => !item.archived), schedules, new Date(), 12);
    if (next !== schedules) persistTaskManagerState({ ...taskState, schedules: next });
  }, [taskView, allItems, schedules, taskState]);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: MouseEvent) => {
      const width = Math.max(120, resizing.startWidth + event.clientX - resizing.startX);
      persistTaskManagerState({ ...taskState, columns: updateColumnPreference(columnPrefs, resizing.id, { width }) });
    };
    const onUp = () => setResizing(null);
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing, taskState, columnPrefs]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (!showArchived && item.archived) return false;
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false;
      if (!needle) return true;
      return `${item.title} ${item.sourceFile} ${SOURCE_META[item.sourceType].label}`.toLowerCase().includes(needle);
    });
  }, [allItems, search, showArchived, sourceFilter]);

  const columns: Array<{ id: string; label: string; width: number }> = taskView
    ? [
      { id: 'rank', label: 'Rank', width: 72 }, { id: 'task', label: 'Task', width: 360 },
      { id: 'status', label: 'Status', width: 105 }, { id: 'priority', label: 'Priority', width: 82 },
      { id: 'horizon', label: 'Horizon', width: 130 }, { id: 'source', label: 'Source', width: 120 }, { id: 'record', label: 'Record', width: 180 },
      { id: 'scheduled', label: 'Scheduled', width: 145 }, { id: 'actions', label: 'Actions', width: 112 },
    ]
    : [
      { id: 'rank', label: 'Rank', width: 64 }, { id: 'task', label: 'Task', width: 360 },
      { id: 'source', label: 'Source', width: 110 }, { id: 'record', label: 'Record', width: 180 },
      { id: 'actions', label: 'Actions', width: 140 },
    ];
  const visibleColumns = columns.filter((column) => !columnPrefs[column.id]?.hidden);

  const activeCount = allItems.filter((item) => !item.archived).length;
  const archivedCount = allItems.length - activeCount;

  function persist(next: typeof edits) { persistPendingWorkEdits(next); }
  function beginEdit(item: PendingWorkItem) { setEditingId(item.id); setDraftTitle(item.title); }
  function saveEdit(id: string) {
    const title = draftTitle.trim();
    if (title) persist(updatePendingWorkItem(edits, id, { title }));
    setEditingId(null);
  }
  function archive(id: string) {
    persist(archivePendingWorkItem(edits, id, true));
    setLastArchived(id);
  }
  function undoArchive() {
    if (lastArchived) persist(archivePendingWorkItem(edits, lastArchived, false));
    setLastArchived(null);
  }
  function move(id: string, direction: -1 | 1) {
    const index = allItems.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (direction < 0 && index > 0) persist(movePendingWorkItem(edits, allItems, id, allItems[index - 1].id));
    if (direction > 0 && index < allItems.length - 1) persist(movePendingWorkItem(edits, allItems, id, allItems[index + 2]?.id ?? null));
  }
  function createTask() {
    if (!newTitle.trim()) return;
    persist(addManualPendingWorkItem(edits, newTitle));
    setNewTitle(''); setAdding(false);
  }
  function setScheduledDate(id: string, scheduledDate: string) {
    persistTaskManagerState({ ...taskState, schedules: { ...schedules, [id]: scheduledDate } });
  }
  function hideColumn(id: string) {
    persistTaskManagerState({ ...taskState, columns: updateColumnPreference(columnPrefs, id, { hidden: true }) });
    setContextMenu(null);
  }
  function showAllColumns() {
    const next = Object.fromEntries(Object.entries(columnPrefs).map(([id, pref]) => [id, { ...pref, hidden: false }]));
    persistTaskManagerState({ ...taskState, columns: next });
  }
  function openContextMenu(event: React.MouseEvent, itemId: string, cellId: string) {
    event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, itemId, cellId });
  }
  function startColumnResize(event: React.MouseEvent, column: { id: string; width: number }) {
    event.preventDefault(); event.stopPropagation();
    setResizing({ id: column.id, startX: event.clientX, startWidth: columnPrefs[column.id]?.width ?? column.width });
  }
  function sortRows(direction: 'asc' | 'desc') {
    if (!contextMenu) return;
    const values = [...allItems].sort((a, b) => {
      const value = (item: typeof a) => contextMenu.cellId === 'source' ? SOURCE_META[item.sourceType].label : contextMenu.cellId === 'scheduled' ? (schedules[item.id] ?? '') : item.title;
      return value(a).localeCompare(value(b)) * (direction === 'asc' ? 1 : -1);
    });
    persist({ ...edits, order: values.map((item) => item.id) }); setContextMenu(null);
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-white" onClick={() => contextMenu && setContextMenu(null)}>
      <Header tabs={[{ id: 'pending-work', label: taskView ? 'Task Manager' : 'Pending work', icon: ListChecks }]} activeTab="pending-work" onTabChange={() => {}} />
      <StandardToolbar
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen((o) => !o)}
        view="ranked" views={[{ id: 'ranked', label: 'Ranked list', icon: ListChecks }]}
        onViewChange={() => {}} search={search} onSearchChange={setSearch}
        onFilterClick={() => setFilterOpen((open) => !open)}
        filterCount={(sourceFilter === 'all' ? 0 : 1) + (showArchived ? 1 : 0)}
        filterOpen={filterOpen}
        filterPanel={(
          <div className="absolute top-full right-0 mt-1 w-64 rounded-xl border bg-white p-3 shadow-xl z-50" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Source</div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'task', 'manual'] as const).map((source) => (
                <button key={source} onClick={() => setSourceFilter(source)} className={`px-2 py-1 rounded-md text-xs border ${sourceFilter === source ? 'border-[var(--color-steel)] text-[var(--color-steel)] bg-blue-50' : 'border-border text-muted-foreground'}`}>
                  {source === 'all' ? 'All' : SOURCE_META[source].label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-3 text-sm text-[var(--color-navy-mid)] cursor-pointer">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              Show archived ({archivedCount})
            </label>
          </div>
        )}
        customActions={(
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: 'var(--color-steel)' }}>
            <Plus className="w-4 h-4" /> Add task
          </button>
        )}
        moreMenu={(
          <>
            <button onClick={() => { setSearch(''); setSourceFilter('all'); setShowArchived(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">Clear view filters</button>
            {taskView && <button onClick={showAllColumns} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">Show all columns</button>}
          </>
        )}
      />

      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: 'active', label: 'Active', value: String(activeCount) },
          { id: 'canonical', label: 'Canonical tasks', value: String(allItems.filter((item) => item.sourceType === 'task' && !item.archived).length) },
          { id: 'archived', label: 'Archived', value: String(archivedCount), hint: taskView ? 'Planning window: today + 11 days' : `Scanned ${new Date(PENDING_WORK_GENERATED_AT).toLocaleDateString()}` },
        ]}
      />

      {adding && (
        <div className="px-5 py-3 border-b flex items-center gap-2 bg-blue-50/40" style={{ borderColor: 'var(--color-border)' }}>
          <input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createTask(); if (event.key === 'Escape') setAdding(false); }} placeholder="Describe the pending work…" className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm outline-none focus:ring-2 focus:ring-blue-200" />
          <button onClick={createTask} className="p-2 rounded-lg text-white" style={{ backgroundColor: 'var(--color-steel)' }} title="Save task"><Check className="w-4 h-4" /></button>
          <button onClick={() => setAdding(false)} className="p-2 rounded-lg border bg-white" title="Cancel"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-white border-b" style={{ borderColor: 'var(--color-border)' }}>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {visibleColumns.map((column) => <th key={column.id} style={{ width: columnPrefs[column.id]?.width ?? column.width }} className="relative px-3 py-2.5 first:pl-4 text-left">
                {column.label}
                {column.id !== 'actions' && <span onMouseDown={(event) => startColumnResize(event, column)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--color-steel-light)]" title="Resize column" />}
              </th>)}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const rank = allItems.findIndex((candidate) => candidate.id === item.id) + 1;
              const source = SOURCE_META[item.sourceType];
              return (
                <tr key={item.id} draggable={!editingId} onDragStart={() => { setDraggingId(item.id); }} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingId && draggingId !== item.id) persist(movePendingWorkItem(edits, allItems, draggingId, item.id)); setDraggingId(null); }} className={`border-b group ${draggingId === item.id ? 'opacity-40' : ''} ${item.archived ? 'opacity-55' : 'hover:bg-slate-50/70'}`} style={{ borderColor: 'var(--color-border)' }}>
                  {visibleColumns.some((column) => column.id === 'rank') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'rank')} className="px-4 py-3"><div className="flex items-center gap-2 text-muted-foreground"><GripVertical className="w-4 h-4 cursor-grab" /><span className="tabular-nums font-medium">{rank}</span></div></td>}
                  {visibleColumns.some((column) => column.id === 'task') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'task')} onDoubleClick={() => beginEdit(item)} className="px-3 py-3">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(item.id); if (event.key === 'Escape') setEditingId(null); }} className="w-full px-2.5 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-blue-200" />
                        <button onClick={() => saveEdit(item.id)} className="p-1.5 rounded-md hover:bg-blue-50" title="Save"><Save className="w-4 h-4" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 rounded-md hover:bg-slate-100" title="Cancel"><X className="w-4 h-4" /></button>
                      </div>
                    ) : <div className={`font-medium leading-5 break-words text-[var(--color-navy)] ${item.archived ? 'line-through' : ''}`}>{item.title}{item.edited && <span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">edited</span>}</div>}
                  </td>}
                  {visibleColumns.some((column) => column.id === 'status') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'status')} className="px-3 py-3"><span className="text-xs font-medium capitalize text-[var(--color-navy-mid)]">{(item.canonicalStatus === 'done' ? 'completed' : item.canonicalStatus ?? item.status).replace('_', ' ')}</span></td>}
                  {visibleColumns.some((column) => column.id === 'priority') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'priority')} className="px-3 py-3"><span className="text-xs font-semibold text-[var(--color-steel)]">{item.priority ?? '—'}</span></td>}
                  {visibleColumns.some((column) => column.id === 'horizon') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'horizon')} className="px-3 py-3"><span className="text-xs text-muted-foreground">{item.horizon ?? '—'}</span></td>}
                  {visibleColumns.some((column) => column.id === 'source') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'source')} className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${source.className}`}>{source.label}</span></td>}
                  {visibleColumns.some((column) => column.id === 'record') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'record')} className="px-3 py-3"><button onClick={() => navigator.clipboard?.writeText(item.sourceLine ? `${item.sourceFile}:${item.sourceLine}` : item.sourceFile)} className="flex items-center gap-1.5 max-w-full text-xs text-muted-foreground hover:text-[var(--color-steel)]" title="Copy source reference"><FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{item.sourceLine ? `${item.sourceFile}:${item.sourceLine}` : item.sourceFile}</span></button></td>}
                  {taskView && visibleColumns.some((column) => column.id === 'scheduled') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'scheduled')} className="px-3 py-3"><input type="date" value={schedules[item.id] ?? ''} onChange={(event) => setScheduledDate(item.id, event.target.value)} className="border-0 bg-transparent text-xs text-muted-foreground outline-none" /></td>}
                  {visibleColumns.some((column) => column.id === 'actions') && <td onContextMenu={(event) => openContextMenu(event, item.id, 'actions')} className="px-3 py-3"><div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100">
                    <button onClick={() => move(item.id, -1)} disabled={rank === 1} className="p-1.5 rounded-md hover:bg-white disabled:opacity-20" title="Move up"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => move(item.id, 1)} disabled={rank === allItems.length} className="p-1.5 rounded-md hover:bg-white disabled:opacity-20" title="Move down"><ArrowDown className="w-4 h-4" /></button>
                    {!taskView && <><button onClick={() => beginEdit(item)} className="p-1.5 rounded-md hover:bg-white" title="Edit"><Pencil className="w-4 h-4" /></button>
                    {item.archived ? <button onClick={() => persist(archivePendingWorkItem(edits, item.id, false))} className="p-1.5 rounded-md hover:bg-white" title="Restore"><RotateCcw className="w-4 h-4" /></button> : <button onClick={() => archive(item.id)} className="p-1.5 rounded-md hover:bg-red-50 hover:text-red-600" title="Archive task"><Trash2 className="w-4 h-4" /></button>}</>}
                    {taskView && <button onClick={(event) => openContextMenu(event, item.id, 'actions')} className="p-1.5 rounded-md hover:bg-white" title="Row options"><MoreVertical className="w-4 h-4" /></button>}
                  </div></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleItems.length === 0 && <div className="h-52 flex flex-col items-center justify-center text-muted-foreground"><Archive className="w-8 h-8 mb-2 opacity-50" /><p className="font-medium">No matching pending work</p><button onClick={() => { setSearch(''); setSourceFilter('all'); }} className="text-sm mt-1 text-[var(--color-steel)]">Clear filters</button></div>}
      </div>

      {lastArchived && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-navy)] text-white rounded-xl shadow-xl px-4 py-3 flex items-center gap-4 text-sm">
          Task archived. Its source record was kept.
          <button onClick={undoArchive} className="font-semibold underline underline-offset-2">Undo</button>
          <button onClick={() => setLastArchived(null)} title="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}
      {taskView && contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onContextMenu={(event) => { event.preventDefault(); setContextMenu(null); }} />
          <div onClick={(event) => event.stopPropagation()} className="fixed z-50 w-52 rounded-xl border bg-white py-1 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y, borderColor: 'var(--color-border)' }}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{contextMenu.cellId === 'task' ? 'Task' : 'Cell'} options</div>
            {contextMenu.cellId === 'task' && <button onClick={() => { const item = allItems.find((candidate) => candidate.id === contextMenu.itemId); if (item) beginEdit(item); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Edit task</button>}
            {contextMenu.cellId !== 'actions' && <button onClick={() => { if (contextMenu.cellId === 'scheduled') setScheduledDate(contextMenu.itemId, ''); else if (contextMenu.cellId === 'task') persist(updatePendingWorkItem(edits, contextMenu.itemId, { title: '' })); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Delete cell</button>}
            <button onClick={() => { archive(contextMenu.itemId); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">Delete row</button>
            <button onClick={() => { archive(contextMenu.itemId); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Hide row</button>
            <div className="my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
            <button onClick={() => { const item = allItems.find((candidate) => candidate.id === contextMenu.itemId); if (item) persist(addManualPendingWorkItem(edits, item.title)); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Duplicate row</button>
            <button onClick={() => sortRows('asc')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Sort ascending</button>
            <button onClick={() => sortRows('desc')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Sort descending</button>
            <button onClick={() => hideColumn(contextMenu.cellId)} disabled={contextMenu.cellId === 'actions'} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40">Hide column</button>
            <button onClick={() => { setSearch(''); setSourceFilter('all'); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Clear filters</button>
          </div>
        </>
      )}
    </div>
  );
}
