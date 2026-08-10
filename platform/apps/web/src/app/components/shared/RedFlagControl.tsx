/**
 * RedFlagControl — the ONE shared platform primitive for TASK-010 (docs/raw/
 * ui-architecture-rules-2026-07.md §5d, docs/glossary.md "Red Flag"). Every
 * eligible data cell (TableView.tsx and friends) and rendered bullet
 * A supported data surface wraps its value with this ONE
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
 *   - learningStatus "applied"-> the owner-approved correction is ACTUALLY
 *     ENACTED (review round-4 item 1) — the flagged value itself is
 *     visibly withheld ("corrected, pending re-entry") instead of shown,
 *     proving governed learning changes real behavior only after approval;
 *     reversible via "Undo correction" (revokeCorrection).
 *
 * Touch/accessibility (review items 8 + round-4 item 10): visibility is
 * gated on POINTER CAPABILITY — both `(hover: none)` (the device's PRIMARY
 * pointer has no hover, e.g. a touchscreen used as the main input) AND
 * `(any-pointer: coarse)` (a coarse pointer exists AT ALL, e.g. a touch
 * digitizer alongside a mouse/trackpad) — never viewport width. A
 * touch-capable laptop with an attached mouse still gets the persistent-
 * visibility treatment on its touchscreen, and a narrow-viewport external
 * mouse-only setup does not. The glyph itself stays visually subtle, but
 * its actual hit target is >=44x44 CSS px whenever ANY coarse pointer is
 * present (`(any-pointer: coarse)`, not only `(pointer: coarse)` — the
 * PRIMARY pointer test alone misses a touchscreen that isn't the OS's
 * declared primary input), overlaid via a larger invisible padding box so
 * it never shifts surrounding layout.
 *
 * Never overloads color for anything else — this is the ONLY flag-shaped
 * control in the app (FlagIcon.tsx, the pre-canon green/yellow/red picker, was
 * removed; AP-023). Domain status (DealPilot/JobPilot fit, etc.) uses
 * explicit text labels, never this control.
 */
import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../../lib/trpc';
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
  /** review round-5 item 11 — surfaces `RedFlagProvider.create`'s
   * "still loading" rejection (or any other create failure) instead of an
   * unhandled promise rejection; cleared on the NEXT successful create. */
  const [createError, setCreateError] = useState<string | null>(null);
  /** review round-5 item 3 ("ship enactment"): `learningStatus === 'proposed'`
   * alone doesn't tell the UI whether the owner has actually approved the
   * proposal in Approvals yet — that lives in the ledger, not the flag's own
   * Memory content. Checked ON DEMAND (popover open), never in the batched
   * `RedFlagProvider` fetch, since it only matters for the rare flag that is
   * BOTH proposed AND currently being inspected — batching it into every
   * page load would reintroduce the N+1 pattern review item 7 removed. */
  const [approval, setApproval] = useState<'unknown' | 'checking' | 'pending' | 'approved' | 'other'>('unknown');
  /** Serializes reason-save (textarea onBlur) against clear/reopen/forget —
   * review item 4: "do not let textarea onBlur race clear/reopen/forget."
   * Blur fires before a sibling button's click when focus moves away, so
   * without this a fast Clear click could fire while a reason-save is still
   * in flight. Review round-4 item 9: this now resolves to the flagId the
   * SAVE itself produced (the reason-save supersedes the lineage to a NEW
   * row) — every OTHER mutation awaits it and uses ITS returned id, never a
   * stale closure `current.row.id` captured before the save started. */
  const pendingSaveRef = useRef<Promise<string> | null>(null);

  const current = ctx.flagFor(anchor);
  const isOpen = current?.value.status === 'open';
  const isApplied = current?.value.learningStatus === 'applied';
  const isProposed = current?.value.learningStatus === 'proposed';
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

  // Re-check approval status each time the popover opens on a proposed flag
  // — never on mount/batch load (see comment on `approval` state above).
  useEffect(() => {
    if (!position || !isProposed || !current?.value.proposalId) return;
    let cancelled = false;
    setApproval('checking');
    trpc.action.resolution
      .query({ proposalId: current.value.proposalId })
      .then((res) => {
        if (cancelled) return;
        setApproval(res.status === 'resolved' && res.decision === 'approve' ? 'approved' : res.status === 'pending' ? 'pending' : 'other');
      })
      .catch(() => {
        if (!cancelled) setApproval('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [position, isProposed, current?.value.proposalId]);

  /** Saves the reason if changed, resolving to the flagId that should be
   * used for any FOLLOWING action — either the freshly-superseded row's id
   * (if a save happened) or the current, already-fresh id (if nothing
   * changed). Never resolves to a stale id. */
  async function saveReasonIfChanged(): Promise<string> {
    if (!current) return '';
    if (reasonDraft === reason) return current.row.id; // "save reason only when changed"
    const trimmed = reasonDraft.trim() || 'No reason given';
    const flagIdAtSaveStart = current.row.id;
    const p = (async () => {
      const updated = await ctx.updateReason(flagIdAtSaveStart, trimmed);
      return updated.id;
    })();
    pendingSaveRef.current = p;
    try {
      return await p;
    } finally {
      if (pendingSaveRef.current === p) pendingSaveRef.current = null;
    }
  }

  /** Every OTHER mutation waits for any in-flight reason-save first and
   * uses ITS resolved id — so a fast Clear/Reopen/Forget click can never
   * race a pending onBlur save NOR act on the id the save has already
   * superseded. */
  async function afterPendingSave(): Promise<string> {
    if (pendingSaveRef.current) {
      return await pendingSaveRef.current.catch(() => current?.row.id ?? '');
    }
    return current?.row.id ?? '';
  }

  async function handleGlyphActivate(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation();
    if (!current) {
      // review round-6 (independent-review follow-up on item 11): a FAILED
      // initial load (loading still true because rows never landed, AND
      // error true) is NOT the same as "still in flight" — the button stays
      // enabled in this state specifically so a click retries the load
      // instead of being silently inert forever.
      if (ctx.loading && ctx.error) {
        ctx.retryLoad();
        return;
      }
      // Never flagged before — one click records it and turns it red immediately.
      // review round-5 item 11: disabled (see the button's `disabled` prop
      // below) while `ctx.loading` (and not yet errored), so this should
      // rarely fire during the initial load — still guarded here too in
      // case a click was already in flight when loading started (e.g. a
      // fast scope change).
      setBusy(true);
      setCreateError(null);
      try {
        await ctx.create({ anchor, renderedValue, ...(renderedVersion ? { renderedVersion } : {}) });
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Could not record this flag — try again.');
      } finally {
        setBusy(false);
      }
      return;
    }
    // User directive 2026-08-10: "Clicking a red flag should remove red flag."
    // Plain activation is a TOGGLE — open → cleared, cleared → reopened. The
    // inspect/edit/reason panel moved to the secondary gesture (right-click /
    // long-press / Shift+Enter, see openDetail below) so the common case costs
    // one click instead of click → popover → Clear.
    if (isOpen) {
      await handleClear();
      return;
    }
    await handleReopen();
  }

  /** Secondary gesture on an existing flag: inspect, edit the reason, enact or
   * revoke a governed correction, or delete the flag's history permanently.
   * Never reachable before a flag exists — there is nothing to inspect. */
  function openDetail(event: React.MouseEvent | React.KeyboardEvent) {
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    setReasonDraft(reason);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPosition(clampMenuPosition({ x: rect.left, y: rect.bottom + 4 }));
  }

  async function handleClear() {
    if (!current) return;
    setBusy(true);
    try {
      const flagId = await afterPendingSave();
      if (flagId) await ctx.clear(flagId);
      setPosition(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!current) return;
    setBusy(true);
    try {
      const flagId = await afterPendingSave();
      if (flagId) await ctx.reopen(flagId);
      setPosition(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    if (!current) return;
    setBusy(true);
    try {
      const flagId = await afterPendingSave();
      if (flagId) await ctx.forget(flagId);
      setPosition(null);
    } finally {
      setBusy(false);
    }
  }

  /** review round-5 item 4 — "exposes retry for failed pre-proposal state":
   * a governed learning step that errored (never the Human's own
   * correction, which already succeeded) is retryable directly, without
   * forcing a Clear-then-Reopen workaround that would needlessly fork the
   * flag's own open/cleared history. */
  async function handleRetryLearning() {
    if (!current) return;
    setBusy(true);
    try {
      const flagId = await afterPendingSave();
      if (flagId) await ctx.retryLearning(flagId);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeCorrection() {
    if (!current) return;
    setBusy(true);
    try {
      const flagId = await afterPendingSave();
      if (flagId) await ctx.revokeCorrection(flagId);
    } finally {
      setBusy(false);
    }
  }

  /** review round-5 item 3 — the missing "ship enactment" affordance: an
   * approved correction never enacts itself; a Human must explicitly ask
   * for it here. Only enabled once `action.resolution` has confirmed the
   * proposal is actually approved — never optimistically shown for a merely
   * "proposed" flag, since `enactCorrection` itself would reject that with
   * CONFLICT server-side (defense in depth, not the only gate). */
  async function handleEnactCorrection() {
    if (!current) return;
    setBusy(true);
    try {
      const flagId = await afterPendingSave();
      if (flagId) await ctx.enactCorrection(flagId);
      setApproval('unknown');
    } finally {
      setBusy(false);
    }
  }

  const label = isOpen
    ? 'Flagged as incorrect — click to remove the flag (right-click to inspect or edit)'
    : current
      ? 'Previously flagged, now cleared — click to flag again (right-click to inspect)'
      : ctx.loading
        ? ctx.error
          ? 'Could not load current flag status — click to retry'
          : 'Flag this value as incorrect (loading current status…)'
        : 'Flag this value as incorrect';

  return (
    <span className={clsx('group/rf relative inline-flex min-w-0 items-center gap-1', className)}>
      {isApplied ? (
        <span
          className="italic line-through decoration-2"
          style={{ color: 'var(--color-warm-gray)', textDecorationColor: 'var(--danger)' }}
          title="A governed correction for this value has been approved and enacted — the original value is withheld pending re-entry"
        >
          (corrected, pending re-entry)
        </span>
      ) : (
        children
      )}
      <button
        type="button"
        aria-label={label}
        aria-pressed={isOpen}
        disabled={busy || (!current && ctx.loading && !ctx.error)}
        onClick={handleGlyphActivate}
        onContextMenu={openDetail}
        onKeyDown={(e) => {
          // Enter/Space = the toggle (create / clear / reopen).
          // Shift+Enter = the keyboard equivalent of right-click: inspect/edit.
          // §5d requires keyboard parity for every pointer gesture.
          if (e.key === 'Enter' && e.shiftKey) {
            openDetail(e);
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void handleGlyphActivate(e);
          }
        }}
        className={clsx(
          // The button itself is the >=44x44 touch target on ANY coarse
          // pointer (review item 8 + round-4 item 10) — absolutely
          // positioned so the larger hit area never shifts the cell/
          // bullet's own layout; the glyph inside stays visually small
          // regardless.
          'relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-1',
          '[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-3.5 [@media(pointer:coarse)]:before:content-[""]',
          '[@media(any-pointer:coarse)]:before:absolute [@media(any-pointer:coarse)]:before:-inset-3.5 [@media(any-pointer:coarse)]:before:content-[""]',
          // Uncolored + hover/focus-only when not currently open (never
          // flagged, or cleared); ALWAYS visible + red when open (that IS
          // the current state). Gated on POINTER CAPABILITY, not viewport
          // width — `(hover: none)` covers a touch-primary device
          // regardless of screen size, and `(any-pointer: coarse)` ALSO
          // covers a touch digitizer that coexists with a mouse/trackpad
          // (review round-4 item 10 — the primary-pointer-only test alone
          // missed this case) (§5d: "Touch and keyboard paths expose the
          // same control").
          isOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/rf:opacity-100 group-focus-within/rf:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60 [@media(any-pointer:coarse)]:opacity-60',
        )}
        title={label}
      >
        <Flag className="h-full w-full" style={{ color: isOpen ? 'var(--danger)' : 'var(--color-warm-gray)' }} fill={isOpen ? 'var(--danger)' : 'none'} />
      </button>
      {createError && (
        <span role="alert" className="absolute left-0 top-full z-[80] mt-1 whitespace-nowrap rounded border bg-white px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {createError}
        </span>
      )}

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
          {isProposed && (
            <div className="mb-2 text-xs" style={{ color: approval === 'approved' ? 'var(--success)' : 'var(--color-warm-gray)' }}>
              {approval === 'checking' && 'Checking approval status…'}
              {approval === 'pending' && 'Awaiting Human approval in Approvals.'}
              {approval === 'approved' && 'Approved — ready to enact this correction.'}
              {(approval === 'other' || approval === 'unknown') && 'Not yet enactable.'}
            </div>
          )}
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
            {isProposed && approval === 'approved' ? (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void handleEnactCorrection()}
                className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-black/5"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                title="Apply the approved correction — its effect becomes visible immediately (review round-5 item 3: 'no approved correction may be stranded')"
              >
                Enact correction
              </button>
            ) : null}
            {current.value.learningStatus === 'failed' ? (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void handleRetryLearning()}
                className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-black/5"
                style={{ borderColor: 'var(--color-border)' }}
                title="Retry the governed learning step — your correction itself was already recorded; only this follow-on step failed"
              >
                Retry learning
              </button>
            ) : null}
            {isApplied ? (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void handleRevokeCorrection()}
                className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-black/5"
                style={{ borderColor: 'var(--color-border)' }}
                title="Undo the enacted correction — reverses the display suppression (review round-4 item 1: 'can be undone')"
              >
                Undo correction
              </button>
            ) : null}
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
