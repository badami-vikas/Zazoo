/**
 * Saved Views (TASK-062).
 *
 * A View — which columns are visible, how the rows are filtered, sorted and
 * grouped, which shape renders them — is a CONFIGURATION, and configuration
 * that lives only in React state is not configuration at all: it is discarded
 * on reload. That single gap is why Lists, view sharing, personal-vs-
 * collaborative views and linked views are all absent from surfaces whose UI
 * already exists. One durable record fixes all of them.
 *
 * The config itself is opaque here. @bridge/core carries no table vocabulary,
 * and the ViewConfig shape belongs to @bridge/tables; the router validates it
 * at the edge. What this module owns is the identity, the ownership rule and
 * the lifecycle.
 *
 * Ownership follows the Chat-thread rule, with one deliberate widening:
 *  - `personal` — visible only to the human who saved it;
 *  - `organization` — visible to every member, editable only by its owner.
 * That second scope is the seam TASK-064 (scoped share grants) grows into, so
 * it exists from the first migration rather than being retrofitted later.
 */

import type { ShareGrantRecord, ShareGrantStore } from "./share-grant.js";

export const SAVED_VIEW_SCOPES = ["personal", "organization"] as const;
export type SavedViewScope = (typeof SAVED_VIEW_SCOPES)[number];

export const MAX_SAVED_VIEW_NAME_LENGTH = 120;
/** A bound on stored configuration, so one View can never become a document. */
export const MAX_SAVED_VIEW_CONFIG_BYTES = 32_768;

export interface SavedViewRecord {
  id: string;
  organizationId: string;
  /** The human who saved it — the only one who may change or delete it. */
  ownerUserId: string;
  /** The Database this View belongs to (a TableSpec id). A View never leaks
   * across Databases: every read is scoped by this. */
  databaseId: string;
  name: string;
  scope: SavedViewScope;
  /** The `ViewConfig` from @bridge/tables, stored as-is. */
  config: Record<string, unknown>;
  /** Columns hidden in this View. Kept beside the config rather than inside it
   * because column visibility is the shell's state, not the view kind's. */
  hiddenColumns: readonly string[];
  /**
   * The List this Database opens on for this owner. At most one per owner per
   * Database — setting a new one clears the previous, in the same write, so
   * "which List is default" can never have two answers.
   */
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewUpdate {
  name?: string;
  scope?: SavedViewScope;
  config?: Record<string, unknown>;
  hiddenColumns?: readonly string[];
  isDefault?: boolean;
}

export class SavedViewNotFoundError extends Error {
  constructor(id: string) {
    super(`unknown saved View ${id}`);
    this.name = "SavedViewNotFoundError";
  }
}

/** One name per Database per owner: two Views called "My deals" in the same
 * List dropdown is a UI that cannot be used, not a storage detail. */
export class SavedViewNameTakenError extends Error {
  constructor(name: string) {
    super(`a saved View named "${name}" already exists on this Database`);
    this.name = "SavedViewNameTakenError";
  }
}

export interface ViewConfigStore {
  /**
   * One View by id, as this caller may see it: their own, an
   * `organization`-scoped one, or one a live share grant points at. Null when
   * the caller may not see it — never a throw, because "not shared with you"
   * and "does not exist" must be indistinguishable from outside.
   */
  get(organizationId: string, userId: string, id: string): Promise<SavedViewRecord | null>;
  /** The caller's own Views on a Database, plus the organization-scoped ones
   * anyone in the organization saved. Ordered by name. */
  list(
    organizationId: string,
    userId: string,
    databaseId: string,
  ): Promise<SavedViewRecord[]>;
  create(record: SavedViewRecord): Promise<SavedViewRecord>;
  /** Owner-only. */
  update(
    organizationId: string,
    ownerUserId: string,
    id: string,
    update: SavedViewUpdate,
    updatedAtISO: string,
  ): Promise<SavedViewRecord>;
  /** Owner-only. */
  remove(organizationId: string, ownerUserId: string, id: string): Promise<void>;
}

/** Shared by both implementations so the in-memory double and the database
 * cannot disagree about what "already exists" means. */
export function conflictsByName(
  existing: readonly SavedViewRecord[],
  candidate: { id: string; ownerUserId: string; databaseId: string; name: string },
): boolean {
  const wanted = candidate.name.trim().toLowerCase();
  return existing.some(
    (view) =>
      view.id !== candidate.id &&
      view.ownerUserId === candidate.ownerUserId &&
      view.databaseId === candidate.databaseId &&
      view.name.trim().toLowerCase() === wanted,
  );
}

export class InMemoryViewConfigStore implements ViewConfigStore {
  #views = new Map<string, SavedViewRecord>();
  /**
   * Optional grant source, so the double answers `get` the same way the
   * database's RLS policy does. Without it a shared personal View would be
   * visible in tests and invisible in production — the direction of divergence
   * that makes a double worse than no double.
   */
  #grants: ShareGrantStore | null;

  constructor(grants: ShareGrantStore | null = null) {
    this.#grants = grants;
  }

  #owned(organizationId: string, ownerUserId: string, id: string): SavedViewRecord {
    const view = this.#views.get(id);
    // An organization-scoped View someone ELSE owns is readable but not
    // writable, and reports as not-found rather than as forbidden: the caller
    // has no business knowing it failed on ownership.
    if (!view || view.organizationId !== organizationId || view.ownerUserId !== ownerUserId) {
      throw new SavedViewNotFoundError(id);
    }
    return view;
  }

  async get(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<SavedViewRecord | null> {
    const view = this.#views.get(id);
    if (!view || view.organizationId !== organizationId) return null;
    if (view.ownerUserId === userId || view.scope === "organization") {
      return { ...view, hiddenColumns: [...view.hiddenColumns] };
    }
    if (!this.#grants) return null;
    const grants = await this.#grants.listForTarget(organizationId, userId, "view", id);
    const usable = grants.some(
      (grant: ShareGrantRecord) => grant.granteeUserId === userId && grant.revokedAt === null,
    );
    return usable ? { ...view, hiddenColumns: [...view.hiddenColumns] } : null;
  }

  async list(
    organizationId: string,
    userId: string,
    databaseId: string,
  ): Promise<SavedViewRecord[]> {
    return [...this.#views.values()]
      .filter(
        (view) =>
          view.organizationId === organizationId &&
          view.databaseId === databaseId &&
          (view.ownerUserId === userId || view.scope === "organization"),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((view) => ({ ...view, hiddenColumns: [...view.hiddenColumns] }));
  }

  async create(record: SavedViewRecord): Promise<SavedViewRecord> {
    if (this.#views.has(record.id)) {
      throw new Error(`saved View ${record.id} already exists`);
    }
    if (conflictsByName([...this.#views.values()], record)) {
      throw new SavedViewNameTakenError(record.name);
    }
    this.#views.set(record.id, { ...record, hiddenColumns: [...record.hiddenColumns] });
    if (record.isDefault) this.#clearOtherDefaults(record);
    return { ...record, hiddenColumns: [...record.hiddenColumns] };
  }

  async update(
    organizationId: string,
    ownerUserId: string,
    id: string,
    update: SavedViewUpdate,
    updatedAtISO: string,
  ): Promise<SavedViewRecord> {
    const view = this.#owned(organizationId, ownerUserId, id);
    const next: SavedViewRecord = {
      ...view,
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.scope !== undefined ? { scope: update.scope } : {}),
      ...(update.config !== undefined ? { config: update.config } : {}),
      ...(update.hiddenColumns !== undefined
        ? { hiddenColumns: [...update.hiddenColumns] }
        : {}),
      ...(update.isDefault !== undefined ? { isDefault: update.isDefault } : {}),
      updatedAt: updatedAtISO,
    };
    if (conflictsByName([...this.#views.values()], next)) {
      throw new SavedViewNameTakenError(next.name);
    }
    this.#views.set(id, next);
    if (update.isDefault) this.#clearOtherDefaults(next);
    return { ...next, hiddenColumns: [...next.hiddenColumns] };
  }

  /** One default per owner per Database — the same rule the partial unique
   * index enforces in Postgres (migration 0051). */
  #clearOtherDefaults(winner: SavedViewRecord): void {
    for (const [id, view] of this.#views) {
      if (
        id !== winner.id &&
        view.isDefault &&
        view.organizationId === winner.organizationId &&
        view.ownerUserId === winner.ownerUserId &&
        view.databaseId === winner.databaseId
      ) {
        this.#views.set(id, { ...view, isDefault: false });
      }
    }
  }

  async remove(organizationId: string, ownerUserId: string, id: string): Promise<void> {
    this.#owned(organizationId, ownerUserId, id);
    this.#views.delete(id);
  }
}
