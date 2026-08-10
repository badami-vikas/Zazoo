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
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
  editable = true,
  showLabel = true,
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
  /**
   * The trigger is a real text input rather than a button (user directive
   * 2026-08-10: "the All text that triggered dropdown should get converted
   * into a search function and be editable", extended: "applicable for all
   * drop downs"). Typing filters options live — the trigger IS the search,
   * there is no second search box inside the menu — and a query with no
   * match surfaces `addDisabledReason`/onAdd inline where the user is
   * already looking, instead of in a separate pinned row.
   *
   * ON BY DEFAULT: this is the standard dropdown behaviour, not an opt-in.
   * Pass `editable={false}` only for a dropdown that genuinely must not
   * accept text (none today).
   */
  editable?: boolean;
  /** Hide the trigger's text label, icon+chevron only (still has `title` and
   * `ariaLabel`, so nothing is lost — just narrower). For the sandwich row's
   * staged responsive collapse. */
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const reasonId = useId();

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

  /**
   * Outside-click closes the menu via a document listener scoped by a ref —
   * NOT a full-screen overlay div. The overlay this replaces sat at z-40 over
   * the entire viewport whenever any dropdown was open, so it covered the
   * toggle strip (z-10) and every other control, and swallowed the user's
   * first click anywhere on the page (user report 2026-08-10: "the toggle is
   * not clickable"). A listener closes on the same gesture while leaving the
   * click to reach whatever was actually clicked.
   */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  if (options.length === 0 && !onAdd && !addDisabledReason) return null;

  const triggerClass =
    'flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm font-semibold shadow-inner max-w-[220px]';
  const triggerStyle = {
    backgroundColor: 'var(--color-surface)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-navy-mid)',
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className ?? ''}`}>
      {editable ? (
        <div
          className={triggerClass}
          style={triggerStyle}
          onClick={() => searchRef.current?.focus()}
        >
          {triggerIcon}
          {showLabel && (
            <input
              ref={searchRef}
              /* Closed, this shows the SELECTED LABEL as a real value — solid
                 text, identical to the old button. It only becomes an empty
                 search field once focused. Using the label as a `placeholder`
                 instead (the first cut of this) rendered muted grey on an
                 empty box, which read as "no dropdown here at all". */
              value={open ? query : (active?.label ?? '')}
              placeholder={open ? 'Search…' : placeholder}
              /* Content-sized, like the button it replaced. A bare <input>
                 defaults to ~20 characters wide regardless of content, which
                 is what stretched this control. `size` ties width to the
                 text; min-w-0 still lets the sandwich row shrink it. */
              size={Math.max(4, (open ? 'Search…' : (active?.label ?? placeholder)).length)}
              aria-label={ariaLabel}
              aria-haspopup="listbox"
              aria-expanded={open}
              title={active?.label}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                if (e.key === 'Enter' && ordered.length === 1) {
                  onSelect(ordered[0]!.id);
                  close();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="min-w-0 max-w-full truncate bg-transparent text-sm font-semibold outline-none"
              style={{ color: 'var(--color-navy-mid)' }}
            />
          )}
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
        </div>
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => {
            setOpen((o) => !o);
            window.setTimeout(() => searchRef.current?.focus(), 0);
          }}
          className={triggerClass}
          style={triggerStyle}
          title={active?.label}
        >
          {triggerIcon}
          {showLabel && <span className="truncate">{active?.label ?? placeholder}</span>}
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
        </button>
      )}

      {open && (
        <>
          <div
            role="listbox"
            className="absolute top-full left-0 mt-1 w-56 border rounded-xl shadow-lg z-50 overflow-hidden bg-white flex flex-col"
            style={{ borderColor: 'var(--color-border)' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
          >
            {showSearch && !editable && (
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
                  {/* editable mode has no separate pinned Add row (below) — the
                      reason surfaces right here, where the user is already
                      looking after typing a name that doesn't exist yet. */}
                  {editable && query && addDisabledReason && (
                    <div className="mt-1" style={{ color: 'var(--color-warm-gray)' }}>
                      {addDisabledReason}
                    </div>
                  )}
                  {editable && query && onAdd && (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        onAdd();
                      }}
                      className="mt-1 flex items-center gap-1.5 font-medium"
                      style={{ color: 'var(--color-steel)' }}
                    >
                      <span aria-hidden="true">＋</span> {addLabel} "{query}"
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Accessible even while "disabled": a real <button disabled> is
                unreachable by keyboard and its `title` is invisible to screen
                readers, so the reason it can't be used yet was undiscoverable
                (user directive 2026-08-10: "The drop down Add option is not
                accessible"). aria-disabled keeps it focusable; the reason is
                real text via aria-describedby, not just a tooltip. Suppressed
                in editable mode — the empty-state block above says the same
                thing right where the user is typing. */}
            {!editable && (onAdd || addDisabledReason) && (
              <>
                <button
                  type="button"
                  aria-disabled={!onAdd}
                  aria-describedby={!onAdd && addDisabledReason ? reasonId : undefined}
                  title={addDisabledReason}
                  onClick={
                    onAdd
                      ? () => {
                          close();
                          onAdd();
                        }
                      : undefined
                  }
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium border-t shrink-0 aria-disabled:opacity-45 aria-disabled:cursor-not-allowed"
                  style={{
                    height: ROW_PX,
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-warm-gray)',
                    backgroundColor: 'white',
                  }}
                >
                  <span aria-hidden="true">＋</span> {addLabel}
                </button>
                {!onAdd && addDisabledReason && (
                  <div id={reasonId} className="sr-only">
                    {addDisabledReason}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
