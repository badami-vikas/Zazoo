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
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { trpc, PILOT_WORKSPACE } from '../../lib/trpc';

type CreateInput = Parameters<typeof trpc.redFlag.create.mutate>[0];
export type RedFlagAnchor = CreateInput['anchor'];
type ScopeInput = Parameters<typeof trpc.redFlag.listForScope.query>[0];
export type RedFlagScope = Omit<ScopeInput, 'workspaceId'>;
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
  create(input: { anchor: RedFlagAnchor; renderedValue: string; renderedVersion?: string; reason?: string }): Promise<RedFlagMemory>;
  clear(flagId: string): Promise<RedFlagMemory>;
  reopen(flagId: string): Promise<RedFlagMemory>;
  updateReason(flagId: string, reason: string): Promise<RedFlagMemory>;
  forget(flagId: string): Promise<void>;
  enactCorrection(flagId: string): Promise<RedFlagMemory>;
  revokeCorrection(flagId: string): Promise<RedFlagMemory>;
}

const RedFlagContext = createContext<RedFlagContextValue | null>(null);

export function useRedFlagContext(): RedFlagContextValue {
  const ctx = useContext(RedFlagContext);
  if (!ctx) throw new Error('RedFlagControl must be rendered within a RedFlagProvider');
  return ctx;
}

export function RedFlagProvider({ scope, children }: { scope: RedFlagScope; children: ReactNode }) {
  const [rows, setRows] = useState<RedFlagRow[] | null>(null);
  const scopeKey = JSON.stringify(scope);

  const refresh = useCallback(() => {
    trpc.redFlag.listForScope
      .query({ workspaceId: PILOT_WORKSPACE, ...scope })
      .then((result) => setRows(result.flags))
      .catch(() => setRows([]));
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
    }
    refresh();
    return memory;
  }

  const value = useMemo<RedFlagContextValue>(
    () => ({
      flagFor: (anchor) => byKey.get(anchorMatchKey(anchor)) ?? null,
      loading: rows === null,
      create: async (input) => {
        const { memory } = await trpc.redFlag.create.mutate({ workspaceId: PILOT_WORKSPACE, operationId: crypto.randomUUID(), ...input });
        return applyLocally(memory);
      },
      clear: async (flagId) => {
        const { memory } = await trpc.redFlag.clear.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        return applyLocally(memory);
      },
      reopen: async (flagId) => {
        const { memory } = await trpc.redFlag.reopen.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        return applyLocally(memory);
      },
      updateReason: async (flagId, reason) => {
        const { memory } = await trpc.redFlag.updateReason.mutate({ workspaceId: PILOT_WORKSPACE, flagId, reason });
        return applyLocally(memory);
      },
      forget: async (flagId) => {
        await trpc.redFlag.forget.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        setRows((prev) => (prev ? prev.filter((r) => r.row.id !== flagId) : prev));
        refresh();
      },
      enactCorrection: async (flagId) => {
        const { memory } = await trpc.redFlag.enactCorrection.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        return applyLocally(memory);
      },
      revokeCorrection: async (flagId) => {
        const { memory } = await trpc.redFlag.revokeCorrection.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        return applyLocally(memory);
      },
    }),
    [byKey, rows, refresh],
  );

  return <RedFlagContext.Provider value={value}>{children}</RedFlagContext.Provider>;
}
