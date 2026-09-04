/**
 * Scoped share grants (TASK-064).
 *
 * Bridge had exactly ONE sharing primitive — `helpdeskTickets.accessToken`,
 * whose whole trust model is "knowing the token proves you are the submitter" —
 * and it was welded to Helpdesk. Every Share affordance in the app was disabled
 * with that as its stated reason. This generalizes the primitive: a grant names
 * a TARGET (a saved View or its Form), an ACCESS LEVEL, an optional expiry and a
 * revocation, and it is either aimed at a known member or carried by an opaque
 * token the way the Helpdesk one is.
 *
 * WHAT A LEVEL MEANS, stated once so no surface can invent its own reading:
 *  - `view`    — may open the View and read what the View shows.
 *  - `edit`    — the above, plus may change the cells the View shows.
 *  - `coowner` — the above, plus may change the View itself and share it on.
 * The ladder is total: every level includes the ones before it, which is what
 * `atLeast` encodes so no call site re-derives it.
 *
 * A grant is DATA, never a capability by itself: `isGrantUsable` is the only
 * place expiry and revocation are decided, so a surface cannot accidentally
 * honour a revoked grant by forgetting one of the two checks.
 */

export const SHARE_TARGET_KINDS = ["view", "form"] as const;
export type ShareTargetKind = (typeof SHARE_TARGET_KINDS)[number];

/** Ordered weakest → strongest. The order IS the permission ladder. */
export const SHARE_ACCESS_LEVELS = ["view", "edit", "coowner"] as const;
export type ShareAccessLevel = (typeof SHARE_ACCESS_LEVELS)[number];

export interface ShareGrantRecord {
  id: string;
  organizationId: string;
  targetKind: ShareTargetKind;
  /** The saved View this grant points at (`view_configs.id`). */
  targetId: string;
  /** The member this was granted to, or null for a link grant. */
  granteeUserId: string | null;
  /**
   * The link credential, or null for a member grant. Opaque and unguessable —
   * the same trust model as the Helpdesk token this generalizes.
   */
  accessToken: string | null;
  accessLevel: ShareAccessLevel;
  /** ISO instant after which the grant is dead, or null for open-ended. */
  expiresAt: string | null;
  /** ISO instant it was revoked, or null. Revocation is a write, never a
   * delete: a grant that vanished cannot be audited. */
  revokedAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export class ShareGrantNotFoundError extends Error {
  constructor(id: string) {
    super(`unknown share grant ${id}`);
    this.name = "ShareGrantNotFoundError";
  }
}

/** Does `held` reach `required` on the ladder? */
export function atLeast(held: ShareAccessLevel, required: ShareAccessLevel): boolean {
  return SHARE_ACCESS_LEVELS.indexOf(held) >= SHARE_ACCESS_LEVELS.indexOf(required);
}

/**
 * The ONE place a grant is judged live. Both conditions are checked here so a
 * caller cannot honour a revoked grant by remembering expiry and forgetting
 * revocation.
 */
export function isGrantUsable(grant: ShareGrantRecord, nowISO: string): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && grant.expiresAt <= nowISO) return false;
  return true;
}

/**
 * What a holder may do with a target, or null when nothing.
 *
 * The OWNER of the target is not represented as a grant — ownership is not a
 * share — so callers resolve ownership first and only ask this about everyone
 * else.
 */
export function effectiveAccess(
  grants: readonly ShareGrantRecord[],
  target: { targetKind: ShareTargetKind; targetId: string },
  holder: { userId?: string | null; accessToken?: string | null },
  nowISO: string,
): ShareAccessLevel | null {
  let best: ShareAccessLevel | null = null;
  for (const grant of grants) {
    if (grant.targetKind !== target.targetKind || grant.targetId !== target.targetId) continue;
    if (!isGrantUsable(grant, nowISO)) continue;
    const matchesUser =
      holder.userId != null && grant.granteeUserId != null && grant.granteeUserId === holder.userId;
    const matchesToken =
      holder.accessToken != null &&
      grant.accessToken != null &&
      grant.accessToken === holder.accessToken;
    if (!matchesUser && !matchesToken) continue;
    if (best === null || atLeast(grant.accessLevel, best)) best = grant.accessLevel;
  }
  return best;
}

export interface ShareGrantStore {
  /** Every grant on a target, live or not — revoked ones are history, not noise. */
  listForTarget(
    organizationId: string,
    actingUserId: string,
    targetKind: ShareTargetKind,
    targetId: string,
  ): Promise<ShareGrantRecord[]>;
  /** Grants aimed at one member, across targets. */
  listForGrantee(organizationId: string, granteeUserId: string): Promise<ShareGrantRecord[]>;
  /** One link grant by its token, across organizations — the token IS the scope. */
  findByToken(accessToken: string): Promise<ShareGrantRecord | null>;
  create(record: ShareGrantRecord): Promise<ShareGrantRecord>;
  /** Idempotent: revoking an already-revoked grant keeps the first instant. */
  revoke(
    organizationId: string,
    actingUserId: string,
    id: string,
    revokedAtISO: string,
  ): Promise<ShareGrantRecord>;
}

export class InMemoryShareGrantStore implements ShareGrantStore {
  #grants = new Map<string, ShareGrantRecord>();

  async listForTarget(
    organizationId: string,
    _actingUserId: string,
    targetKind: ShareTargetKind,
    targetId: string,
  ): Promise<ShareGrantRecord[]> {
    return [...this.#grants.values()]
      .filter(
        (grant) =>
          grant.organizationId === organizationId &&
          grant.targetKind === targetKind &&
          grant.targetId === targetId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async listForGrantee(organizationId: string, granteeUserId: string): Promise<ShareGrantRecord[]> {
    return [...this.#grants.values()]
      .filter(
        (grant) =>
          grant.organizationId === organizationId && grant.granteeUserId === granteeUserId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async findByToken(accessToken: string): Promise<ShareGrantRecord | null> {
    return [...this.#grants.values()].find((grant) => grant.accessToken === accessToken) ?? null;
  }

  async create(record: ShareGrantRecord): Promise<ShareGrantRecord> {
    if (this.#grants.has(record.id)) throw new Error(`share grant ${record.id} already exists`);
    this.#grants.set(record.id, { ...record });
    return { ...record };
  }

  async revoke(
    organizationId: string,
    _actingUserId: string,
    id: string,
    revokedAtISO: string,
  ): Promise<ShareGrantRecord> {
    const grant = this.#grants.get(id);
    if (!grant || grant.organizationId !== organizationId) throw new ShareGrantNotFoundError(id);
    const next = { ...grant, revokedAt: grant.revokedAt ?? revokedAtISO };
    this.#grants.set(id, next);
    return { ...next };
  }
}
