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

// ── Messages: third-party message BODIES, Local Plane only ────────────────────
//
// ADR-158 reverses ADR-157 on this point and is approved explicitly under AP-091.
// Bridge now persists other people's personal message content so it can be
// searched. Everything in this section is LOCAL ONLY, in the same sense (and for
// stronger reasons) as `LocalPerson.phones`: a body never dual-writes to cloud
// canonical, and there is no promote path for one.
//
// Honest limitation, recorded rather than mitigated: pglite writes to a
// directory in the user's home. Encryption at rest is the user's FileVault
// setting, not a guarantee Bridge makes.

/** Delivery state as WhatsApp reports it. `unknown` when nothing was reported. */
export type LocalMessageAck =
  | "error"
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "played"
  | "unknown";

export type LocalMessageDirection = "inbound" | "outbound";

/**
 * Which identity space `senderKey` lives in.
 *
 * `phone` and `lid` are DISJOINT and are never matched to each other. A WhatsApp
 * Linked ID is an opaque account handle, not a phone number — see
 * `@bridge/whatsapp`'s `normalize.ts`, where guarding only the id suffix was
 * shown to be insufficient because an extractor had already laundered LID digits
 * into a phone-shaped field. `self` is the account owner; `unknown` is a message
 * whose sender the capture could not attribute, which stays unattributed rather
 * than being guessed.
 */
export type LocalMessageSenderKind = "phone" | "lid" | "self" | "unknown";

/**
 * What was attached, not the attachment itself. Media bytes are not stored in
 * the database; `localPath` points at a file on the user's own disk when one was
 * downloaded. Never a remote URL — a stored remote URL would turn opening a
 * message into a network fetch that leaks read receipts.
 */
export interface LocalMessageAttachment {
  kind:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contact"
    | "other";
  mimeType?: string;
  fileName?: string;
  byteSize?: number;
  localPath?: string;
}

/** One captured message. */
export interface LocalMessage {
  organizationId: string;
  /** Which Module captured it, e.g. "whatsapp". */
  source: string;
  /** The source's own message id. Idempotency key together with source. */
  messageId: string;
  /** The thread this belongs to (`…@c.us`, `…@lid`, or `…@g.us`). */
  chatId: string;
  /**
   * Source-scoped sender identity — the SAME key space as `LocalPerson.dedupeKey`
   * (`whatsapp:+E164` or `whatsapp-lid:<id>`). Absent when unattributed.
   */
  senderKey?: string;
  senderKind: LocalMessageSenderKind;
  direction: LocalMessageDirection;
  /** ISO-8601, as the source reported it. */
  sentAt: string;
  /** The message text. Empty string for a media-only message. */
  body: string;
  attachment?: LocalMessageAttachment;
  ack: LocalMessageAck;
  /** ISO-8601 capture time, supplied by the caller. */
  capturedAt: string;
}

export type LocalMessageSearchMode = "fulltext" | "fuzzy";

export interface LocalMessageSearchQuery {
  organizationId: string;
  text: string;
  source?: string;
  chatId?: string;
  senderKey?: string;
  /**
   * `fulltext` is word-level Postgres FTS; `fuzzy` is substring/near-miss
   * matching for typos and partial words. Defaults to `fulltext`.
   */
  mode?: LocalMessageSearchMode;
  limit?: number;
}

export interface LocalMessageSearchHit extends LocalMessage {
  /** Higher is better. Comparable within one result set only. */
  rank: number;
}

/**
 * What the installed store can actually do, reported rather than assumed.
 *
 * `fullText` uses core Postgres (`tsvector` + GIN) and is always present.
 * `trigram` needs `pg_trgm`, which pglite SHIPS but does not load unless the
 * client registered it at construction — so this can legitimately be false, and
 * fuzzy search degrades to a substring scan instead of silently returning
 * nothing.
 */
export interface LocalMessageSearchCapabilities {
  fullText: boolean;
  trigram: boolean;
}

/**
 * Who has written into a thread and when. This is the factual input to the
 * consent gate (`@bridge/whatsapp`'s send policy): automation may only send
 * where the recipient wrote first, so "did they ever write to us" has to be a
 * stored fact rather than an assumption.
 */
export interface LocalThreadActivity {
  chatId: string;
  inboundCount: number;
  outboundCount: number;
  firstInboundAt?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
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

  // ── Messages (Local Plane only — see the Messages section above) ────────────

  /**
   * Idempotent upsert. Re-capturing a message is a no-op except that `ack` may
   * advance (sent → delivered → read) and a body may be corrected by an edit;
   * a re-capture must never duplicate a row.
   *
   * Implementations MUST reject a message whose `senderKey` and `senderKind`
   * disagree about which identity space it is in. That is the guard that keeps
   * LID handles from being laundered into phone identities.
   */
  putMessages(messages: readonly LocalMessage[]): Promise<void>;
  /** One thread, oldest first. */
  listMessages(
    organizationId: string,
    source: string,
    chatId: string,
    limit?: number,
  ): Promise<LocalMessage[]>;
  searchMessages(query: LocalMessageSearchQuery): Promise<LocalMessageSearchHit[]>;
  /** Consent-gate facts for one thread. Absent thread = all-zero activity. */
  getThreadActivity(
    organizationId: string,
    source: string,
    chatId: string,
  ): Promise<LocalThreadActivity>;
  messageSearchCapabilities(): Promise<LocalMessageSearchCapabilities>;
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
