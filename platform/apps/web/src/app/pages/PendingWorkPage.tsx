import { useMemo, useState } from 'react';
import {
  Archive, ArrowDown, ArrowUp, Check, FileText, GripVertical, ListChecks,
  Pencil, Plus, RotateCcw, Save, Trash2, X,
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

const SOURCE_META: Record<PendingWorkSource, { label: string; className: string }> = {
  task: { label: 'Canonical task', className: 'bg-emerald-50 text-emerald-700' },
  roadmap: { label: 'Roadmap', className: 'bg-blue-50 text-blue-700' },
  bug: { label: 'Bug', className: 'bg-red-50 text-red-700' },
  request: { label: 'Request', className: 'bg-violet-50 text-violet-700' },
  approval: { label: 'Approval', className: 'bg-amber-50 text-amber-700' },
  manual: { label: 'Added here', className: 'bg-slate-100 text-slate-700' },
};

export function PendingWorkPage() {
  const edits = usePendingWorkEdits();
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

  const allItems = useMemo(() => applyPendingWorkEdits(PENDING_WORK_SOURCE, edits, true), [edits]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (!showArchived && item.archived) return false;
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false;
      if (!needle) return true;
      return `${item.title} ${item.sourceFile} ${SOURCE_META[item.sourceType].label}`.toLowerCase().includes(needle);
    });
  }, [allItems, search, showArchived, sourceFilter]);

  const columns: Array<{ id: string; label: string; width: number }> = [
    { id: 'rank', label: 'Rank', width: 64 }, { id: 'task', label: 'Task', width: 360 },
    { id: 'source', label: 'Source', width: 110 }, { id: 'record', label: 'Record', width: 180 },
    { id: 'actions', label: 'Actions', width: 140 },
  ];

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
  return (
    <div className="h-full min-h-0 flex flex-col bg-white">
      <Header tabs={[{ id: 'pending-work', label: 'Pending work', icon: ListChecks }]} activeTab="pending-work" onTabChange={() => {}} />
      <StandardToolbar
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen((o) => !o)}
        search={search} onSearchChange={setSearch}
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
          <button onClick={() => { setSearch(''); setSourceFilter('all'); setShowArchived(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">Clear view filters</button>
        )}
      />

      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: 'active', label: 'Active', value: String(activeCount) },
          { id: 'canonical', label: 'Canonical tasks', value: String(allItems.filter((item) => item.sourceType === 'task' && !item.archived).length) },
          { id: 'archived', label: 'Archived', value: String(archivedCount), hint: `Scanned ${new Date(PENDING_WORK_GENERATED_AT).toLocaleDateString()}` },
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
              {columns.map((column) => <th key={column.id} style={{ width: column.width }} className="px-3 py-2.5 first:pl-4 text-left">
                {column.label}
              </th>)}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const rank = allItems.findIndex((candidate) => candidate.id === item.id) + 1;
              const source = SOURCE_META[item.sourceType];
              return (
                <tr key={item.id} draggable={!editingId} onDragStart={() => { setDraggingId(item.id); }} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingId && draggingId !== item.id) persist(movePendingWorkItem(edits, allItems, draggingId, item.id)); setDraggingId(null); }} className={`border-b group ${draggingId === item.id ? 'opacity-40' : ''} ${item.archived ? 'opacity-55' : 'hover:bg-slate-50/70'}`} style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3"><div className="flex items-center gap-2 text-muted-foreground"><GripVertical className="w-4 h-4 cursor-grab" /><span className="tabular-nums font-medium">{rank}</span></div></td>
                  <td onDoubleClick={() => beginEdit(item)} className="px-3 py-3">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(item.id); if (event.key === 'Escape') setEditingId(null); }} className="w-full px-2.5 py-1.5 border rounded-lg outline-none focus:ring-2 focus:ring-blue-200" />
                        <button onClick={() => saveEdit(item.id)} className="p-1.5 rounded-md hover:bg-blue-50" title="Save"><Save className="w-4 h-4" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 rounded-md hover:bg-slate-100" title="Cancel"><X className="w-4 h-4" /></button>
                      </div>
                    ) : <div className={`font-medium leading-5 break-words text-[var(--color-navy)] ${item.archived ? 'line-through' : ''}`}>{item.title}{item.edited && <span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">edited</span>}</div>}
                  </td>
                  <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${source.className}`}>{source.label}</span></td>
                  <td className="px-3 py-3"><button onClick={() => navigator.clipboard?.writeText(item.sourceLine ? `${item.sourceFile}:${item.sourceLine}` : item.sourceFile)} className="flex items-center gap-1.5 max-w-full text-xs text-muted-foreground hover:text-[var(--color-steel)]" title="Copy source reference"><FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{item.sourceLine ? `${item.sourceFile}:${item.sourceLine}` : item.sourceFile}</span></button></td>
                  <td className="px-3 py-3"><div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100">
                    <button onClick={() => move(item.id, -1)} disabled={rank === 1} className="p-1.5 rounded-md hover:bg-white disabled:opacity-20" title="Move up"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => move(item.id, 1)} disabled={rank === allItems.length} className="p-1.5 rounded-md hover:bg-white disabled:opacity-20" title="Move down"><ArrowDown className="w-4 h-4" /></button>
                    <button onClick={() => beginEdit(item)} className="p-1.5 rounded-md hover:bg-white" title="Edit"><Pencil className="w-4 h-4" /></button>
                    {item.archived ? <button onClick={() => persist(archivePendingWorkItem(edits, item.id, false))} className="p-1.5 rounded-md hover:bg-white" title="Restore"><RotateCcw className="w-4 h-4" /></button> : <button onClick={() => archive(item.id)} className="p-1.5 rounded-md hover:bg-red-50 hover:text-red-600" title="Archive task"><Trash2 className="w-4 h-4" /></button>}
                  </div></td>
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
    </div>
  );
}
