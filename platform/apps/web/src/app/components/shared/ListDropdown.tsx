// ListDropdown — the standard "which list am I looking at" control (shell-v2, user spec
// 2026-07-07). Replaces the ListBar pill row: a dropdown trigger showing the currently-open
// list's name, first toolbar slot on every list-capable page. Menu shape per spec: first item =
// the currently-open list, up to 5 list items visible (more → the list area scrolls), and a
// pinned "＋ Add list" slot that is ALWAYS visible at the bottom, never scrolled away.
import { useState } from 'react';
import { ChevronDown, Check, List as ListIcon, Plus } from 'lucide-react';

export interface ListOption {
  id: string;
  label: string;
}

// Five 36px rows visible before the list area scrolls (the Add-list slot sits below, outside
// the scroll container, so it can never scroll away).
const MAX_VISIBLE_ROWS = 5;
const ROW_PX = 36;

export function ListDropdown({
  lists,
  activeId,
  onSelect,
  onAddList,
}: {
  lists: ListOption[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddList?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = lists.find((l) => l.id === activeId) ?? lists[0];
  // Spec: the currently-open list renders first in the menu, then the rest in given order.
  const ordered = active ? [active, ...lists.filter((l) => l.id !== active.id)] : lists;
  if (lists.length === 0 && !onAddList) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold shadow-inner max-w-[220px]"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
        title={active?.label}
      >
        <ListIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--color-steel)' }} />
        <span className="truncate">{active?.label ?? 'Lists'}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 w-52 border rounded-xl shadow-lg z-50 overflow-hidden bg-white flex flex-col"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="py-1 overflow-y-auto" style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_PX }}>
              {ordered.map((l) => {
                const isActive = active && l.id === active.id;
                return (
                  <button
                    key={l.id}
                    onClick={() => { onSelect(l.id); setOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-left"
                    style={{
                      height: ROW_PX,
                      backgroundColor: isActive ? 'var(--color-surface)' : 'transparent',
                      color: isActive ? 'var(--color-steel)' : 'var(--color-navy-mid)',
                    }}
                  >
                    <span className="truncate flex-1">{l.label}</span>
                    {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
              {ordered.length === 0 && (
                <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>No lists yet</div>
              )}
            </div>
            {onAddList && (
              <button
                onClick={() => { setOpen(false); onAddList(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-t shrink-0"
                style={{ height: ROW_PX, borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)', backgroundColor: 'white' }}
              >
                <Plus className="w-3.5 h-3.5" /> Add list
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Small data-agnostic create dialog pages can mount for the "＋ Add list" flow — same shape the
// retired ListBar modal had (name + optional AI instruction), but the caller owns persistence.
export function CreateListModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, instruction: string) => void;
}) {
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const submit = () => { if (name.trim()) { onCreate(name.trim(), instruction.trim()); onClose(); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--color-navy)' }}>New list</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="List name"
          className="px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="AI instruction (optional)"
          rows={2}
          className="px-3 py-2 rounded-lg border text-sm resize-none"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ color: 'var(--color-warm-gray)' }}>Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={submit}
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
