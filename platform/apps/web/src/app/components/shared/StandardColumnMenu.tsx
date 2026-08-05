import { useCallback, useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";

export interface MenuPosition {
  x: number;
  y: number;
}

export function clampMenuPosition(position: MenuPosition): MenuPosition {
  const margin = 8;
  const width = 224;
  const height = Math.min(window.innerHeight * 0.7, 420);
  return {
    x: Math.max(margin, Math.min(position.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(position.y, window.innerHeight - height - margin)),
  };
}

export interface StandardColumnMenuItemProps {
  label: string;
  databaseBacked: boolean;
  onFilter: () => void;
  onSort: (direction: "asc" | "desc") => void;
  onGroup?: () => void;
  onHide?: () => void;
}

/**
 * The menu itself, split out from its trigger so any surface can show the SAME
 * items with the SAME disabled reasons (AP-021). `TableView` reaches it through
 * `<StandardColumnMenu>` below — label + ⋮ trigger inside a real <th>.
 *
 * The split was introduced for the canvas renderer, which had no DOM header to
 * hang a trigger on and mounted this panel at the coordinates Glide reported.
 * That renderer is gone (ADR-194), but the panel stays separately mountable and
 * viewport-clamped: it is `position: fixed`, so it can be opened from anywhere
 * without inheriting a <th>'s uppercase/tracking or its overflow clipping.
 */
export function StandardColumnMenuPanel({
  label,
  databaseBacked,
  onFilter,
  onSort,
  onGroup,
  onHide,
  position,
  onClose,
}: StandardColumnMenuItemProps & { position: MenuPosition; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const schemaReason = "Unavailable: this surface has no governed schema-mutation capability";
  const destructiveReason = "Unavailable: dependency preview and undo are required before this schema mutation can run";

  return (
        <div
          role="menu"
          aria-label={`${label} column actions`}
          className="fixed z-[80] max-h-[min(70vh,420px)] w-56 overflow-auto rounded-xl border py-1 text-left normal-case tracking-normal shadow-xl"
          // `--popover` rather than a `bg-white` class: this panel is the same
          // kind of surface as `DropdownMenuContent` (which `StandardRowMenu`
          // renders), and that token is the one the `.dark` block overrides.
          // NOT `--color-surface`: the `@theme inline` block re-declares it
          // from a frozen light hex AFTER `.dark`, so it does not survive a
          // dark-mode flip.
          style={{
            left: position.x,
            top: position.y,
            borderColor: "var(--color-border)",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {["Rename", "Edit column", "Change type", "AI Smartfill"].map((command) => (
            <button key={command} type="button" role="menuitem" disabled title={schemaReason} className="w-full px-3 py-1.5 text-left text-xs opacity-45">
              {command}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { onFilter(); onClose(); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10">
            Filter
          </button>
          <button type="button" role="menuitem" onClick={() => { onSort("asc"); onClose(); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10">
            Sort ascending
          </button>
          <button type="button" role="menuitem" onClick={() => { onSort("desc"); onClose(); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10">
            Sort descending
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onGroup}
            // The old wording ("this column cannot group the current View") implied a
            // per-column condition that does not exist: TableView never passes
            // `onGroup`, so Group is disabled for EVERY column on every View. Say the
            // true reason instead of inventing a column-specific one.
            title={onGroup ? undefined : "Unavailable: grouping is not wired for this View yet"}
            onClick={() => { onGroup?.(); onClose(); }}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-45"
          >
            Group
          </button>
          {["Calculate", "Lock column"].map((command) => (
            <button key={command} type="button" role="menuitem" disabled title={schemaReason} className="w-full px-3 py-1.5 text-left text-xs opacity-45">
              {command}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            disabled={!onHide}
            title={onHide ? undefined : "Unavailable: this surface cannot persist column visibility"}
            onClick={() => { onHide?.(); onClose(); }}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-45"
          >
            Hide column
          </button>
          {["Add column left", "Add column right", "Duplicate column", "Delete column"].map((command) => (
            <button key={command} type="button" role="menuitem" disabled title={destructiveReason} className="w-full px-3 py-1.5 text-left text-xs opacity-45">
              {command}
            </button>
          ))}
          {databaseBacked && (
            <>
              <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
              <button
                type="button"
                role="menuitem"
                disabled
                title="This Database already has a Page"
                className="w-full px-3 py-1.5 text-left text-xs opacity-45"
              >
                Add page
              </button>
              <button
                type="button"
                role="menuitem"
                disabled
                title="Removing this Page requires dependency preview, confirmation, and undo"
                className="w-full px-3 py-1.5 text-left text-xs opacity-45"
              >
                Remove page
              </button>
            </>
          )}
        </div>
  );
}

/** The DOM header's trigger + panel. Unchanged behaviour: click or right-click
 * opens the SAME `StandardColumnMenuPanel` the canvas renderer opens. */
export function StandardColumnMenu(props: StandardColumnMenuItemProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const close = useCallback(() => setPosition(null), []);

  return (
    <div
      className="flex items-center gap-1"
      onContextMenu={(event) => {
        event.preventDefault();
        setPosition(clampMenuPosition({ x: event.clientX, y: event.clientY }));
      }}
    >
      <span>{props.label}</span>
      <button
        type="button"
        aria-label={`Open ${props.label} column menu`}
        className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition(clampMenuPosition({ x: rect.left, y: rect.bottom + 4 }));
        }}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {position && <StandardColumnMenuPanel {...props} position={position} onClose={close} />}
    </div>
  );
}
