import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

export interface OrganizationContext {
  organizationId: string;
  userId?: string;
}

const activeContexts = new WeakMap<object, OrganizationContext>();

function activeContext(db: Database): OrganizationContext | undefined {
  return activeContexts.get(db as object);
}

function assertCompatibleContext(
  active: OrganizationContext,
  requested: OrganizationContext,
): void {
  if (active.organizationId !== requested.organizationId) {
    throw new Error(
      `RLS context cannot switch Organization inside one transaction: ` +
        `"${active.organizationId}" -> "${requested.organizationId}"`,
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
 * Run Organization-scoped DML inside a transaction whose RLS settings are
 * local to that transaction. This is safe with pooled connection reuse:
 * neither Organization nor user identity survives commit/rollback.
 */
export async function withOrganizationContext<T>(
  db: Database,
  context: OrganizationContext,
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
        set_config('app.organization_id', ${context.organizationId}, true),
        set_config('app.user_id', ${context.userId ?? ""}, true)
    `);
    const scopedDb = tx as Database;
    activeContexts.set(scopedDb as object, { ...context });
    return operation(scopedDb);
  });
}

export function withOrganizationOnly<T>(
  db: Database,
  organizationId: string,
  operation: (tx: Database) => Promise<T>,
): Promise<T> {
  return withOrganizationContext(db, { organizationId }, operation);
}

/**
 * Store methods that receive only a row id use the runtime's configured pilot
 * Organization. Tests and owner-level migration utilities may omit it.
 */
export function withDefaultOrganization<T>(
  db: Database,
  defaultOrganizationId: string | undefined,
  operation: (tx: Database) => Promise<T>,
): Promise<T> {
  return defaultOrganizationId
    ? withOrganizationOnly(db, defaultOrganizationId, operation)
    : operation(db);
}
