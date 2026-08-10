/**
 * StandardDropdown — the ONE dropdown shape in Bridge (ui-architecture-rules §5e,
 * user directive 2026-08-10: "Add and search feature in a dropdown is a standard,
 * not case by case implementation").
 *
 * Every dropdown that selects from a list of named things — Lists, Views, column
 * pickers, relation pickers, Module pickers — renders through this. It always
 * provides:
 *   - the currently-selected option FIRST in the menu,
 *   - a type-to-filter search box (auto-shown past SEARCH_THRESHOLD options; the
 *     caller may force it on/off),
 *   - a pinned "＋ Add …" slot at the BOTTOM that never scrolls away,
 *   - five rows visible before the option area scrolls.
 *
 * A page that needs a dropdown does NOT hand-roll one. If a behaviour is missing
 * here, it is added here — that is what "standard" means.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export interface DropdownOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

/** Past this many options the search box appears on its own. */
const SEARCH_THRESHOLD = 6;
const MAX_VISIBLE_ROWS = 5;
const ROW_PX = 36;

export function StandardDropdown({
  options,
  activeId,
  onSelect,
  onAdd,
  addLabel = 'Add',
  addDisabledReason,
  searchable,
  triggerIcon,
  placeholder = 'Select…',
  ariaLabel,
  emptyLabel = 'Nothing here yet',
  className,
}: {
  options: DropdownOption[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Omit to hide the pinned add row — but prefer supplying it: "Add" is standard. */
  onAdd?: () => void;
  addLabel?: string;
  /**
   * Renders the Add row disabled with this reason instead of hiding it —
   * AP-021: an interactive-looking control that cannot yet do anything must
   * explain why, never simply disappear. Use when the capability the row
   * points at is real but not wired yet (e.g. saved Lists before persistence
   * ships), not for capabilities that will never exist.
   */
  addDisabledReason?: string;
  /** Force the search box on/off. Default: on past SEARCH_THRESHOLD options. */
  searchable?: boolean;
  triggerIcon?: ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const active = options.find((o) => o.id === activeId) ?? options[0];
  const showSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  // Selected option first, then the rest in given order (spec §5e).
  const ordered = useMemo(() => {
    const rest = active ? options.filter((o) => o.id !== active.id) : options;
    const all = active ? [active, ...rest] : options;
    const q = query.trim().toLowerCase();
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  }, [options, active, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  if (options.length === 0 && !onAdd && !addDisabledReason) return null;

  return (
    <div className={`relative shrink-0 ${className ?? ''}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((o) => !o);
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold shadow-inner max-w-[220px]"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-navy-mid)',
        }}
        title={active?.label}
      >
        {triggerIcon}
        <span className="truncate">{active?.label ?? placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="listbox"
            className="absolute top-full left-0 mt-1 w-56 border rounded-xl shadow-lg z-50 overflow-hidden bg-white flex flex-col"
            style={{ borderColor: 'var(--color-border)' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
          >
            {showSearch && (
              <div className="relative border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
                <Search
                  className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--color-warm-gray)' }}
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search options"
                  className="w-full pl-8 pr-2.5 py-2 text-sm outline-none bg-transparent"
                  style={{ color: 'var(--color-navy-mid)' }}
                />
              </div>
            )}

            <div className="py-1 overflow-y-auto" style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_PX }}>
              {ordered.map((o) => {
                const isActive = active && o.id === active.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={Boolean(isActive)}
                    onClick={() => {
                      onSelect(o.id);
                      close();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-left"
                    style={{
                      height: ROW_PX,
                      backgroundColor: isActive ? 'var(--color-surface)' : 'transparent',
                      color: isActive ? 'var(--color-steel)' : 'var(--color-navy-mid)',
                    }}
                  >
                    {o.icon}
                    <span className="truncate flex-1">{o.label}</span>
                    {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
              {ordered.length === 0 && (
                <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>
                  {query ? 'No matches' : emptyLabel}
                </div>
              )}
            </div>

            {(onAdd || addDisabledReason) && (
              <button
                type="button"
                disabled={!onAdd}
                title={addDisabledReason}
                onClick={
                  onAdd
                    ? () => {
                        close();
                        onAdd();
                      }
                    : undefined
                }
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-t shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
                style={{
                  height: ROW_PX,
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-warm-gray)',
                  backgroundColor: 'white',
                }}
              >
                <span aria-hidden="true">＋</span> {addLabel}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
