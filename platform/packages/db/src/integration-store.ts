/**
 * DrizzleIntegrationStore — the governed surface for connected integrations and
 * their USER-EDITABLE permissions (Slice B).
 *
 * An integration is an `integration`-type actor. The Bridge capabilities it holds
 * (external:fetch, person:read, event:write, …) are CBAC grants in the
 * `permissions` table, revocable via `revoked_at` (history is never deleted).
 * Time-boxed access uses `ephemeral_grants`. The Authority resolver reads these
 * the same way it does for any actor, so edits here change real enforcement.
 *
 * Two scope kinds are NON-GRANTABLE as a standing allow: external:send and
 * network_graph:full are agent-floor DENY — egress that always requires human
 * approval at run time. The UI surfaces them as "always requires approval"; an
 * attempt to grant one is refused here, structurally.
 *
 * Binds the shared Database union, so it runs on the LOCAL plane (where private
 * integration records + tokens belong) or cloud.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { ALWAYS_APPROVAL_SCOPES } from "@bridge/core";
import type { Database } from "./client.js";
import { integrations, permissions } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

/** Actor type used for an integration's CBAC grants. */
export const INTEGRATION_ACTOR_TYPE = "integration";

/**
 * Scopes that can never be a standing allow — always human-approved at run time.
 * Re-exported from @bridge/core's canonical agent-floor definition (the single
 * source of truth shared with `agentFloorDeny` and `isForbiddenAgentToken`) so
 * this store's refusal never drifts from the runtime floor it is protecting.
 */
export { ALWAYS_APPROVAL_SCOPES };

export interface IntegrationRow {
  id: string;
  provider: string;
  scopes: string[];
  status: string;
}

export interface ScopeGrant {
  id: string;
  resourceType: string;
  action: string;
  effect: string;
  /** ISO string when this grant expires, or null for a standing grant. */
  expiresAt: string | null;
}

/** Raised when a caller tries to grant an agent-floor DENY scope as a standing allow. */
export class IntegrationFloorScopeError extends Error {
  constructor(public readonly scope: string) {
    super(
      `scope "${scope}" is agent-floor DENY and always requires approval; ` +
        `it cannot be granted as a standing permission`,
    );
    this.name = "IntegrationFloorScopeError";
  }
}

export class DrizzleIntegrationStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /** Connected integrations for a organization. */
  async list(organizationId: string): Promise<IntegrationRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select({
        id: integrations.id,
        provider: integrations.provider,
        scopes: integrations.scopes,
        status: integrations.status,
      })
      .from(integrations)
      .where(eq(integrations.organizationId, organizationId));
    return rows.map((r) => ({ id: r.id, provider: r.provider, scopes: r.scopes ?? [], status: r.status }));
    });
  }

  /** Record a connected integration (OAuth scopes are the platform-declared list). */
  async connect(organizationId: string, provider: string, oauthScopes: string[] = []): Promise<IntegrationRow> {
    // Ids are generated here rather than via .returning(): the Database union
    // (postgres-js | pglite) has divergent .returning() typings, so we avoid it.
    const id = randomUUID();
    await withOrganizationOnly(this.#db, organizationId, async (tx) => {
      await tx.insert(integrations).values({ id, organizationId, provider, scopes: oauthScopes, status: "active" });
    });
    return { id, provider, scopes: oauthScopes, status: "active" };
  }

  /** Mark an integration revoked and revoke every standing grant it held. */
  async disconnect(organizationId: string, integrationId: string, at: Date = new Date()): Promise<void> {
    await withOrganizationOnly(this.#db, organizationId, async (tx) => {
    await tx
      .update(integrations)
      .set({ status: "revoked" })
      .where(and(eq(integrations.organizationId, organizationId), eq(integrations.id, integrationId)));
    await tx
      .update(permissions)
      .set({ revokedAt: at })
      .where(
        and(
          eq(permissions.organizationId, organizationId),
          eq(permissions.actorType, INTEGRATION_ACTOR_TYPE),
          eq(permissions.actorId, integrationId),
          isNull(permissions.revokedAt),
        ),
      );
    });
  }

  /** Active (non-revoked) Bridge capability grants held by an integration. */
  async listScopes(organizationId: string, integrationId: string): Promise<ScopeGrant[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select({
        id: permissions.id,
        resourceType: permissions.resourceType,
        action: permissions.action,
        effect: permissions.effect,
        expiresAt: permissions.expiresAt,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.organizationId, organizationId),
          eq(permissions.actorType, INTEGRATION_ACTOR_TYPE),
          eq(permissions.actorId, integrationId),
          isNull(permissions.revokedAt),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      resourceType: r.resourceType,
      action: r.action,
      effect: r.effect,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    }));
    });
  }

  /**
   * Grant a standing Bridge capability to an integration. Refuses agent-floor DENY
   * scopes (external:send, network_graph:full) — those are always-approval, never a
   * standing allow.
   */
  async grantScope(args: {
    organizationId: string;
    integrationId: string;
    resourceType: string;
    action: string;
    grantedBy?: string;
    expiresAt?: Date;
  }): Promise<ScopeGrant> {
    if (ALWAYS_APPROVAL_SCOPES.includes(args.resourceType)) {
      throw new IntegrationFloorScopeError(args.resourceType);
    }
    const id = randomUUID();
    await withOrganizationOnly(this.#db, args.organizationId, async (tx) => {
    await tx.insert(permissions).values({
      id,
      organizationId: args.organizationId,
      actorType: INTEGRATION_ACTOR_TYPE,
      actorId: args.integrationId,
      resourceType: args.resourceType,
      action: args.action,
      effect: "allow",
      ...(args.grantedBy ? { grantedBy: args.grantedBy } : {}),
      ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    });
    });
    return {
      id,
      resourceType: args.resourceType,
      action: args.action,
      effect: "allow",
      expiresAt: args.expiresAt ? args.expiresAt.toISOString() : null,
    };
  }

  /** Revoke a single standing grant (narrowing). Append-only: sets revoked_at. */
  async revokeScope(organizationId: string, permissionId: string, at: Date = new Date()): Promise<void> {
    await withOrganizationOnly(this.#db, organizationId, async (tx) => {
    await tx
      .update(permissions)
      .set({ revokedAt: at })
      .where(and(eq(permissions.organizationId, organizationId), eq(permissions.id, permissionId)));
    });
  }
}
