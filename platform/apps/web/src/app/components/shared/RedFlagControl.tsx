/**
 * RedFlagControl — the ONE shared platform primitive for TASK-010 (docs/raw/
 * ui-architecture-rules-2026-07.md §5d, docs/glossary.md "Red Flag"). Every
 * eligible data cell (TableView.tsx and friends) and rendered bullet
 * (JobPilotApplicationDetail.tsx and friends) wraps its value with this ONE
 * component — no per-page red-flag logic, no duplicate feedback subsystem.
 * Must be rendered inside a `RedFlagProvider` (RedFlagProvider.tsx), which
 * batches ONE query for an entire visible table/record instead of each
 * control querying on its own mount (review remediation item 7).
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
 * Touch/accessibility (review item 8): visibility is gated on POINTER
 * CAPABILITY (`(hover: none)`), never viewport width — a touch-capable
 * laptop at a wide viewport still gets the persistent-visibility treatment,
 * and a narrow-viewport external mouse doesn't. The glyph itself stays
 * visually subtle, but its actual hit target is >=44x44 CSS px on a coarse
 * pointer (`(pointer: coarse)`), overlaid via a larger invisible padding box
 * so it never shifts surrounding layout.
 *
 * Never overloads color for anything else — this is the ONLY flag-shaped
 * control in the app (FlagIcon.tsx, the pre-canon green/yellow/red picker, was
 * removed; AP-023). Domain status (DealPilot/JobPilot fit, etc.) uses
 * explicit text labels, never this control.
 */
import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import clsx from 'clsx';
import { useRedFlagContext, type RedFlagAnchor } from './RedFlagProvider';

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
  /** What this flag targets — the discriminated cell/bullet anchor
   * (RedFlagProvider.tsx's `RedFlagAnchor`). */
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
  const ctx = useRedFlagContext();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Serializes reason-save (textarea onBlur) against clear/reopen/forget —
   * review item 4: "do not let textarea onBlur race clear/reopen/forget."
   * Blur fires before a sibling button's click when focus moves away, so
   * without this a fast Clear click could fire while a reason-save is still
   * in flight. Every mutation handler awaits this first. */
  const pendingSaveRef = useRef<Promise<void> | null>(null);

  const current = ctx.flagFor(anchor);
  const isOpen = current?.value.status === 'open';
  const reason = current?.value.reason ?? '';

  useEffect(() => {
    setReasonDraft(reason);
    // Reset the draft whenever the underlying flag identity/reason changes
    // (e.g. after a refresh following clear/reopen).
  }, [current?.row.id, reason]);

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

  async function saveReasonIfChanged(): Promise<void> {
    if (!current || reasonDraft === reason) return; // "save reason only when changed"
    const trimmed = reasonDraft.trim() || 'No reason given';
    const p = ctx.updateReason(current.row.id, trimmed);
    pendingSaveRef.current = p;
    try {
      await p;
    } finally {
      if (pendingSaveRef.current === p) pendingSaveRef.current = null;
    }
  }

  /** Every OTHER mutation waits for any in-flight reason-save first, so a
   * fast Clear/Reopen/Forget click can never race a pending onBlur save. */
  async function afterPendingSave(): Promise<void> {
    if (pendingSaveRef.current) await pendingSaveRef.current.catch(() => {});
  }

  async function handleGlyphActivate(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation();
    if (!current) {
      // Never flagged before — one click records it and turns it red immediately.
      setBusy(true);
      try {
        await ctx.create({ anchor, renderedValue, ...(renderedVersion ? { renderedVersion } : {}) });
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
      await afterPendingSave();
      await ctx.clear(current.row.id);
      setPosition(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!current) return;
    setBusy(true);
    try {
      await afterPendingSave();
      await ctx.reopen(current.row.id);
      setPosition(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    if (!current) return;
    setBusy(true);
    try {
      await afterPendingSave();
      await ctx.forget(current.row.id);
      setPosition(null);
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
    <span className={clsx('group/rf relative inline-flex min-w-0 items-center gap-1', className)}>
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
          // The button itself is the >=44x44 touch target on a coarse
          // pointer (review item 8) — absolutely positioned so the larger
          // hit area never shifts the cell/bullet's own layout; the glyph
          // inside stays visually small regardless.
          'relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-1',
          '[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-3.5 [@media(pointer:coarse)]:before:content-[""]',
          // Uncolored + hover/focus-only when not currently open (never
          // flagged, or cleared); ALWAYS visible + red when open (that IS
          // the current state). Gated on POINTER CAPABILITY, not viewport
          // width — `(hover: none)` covers touch/coarse-pointer devices
          // regardless of screen size (§5d: "Touch and keyboard paths
          // expose the same control").
          isOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/rf:opacity-100 group-focus-within/rf:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60',
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
            {current.value.anchor.kind === 'cell' ? ` · ${current.value.anchor.fieldId}` : ` · ${current.value.anchor.bulletPath}`}
          </div>
          <div className="mb-2 text-xs italic" style={{ color: 'var(--color-warm-gray)' }}>
            Learning status: {current.value.learningStatus}
            {current.value.learningStatus === 'failed' && current.value.learningFailureReason ? ` (${current.value.learningFailureReason})` : ''}
          </div>
          <textarea
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            onBlur={() => void saveReasonIfChanged()}
            placeholder="Why is this wrong? (optional)"
            rows={2}
            className="mb-2 block w-full resize-none rounded border px-2 py-1 text-xs outline-none"
            style={{ borderColor: 'var(--color-border)' }}
          />
          <div className="flex flex-wrap gap-2">
            {current.value.status === 'open' ? (
              <button type="button" role="menuitem" disabled={busy} onClick={() => void handleClear()} className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-black/5" style={{ borderColor: 'var(--color-border)' }}>
                Clear
              </button>
            ) : (
              <button type="button" role="menuitem" disabled={busy} onClick={() => void handleReopen()} className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-black/5" style={{ borderColor: 'var(--color-border)' }}>
                Reopen
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void handleForget()}
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
