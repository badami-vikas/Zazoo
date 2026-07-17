/**
 * RedFlagProvider — the batched data layer behind every `RedFlagControl` on
 * one page/table (TASK-010 review remediation item 7: "eliminate per-cell
 * N+1"). ONE `redFlag.listForScope` query covers an entire visible
 * table/record's worth of cells/bullets; `RedFlagControl` consumes the
 * result via `useRedFlagContext()` instead of querying on its own mount.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { trpc, PILOT_WORKSPACE } from '../../lib/trpc';

type CreateInput = Parameters<typeof trpc.redFlag.create.mutate>[0];
export type RedFlagAnchor = CreateInput['anchor'];
type ScopeInput = Parameters<typeof trpc.redFlag.listForScope.query>[0];
export type RedFlagScope = Omit<ScopeInput, 'workspaceId'>;
type ListResult = Awaited<ReturnType<typeof trpc.redFlag.listForScope.query>>;
export type RedFlagRow = ListResult['flags'][number];

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

interface RedFlagContextValue {
  flagFor(anchor: RedFlagAnchor): RedFlagRow | null;
  loading: boolean;
  create(input: { anchor: RedFlagAnchor; renderedValue: string; renderedVersion?: string; reason?: string }): Promise<void>;
  clear(flagId: string): Promise<void>;
  reopen(flagId: string): Promise<void>;
  updateReason(flagId: string, reason: string): Promise<void>;
  forget(flagId: string): Promise<void>;
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

  const value = useMemo<RedFlagContextValue>(
    () => ({
      flagFor: (anchor) => byKey.get(anchorMatchKey(anchor)) ?? null,
      loading: rows === null,
      create: async (input) => {
        await trpc.redFlag.create.mutate({ workspaceId: PILOT_WORKSPACE, operationId: crypto.randomUUID(), ...input });
        refresh();
      },
      clear: async (flagId) => {
        await trpc.redFlag.clear.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        refresh();
      },
      reopen: async (flagId) => {
        await trpc.redFlag.reopen.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        refresh();
      },
      updateReason: async (flagId, reason) => {
        await trpc.redFlag.updateReason.mutate({ workspaceId: PILOT_WORKSPACE, flagId, reason });
        refresh();
      },
      forget: async (flagId) => {
        await trpc.redFlag.forget.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
        refresh();
      },
    }),
    [byKey, rows, refresh],
  );

  return <RedFlagContext.Provider value={value}>{children}</RedFlagContext.Provider>;
}
