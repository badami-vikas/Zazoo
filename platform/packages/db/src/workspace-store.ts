/**
 * DrizzleWorkspaceStore — direct-DB CRUD for workspaces + membership.
 *
 * This is NOT a governed pipeline action: creating a workspace or inviting a
 * teammate is authenticated CRUD (same tier as reading your own workspace
 * list), not an external-effect skill, so it never goes through
 * UniversalActionPipeline.propose(). See docs/raw/decisions-log.md.
 *
 * Membership is flat: `workspaceMembers` IS the team-member list for this UI.
 * The schema's separate `teams`/`team_members` tables model sub-teams WITHIN a
 * workspace (a finer-grained grouping) and are out of scope here — nothing in
 * the current UI needs them, and adding a team_members row implicitly for
 * every invite would invent a default team the schema doesn't require.
 *
 * `workspaceMembers.roleId` references `roles.id`, but `roles` rows are
 * workspace-scoped (workspace_id NOT NULL) and don't yet have a seeded
 * "owner"/"member" default anywhere in the system (no roles registry exists
 * for plain workspace CRUD). Rather than fabricate a dummy role row, roleId is
 * left null here — the same "type-wide, no role" shape `permissions` already
 * uses elsewhere (resourceId nullable = type-wide). A future roles pass can
 * backfill real role ids without changing this store's shape.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { users, workspaces, workspaceMembers } from "./schema.js";

export interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
}

export class DrizzleWorkspaceStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /** Create a workspace and add the creator as its first member. */
  async createWorkspace(name: string, creatorUserId: string): Promise<WorkspaceRow> {
    const id = randomUUID();
    const createdAt = new Date();
    await this.#db.insert(workspaces).values({ id, name, createdAt });
    await this.#db.insert(workspaceMembers).values({
      workspaceId: id,
      userId: creatorUserId,
      roleId: null,
    });
    return { id, name, createdAt: createdAt.toISOString() };
  }

  /** Workspaces the given user is a member of. */
  async listWorkspaces(userId: string): Promise<WorkspaceRow[]> {
    const memberships = await this.#db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    const ids = memberships.map((m) => m.workspaceId);
    if (ids.length === 0) return [];
    const rows = await this.#db.select().from(workspaces).where(inArray(workspaces.id, ids));
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * Invite a member by email: find-or-create the user, then add them as a
   * workspace member (no-op if already a member).
   */
  async inviteMember(workspaceId: string, email: string): Promise<{ userId: string; email: string }> {
    const existing = await this.#db.select().from(users).where(eq(users.email, email)).limit(1);
    let userId: string;
    if (existing[0]) {
      userId = existing[0].id;
    } else {
      userId = randomUUID();
      await this.#db.insert(users).values({ id: userId, email, createdAt: new Date() });
    }

    const alreadyMember = await this.#db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .then((rows) => rows.some((r) => r.userId === userId));
    if (!alreadyMember) {
      await this.#db.insert(workspaceMembers).values({ workspaceId, userId, roleId: null });
    }

    return { userId, email };
  }

  /** Members of a workspace. */
  async listMembers(workspaceId: string): Promise<MemberRow[]> {
    const memberships = await this.#db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    const ids = memberships.map((m) => m.userId);
    if (ids.length === 0) return [];
    const rows = await this.#db.select().from(users).where(inArray(users.id, ids));
    return rows.map((r) => ({ userId: r.id, email: r.email, name: r.name ?? null }));
  }

  /**
   * True when `userId` is a member of `workspaceId`. Backs the SEC-6 membership
   * check in the API router: workspace-scoped procedures must verify the caller
   * actually belongs to the workspace, not merely that the id is the pilot one.
   */
  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const rows = await this.#db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Idempotent find-or-create for the pilot workspace + pilot user rows. Every FK'd
   * write that references `workspaces.id`/`users.id` (e.g. `integrations.workspace_id`
   * via `integration.connect`, or `workspace_members.user_id` via `workspace.create`)
   * throws a raw Postgres FK violation (23503) against a real/persistent DB unless
   * these rows already exist — there is no migration seed for them, since the pilot
   * ids are structural constants (`wiring.ts`), not migration data. Safe to call on
   * every boot: no-ops if the rows are already present.
   */
  async bootstrapPilotIdentities(input: { workspaceId: string; userId: string; userEmail: string }): Promise<void> {
    await this.#db
      .insert(workspaces)
      .values({ id: input.workspaceId, name: "Pilot Organization", createdAt: new Date() })
      .onConflictDoNothing({ target: workspaces.id });
    await this.#db
      .update(workspaces)
      .set({ name: "Pilot Organization" })
      .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.name, "Pilot workspace")));
    await this.#db
      .insert(users)
      .values({ id: input.userId, email: input.userEmail, createdAt: new Date() })
      .onConflictDoNothing({ target: users.id });
    // SEC-6: the pilot user must be a MEMBER of the pilot workspace, not just an
    // existing user row — otherwise the membership check (`isMember`) would refuse
    // the pilot identity that every tokenless/dev request falls back to.
    await this.#db
      .insert(workspaceMembers)
      .values({ workspaceId: input.workspaceId, userId: input.userId, roleId: null })
      .onConflictDoNothing({ target: [workspaceMembers.workspaceId, workspaceMembers.userId] });
  }
}
