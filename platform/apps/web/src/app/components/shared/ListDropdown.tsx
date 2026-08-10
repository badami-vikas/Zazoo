// ListDropdown — the standard "which list am I looking at" control (shell-v2, user spec
// 2026-07-07), first toolbar slot on every list-capable page.
//
// It is now a thin binding over <StandardDropdown> (§5e, user directive 2026-08-10:
// "Add and search feature in a dropdown is a standard, not case by case implementation").
// Menu shape — selected list first, search box, five rows before scroll, pinned "＋ Add list"
// that never scrolls away — lives in StandardDropdown and is shared with every other
// dropdown in the app rather than re-implemented here.
import { useState } from 'react';
import { List as ListIcon } from 'lucide-react';
import { StandardDropdown } from './StandardDropdown';

export interface ListOption {
  id: string;
  label: string;
}

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
  return (
    <StandardDropdown
      options={lists}
      activeId={activeId}
      onSelect={onSelect}
      {...(onAddList ? { onAdd: onAddList } : {})}
      addLabel="Add list"
      ariaLabel="Select list"
      placeholder="Lists"
      emptyLabel="No lists yet"
      triggerIcon={<ListIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--color-steel)' }} />}
    />
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
