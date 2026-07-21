/**
 * CanonicalIdentityStore — the CLOUD plane's narrow write surface.
 *
 * Dual-write rule (decisions.md): the ONLY thing that crosses the gate outward to
 * cloud canonical is a counterparty's PUBLIC / identity-grade fact (name, email,
 * company). Private relationship data — Gmail/Calendar bodies, derived Events/
 * Memories/Signals, warmth — NEVER lands here; it stays in @bridge/local.
 *
 * This store writes only `people_canonical` (GLOBAL-deduped, no tenant linkage),
 * keyed by a stable dedup_key. The Drizzle adapter targets Supabase; the in-memory
 * fake lets the slice run + be tested with zero infra (and is the default until a
 * Supabase URL is configured — identity then mirrors local-only, audited).
 */
import { eq, isNotNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { peopleCanonical } from "./schema.js";

/** A public, identity-grade fact about a counterparty. No private fields. */
export interface CanonicalPersonIdentity {
  /** Stable global key (e.g. lowercased primary email), or null when unavailable. */
  dedupKey: string | null;
  fullName?: string;
  emails: string[];
  currentCompanyName?: string;
  /** Provenance — which integration sourced it (e.g. "google:gmail"). */
  enrichmentSource?: string;
}

export interface UpsertResult {
  canonicalPersonId: string;
  created: boolean;
}

export interface CanonicalIdentityStore {
  /**
   * Upsert a PUBLIC identity by dedup_key. Returns the canonical id (existing or
   * the supplied `idIfNew` when freshly created). `idIfNew` is caller-generated via
   * the determinism seam (ctx.ids) so dual-writes stay replayable.
   */
  upsertPersonIdentity(identity: CanonicalPersonIdentity, idIfNew: string): Promise<UpsertResult>;
}

/** Drizzle/Supabase adapter — writes the canonical people table. */
export class DrizzleCanonicalIdentityStore implements CanonicalIdentityStore {
  constructor(private readonly db: Database) {}
  async upsertPersonIdentity(identity: CanonicalPersonIdentity, idIfNew: string): Promise<UpsertResult> {
    if (identity.dedupKey !== null) {
      const existing = await this.db
        .select({ id: peopleCanonical.id })
        .from(peopleCanonical)
        .where(eq(peopleCanonical.dedupKey, identity.dedupKey))
        .limit(1);
      const found = existing[0];
      if (found) return { canonicalPersonId: found.id, created: false };
    }

    const inserted = await this.db
      .insert(peopleCanonical)
      .values({
        id: idIfNew,
        ...(identity.fullName ? { fullName: identity.fullName } : {}),
        ...(identity.currentCompanyName ? { currentCompanyName: identity.currentCompanyName } : {}),
        emails: identity.emails,
        dedupKey: identity.dedupKey,
        ...(identity.enrichmentSource ? { enrichmentSource: identity.enrichmentSource } : {}),
      })
      .onConflictDoNothing({
        target: peopleCanonical.dedupKey,
        where: isNotNull(peopleCanonical.dedupKey),
      })
      // No-arg returning() (full row) — typechecks across the postgres-js | pglite
      // Database union; we only read `.id`.
      .returning();

    const row = inserted[0];
    if (row) return { canonicalPersonId: row.id, created: true };

    // Lost a race to a concurrent insert — read the winner.
    if (identity.dedupKey === null) {
      throw new Error("Canonical identity insert returned no row for a null dedup key");
    }
    const after = await this.db
      .select({ id: peopleCanonical.id })
      .from(peopleCanonical)
      .where(eq(peopleCanonical.dedupKey, identity.dedupKey))
      .limit(1);
    const winner = after[0];
    if (!winner) {
      throw new Error(`Canonical identity conflict winner missing for dedup key "${identity.dedupKey}"`);
    }
    return { canonicalPersonId: winner.id, created: false };
  }
}

/** In-memory fake — zero-infra default; identity mirrors local-only until Supabase is wired. */
export class InMemoryCanonicalIdentityStore implements CanonicalIdentityStore {
  readonly identities = new Map<string, CanonicalPersonIdentity & { canonicalPersonId: string }>();
  readonly unkeyedIdentities = new Map<string, CanonicalPersonIdentity & { canonicalPersonId: string }>();
  async upsertPersonIdentity(identity: CanonicalPersonIdentity, idIfNew: string): Promise<UpsertResult> {
    if (identity.dedupKey === null) {
      this.unkeyedIdentities.set(idIfNew, { ...identity, canonicalPersonId: idIfNew });
      return { canonicalPersonId: idIfNew, created: true };
    }
    const existing = this.identities.get(identity.dedupKey);
    if (existing) return { canonicalPersonId: existing.canonicalPersonId, created: false };
    this.identities.set(identity.dedupKey, { ...identity, canonicalPersonId: idIfNew });
    return { canonicalPersonId: idIfNew, created: true };
  }
}
