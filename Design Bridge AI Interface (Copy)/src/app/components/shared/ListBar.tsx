// Standardized Lists bar (Phase 2): pill row + user-creatable lists, each with an AI instruction
// shown right below it that the agent must follow, and multi-select merge. Sits under
// ToolPageHeader, above StandardToolbar, on every tool page — the same slot Helpdesk pioneered.
import { useState } from 'react';
import { Plus, ListIcon, Combine, Sparkles, Pencil, Check, X, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useLists, createList, deleteList, setListInstruction, mergeLists, type ToolList } from '../../data/lists';

export function ListBar({ scope, selected, onSelect, allLabel = 'All' }: { scope: string; selected: string | null; onSelect: (listId: string | null) => void; allLabel?: string }) {
  const lists = useLists(scope);
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState<string[]>([]);
  const [editingInstruction, setEditingInstruction] = useState(false);
  const [draftInstruction, setDraftInstruction] = useState('');

  const activeList = lists.find((l) => l.id === selected) ?? null;

  function toggleSelecting(listId: string) {
    setSelecting((prev) => (prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]));
  }

  function doMerge() {
    if (selecting.length < 2) return;
    const names = lists.filter((l) => selecting.includes(l.id)).map((l) => l.name).join(' + ');
    const merged = mergeLists(scope, selecting, names);
    setSelecting([]);
    onSelect(merged.id);
  }

  return (
    <div className="flex flex-col border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto scrollbar-hide" style={{ backgroundColor: 'white' }}>
        <Pill label={allLabel} active={selected === null} onClick={() => onSelect(null)} leadingIcon={<ListIcon className="w-3.5 h-3.5" />} />
        {lists.map((l) => (
          <div key={l.id} className="flex items-center gap-1">
            {selecting.length > 0 && (
              <input type="checkbox" className="accent-[var(--color-steel)]" checked={selecting.includes(l.id)} onChange={() => toggleSelecting(l.id)} />
            )}
            <Pill label={l.name} active={selected === l.id} onClick={() => (selecting.length > 0 ? toggleSelecting(l.id) : onSelect(l.id))} />
          </div>
        ))}
        {lists.length >= 2 && (
          <button
            onClick={() => (selecting.length > 0 ? doMerge() : setSelecting(lists.length ? [lists[0].id] : []))}
            disabled={selecting.length === 1}
            className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border disabled:opacity-40"
            style={{ color: 'var(--color-navy-mid)', borderColor: 'var(--color-border)' }}
            title={selecting.length > 0 ? 'Merge selected lists' : 'Select lists to merge'}
          >
            <Combine className="w-3 h-3" /> {selecting.length > 1 ? `Merge (${selecting.length})` : 'Merge'}
          </button>
        )}
        <button
          onClick={() => setCreating(true)}
          className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:bg-[var(--color-surface)] border border-dashed"
          style={{ color: 'var(--color-warm-gray)', borderColor: 'var(--color-border)' }}
        >
          <Plus className="w-3 h-3" /> Add list
        </button>
      </div>

      {activeList && (
        <div className="flex items-start gap-2 px-4 py-1.5 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 6%, white)' }}>
          <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
          {editingInstruction ? (
            <div className="flex-1 flex items-center gap-1.5">
              <input
                autoFocus
                value={draftInstruction}
                onChange={(e) => setDraftInstruction(e.target.value)}
                placeholder="Tell the AI how to treat this list…"
                className="flex-1 px-2 py-1 rounded border text-xs"
                style={{ borderColor: 'var(--color-border)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') { setListInstruction(scope, activeList.id, draftInstruction); setEditingInstruction(false); } if (e.key === 'Escape') setEditingInstruction(false); }}
              />
              <button onClick={() => { setListInstruction(scope, activeList.id, draftInstruction); setEditingInstruction(false); }}><Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} /></button>
              <button onClick={() => setEditingInstruction(false)}><X className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} /></button>
            </div>
          ) : (
            <button
              className="flex-1 flex items-center gap-1.5 text-left group"
              style={{ color: activeList.instruction ? 'var(--color-navy-mid)' : 'var(--color-warm-gray)' }}
              onClick={() => { setDraftInstruction(activeList.instruction); setEditingInstruction(true); }}
            >
              <span className="italic">{activeList.instruction || 'No AI instruction yet — click to add one'}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 shrink-0" />
            </button>
          )}
          <button onClick={() => { deleteList(scope, activeList.id); onSelect(null); }} title="Delete list" className="shrink-0">
            <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
          </button>
        </div>
      )}

      {creating && <CreateListModal scope={scope} onClose={() => setCreating(false)} onCreated={(l) => onSelect(l.id)} />}
    </div>
  );
}

function CreateListModal({ scope, onClose, onCreated }: { scope: string; onClose: () => void; onCreated: (l: ToolList) => void }) {
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>New list</h3>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)' }} />
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="AI instruction (optional) — e.g. Only auto-queue remote roles" rows={2} className="px-3 py-2 rounded-lg border text-sm resize-none" style={{ borderColor: 'var(--color-border)' }} />
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={() => { const l = createList(scope, name.trim(), instruction.trim()); onCreated(l); onClose(); }}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-steel)' }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function Pill({ label, active, onClick, leadingIcon }: { label: string; active: boolean; onClick: () => void; leadingIcon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors border')}
      style={{ backgroundColor: active ? 'var(--color-steel)' : 'var(--color-surface)', color: active ? 'white' : 'var(--color-navy-mid)', borderColor: active ? 'var(--color-steel)' : 'var(--color-border)' }}
    >
      {leadingIcon}
      {label}
    </button>
  );
}
