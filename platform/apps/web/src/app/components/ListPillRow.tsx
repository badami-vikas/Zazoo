import { Plus, ListIcon } from 'lucide-react';
import { Pill } from './shared/Pill';

interface ListPillRowProps {
  pills: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
  onAddList?: () => void;
  onPillContextMenu?: (name: string, e: React.MouseEvent) => void;  // right-click a list pill
  allLabel?: string;       // label for the leading (unfiltered) pill — defaults to "All"
  addLabel?: string;       // label for the add-list button — defaults to "Add list"
}

export function ListPillRow({ pills, selected, onSelect, onAddList, onPillContextMenu, allLabel = 'All', addLabel = 'Add list' }: ListPillRowProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-4 py-2.5 border-b shrink-0 overflow-x-auto scrollbar-hide"
      style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}
    >
      <Pill
        label={allLabel}
        active={selected === null}
        onClick={() => onSelect(null)}
        leadingIcon={<ListIcon className="w-3.5 h-3.5" />}
      />
      {pills.map(p => (
        <Pill
          key={p}
          label={p}
          active={selected === p}
          onClick={() => onSelect(p)}
          onContextMenu={onPillContextMenu ? (e) => { e.preventDefault(); onPillContextMenu(p, e); } : undefined}
        />
      ))}
      {onAddList && (
        <button
          onClick={onAddList}
          className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:bg-[var(--color-surface)] border border-dashed"
          style={{ color: 'var(--color-warm-gray)', borderColor: 'var(--color-border)' }}
          title="Add new list"
        >
          <Plus className="w-3 h-3" /> {addLabel}
        </button>
      )}
    </div>
  );
}
