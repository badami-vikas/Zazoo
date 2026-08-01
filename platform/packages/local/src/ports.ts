/**
 * LOCAL plane ports — the customer-controlled private tier.
 *
 * Residency invariant (decisions.md): EVERYTHING is local by default. OAuth tokens,
 * raw Gmail/Calendar bodies, and the derived Events/Memories/Signals/warmth
 * live ONLY here (pglite/Postgres on the machine/VPC). They NEVER cross the gate to
 * cloud canonical. The ONLY thing dual-written outward is a counterparty's
 * public/identity-grade fact (see CanonicalIdentityStore in @bridge/db).
 *
 * In-memory adapters (stores/memory.ts) let the slice run + be tested with zero
 * infra; the pglite adapters (stores/pglite.ts) bind the same interfaces — the
 * exact ports/adapters seam the wiki calls for.
 */

// ── Secret store: OAuth tokens (local only, never Supabase) ───────────────────

export interface OAuthTokenRecord {
  /** integrations.id this token belongs to. */
  integrationId: string;
  organizationId: string;
  /** 'google' (covers both gmail + calendar under one consent). */
  provider: string;
  accessToken: string;
  /** Long-lived refresh token (offline access). Absent until first consent. */
  refreshToken?: string;
  /** Space-joined granted scopes. */
  scope: string;
  tokenType: string;
  /** Access-token expiry, epoch ms. */
  expiryDate?: number;
  updatedAt: string;
}

export interface SecretStore {
  putToken(rec: OAuthTokenRecord): Promise<void>;
  getToken(integrationId: string): Promise<OAuthTokenRecord | null>;
  deleteToken(integrationId: string): Promise<void>;
  compareAndSwapToken(
    integrationId: string,
    expected: OAuthTokenRecord | null,
    replacement: OAuthTokenRecord | null,
  ): Promise<boolean>;
  /**
   * Keep a replacement invisible to every token reader/writer until both
   * authorization checks pass. A failed or throwing post-write check restores
   * the exact prior token before the per-Integration lock is released.
   */
  finalizeToken(
    replacement: OAuthTokenRecord,
    stillAuthorized: () => Promise<boolean>,
  ): Promise<boolean>;
}

// ── Body store: raw private Gmail thread / Calendar event content ──────────────

export interface StoredBody {
  organizationId: string;
  /** 'gmail' | 'google-calendar'. */
  source: string;
  /** Gmail threadId / messageId, Calendar eventId. */
  sourceRecordId: string;
  /** Always 'private' — these bodies structurally cannot egress. */
  dataScope: "private";
  /** The raw payload (thread messages / event details). Private relationship data. */
  content: unknown;
  capturedAt: string;
}

export interface BodyStore {
  put(body: StoredBody): Promise<void>;
  get(organizationId: string, source: string, sourceRecordId: string): Promise<StoredBody | null>;
  list(organizationId: string, source: string): Promise<StoredBody[]>;
}

// ── Local graph store: derived entities + person-match lookup ──────────────────

/** A person on the local tier. `emails` drives deterministic thread/event matching. */
export interface LocalPerson {
  id: string;
  organizationId: string;
  fullName?: string;
  emails: string[];
  /**
   * E.164 phone numbers. LOCAL ONLY — a number never crosses to cloud canonical
   * without an explicit promote, unlike `emails`, which is dual-written.
   */
  phones?: string[];
  /**
   * Source-scoped identity key, e.g. `whatsapp:+919876543210` or
   * `whatsapp-lid:1234@lid`. Lets a source match its own people deterministically
   * without an email — WhatsApp contacts frequently have no email at all, and
   * roughly half disclose no phone number either.
   */
  dedupeKey?: string;
  /**
   * Link to the cloud canonical identity. Null until an explicit promote —
   * a local-only Person is a complete Person, not a pending one.
   */
  canonicalPersonId?: string;
}

/**
 * A named local list of People — the local-plane equivalent of the cloud
 * `communities kind='list'` surface. Bulk imports land here rather than in the
 * relationship graph: a WhatsApp address book is a roster, not 8,384
 * relationships.
 */
export interface LocalPersonList {
  id: string;
  organizationId: string;
  name: string;
  /** Which Module/import produced it, e.g. "whatsapp". */
  source: string;
  createdAt: string;
}

/** A committed graph entry. Interactions are Events. */
export interface LocalEntityRecord {
  id: string;
  organizationId: string;
  kind: "event" | "memory" | "signal";
  /** The Person this entry is about, when matched. */
  personId?: string;
  payload: unknown;
  /** Provenance back to the sourced record. */
  source?: string;
  sourceRecordId?: string;
  createdAt: string;
}

/** Idempotency row: an external record already mapped to a local entity. */
export interface ExternalRecordRow {
  organizationId: string;
  source: string;
  sourceRecordId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface LocalGraphStore {
  /** People whose email set contains `email` (case-insensitive). Drives matching. */
  findPeopleByEmail(organizationId: string, email: string): Promise<LocalPerson[]>;
  /**
   * People carrying this source-scoped identity key. Returns a LIST because
   * "more than one match" must stay representable — an ambiguous match becomes
   * a possible_duplicate Signal, never a silent pick.
   */
  findPeopleByDedupeKey(organizationId: string, dedupeKey: string): Promise<LocalPerson[]>;
  upsertPerson(person: LocalPerson): Promise<void>;
  listPeople(organizationId: string): Promise<LocalPerson[]>;

  /** Create the list if absent, and return it either way. */
  ensurePersonList(list: LocalPersonList): Promise<LocalPersonList>;
  listPersonLists(organizationId: string): Promise<LocalPersonList[]>;
  /** Idempotent: re-running an import re-adds the same members as a no-op. */
  addPeopleToList(listId: string, personIds: readonly string[]): Promise<void>;
  listPeopleInList(listId: string): Promise<LocalPerson[]>;

  /** Commit a derived entity (post-approval). Local only. */
  commitEntity(entry: LocalEntityRecord): Promise<void>;
  listEntities(organizationId: string, kind?: LocalEntityRecord["kind"]): Promise<LocalEntityRecord[]>;

  /** Idempotent dedup against re-sync (mirrors external_records). */
  recordExternal(row: ExternalRecordRow): Promise<void>;
  hasExternal(organizationId: string, source: string, sourceRecordId: string): Promise<boolean>;

  /** Incremental-sync cursor per (integration, source). */
  getSyncCursor(integrationId: string, source: string): Promise<string | null>;
  setSyncCursor(integrationId: string, source: string, cursor: string): Promise<void>;
}

// ── Atomic state store: module-private durable aggregates ─────────────────────

export interface LocalStateMutation<T> {
  state: unknown;
  result: T;
}

/**
 * Organization-scoped atomic JSON state for Local Plane modules whose canonical
 * relational schema has not yet entered the numbered migration stream.
 *
 * Reducers are synchronous and may be retried after cross-process contention;
 * they must not perform side effects. A thrown reducer leaves the previous
 * value untouched.
 */
export interface LocalStateStore {
  read(organizationId: string, namespace: string): Promise<unknown | null>;
  update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => LocalStateMutation<T>,
  ): Promise<T>;
}

/** The Local Plane stores, assembled. */
export interface LocalPlane {
  secrets: SecretStore;
  bodies: BodyStore;
  graph: LocalGraphStore;
  state: LocalStateStore;
  close(): Promise<void>;
}
