import { useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";

interface MenuPosition {
  x: number;
  y: number;
}

function clampMenuPosition(position: MenuPosition): MenuPosition {
  const margin = 8;
  const width = 224;
  const height = Math.min(window.innerHeight * 0.7, 420);
  return {
    x: Math.max(margin, Math.min(position.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(position.y, window.innerHeight - height - margin)),
  };
}

export function StandardColumnMenu({
  label,
  databaseBacked,
  onFilter,
  onSort,
}: {
  label: string;
  databaseBacked: boolean;
  onFilter: () => void;
  onSort: (direction: "asc" | "desc") => void;
}) {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [position]);

  const disabledReason = "Schema editing is unavailable for this read-only runtime binding";
  const disabledCommands = [
    "Rename",
    "Edit column",
    "Change type",
    "AI Smartfill",
    "Group",
    "Calculate",
    "Lock column",
    "Hide column",
    "Add column left",
    "Add column right",
    "Duplicate column",
    "Delete column",
  ];

  return (
    <div
      className="flex items-center gap-1"
      onContextMenu={(event) => {
        event.preventDefault();
        setPosition(clampMenuPosition({ x: event.clientX, y: event.clientY }));
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        aria-label={`Open ${label} column menu`}
        className="rounded p-0.5 hover:bg-black/5"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition(clampMenuPosition({ x: rect.left, y: rect.bottom + 4 }));
        }}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {position && (
        <div
          role="menu"
          aria-label={`${label} column actions`}
          className="fixed z-[80] max-h-[min(70vh,420px)] w-56 overflow-auto rounded-xl border bg-white py-1 text-left normal-case tracking-normal shadow-xl"
          style={{ left: position.x, top: position.y, borderColor: "var(--color-border)" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {disabledCommands.slice(0, 4).map((command) => (
            <button key={command} type="button" role="menuitem" disabled title={disabledReason} className="w-full px-3 py-1.5 text-left text-xs opacity-45">
              {command}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { onFilter(); setPosition(null); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5">
            Filter
          </button>
          <button type="button" role="menuitem" onClick={() => { onSort("asc"); setPosition(null); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5">
            Sort ascending
          </button>
          <button type="button" role="menuitem" onClick={() => { onSort("desc"); setPosition(null); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5">
            Sort descending
          </button>
          {disabledCommands.slice(4).map((command) => (
            <button key={command} type="button" role="menuitem" disabled title={disabledReason} className="w-full px-3 py-1.5 text-left text-xs opacity-45">
              {command}
            </button>
          ))}
          <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
          <button
            type="button"
            role="menuitem"
            disabled
            title={databaseBacked ? "This database already has a Page" : "Only database-backed columns can create Pages"}
            className="w-full px-3 py-1.5 text-left text-xs opacity-45"
          >
            Add page
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            title="Removing this Page requires the governed schema editor"
            className="w-full px-3 py-1.5 text-left text-xs opacity-45"
          >
            Remove page
          </button>
        </div>
      )}
    </div>
  );
}
