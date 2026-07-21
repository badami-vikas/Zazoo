/**
 * RedFlagProvider — the batched data layer behind every `RedFlagControl` on
 * one page/table (TASK-010 review remediation item 7: "eliminate per-cell
 * N+1"). ONE `redFlag.listForScope` query covers an entire visible
 * table/record's worth of cells/bullets; `RedFlagControl` consumes the
 * result via `useRedFlagContext()` instead of querying on its own mount.
 *
 * Review round-4 item 9: every mutation below updates the LOCAL `rows`
 * cache SYNCHRONOUSLY from its own return value (never discarding it) and
 * returns the resulting row back to the caller — a background `refresh()`
 * still runs for eventual server-truth reconciliation, but `RedFlagControl`
 * never needs to wait for it: a reason-save immediately followed by a
 * clear/reopen/forget click can safely chain off the SAVE's own returned
 * id instead of a stale closure value.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { trpc, PILOT_ORGANIZATION } from '../../lib/trpc';

type CreateInput = Parameters<typeof trpc.redFlag.create.mutate>[0];
export type RedFlagAnchor = CreateInput['anchor'];
type ScopeInput = Parameters<typeof trpc.redFlag.listForScope.query>[0];
export type RedFlagScope = Omit<ScopeInput, 'organizationId'>;
type ListResult = Awaited<ReturnType<typeof trpc.redFlag.listForScope.query>>;
export type RedFlagRow = ListResult['flags'][number];
type RedFlagValue = RedFlagRow['value'];
type RedFlagMemory = RedFlagRow['row'];

/** A stable, order-independent string key for an anchor — used ONLY for
 * client-side lookup inside the batched result set (the server computes its
 * own canonical/deterministic key independently; this must simply be
 * consistent for equal anchors, not match the server's algorithm). */
function anchorMatchKey(anchor: RedFlagAnchor): string {
  if (anchor.kind === 'cell') return ['cell', anchor.moduleId, anchor.databaseId, anchor.recordId, anchor.fieldId].join('\u0000');
  const t = anchor.target;
  const targetKey = t.type === 'record' ? t.recordId : t.type === 'file' ? t.fileId : t.resultId;
  return ['bullet', anchor.moduleId, t.type, targetKey, anchor.bulletPath].join('\u0000');
}

/** Client-side mirror of the server's `parseLearningMemory` — only the
 * `red_flag`-shaped fields this UI ever reads. */
function parseRedFlagValue(content: string): RedFlagValue | null {
  try {
    const parsed = JSON.parse(content);
    return parsed?.kind === 'red_flag' ? parsed : null;
  } catch {
    return null;
  }
}

function toRow(memory: RedFlagMemory): RedFlagRow | null {
  const value = parseRedFlagValue(memory.content);
  if (!value) return null;
  return { row: memory, value } as RedFlagRow;
}

interface RedFlagContextValue {
  flagFor(anchor: RedFlagAnchor): RedFlagRow | null;
  loading: boolean;
  /** review round-5 item 11 — true only while the MOST RECENT refresh
   * attempt failed; distinct from `loading` (never yet loaded) and from a
   * genuinely empty scope (`rows === []` with `error === false`). Last-good
   * `rows` from an earlier successful load are preserved across an error —
   * a transient network blip must never make existing flags disappear. */
  error: boolean;
  create(input: { anchor: RedFlagAnchor; renderedValue: string; renderedVersion?: string; reason?: string }): Promise<RedFlagMemory>;
  clear(flagId: string): Promise<RedFlagMemory>;
  reopen(flagId: string): Promise<RedFlagMemory>;
  updateReason(flagId: string, reason: string): Promise<RedFlagMemory>;
  forget(flagId: string): Promise<void>;
  enactCorrection(flagId: string): Promise<RedFlagMemory>;
  revokeCorrection(flagId: string): Promise<RedFlagMemory>;
  retryLearning(flagId: string): Promise<RedFlagMemory>;
  /** review round-6 (independent-review follow-up on item 11) — a failed
   * INITIAL load (rows still null, error true) previously had no recovery
   * path short of a full component remount: `create()` stayed permanently
   * disabled and the button's tooltip kept saying "loading…" even though
   * nothing was actually in flight anymore. Exposes the SAME `refresh()`
   * this provider already uses internally so a caller can retry on demand. */
  retryLoad(): void;
}

const RedFlagContext = createContext<RedFlagContextValue | null>(null);

export function useRedFlagContext(): RedFlagContextValue {
  const ctx = useContext(RedFlagContext);
  if (!ctx) throw new Error('RedFlagControl must be rendered within a RedFlagProvider');
  return ctx;
}

export function RedFlagProvider({ scope, children }: { scope: RedFlagScope; children: ReactNode }) {
  const [rows, setRows] = useState<RedFlagRow[] | null>(null);
  const [error, setError] = useState(false);
  const scopeKey = JSON.stringify(scope);
  /** review round-5 item 11 — "generation/abort guard overlapping
   * refreshes": every refresh() call stamps the CURRENT generation before
   * firing its query, and only applies its result if it is STILL the most
   * recent refresh when the response lands. Without this, an older
   * in-flight request (e.g. the initial mount's refresh(), or a scope
   * change's refresh()) that happens to resolve AFTER a newer one (a
   * mutation's own applyLocally()-triggered refresh()) could silently
   * overwrite fresher data with stale data — a classic out-of-order-
   * response race, not merely a duplicate-request inefficiency. */
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    const generation = ++generationRef.current;
    trpc.redFlag.listForScope
      .query({ organizationId: PILOT_ORGANIZATION, ...scope })
      .then((result) => {
        if (generationRef.current !== generation) return; // a newer refresh already landed or is in flight
        setRows(result.flags);
        setError(false);
      })
      .catch(() => {
        if (generationRef.current !== generation) return;
        // Preserve the last KNOWN-GOOD rows (never clobber real flags with
        // an empty array just because a request failed) — only flip the
        // `error` flag so a caller can distinguish "genuinely empty" from
        // "we don't currently know."
        setError(true);
      });
    // Depends on `scopeKey` (a stable JSON string), not the `scope` object
    // reference itself, since callers may pass a fresh object literal each
    // render.
  }, [scopeKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const byKey = useMemo(() => {
    const map = new Map<string, RedFlagRow>();
    for (const row of rows ?? []) map.set(anchorMatchKey(row.value.anchor), row);
    return map;
  }, [rows]);

  /** review round-4 item 9: apply a mutation's own returned row to the
   * LOCAL cache immediately — replacing any existing entry for the SAME
   * anchor (a mutation always supersedes the flag it targets) — before a
   * background refresh reconciles against the server. This is what lets
   * `RedFlagControl` chain a reason-save's returned id straight into a
   * following clear/reopen/forget without waiting on a round-trip refetch. */
  function applyLocally(memory: RedFlagMemory): RedFlagMemory {
    const next = toRow(memory);
    if (next) {
      setRows((prev) => {
        const base = prev ?? [];
        const key = anchorMatchKey(next.value.anchor);
        const withoutStale = base.filter((r) => anchorMatchKey(r.value.anchor) !== key);
        return [...withoutStale, next];
      });
      setError(false); // a successful mutation proves we're not in a genuine error state
    }
    refresh();
    return memory;
  }

  const value = useMemo<RedFlagContextValue>(
    () => ({
      flagFor: (anchor) => byKey.get(anchorMatchKey(anchor)) ?? null,
      loading: rows === null,
      error,
      create: async (input) => {
        // review round-5 item 11 — "disable create until initial load":
        // before the batched scope query has EVER completed once, we
        // genuinely don't know whether this anchor already has an open
        // flag someone else recorded — creating blind risks a confusing
        // CONFLICT (or, worse, a Human believing they just flagged
        // something for the first time when it was already flagged).
        if (rows === null) {
          throw new Error('Red flag data is still loading — please wait a moment and try again.');
        }
        const { memory } = await trpc.redFlag.create.mutate({ organizationId: PILOT_ORGANIZATION, operationId: crypto.randomUUID(), ...input });
        return applyLocally(memory);
      },
      clear: async (flagId) => {
        const { memory } = await trpc.redFlag.clear.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
        return applyLocally(memory);
      },
      reopen: async (flagId) => {
        const { memory } = await trpc.redFlag.reopen.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
        return applyLocally(memory);
      },
      updateReason: async (flagId, reason) => {
        const { memory } = await trpc.redFlag.updateReason.mutate({ organizationId: PILOT_ORGANIZATION, flagId, reason });
        return applyLocally(memory);
      },
      forget: async (flagId) => {
        await trpc.redFlag.forget.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
        setRows((prev) => (prev ? prev.filter((r) => r.row.id !== flagId) : prev));
        refresh();
      },
      enactCorrection: async (flagId) => {
        const { memory } = await trpc.redFlag.enactCorrection.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
        return applyLocally(memory);
      },
      revokeCorrection: async (flagId) => {
        const { memory } = await trpc.redFlag.revokeCorrection.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
        return applyLocally(memory);
      },
      retryLearning: async (flagId) => {
        // review round-5 item 4: a stable client operationId, same
        // idempotency contract as create() — a client's own retry-of-a-
        // retry (e.g. a double-click before the first response lands)
        // converges instead of attempting the governed step twice.
        const { memory } = await trpc.redFlag.retryLearning.mutate({ organizationId: PILOT_ORGANIZATION, flagId, operationId: crypto.randomUUID() });
        return applyLocally(memory);
      },
      retryLoad: refresh,
    }),
    [byKey, rows, error, refresh],
  );

  return <RedFlagContext.Provider value={value}>{children}</RedFlagContext.Provider>;
}
