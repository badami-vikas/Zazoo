/**
 * DrizzleOrganizationStore — direct-DB CRUD for organizations + membership.
 *
 * This is NOT a governed pipeline action: creating a organization or inviting a
 * teammate is authenticated CRUD (same tier as reading your own organization
 * list), not an external-effect skill, so it never goes through
 * UniversalActionPipeline.propose(). See docs/raw/decisions-log.md.
 *
 * Membership is flat: `organizationMembers` IS the team-member list for this UI.
 * The schema's separate `teams`/`team_members` tables model sub-teams WITHIN a
 * organization (a finer-grained grouping) and are out of scope here — nothing in
 * the current UI needs them, and adding a team_members row implicitly for
 * every invite would invent a default team the schema doesn't require.
 *
 * `organizationMembers.roleId` references `roles.id`, but `roles` rows are
 * organization-scoped (organization_id NOT NULL) and don't yet have a seeded
 * "owner"/"member" default anywhere in the system (no roles registry exists
 * for plain organization CRUD). Rather than fabricate a dummy role row, roleId is
 * left null here — the same "type-wide, no role" shape `permissions` already
 * uses elsewhere (resourceId nullable = type-wide). A future roles pass can
 * backfill real role ids without changing this store's shape.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { users, organizations, organizationMembers } from "./schema.js";
import {
  withOrganizationContext,
  withOrganizationOnly,
} from "./organization-context.js";

export interface OrganizationRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
}

export class UnknownOrganizationError extends Error {
  constructor(readonly organizationId: string) {
    super(`organization: unknown id ${organizationId}`);
    this.name = "UnknownOrganizationError";
  }
}

export class OrganizationRenameRollbackError extends Error {
  constructor(
    readonly renameError: unknown,
    readonly rollbackError: unknown,
  ) {
    super("organization: rename failed and its external state could not be restored", {
      cause: new AggregateError([renameError, rollbackError]),
    });
    this.name = "OrganizationRenameRollbackError";
  }
}

export class OrganizationRenameCoordinatorUnavailableError extends Error {
  constructor() {
    super("organization: Organization Files rename coordinator is not configured");
    this.name = "OrganizationRenameCoordinatorUnavailableError";
  }
}

export interface OrganizationRenameLease {
  recover(currentOrganizationName: string): Promise<void>;
  rename(
    previousOrganizationName: string,
    nextOrganizationName: string,
  ): Promise<void>;
  complete(): Promise<void>;
}

export interface OrganizationRenameCoordinator {
  createLease(organizationId: string): Promise<OrganizationRenameLease>;
}

export class DrizzleOrganizationStore {
  #db: Database;
  #renameCoordinator: OrganizationRenameCoordinator | undefined;
  constructor(db: Database, renameCoordinator?: OrganizationRenameCoordinator) {
    this.#db = db;
    this.#renameCoordinator = renameCoordinator;
  }

  /** Create a organization and add the creator as its first member. */
  async createOrganization(name: string, creatorUserId: string): Promise<OrganizationRow> {
    const id = randomUUID();
    const createdAt = new Date();
    await withOrganizationContext(this.#db, { organizationId: id, userId: creatorUserId }, async (tx) => {
      await tx.insert(organizations).values({ id, name, createdAt });
      await tx.insert(organizationMembers).values({
        organizationId: id,
        userId: creatorUserId,
        roleId: null,
      });
    });
    return { id, name, createdAt: createdAt.toISOString() };
  }

  /** Organizations the given user is a member of. */
  async listOrganizations(userId: string): Promise<OrganizationRow[]> {
    const candidates = await this.#db.select().from(organizations);
    const rows: OrganizationRow[] = [];
    for (const candidate of candidates) {
      if (await this.isMember(candidate.id, userId)) {
        rows.push({
          id: candidate.id,
          name: candidate.name,
          createdAt: candidate.createdAt.toISOString(),
        });
      }
    }
    return rows;
  }

  /**
   * Run a local Files operation against the row-locked current Organization
   * name after recovering any interrupted rename.
   */
  async withLockedOrganizationFiles<T>(
    organizationId: string,
    operation: (organization: OrganizationRow) => Promise<T>,
  ): Promise<T> {
    const coordinator = this.#renameCoordinator;
    if (!coordinator) throw new OrganizationRenameCoordinatorUnavailableError();
    const lease = await coordinator.createLease(organizationId);
    return this.#db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update")
        .limit(1);
      if (!locked) throw new UnknownOrganizationError(organizationId);
      const current: OrganizationRow = {
        id: locked.id,
        name: locked.name,
        createdAt: locked.createdAt.toISOString(),
      };
      await lease.recover(current.name);
      return operation(current);
    });
  }

  /**
   * Rename an Organization only through the injected Files coordinator. The
   * coordinator owns the durable intent; database row locks serialize recovery,
   * Files movement, commit, and any post-failure reconciliation across processes.
   */
  async renameOrganization(
    organizationId: string,
    name: string,
    options: { ifCurrentName?: string } = {},
  ): Promise<OrganizationRow> {
    const coordinator = this.#renameCoordinator;
    if (!coordinator) throw new OrganizationRenameCoordinatorUnavailableError();
    const lease = await coordinator.createLease(organizationId);
    let organizationLocked = false;
    let renamed: OrganizationRow;
    try {
      renamed = await this.#db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .for("update")
          .limit(1);
        if (!locked) throw new UnknownOrganizationError(organizationId);
        organizationLocked = true;
        const current: OrganizationRow = {
          id: locked.id,
          name: locked.name,
          createdAt: locked.createdAt.toISOString(),
        };
        await lease.recover(current.name);
        if (
          options.ifCurrentName !== undefined &&
          current.name !== options.ifCurrentName
        ) {
          return current;
        }
        await lease.rename(current.name, name);
        const [updated] = await tx
          .update(organizations)
          .set({ name })
          .where(eq(organizations.id, organizationId))
          .returning();
        if (!updated) throw new UnknownOrganizationError(organizationId);
        return {
          id: updated.id,
          name: updated.name,
          createdAt: updated.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if (!organizationLocked) throw error;
      try {
        await this.#db.transaction(async (tx) => {
          const [locked] = await tx
            .select()
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .for("update")
            .limit(1);
          if (!locked) throw new UnknownOrganizationError(organizationId);
          await lease.recover(locked.name);
        });
      } catch (recoveryError) {
        throw new OrganizationRenameRollbackError(error, recoveryError);
      }
      throw error;
    }
    await this.#db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update")
        .limit(1);
      if (!locked) throw new UnknownOrganizationError(organizationId);
      await lease.complete();
    });
    return renamed;
  }

  /**
   * Invite a member by email: find-or-create the user, then add them as a
   * organization member (no-op if already a member).
   */
  async inviteMember(organizationId: string, email: string): Promise<{ userId: string; email: string }> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const existing = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      const userId = existing[0]?.id ?? randomUUID();
      if (!existing[0]) {
        await tx.insert(users).values({ id: userId, email, createdAt: new Date() });
      }
      await tx
        .insert(organizationMembers)
        .values({ organizationId, userId, roleId: null })
        .onConflictDoNothing({
          target: [organizationMembers.organizationId, organizationMembers.userId],
        });
      return { userId, email };
    });
  }

  /** Members of a organization. */
  async listMembers(organizationId: string): Promise<MemberRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const memberships = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));
    const ids = memberships.map((m) => m.userId);
    if (ids.length === 0) return [];
    const rows = await tx.select().from(users).where(inArray(users.id, ids));
    return rows.map((r) => ({ userId: r.id, email: r.email, name: r.name ?? null }));
    });
  }

  /**
   * True when `userId` is a member of `organizationId`. Backs the SEC-6 membership
   * check in the API router: organization-scoped procedures must verify the caller
   * actually belongs to the organization, not merely that the id is the pilot one.
   */
  async isMember(organizationId: string, userId: string): Promise<boolean> {
    return withOrganizationContext(this.#db, { organizationId, userId }, async (tx) => {
    const rows = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    return rows.length > 0;
    });
  }

  /** Idempotently bind a verified Auth subject to the pilot Organization. */
  async ensureMember(input: {
    organizationId: string;
    userId: string;
    userEmail: string;
  }): Promise<void> {
    await withOrganizationContext(
      this.#db,
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        await tx
          .insert(users)
          .values({
            id: input.userId,
            email: input.userEmail,
            createdAt: new Date(),
          })
          .onConflictDoUpdate({
            target: users.id,
            set: { email: input.userEmail },
          });
        await tx
          .insert(organizationMembers)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            roleId: null,
          })
          .onConflictDoNothing({
            target: [organizationMembers.organizationId, organizationMembers.userId],
          });
      },
    );
  }

  /**
   * Idempotent find-or-create for the pilot organization + pilot user rows. Every FK'd
   * write that references `organizations.id`/`users.id` (e.g. `integrations.organization_id`
   * via `integration.connect`, or `organization_members.user_id` via `organization.create`)
   * throws a raw Postgres FK violation (23503) against a real/persistent DB unless
   * these rows already exist — there is no migration seed for them, since the pilot
   * ids are structural constants (`wiring.ts`), not migration data. Safe to call on
   * every boot: no-ops if the rows are already present.
   */
  async bootstrapPilotIdentities(input: { organizationId: string; userId: string; userEmail: string }): Promise<void> {
    await withOrganizationContext(
      this.#db,
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
    await tx
      .insert(organizations)
      .values({ id: input.organizationId, name: "Pilot Organization", createdAt: new Date() })
      .onConflictDoNothing({ target: organizations.id });
    await tx
      .insert(users)
      .values({ id: input.userId, email: input.userEmail, createdAt: new Date() })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: input.userEmail },
      });
    // SEC-6: the pilot user must be a MEMBER of the pilot organization, not just an
    // existing user row — otherwise the membership check (`isMember`) would refuse
    // the pilot identity that every tokenless/dev request falls back to.
    await tx
      .insert(organizationMembers)
      .values({ organizationId: input.organizationId, userId: input.userId, roleId: null })
      .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] });
      },
    );
  }
}
