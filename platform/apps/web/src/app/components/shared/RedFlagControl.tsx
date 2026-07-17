/**
 * RedFlagControl — the ONE shared platform primitive for TASK-010 (docs/raw/
 * ui-architecture-rules-2026-07.md §5d, docs/glossary.md "Red Flag"). Every
 * eligible data cell (TableView.tsx and friends) and rendered bullet
 * (JobPilotApplicationDetail.tsx and friends) wraps its value with this ONE
 * component — no per-page red-flag logic, no duplicate feedback subsystem.
 *
 * States (glossary, verbatim): "On pointer hover or keyboard focus of any
 * eligible data cell or rendered bullet, show a subtle uncolored flag without
 * shifting layout. Selecting it records scoped negative feedback and turns it
 * red. Selecting again opens inspect/edit/clear; clearing is reversible and
 * audited."
 *   - no flag yet             -> subtle, uncolored, hover/focus-only. Click = create (turns red).
 *   - open flag (current)     -> solid red, ALWAYS visible (it IS the state). Click = inspect/edit/clear.
 *   - most recent is "cleared"-> subtle, uncolored, hover/focus-only (not currently active).
 *                                Click = inspect/reopen (never silently creates a duplicate).
 *
 * Never overloads color for anything else — this is the ONLY flag-shaped
 * control in the app (FlagIcon.tsx, the pre-canon green/yellow/red picker, was
 * removed; AP-023). Domain status (DealPilot/JobPilot fit, etc.) uses
 * explicit text labels, never this control.
 */
import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import clsx from 'clsx';
import { trpc, PILOT_WORKSPACE } from '../../lib/trpc';

type CreateInput = Parameters<typeof trpc.redFlag.create.mutate>[0];
export type RedFlagAnchor = CreateInput['anchor'];
type ListForAnchorResult = Awaited<ReturnType<typeof trpc.redFlag.listForAnchor.query>>;
type RedFlagRow = ListForAnchorResult['flags'][number];

interface MenuPosition {
  x: number;
  y: number;
}

/** Mirrors StandardColumnMenu.tsx's clamp — same positioned-popover convention
 * every other small overlay in this app already uses. */
function clampMenuPosition(position: MenuPosition): MenuPosition {
  const margin = 8;
  const width = 288;
  const height = Math.min(window.innerHeight * 0.6, 360);
  return {
    x: Math.max(margin, Math.min(position.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(position.y, window.innerHeight - height - margin)),
  };
}

export interface RedFlagControlProps {
  /** What this flag targets — Module + Database/Record/Field, or File/Result/
   * bullet anchor (glossary). At least recordId, fileId, or bulletPath is
   * required by the server; pass whichever anchor shape fits the caller. */
  anchor: RedFlagAnchor;
  /** The rendered value/version AT FLAG TIME (glossary) — whatever text the
   * cell/bullet currently shows, so a later correction is detectable. */
  renderedValue: string;
  renderedVersion?: string;
  /** The cell/bullet's own rendered content — RedFlagControl wraps it and
   * supplies its own hover/focus group, so callers never need to add hover
   * plumbing to their own markup. */
  children: React.ReactNode;
  className?: string;
}

export function RedFlagControl({ anchor, renderedValue, renderedVersion, children, className }: RedFlagControlProps) {
  const [flags, setFlags] = useState<RedFlagRow[] | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  const refresh = () => {
    trpc.redFlag.listForAnchor
      .query({
        workspaceId: PILOT_WORKSPACE,
        moduleId: anchor.moduleId,
        ...(anchor.recordId ? { recordId: anchor.recordId } : {}),
        ...(anchor.fieldId ? { fieldId: anchor.fieldId } : {}),
        ...(anchor.bulletPath ? { bulletPath: anchor.bulletPath } : {}),
      })
      .then((result) => setFlags(result.flags))
      .catch(() => setFlags([]));
  };

  useEffect(() => {
    refresh();
    // Deliberately depends on the anchor's scalar identity fields, not object
    // equality (a fresh `anchor` object literal is passed on every render by
    // callers like TableView.tsx).
  }, [anchor.moduleId, anchor.recordId, anchor.fieldId, anchor.bulletPath]);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [position]);

  // Most recent (current) flag for this anchor, if any — `listForAnchor` only
  // ever returns non-superseded rows, so at most one is "current" per anchor.
  const current = flags?.[0] ?? null;
  const isOpen = current?.value.status === 'open';
  const reason = current?.value.reason ?? '';

  async function handleGlyphActivate(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation();
    if (!current) {
      // Never flagged before — one click records it and turns it red immediately.
      setBusy(true);
      try {
        await trpc.redFlag.create.mutate({ workspaceId: PILOT_WORKSPACE, anchor, renderedValue, ...(renderedVersion ? { renderedVersion } : {}) });
        refresh();
      } finally {
        setBusy(false);
      }
      return;
    }
    // Already flagged (open or cleared) — second selection opens inspect/edit/clear.
    setReasonDraft(reason);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPosition(clampMenuPosition({ x: rect.left, y: rect.bottom + 4 }));
  }

  async function handleClear() {
    if (!current) return;
    setBusy(true);
    try {
      await trpc.redFlag.clear.mutate({ workspaceId: PILOT_WORKSPACE, flagId: current.row.id });
      setPosition(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!current) return;
    setBusy(true);
    try {
      await trpc.redFlag.reopen.mutate({ workspaceId: PILOT_WORKSPACE, flagId: current.row.id });
      setPosition(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveReason() {
    if (!current) return;
    setBusy(true);
    try {
      await trpc.redFlag.updateReason.mutate({ workspaceId: PILOT_WORKSPACE, flagId: current.row.id, reason: reasonDraft.trim() || 'No reason given' });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    if (!current) return;
    setBusy(true);
    try {
      await trpc.redFlag.forget.mutate({ workspaceId: PILOT_WORKSPACE, flagId: current.row.id });
      setPosition(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const label = isOpen
    ? 'Flagged as incorrect — inspect, edit, or clear'
    : current
      ? 'Previously flagged, now cleared — inspect or reopen'
      : 'Flag this value as incorrect';

  return (
    <span ref={containerRef} className={clsx('group/rf relative inline-flex min-w-0 items-center gap-1', className)}>
      {children}
      <button
        type="button"
        aria-label={label}
        aria-pressed={isOpen}
        disabled={busy}
        onClick={handleGlyphActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void handleGlyphActivate(e);
          }
        }}
        className={clsx(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-1',
          // Uncolored + hover/focus-only when not currently open (never flagged, or
          // cleared); ALWAYS visible + red when open (that IS the current state).
          // The `max-[767px]:opacity-100` clause keeps touch/coarse-pointer viewports
          // showing the same control persistently, since touch has no hover state
          // (§5d: "Touch and keyboard paths expose the same control").
          isOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/rf:opacity-100 group-focus-within/rf:opacity-100 focus-visible:opacity-100 max-[767px]:opacity-60',
        )}
        title={label}
      >
        <Flag className="h-full w-full" style={{ color: isOpen ? 'var(--danger)' : 'var(--color-warm-gray)' }} fill={isOpen ? 'var(--danger)' : 'none'} />
      </button>

      {position && current && (
        <div
          role="menu"
          aria-label="Red flag detail"
          className="fixed z-[80] w-72 rounded-xl border bg-white p-3 text-left text-sm normal-case tracking-normal shadow-xl"
          style={{ left: position.x, top: position.y, borderColor: 'var(--color-border)' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>
            {current.value.status === 'open' ? 'Flagged' : 'Cleared'} · {current.row.createdBy} · {new Date(current.row.createdAt).toLocaleString()}
          </div>
          <div className="mb-2 text-xs" style={{ color: 'var(--color-navy-mid)' }}>
            Target: {current.value.anchor.moduleId}
            {current.value.anchor.fieldId ? ` · ${current.value.anchor.fieldId}` : ''}
            {current.value.anchor.bulletPath ? ` · ${current.value.anchor.bulletPath}` : ''}
          </div>
          <div className="mb-2 text-xs italic" style={{ color: 'var(--color-warm-gray)' }}>
            Learning status: {current.value.learningStatus}
          </div>
          <textarea
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            onBlur={handleSaveReason}
            placeholder="Why is this wrong? (optional)"
            rows={2}
            className="mb-2 block w-full resize-none rounded border px-2 py-1 text-xs outline-none"
            style={{ borderColor: 'var(--color-border)' }}
          />
          <div className="flex flex-wrap gap-2">
            {current.value.status === 'open' ? (
              <button type="button" role="menuitem" disabled={busy} onClick={handleClear} className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-black/5" style={{ borderColor: 'var(--color-border)' }}>
                Clear
              </button>
            ) : (
              <button type="button" role="menuitem" disabled={busy} onClick={handleReopen} className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-black/5" style={{ borderColor: 'var(--color-border)' }}>
                Reopen
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={handleForget}
              className="rounded-lg px-2 py-1 text-xs font-medium opacity-60 hover:bg-black/5 hover:opacity-100"
              title="Permanently delete this flag's history — distinct from Clear, which stays reversible/audited"
            >
              Delete permanently
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
