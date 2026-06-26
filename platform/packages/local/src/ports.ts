/**
 * LOCAL plane ports — the customer-controlled private tier.
 *
 * Residency invariant (decisions.md): EVERYTHING is local by default. OAuth tokens,
 * raw Gmail/Calendar bodies, and the derived Touchpoints/Memories/Signals/warmth
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
  workspaceId: string;
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
}

// ── Body store: raw private Gmail thread / Calendar event content ──────────────

export interface StoredBody {
  workspaceId: string;
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
  get(workspaceId: string, source: string, sourceRecordId: string): Promise<StoredBody | null>;
  list(workspaceId: string, source: string): Promise<StoredBody[]>;
}

// ── Local graph store: derived entities + person-match lookup ──────────────────

/** A person on the local tier. `emails` drives deterministic thread/event matching. */
export interface LocalPerson {
  id: string;
  workspaceId: string;
  fullName?: string;
  emails: string[];
  /** Link to the cloud canonical identity (set when dual-written). */
  canonicalPersonId?: string;
}

/** A committed graph entry. Vocabulary: Touchpoint | Memory | Signal — never Lead/Deal/Contact. */
export interface LocalEntityRecord {
  id: string;
  workspaceId: string;
  kind: "touchpoint" | "memory" | "signal";
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
  workspaceId: string;
  source: string;
  sourceRecordId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface LocalGraphStore {
  /** People whose email set contains `email` (case-insensitive). Drives matching. */
  findPeopleByEmail(workspaceId: string, email: string): Promise<LocalPerson[]>;
  upsertPerson(person: LocalPerson): Promise<void>;
  listPeople(workspaceId: string): Promise<LocalPerson[]>;

  /** Commit a derived entity (post-approval). Local only. */
  commitEntity(entry: LocalEntityRecord): Promise<void>;
  listEntities(workspaceId: string, kind?: LocalEntityRecord["kind"]): Promise<LocalEntityRecord[]>;

  /** Idempotent dedup against re-sync (mirrors external_records). */
  recordExternal(row: ExternalRecordRow): Promise<void>;
  hasExternal(workspaceId: string, source: string, sourceRecordId: string): Promise<boolean>;

  /** Incremental-sync cursor per (integration, source). */
  getSyncCursor(integrationId: string, source: string): Promise<string | null>;
  setSyncCursor(integrationId: string, source: string, cursor: string): Promise<void>;
}

/** The three local-plane stores, assembled. */
export interface LocalPlane {
  secrets: SecretStore;
  bodies: BodyStore;
  graph: LocalGraphStore;
  close(): Promise<void>;
}

// ── Capture outbox: offline-first queue for mobile quick-capture ───────────────
//
// A CaptureDraft is a meeting note captured on a local-plane node (the phone). It is
// written to the OutboxStore SYNCHRONOUSLY at Save time (never blocks on network) and
// later replayed by the sync engine as a Pipeline action.propose. `id` is a ULID and is
// the end-to-end idempotency key: a duplicate enqueue is a no-op, and a double-propose is
// a Pipeline no-op. Audio NEVER enters this queue — only `audioLocalMediaId` (a local
// pointer); `private ∩ egress = none` means audio bytes cannot cross the gate.

export interface CaptureDraft {
  /** ULID — idempotency key, end to end. */
  id: string;
  workspaceId: string;
  /** Transcript text (on-device STT or manual). May be empty if audio-only + STT failed. */
  text: string;
  /** Optional Person quick-tag: an existing local/canonical id, or a provisional id. */
  personId?: string;
  /** True when `personId` points at a provisional (offline-created) Person. */
  personProvisional?: boolean;
  /** Pointer into LocalMediaStore for the audio blob, if retained. NEVER synced outward. */
  audioLocalMediaId?: string;
  /** Opt-in calendar write-back intent (governed egress, resolved by Plan 07). */
  calendar?: { mode: "new" | "attach"; existingEventId?: string };
  /** Epoch ms, device clock at capture. */
  capturedAt: number;
}

export type OutboxStatus = "pending" | "synced" | "failed";

export interface OutboxRecord {
  draft: CaptureDraft;
  status: OutboxStatus;
  /** Replay attempts so far. */
  attempts: number;
  /** Epoch ms; the earliest time this record may be replayed (backoff). */
  nextAttemptAt: number;
  /** Last failure message, when status === "failed". */
  lastError?: string;
}

export interface OutboxStore {
  /** Durable, SYNCHRONOUS enqueue. Idempotent: a duplicate `draft.id` is a no-op. */
  enqueue(draft: CaptureDraft): Promise<void>;
  get(id: string): Promise<OutboxRecord | null>;
  /** Records replayable at `now`: status !== "synced" AND nextAttemptAt <= now, FIFO by capturedAt. */
  listPending(now: number): Promise<OutboxRecord[]>;
  /** Mark committed. */
  markSynced(id: string): Promise<void>;
  /** Mark a failed attempt: increments `attempts`, sets `lastError` + the next backoff time. */
  markFailed(id: string, error: string, nextAttemptAt: number): Promise<void>;
}
