import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

interface ActiveWorkspaceContext {
  workspaceId: string;
  userId?: string;
}

const activeContexts = new WeakMap<object, ActiveWorkspaceContext>();

function activeContext(db: Database): ActiveWorkspaceContext | undefined {
  return activeContexts.get(db as object);
}

function assertCompatibleContext(
  active: ActiveWorkspaceContext,
  requested: ActiveWorkspaceContext,
): void {
  if (active.workspaceId !== requested.workspaceId) {
    throw new Error(
      `RLS context cannot switch Organization inside one transaction: ` +
        `"${active.workspaceId}" -> "${requested.workspaceId}"`,
    );
  }
  if (
    active.userId !== undefined &&
    requested.userId !== undefined &&
    active.userId !== requested.userId
  ) {
    throw new Error(
      `RLS context cannot switch user inside one transaction: ` +
        `"${active.userId}" -> "${requested.userId}"`,
    );
  }
}

/**
 * Run workspace-scoped DML inside a transaction whose RLS settings are local
 * to that transaction. This is safe with Supavisor/PgBouncer connection reuse:
 * neither Organization nor user identity survives commit/rollback.
 */
export async function withWorkspaceContext<T>(
  db: Database,
  context: ActiveWorkspaceContext,
  operation: (tx: Database) => Promise<T>,
): Promise<T> {
  const active = activeContext(db);
  if (active) {
    assertCompatibleContext(active, context);
    if (context.userId !== undefined && active.userId === undefined) {
      await db.execute(
        sql`SELECT set_config('app.user_id', ${context.userId}, true)`,
      );
      active.userId = context.userId;
    }
    return operation(db);
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('app.workspace_id', ${context.workspaceId}, true),
        set_config('app.user_id', ${context.userId ?? ""}, true)
    `);
    const scopedDb = tx as Database;
    activeContexts.set(scopedDb as object, { ...context });
    return operation(scopedDb);
  });
}

export function withWorkspaceOnly<T>(
  db: Database,
  workspaceId: string,
  operation: (tx: Database) => Promise<T>,
): Promise<T> {
  return withWorkspaceContext(db, { workspaceId }, operation);
}

/**
 * Store methods that receive only a row id use the runtime's configured pilot
 * Organization. Tests and owner-level migration utilities may omit it.
 */
export function withDefaultWorkspace<T>(
  db: Database,
  defaultWorkspaceId: string | undefined,
  operation: (tx: Database) => Promise<T>,
): Promise<T> {
  return defaultWorkspaceId
    ? withWorkspaceOnly(db, defaultWorkspaceId, operation)
    : operation(db);
}
