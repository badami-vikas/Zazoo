import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { relationMaterializationEffects } from "./schema.js";

export type RelationMaterializationStatus = "pending" | "applied" | "failed";
export type RelationMaterializationEffect =
  typeof relationMaterializationEffects.$inferSelect;

export interface EnsureRelationMaterializationInput {
  workspaceId: string;
  ownerUserId: string;
  proposalLedgerId: string;
  decisionLedgerId: string;
}

export interface RelationMaterializationAttempt {
  effect: RelationMaterializationEffect;
  started: boolean;
}

export interface RelationMaterializationCursor {
  id: string;
}

export interface RelationMaterializationPage {
  items: RelationMaterializationEffect[];
  nextCursor: RelationMaterializationCursor | null;
}

const RELATIONSHIP_MUTATION_KINDS = [
  "relationship_record_mutation",
  "relationship_interaction_create",
] as const;

interface StoreContext {
  workspaceId: string;
  userId: string | null;
}

const MATERIALIZATION_LEASE_MS = 5 * 60_000;

export class DrizzleRelationMaterializationStore {
  readonly #db: Database;
  readonly #context: StoreContext | null;

  constructor(db: Database, context: StoreContext | null = null) {
    this.#db = db;
    this.#context = context;
  }

  #hasContext(workspaceId: string, ownerUserId: string): boolean {
    return (
      this.#context?.workspaceId === workspaceId &&
      this.#context.userId === ownerUserId
    );
  }

  #hasWorkspaceContext(workspaceId: string): boolean {
    return this.#context?.workspaceId === workspaceId;
  }

  async #withWorkspace<T>(
    workspaceId: string,
    operation: (store: DrizzleRelationMaterializationStore) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`,
      );
      return operation(
        new DrizzleRelationMaterializationStore(tx, {
          workspaceId,
          userId: null,
        }),
      );
    });
  }

  async #withContext<T>(
    workspaceId: string,
    ownerUserId: string,
    operation: (store: DrizzleRelationMaterializationStore) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.workspace_id', ${workspaceId}, true),
          set_config('app.user_id', ${ownerUserId}, true)
      `);
      return operation(
        new DrizzleRelationMaterializationStore(tx, {
          workspaceId,
          userId: ownerUserId,
        }),
      );
    });
  }

  async ensure(
    input: EnsureRelationMaterializationInput,
  ): Promise<RelationMaterializationEffect> {
    const normalized = {
      workspaceId: input.workspaceId.toLowerCase(),
      ownerUserId: input.ownerUserId.toLowerCase(),
      proposalLedgerId: input.proposalLedgerId.toLowerCase(),
      decisionLedgerId: input.decisionLedgerId.toLowerCase(),
    };
    if (!this.#hasContext(normalized.workspaceId, normalized.ownerUserId)) {
      return this.#withContext(
        normalized.workspaceId,
        normalized.ownerUserId,
        (store) => store.ensure(normalized),
      );
    }
    await this.#db
      .insert(relationMaterializationEffects)
      .values(normalized)
      .onConflictDoNothing({
        target: [
          relationMaterializationEffects.workspaceId,
          relationMaterializationEffects.proposalLedgerId,
        ],
      });
    const effect = await this.getByProposal(
      normalized.workspaceId,
      normalized.ownerUserId,
      normalized.proposalLedgerId,
    );
    if (!effect || effect.decisionLedgerId !== normalized.decisionLedgerId) {
      throw new Error(
        "Relation materialization effect does not match the approved decision",
      );
    }
    return effect;
  }

  async getByProposal(
    workspaceId: string,
    ownerUserId: string,
    proposalLedgerId: string,
  ): Promise<RelationMaterializationEffect | null> {
    const normalizedWorkspaceId = workspaceId.toLowerCase();
    const normalizedOwnerUserId = ownerUserId.toLowerCase();
    const normalizedProposalId = proposalLedgerId.toLowerCase();
    if (!this.#hasContext(normalizedWorkspaceId, normalizedOwnerUserId)) {
      return this.#withContext(
        normalizedWorkspaceId,
        normalizedOwnerUserId,
        (store) =>
          store.getByProposal(
            normalizedWorkspaceId,
            normalizedOwnerUserId,
            normalizedProposalId,
          ),
      );
    }
    const rows = await this.#db
      .select()
      .from(relationMaterializationEffects)
      .where(
        and(
          eq(relationMaterializationEffects.workspaceId, normalizedWorkspaceId),
          eq(relationMaterializationEffects.ownerUserId, normalizedOwnerUserId),
          eq(
            relationMaterializationEffects.proposalLedgerId,
            normalizedProposalId,
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async beginAttempt(
    input: EnsureRelationMaterializationInput,
    attemptedAt: Date,
    opts: { allowExhausted?: boolean } = {},
  ): Promise<RelationMaterializationAttempt> {
    const normalizedWorkspaceId = input.workspaceId.toLowerCase();
    const normalizedOwnerUserId = input.ownerUserId.toLowerCase();
    if (!this.#hasContext(normalizedWorkspaceId, normalizedOwnerUserId)) {
      return this.#withContext(
        normalizedWorkspaceId,
        normalizedOwnerUserId,
        (store) => store.beginAttempt(input, attemptedAt, opts),
      );
    }
    const effect = await this.ensure(input);
    const lockedRows = await this.#db
      .select()
      .from(relationMaterializationEffects)
      .where(eq(relationMaterializationEffects.id, effect.id))
      .for("update")
      .limit(1);
    const locked = lockedRows[0];
    if (!locked) {
      throw new Error("Relation materialization effect disappeared before retry");
    }
    const leaseIsActive =
      locked.leaseToken !== null &&
      locked.leaseExpiresAt !== null &&
      locked.leaseExpiresAt.getTime() > attemptedAt.getTime();
    const failedAttemptBudgetExhausted =
      locked.status === "failed" &&
      locked.attemptCount >= locked.maxAttempts;
    const finalLeaseRecoveryExhausted =
      locked.status === "pending" &&
      locked.attemptCount >= locked.maxAttempts &&
      locked.leaseRecoveryCount >= locked.maxLeaseRecoveries;
    if (
      locked.status === "applied" ||
      leaseIsActive ||
      ((failedAttemptBudgetExhausted || finalLeaseRecoveryExhausted) &&
        !opts.allowExhausted)
    ) {
      return { effect: locked, started: false };
    }
    const extendingOwnerRetry =
      opts.allowExhausted === true &&
      (failedAttemptBudgetExhausted || finalLeaseRecoveryExhausted);
    const recoveringInterruptedFinalAttempt =
      locked.status === "pending" &&
      locked.attemptCount >= locked.maxAttempts &&
      !extendingOwnerRetry;
    const leaseToken = randomUUID();
    const rows = await this.#db
      .update(relationMaterializationEffects)
      .set({
        status: "pending",
        attemptCount: recoveringInterruptedFinalAttempt
          ? locked.attemptCount
          : locked.attemptCount + 1,
        maxAttempts: extendingOwnerRetry
          ? locked.maxAttempts + 1
          : locked.maxAttempts,
        leaseRecoveryCount: extendingOwnerRetry
          ? 0
          : recoveringInterruptedFinalAttempt
            ? locked.leaseRecoveryCount + 1
            : 0,
        lastAttemptedAt: attemptedAt,
        nextRetryAt: null,
        leaseToken,
        leaseExpiresAt: new Date(
          attemptedAt.getTime() + MATERIALIZATION_LEASE_MS,
        ),
        lastError: null,
        updatedAt: attemptedAt,
      })
      .where(eq(relationMaterializationEffects.id, locked.id))
      .returning();
    const started = rows[0];
    if (!started) {
      throw new Error("Relation materialization attempt could not be recorded");
    }
    return { effect: started, started: true };
  }

  async markApplied(
    effectId: string,
    workspaceId: string,
    ownerUserId: string,
    leaseToken: string,
    relationCount: number,
    appliedAt: Date,
  ): Promise<RelationMaterializationEffect> {
    if (!this.#hasContext(workspaceId, ownerUserId)) {
      return this.#withContext(workspaceId, ownerUserId, (store) =>
        store.markApplied(
          effectId,
          workspaceId,
          ownerUserId,
          leaseToken,
          relationCount,
          appliedAt,
        ),
      );
    }
    const rows = await this.#db
      .update(relationMaterializationEffects)
      .set({
        status: "applied",
        relationCount,
        lastError: null,
        nextRetryAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        appliedAt,
        updatedAt: appliedAt,
      })
      .where(
        and(
          eq(relationMaterializationEffects.id, effectId),
          eq(relationMaterializationEffects.workspaceId, workspaceId),
          eq(relationMaterializationEffects.ownerUserId, ownerUserId),
          eq(relationMaterializationEffects.leaseToken, leaseToken),
        ),
      )
      .returning();
    const effect = rows[0];
    if (!effect) {
      throw new Error("Relation materialization effect could not be applied");
    }
    return effect;
  }

  async markFailed(
    effectId: string,
    workspaceId: string,
    ownerUserId: string,
    leaseToken: string,
    error: string,
    failedAt: Date,
    nextRetryAt: Date | null,
  ): Promise<RelationMaterializationEffect> {
    if (!this.#hasContext(workspaceId, ownerUserId)) {
      return this.#withContext(workspaceId, ownerUserId, (store) =>
        store.markFailed(
          effectId,
          workspaceId,
          ownerUserId,
          leaseToken,
          error,
          failedAt,
          nextRetryAt,
        ),
      );
    }
    const rows = await this.#db
      .update(relationMaterializationEffects)
      .set({
        status: "failed",
        lastError: error,
        nextRetryAt,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(relationMaterializationEffects.id, effectId),
          eq(relationMaterializationEffects.workspaceId, workspaceId),
          eq(relationMaterializationEffects.ownerUserId, ownerUserId),
          eq(relationMaterializationEffects.leaseToken, leaseToken),
        ),
      )
      .returning();
    const effect = rows[0];
    if (!effect) {
      throw new Error("Relation materialization failure could not be recorded");
    }
    return effect;
  }

  async listRetryable(
    workspaceId: string,
    ownerUserId: string,
    opts: { limit: number; now?: Date },
  ): Promise<RelationMaterializationEffect[]> {
    if (!this.#hasContext(workspaceId, ownerUserId)) {
      return this.#withContext(workspaceId, ownerUserId, (store) =>
        store.listRetryable(workspaceId, ownerUserId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const now = opts.now ?? new Date();
    return this.#db
      .select()
      .from(relationMaterializationEffects)
      .where(
        and(
          eq(relationMaterializationEffects.workspaceId, workspaceId),
          eq(relationMaterializationEffects.ownerUserId, ownerUserId),
          sql<boolean>`(
            (
              ${relationMaterializationEffects.status} = 'pending'
              AND (
                ${relationMaterializationEffects.leaseExpiresAt} IS NULL
                OR ${relationMaterializationEffects.leaseExpiresAt} <= ${now}
              )
              AND (
                ${relationMaterializationEffects.attemptCount} < ${relationMaterializationEffects.maxAttempts}
                OR ${relationMaterializationEffects.leaseRecoveryCount} < ${relationMaterializationEffects.maxLeaseRecoveries}
              )
            )
            OR (
              ${relationMaterializationEffects.status} = 'failed'
              AND ${relationMaterializationEffects.attemptCount} < ${relationMaterializationEffects.maxAttempts}
              AND (
                ${relationMaterializationEffects.nextRetryAt} IS NULL
                OR ${relationMaterializationEffects.nextRetryAt} <= ${now}
              )
            )
          )`,
        ),
      )
      .orderBy(
        sql`${relationMaterializationEffects.nextRetryAt} ASC NULLS FIRST`,
        asc(relationMaterializationEffects.createdAt),
      )
      .limit(limit);
  }

  async discoverApproved(
    workspaceId: string,
    ownerUserId: string,
    opts: { limit: number },
  ): Promise<number> {
    const normalizedWorkspaceId = workspaceId.toLowerCase();
    const normalizedOwnerUserId = ownerUserId.toLowerCase();
    if (!this.#hasContext(normalizedWorkspaceId, normalizedOwnerUserId)) {
      return this.#withContext(
        normalizedWorkspaceId,
        normalizedOwnerUserId,
        (store) =>
          store.discoverApproved(normalizedWorkspaceId, normalizedOwnerUserId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const result = await this.#db.execute(sql`
      INSERT INTO relation_materialization_effects (
        workspace_id,
        owner_user_id,
        proposal_ledger_id,
        decision_ledger_id
      )
      SELECT
        decision.workspace_id,
        ${normalizedOwnerUserId}::uuid,
        proposal.id,
        decision.id
      FROM ledger AS decision
      JOIN ledger AS proposal
        ON proposal.id = decision.ref_ledger_id
       AND proposal.workspace_id = decision.workspace_id
      WHERE decision.workspace_id = ${normalizedWorkspaceId}::uuid
        AND decision.user_decision IN ('approve', 'edit')
        AND (
          (
            decision.resource_type = 'relation'
            AND proposal.resource_type = 'relation'
            AND proposal.inputs ->> 'kind' = 'relationship_signal_evidence'
          )
          OR (
            decision.resource_type = proposal.resource_type
            AND proposal.inputs ->> 'kind' IN (
              'relationship_record_mutation',
              'relationship_interaction_create'
            )
            AND (
              (proposal.inputs ->> 'kind' = 'relationship_record_mutation'
                AND proposal.resource_type IN ('person', 'community'))
              OR
              (proposal.inputs ->> 'kind' = 'relationship_interaction_create'
                AND proposal.resource_type = 'event')
            )
          )
          OR (
            decision.resource_type = 'event'
            AND proposal.resource_type = 'event'
            AND proposal.data_scope = 'private'
            AND jsonb_typeof(proposal.inputs -> 'directive' -> 'entities') = 'array'
            AND NOT (proposal.inputs -> 'directive' ? 'person')
            AND (
              SELECT count(*)
              FROM jsonb_array_elements(
                proposal.inputs -> 'directive' -> 'entities'
              ) AS intake_entity
              WHERE intake_entity ->> 'kind' = 'event'
                AND intake_entity ->> 'personId' IS NOT NULL
                AND intake_entity ->> 'source' IN ('gmail', 'google-calendar')
            ) = 1
          )
        )
        AND (
          CASE
            WHEN proposal.on_behalf_of_type = 'user' THEN proposal.on_behalf_of_id
            WHEN proposal.actor_type = 'user' THEN proposal.actor_id
            ELSE NULL
          END
        ) = ${normalizedOwnerUserId}
        AND (
          CASE
            WHEN decision.on_behalf_of_type = 'user' THEN decision.on_behalf_of_id
            WHEN decision.actor_type = 'user' THEN decision.actor_id
            ELSE NULL
          END
        ) = ${normalizedOwnerUserId}
        AND NOT EXISTS (
          SELECT 1
          FROM relation_materialization_effects AS existing
          WHERE existing.workspace_id = decision.workspace_id
            AND existing.proposal_ledger_id = proposal.id
        )
      ORDER BY
        decision.append_sequence ASC NULLS FIRST,
        decision.created_at ASC,
        decision.id ASC
      LIMIT ${limit}
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (Array.isArray(result)) return result.length;
    return (result as { rows?: unknown[] }).rows?.length ?? 0;
  }

  async listApprovedOwners(
    workspaceId: string,
    opts: { limit: number; afterOwnerUserId?: string },
  ): Promise<{ ownerUserIds: string[]; nextCursor: string | null }> {
    const normalizedWorkspaceId = workspaceId.toLowerCase();
    const afterOwnerUserId = opts.afterOwnerUserId?.toLowerCase();
    if (!this.#hasWorkspaceContext(normalizedWorkspaceId)) {
      return this.#withWorkspace(normalizedWorkspaceId, (store) =>
        store.listApprovedOwners(normalizedWorkspaceId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const result = await this.#db.execute(sql`
      WITH approved_owners AS (
        SELECT DISTINCT
          CASE
            WHEN proposal.on_behalf_of_type = 'user' THEN proposal.on_behalf_of_id
            WHEN proposal.actor_type = 'user' THEN proposal.actor_id
            ELSE NULL
          END AS owner_user_id
        FROM ledger AS decision
        JOIN ledger AS proposal
          ON proposal.id = decision.ref_ledger_id
         AND proposal.workspace_id = decision.workspace_id
        WHERE decision.workspace_id = ${normalizedWorkspaceId}::uuid
          AND decision.user_decision IN ('approve', 'edit')
          AND (
            (
              decision.resource_type = 'relation'
              AND proposal.resource_type = 'relation'
              AND proposal.inputs ->> 'kind' = 'relationship_signal_evidence'
            )
            OR (
              decision.resource_type = proposal.resource_type
              AND proposal.inputs ->> 'kind' IN (
                'relationship_record_mutation',
                'relationship_interaction_create'
              )
              AND (
                (proposal.inputs ->> 'kind' = 'relationship_record_mutation'
                  AND proposal.resource_type IN ('person', 'community'))
                OR
                (proposal.inputs ->> 'kind' = 'relationship_interaction_create'
                  AND proposal.resource_type = 'event')
              )
            )
            OR (
              decision.resource_type = 'event'
              AND proposal.resource_type = 'event'
              AND proposal.data_scope = 'private'
              AND jsonb_typeof(proposal.inputs -> 'directive' -> 'entities') = 'array'
              AND NOT (proposal.inputs -> 'directive' ? 'person')
              AND (
                SELECT count(*)
                FROM jsonb_array_elements(
                  proposal.inputs -> 'directive' -> 'entities'
                ) AS intake_entity
                WHERE intake_entity ->> 'kind' = 'event'
                  AND intake_entity ->> 'personId' IS NOT NULL
                  AND intake_entity ->> 'source' IN ('gmail', 'google-calendar')
              ) = 1
            )
          )
          AND (
            CASE
              WHEN proposal.on_behalf_of_type = 'user' THEN proposal.on_behalf_of_id
              WHEN proposal.actor_type = 'user' THEN proposal.actor_id
              ELSE NULL
            END
          ) = (
            CASE
              WHEN decision.on_behalf_of_type = 'user' THEN decision.on_behalf_of_id
              WHEN decision.actor_type = 'user' THEN decision.actor_id
              ELSE NULL
            END
          )
        UNION
        SELECT DISTINCT
          CASE
            WHEN proposal.on_behalf_of_type = 'user' THEN proposal.on_behalf_of_id
            WHEN proposal.actor_type = 'user' THEN proposal.actor_id
            ELSE NULL
          END AS owner_user_id
        FROM ledger AS proposal
        WHERE proposal.workspace_id = ${normalizedWorkspaceId}::uuid
          AND proposal.user_decision = 'auto'
          AND proposal.inputs ->> 'kind' IN (
            'relationship_record_mutation',
            'relationship_interaction_create'
          )
          AND (
            (proposal.inputs ->> 'kind' = 'relationship_record_mutation'
              AND proposal.resource_type IN ('person', 'community'))
            OR
            (proposal.inputs ->> 'kind' = 'relationship_interaction_create'
              AND proposal.resource_type = 'event')
          )
      )
      SELECT owner_user_id::text
      FROM approved_owners
      WHERE owner_user_id IS NOT NULL
        ${
          afterOwnerUserId
            ? sql`AND owner_user_id > ${afterOwnerUserId}::uuid`
            : sql``
        }
      ORDER BY owner_user_id
      LIMIT ${limit + 1}
    `);
    const rows = (
      Array.isArray(result)
        ? result
        : (result as { rows?: unknown[] }).rows ?? []
    ) as Array<{ owner_user_id: string }>;
    const page = rows.slice(0, limit).map((row) => row.owner_user_id);
    return {
      ownerUserIds: page,
      nextCursor:
        rows.length > limit ? page.at(-1) ?? null : null,
    };
  }

  /**
   * Auto-applied Human mutations have no separate decision row, so the RM4
   * effect table cannot represent them. Their lifecycle Event is the durable
   * materialization receipt; this bounded query finds ledger rows missing it.
   */
  async listUnmaterializedAutoMutationIds(
    workspaceId: string,
    ownerUserId: string,
    opts: { limit: number },
  ): Promise<string[]> {
    const normalizedWorkspaceId = workspaceId.toLowerCase();
    const normalizedOwnerUserId = ownerUserId.toLowerCase();
    if (!this.#hasContext(normalizedWorkspaceId, normalizedOwnerUserId)) {
      return this.#withContext(
        normalizedWorkspaceId,
        normalizedOwnerUserId,
        (store) =>
          store.listUnmaterializedAutoMutationIds(
            normalizedWorkspaceId,
            normalizedOwnerUserId,
            opts,
          ),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const result = await this.#db.execute(sql`
      SELECT proposal.id::text
      FROM ledger AS proposal
      WHERE proposal.workspace_id = ${normalizedWorkspaceId}::uuid
        AND proposal.user_decision = 'auto'
        AND proposal.inputs ->> 'kind' IN (${sql.join(
          RELATIONSHIP_MUTATION_KINDS.map((kind) => sql`${kind}`),
          sql`, `,
        )})
        AND (
          (proposal.inputs ->> 'kind' = 'relationship_record_mutation'
            AND proposal.resource_type IN ('person', 'community'))
          OR
          (proposal.inputs ->> 'kind' = 'relationship_interaction_create'
            AND proposal.resource_type = 'event')
        )
        AND (
          CASE
            WHEN proposal.on_behalf_of_type = 'user' THEN proposal.on_behalf_of_id
            WHEN proposal.actor_type = 'user' THEN proposal.actor_id
            ELSE NULL
          END
        ) = ${normalizedOwnerUserId}
        AND NOT EXISTS (
          SELECT 1
          FROM events AS materialized
          WHERE materialized.workspace_id = proposal.workspace_id
            AND materialized.payload ->> 'decisionLedgerId' = proposal.id::text
        )
      ORDER BY
        proposal.append_sequence ASC NULLS FIRST,
        proposal.created_at ASC,
        proposal.id ASC
      LIMIT ${limit}
    `);
    const rows = (
      Array.isArray(result)
        ? result
        : (result as { rows?: unknown[] }).rows ?? []
    ) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  async listOutstanding(
    workspaceId: string,
    ownerUserId: string,
    opts: { limit: number },
  ): Promise<RelationMaterializationEffect[]> {
    return (await this.listOutstandingPage(workspaceId, ownerUserId, opts)).items;
  }

  async listOutstandingPage(
    workspaceId: string,
    ownerUserId: string,
    opts: { limit: number; cursor?: RelationMaterializationCursor },
  ): Promise<RelationMaterializationPage> {
    if (!this.#hasContext(workspaceId, ownerUserId)) {
      return this.#withContext(workspaceId, ownerUserId, (store) =>
        store.listOutstandingPage(workspaceId, ownerUserId, opts),
      );
    }
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const rows = await this.#db
      .select()
      .from(relationMaterializationEffects)
      .where(
        and(
          eq(relationMaterializationEffects.workspaceId, workspaceId),
          eq(relationMaterializationEffects.ownerUserId, ownerUserId),
          inArray(relationMaterializationEffects.status, ["pending", "failed"]),
          opts.cursor
            ? gt(
                relationMaterializationEffects.id,
                opts.cursor.id.toLowerCase(),
              )
            : undefined,
        ),
      )
      .orderBy(asc(relationMaterializationEffects.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit
          ? { id: items.at(-1)!.id }
          : null,
    };
  }
}
