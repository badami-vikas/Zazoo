/**
 * Drizzle schema — faithful mirror of docs/raw/SCHEMA.sql (Bridge AI Schema v2).
 *
 * Conventions (from the SQL header):
 *   - uuid PKs (gen_random_uuid)
 *   - tenant-scoped tables carry workspace_id (RLS deny-by-default, applied in Supabase)
 *   - soft-delete via archived_at (NEVER hard delete)
 *   - append-only tables (events, ledger, timeline, signal_actions) revoke UPDATE/DELETE
 *   - TWO TIERS: canonical (platform/global/public) vs relationship (per-user/private)
 *
 * RLS policies + the append-only REVOKEs live in the Supabase migrations, not here —
 * Drizzle owns table shape; the database owns enforcement.
 */
import {
  boolean,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidv7 } from "@bridge/core";

/** pgvector column. v1 dim = 768 (nomic-embed-text-v1.5). */
const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
  })(name);

const uuidPk = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
/**
 * PK for append-only, high-write tables (ledger, events, timeline_entries).
 * Random v4 uuids B-tree-page-split-thrash on high-insert-rate tables with no
 * time locality; UUIDv7 (RFC 9562, time-prefixed) keeps new rows physically
 * adjacent. `$defaultFn` generates the id application-side (Drizzle calls this
 * before sending the INSERT) via `@bridge/core`'s `uuidv7()` — there is no
 * native Postgres uuidv7() before PG18 (Supabase/pglite are both pre-v18), and
 * this repo's convention is a small in-house generator over a new npm
 * dependency (see docs/raw/decisions-log.md). The column DEFAULT stays
 * gen_random_uuid() (v4) as a defense-in-depth backstop for direct-SQL inserts
 * that bypass Drizzle — see migrations/0004_schema_hardening.sql's comment on
 * item (2). Forward-only: existing v4 row ids are NOT migrated.
 */
const uuidPkV7 = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .$defaultFn(() => uuidv7());
const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// =====================================================================
// LAYER 1 — TENANCY
// =====================================================================
export const users = pgTable("users", {
  id: uuidPk(),
  email: text("email").unique().notNull(),
  name: text("name"),
  createdAt: now(),
});

export const workspaces = pgTable("workspaces", {
  id: uuidPk(),
  name: text("name").notNull(),
  createdAt: now(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const workspaceSettings = pgTable("workspace_settings", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id),
  defaultVisibility: text("default_visibility").notNull().default("private"),
  settings: jsonb("settings").notNull().default({}),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const teams = pgTable("teams", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id),
    userId: uuid("user_id").notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// =====================================================================
// LAYER 2 — TWO-TIER NETWORK
// =====================================================================
export const peopleCanonical = pgTable(
  "people_canonical",
  {
    id: uuidPk(),
    fullName: text("full_name"),
    preferredName: text("preferred_name"),
    currentTitle: text("current_title"),
    currentCompanyName: text("current_company_name"),
    bio: text("bio"),
    linkedinUrl: text("linkedin_url"),
    twitterHandle: text("twitter_handle"),
    githubHandle: text("github_handle"),
    websiteUrl: text("website_url"),
    emails: text("emails").array(),
    locationCity: text("location_city"),
    locationCountry: text("location_country"),
    avatarUrl: text("avatar_url"),
    enrichmentSource: text("enrichment_source"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    enrichmentConfidence: numeric("enrichment_confidence"),
    // NOT `.unique()` — a plain drizzle-generated unique constraint here would
    // recreate the exact role_permissions drift bug (`drizzle-kit push` testing
    // a different constraint than what migrates to prod). The real constraint is
    // a partial unique index (`people_canonical_dedup_key_uq`, WHERE dedup_key IS
    // NOT NULL — multiple NULL-key rows are allowed, non-null duplicates are
    // rejected) hand-written in migrations/0004_schema_hardening.sql.
    dedupKey: text("dedup_key"),
    // ── Extended social identity (added v1.1) ─────────────────────────────
    instagramHandle: text("instagram_handle"),
    tiktokHandle: text("tiktok_handle"),
    blueskyHandle: text("bluesky_handle"),
    mastodonUrl: text("mastodon_url"),
    // ── Academic / research presence ──────────────────────────────────────
    orcidId: text("orcid_id"),
    scholarUrl: text("scholar_url"),
    // ── Structured professional context ───────────────────────────────────
    /** [{name, title, from?, to?}] */
    previousCompanies: jsonb("previous_companies").$type<Array<{ name: string; title: string; from?: string; to?: string }>>(),
    /** [{institution, degree?, field?, year?}] */
    education: jsonb("education").$type<Array<{ institution: string; degree?: string; field?: string; year?: string }>>(),
    skills: text("skills").array(),
    // ── Recon enrichment state ─────────────────────────────────────────────
    reconRunAt: timestamp("recon_run_at", { withTimezone: true }),
    /** [{label, value, source, url?}] risk/compliance/exposure signals */
    reconSignals: jsonb("recon_signals").$type<Array<{ label: string; value: string; source: string; url?: string }>>(),
  },
  (t) => [
    // `= ANY(emails)` lookups (identity resolution) were a per-row array scan
    // with no index at all. GIN supports `&&`/`@>`/`= ANY` array containment.
    index("people_canonical_emails_idx").using("gin", t.emails),
  ],
);

export const communitiesCanonical = pgTable(
  "communities_canonical",
  {
    id: uuidPk(),
    name: text("name"),
    kind: text("kind"),
    description: text("description"),
    websiteUrl: text("website_url"),
    logoUrl: text("logo_url"),
    linkedinUrl: text("linkedin_url"),
    memberCountApprox: integer("member_count_approx"),
    headquartersCity: text("headquarters_city"),
    headquartersCountry: text("headquarters_country"),
    // NOT `.unique()` — see peopleCanonical.dedupKey above. Real constraint is
    // the partial unique index `communities_canonical_dedup_key_uq` in
    // migrations/0004_schema_hardening.sql.
    dedupKey: text("dedup_key"),
    // ── Recon enrichment (added v1.1) ──────────────────────────────────────
    techStack: text("tech_stack").array(),
    twitterHandle: text("twitter_handle"),
    githubOrg: text("github_org"),
    employeeCountApprox: integer("employee_count_approx"),
    foundedYear: integer("founded_year"),
    /** [{title, url, postedAt?}] open roles from Greenhouse/Lever */
    hiringSignals: jsonb("hiring_signals").$type<Array<{ title: string; url: string; postedAt?: string }>>(),
    reconRunAt: timestamp("recon_run_at", { withTimezone: true }),
  },
  () => [],
);

export const communities = pgTable("communities", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("private"),
  canonicalCommunityId: uuid("canonical_community_id").references(() => communitiesCanonical.id),
  nameOverride: text("name_override"),
  descriptionOverride: text("description_override"),
  kind: text("kind"),
  primaryPlaceId: uuid("primary_place_id"),
  warmthAvg: numeric("warmth_avg"),
  isUserConfirmed: boolean("is_user_confirmed").notNull().default(false),
  source: text("source").notNull().default("user"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const people = pgTable(
  "people",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    visibility: text("visibility").notNull().default("private"),
    canonicalPersonId: uuid("canonical_person_id").references(() => peopleCanonical.id),
    fullNameOverride: text("full_name_override"),
    currentTitleOverride: text("current_title_override"),
    bioOverride: text("bio_override"),
    avatarUrlOverride: text("avatar_url_override"),
    emailsOverride: text("emails_override").array(),
    currentCommunityId: uuid("current_community_id").references(() => communities.id),
    source: text("source"),
    ringPlacement: integer("ring_placement"),
    warmthScore: numeric("warmth_score"),
    reciprocityScore: numeric("reciprocity_score"),
    dormancyRisk: numeric("dormancy_risk"),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    contextFreshnessAt: timestamp("context_freshness_at", { withTimezone: true }),
    isPinnedToInner: boolean("is_pinned_to_inner").notNull().default(false),
    isMuted: boolean("is_muted").notNull().default(false),
    createdAt: now(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("people_ws_user_idx").on(t.workspaceId, t.userId),
    index("people_canonical_idx").on(t.canonicalPersonId),
  ],
);

export const communityMembers = pgTable(
  "community_members",
  {
    communityId: uuid("community_id").notNull().references(() => communities.id),
    personId: uuid("person_id").notNull().references(() => people.id),
    role: text("role"),
    confidence: numeric("confidence"),
  },
  (t) => [primaryKey({ columns: [t.communityId, t.personId] })],
);

export const nodeTypes = pgTable("node_types", {
  type: text("type").primaryKey(),
  plane: text("plane").notNull(), // mirror | operational | infra
});

export const edges = pgTable(
  "edges",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    srcType: text("src_type").notNull(),
    srcId: uuid("src_id").notNull(),
    dstType: text("dst_type").notNull(),
    dstId: uuid("dst_id").notNull(),
    edgeType: text("edge_type").notNull(),
    properties: jsonb("properties").notNull().default({}),
    createdAt: now(),
  },
  (t) => [
    index("edges_src_idx").on(t.workspaceId, t.srcType, t.srcId),
    index("edges_dst_idx").on(t.workspaceId, t.dstType, t.dstId),
  ],
);

// =====================================================================
// LAYER 3 — OPERATIONAL PLANE
// =====================================================================
export const initiatives = pgTable("initiatives", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  title: text("title").notNull(),
  goal: text("goal"),
  description: text("description"),
  decompositionStrategy: jsonb("decomposition_strategy"),
  status: text("status").default("active"),
  startDate: date("start_date"),
  targetDate: date("target_date"),
  createdAt: now(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const initiativeParticipants = pgTable(
  "initiative_participants",
  {
    initiativeId: uuid("initiative_id").notNull().references(() => initiatives.id),
    personId: uuid("person_id").notNull().references(() => people.id),
    role: text("role"),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.personId] })],
);

export const initiativeCommunities = pgTable(
  "initiative_communities",
  {
    initiativeId: uuid("initiative_id").notNull().references(() => initiatives.id),
    communityId: uuid("community_id").notNull().references(() => communities.id),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.communityId] })],
);

export const touchpoints = pgTable(
  "touchpoints",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    initiativeId: uuid("initiative_id").references(() => initiatives.id),
    parentTouchpointId: uuid("parent_touchpoint_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    touchpointKind: text("touchpoint_kind"),
    alignmentScore: numeric("alignment_score"),
    assigneeType: text("assignee_type").notNull(),
    assigneeId: uuid("assignee_id").notNull(),
    context: text("context"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdAt: now(),
  },
  (t) => [index("touchpoints_tree_idx").on(t.initiativeId, t.parentTouchpointId)],
);

export const timelineEntries = pgTable(
  "timeline_entries",
  {
    id: uuidPkV7(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    content: text("content"),
    createdBy: text("created_by").notNull(),
    createdAt: now(),
  },
  (t) => [index("timeline_entries_ws_occurred_idx").on(t.workspaceId, t.occurredAt)],
);

export const timelineEntryRefs = pgTable(
  "timeline_entry_refs",
  {
    entryId: uuid("entry_id").notNull().references(() => timelineEntries.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.entityType, t.entityId] })],
);

/**
 * memories — the MEM-1 "learns how you work" home (roadmap undefined-element #3).
 * A thin, derived, CLASSIFIED layer of confirmed/superseded learned facts that
 * sits ALONGSIDE timeline_entries (the raw capture log), NOT a fork of it: a
 * capture lands as a timeline entry and, when wired, a derived Memory candidate
 * is written here with `source_ref_*` pointing back at that entry.
 *
 * Append-only (corrections supersede via `supersedes_id`, the prior row is
 * retained). Read visibility is authority-scoped by `scope` at the store
 * boundary (@bridge/core MemoryStore) AND defended at the DB by RLS
 * (migrations/0009). `trust_origin` carries PI-1 provenance so a Memory derived
 * from untrusted content is auditable as such.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuidPkV7(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    /** episodic | semantic | procedural | preference */
    type: text("type").notNull(),
    /** The element (Person/Community/Initiative…) this fact is about, if any.
     * No FK — it can reference any node type across the graph. */
    subjectElementId: uuid("subject_element_id"),
    /** Classification: public | workspace | team | private | restricted. */
    scope: text("scope").notNull(),
    content: text("content").notNull(),
    /** What this Memory was derived from: timeline_entry | ledger | feedback. */
    sourceRefType: text("source_ref_type"),
    sourceRefId: uuid("source_ref_id"),
    /** Writer's confidence in the fact, 0..1 (numeric; adapter Number()-izes). */
    confidence: numeric("confidence").notNull(),
    /** The Memory this row corrects/replaces (self-FK in migrations/0009). */
    supersedesId: uuid("supersedes_id"),
    /** PI-1 provenance: operator | user_content | untrusted_external. */
    trustOrigin: text("trust_origin").notNull(),
    /** local | cloud — captures/derived-facts default to the local plane. */
    plane: text("plane").notNull(),
    /** Provenance actor: provider/agent/user id that produced this Memory. */
    createdBy: text("created_by").notNull(),
    /** Owner for authority-scoping team/private/restricted reads. */
    ownerUserId: uuid("owner_user_id"),
    createdAt: now(),
  },
  (t) => [index("memories_ws_subject_idx").on(t.workspaceId, t.subjectElementId)],
);


export const files = pgTable("files", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  source: text("source").notNull(),
  storageRef: text("storage_ref"),
  contentText: text("content_text"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: now(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const fileRefs = pgTable(
  "file_refs",
  {
    fileId: uuid("file_id").notNull().references(() => files.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.entityType, t.entityId] })],
);

// =====================================================================
// LAYER 3b — CENTRAL EMBEDDINGS
// =====================================================================
export const embeddings = pgTable(
  "embeddings",
  {
    id: uuidPk(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    embeddingModel: text("embedding_model").notNull().default("nomic-embed-text-v1.5"),
    embeddingVersion: text("embedding_version").notNull().default("1"),
    embedding: vector("embedding", 768).notNull(),
    createdAt: now(),
  },
  (t) => [
    unique("embeddings_uq").on(t.entityType, t.entityId, t.embeddingModel),
    index("embeddings_entity_idx").on(t.entityType, t.entityId),
    // ANN index for similarity search (docs/raw/SCHEMA.sql:171). Drizzle has no
    // native `USING hnsw` index builder / vector distance-operator-class API, so
    // the actual `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` DDL
    // lives in migrations/0004_schema_hardening.sql (hand-written, same pattern
    // as the role_permissions coalesce-NULL index in 0001). This comment exists
    // so a future editor doesn't assume the hnsw index is missing just because
    // it isn't declared here — it's real, verified working against pglite too
    // (@electric-sql/pglite/vector ships hnsw index builds at the pinned version).
  ],
);

export const embeddingModels = pgTable("embedding_models", {
  embeddingModel: text("embedding_model").primaryKey(),
  dim: integer("dim").notNull(),
  tableName: text("table_name").notNull(),
  isActive: boolean("is_active").notNull().default(false),
});

// =====================================================================
// LAYER 4 — CAPABILITY REGISTRIES
// =====================================================================
export const skills = pgTable(
  "skills",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    name: text("name").notNull(),
    version: text("version").notNull().default("1.0.0"),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    implRef: text("impl_ref"),
    status: text("status").notNull().default("active"),
  },
  (t) => [unique("skills_uq").on(t.workspaceId, t.name, t.version)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    name: text("name").notNull(),
    identityType: text("identity_type").notNull().default("service_principal"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    assumesRoleId: uuid("assumes_role_id"),
    goal: text("goal"),
    allowedSkills: text("allowed_skills").array().notNull().default(sql`'{}'`),
    allowedTools: uuid("allowed_tools").array().notNull().default(sql`'{}'`),
    capabilityScope: jsonb("capability_scope").notNull().default({}),
    status: text("status").notNull().default("active"),
  },
  (t) => [unique("agents_workspace_id_id_uq").on(t.workspaceId, t.id)],
);

export const rituals = pgTable("rituals", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  trigger: jsonb("trigger").notNull(),
  cadence: text("cadence"),
  agentId: uuid("agent_id").references(() => agents.id),
  agentPlane: text("agent_plane"),
  /** Legacy multi-owner field retained only for migration compatibility. */
  agentIds: uuid("agent_ids").array().notNull().default(sql`'{}'`),
  skillPipeline: jsonb("skill_pipeline").notNull().default([]),
  policyScopeId: uuid("policy_scope_id"),
  outputSurface: text("output_surface"),
  supportsInitiative: uuid("supports_initiative").references(() => initiatives.id),
  isTemplate: boolean("is_template").notNull().default(false),
  status: text("status").notNull().default("active"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const ritualRuns = pgTable("ritual_runs", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  ritualId: uuid("ritual_id").notNull().references(() => rituals.id),
  runId: text("run_id"),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  output: jsonb("output"),
  ledgerId: uuid("ledger_id"),
});

export const tools = pgTable("tools", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  surface: text("surface").notNull(),
  composition: jsonb("composition").notNull().default({}),
  status: text("status").notNull().default("active"),
});

export const integrations = pgTable("integrations", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  provider: text("provider").notNull(),
  authRef: text("auth_ref"),
  scopes: text("scopes").array(),
  status: text("status").notNull().default("active"),
});

export const integrationSyncState = pgTable(
  "integration_sync_state",
  {
    integrationId: uuid("integration_id").notNull().references(() => integrations.id),
    source: text("source").notNull(),
    lastCursor: text("last_cursor"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.integrationId, t.source] })],
);

export const externalRecords = pgTable(
  "external_records",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: now(),
  },
  (t) => [unique("external_records_uq").on(t.workspaceId, t.source, t.sourceRecordId)],
);

// =====================================================================
// LAYER 5 — GOVERNANCE SPINE
// =====================================================================
export const roles = pgTable("roles", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("human"), // human | agent
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuidPk(),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    action: text("action").notNull(),
    effect: text("effect").notNull().default("allow"),
  },
  // NOT `unique(...).on(...)` here anymore. SCHEMA.sql uses a
  // coalesce(resource_id, '0000…') expression so NULL (type-wide) grants are
  // unique — Drizzle's `unique().on()` builder takes columns only and cannot
  // express that, so it previously declared a NAIVE (non-coalesced) unique
  // constraint of the same name (`role_permissions_uq`) alongside the real,
  // hand-written coalesce-NULL unique INDEX in migrations/0001_governance_seed.sql
  // (which explicitly `DROP CONSTRAINT`s the naive one before creating the real
  // index). Two constraints, same name, different semantics: `drizzle-kit push`
  // (reads schema.ts directly) tested the naive one against local dev, while
  // migrations/ (what actually ships) enforced the coalesce one — a silent
  // drift between what's tested locally and what's enforced in prod. Declaring
  // NOTHING here (no `unique()`/`uniqueIndex()` builder) makes the hand-written
  // coalesce index in 0001 (reasserted defensively in 0004_schema_hardening.sql)
  // the ONE canonical constraint on both paths.
  () => [],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    action: text("action").notNull(),
    effect: text("effect").notNull().default("deny"), // v2: default DENY
    grantedBy: uuid("granted_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index("permissions_actor_idx").on(t.workspaceId, t.actorType, t.actorId, t.resourceType)],
);

export const ephemeralGrants = pgTable(
  "ephemeral_grants",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id").notNull(),
    contextType: text("context_type").notNull(),
    contextId: uuid("context_id").notNull(),
    runId: text("run_id"),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    action: text("action").notNull(),
    grantedBy: uuid("granted_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("ephemeral_grants_active_idx").on(t.workspaceId, t.actorType, t.actorId)],
);

export const delegations = pgTable("delegations", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  principalType: text("principal_type").notNull(),
  principalId: uuid("principal_id").notNull(),
  delegateAgentId: uuid("delegate_agent_id").notNull().references(() => agents.id),
  scope: jsonb("scope").notNull().default({}),
  grantedBy: uuid("granted_by"),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const policies = pgTable("policies", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  scopeType: text("scope_type").notNull(),
  scopeId: uuid("scope_id"),
  name: text("name").notNull(),
  rule: jsonb("rule").notNull(),
  evaluationPhase: text("evaluation_phase").notNull().default("pre"),
  effect: text("effect").notNull().default("require_approval"),
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
});

export const policyParams = pgTable(
  "policy_params",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    policyId: uuid("policy_id").references(() => policies.id),
    paramKey: text("param_key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("policy_params_uq").on(t.workspaceId, t.policyId, t.paramKey)],
);

export const ledger = pgTable("ledger", {
  // Append-only, high-write table — UUIDv7 keeps new rows physically adjacent
  // (see uuidPkV7's doc comment; migrations/0004_schema_hardening.sql item 2).
  id: uuidPkV7(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id").notNull(),
  onBehalfOfType: text("on_behalf_of_type"),
  onBehalfOfId: uuid("on_behalf_of_id"),
  delegationId: uuid("delegation_id").references(() => delegations.id),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id"),
  inputs: jsonb("inputs"),
  proposedOutput: jsonb("proposed_output"),
  userDecision: text("user_decision"), // approve | veto | edit
  diff: jsonb("diff"),
  policyResults: jsonb("policy_results"),
  /** Links a decision row back to the proposal it resolves. Real column (see
   * 0003_ledger_ref_column.sql) — a partial unique index enforces "at most one
   * non-rejected decision per ref_ledger_id" at the DB, closing the double-approve
   * TOCTOU the old `diff->>'__refLedgerId'` jsonb-only linkage could not. */
  refLedgerId: uuid("ref_ledger_id"),
  /** Trace seed: ties a request to its originating event/signal. Real column —
   * previously only round-tripped via a `diff` jsonb reserved key. */
  seed: text("seed"),
  /** Data tier this action touched (the access dropdown) — audit completeness. */
  dataScope: text("data_scope"),
  /** Original run context (initiative/community/ritual + runId) — audit completeness;
   * lets a replayed decide() thread the SAME context instead of a synthetic one. */
  context: jsonb("context"),
  /** Provenance / trust origin of the input that drove this action (PI-1):
   * operator | user_content | untrusted_external. Nullable — absent on rows not
   * ingested from a tagged source. Tag-and-persist only; gating is PI-2. */
  trustOrigin: text("trust_origin"),
  createdAt: now(),
});

export const decisionTraces = pgTable("decision_traces", {
  id: uuidPk(),
  ledgerId: uuid("ledger_id").notNull().references(() => ledger.id),
  signals: jsonb("signals"),
  context: jsonb("context"),
  reasoning: jsonb("reasoning"),
  outcome: jsonb("outcome"),
});

// =====================================================================
// LAYER 6 — EVENT / SIGNAL BUS
// =====================================================================
export const events = pgTable(
  "events",
  {
    // Append-only, high-write table — UUIDv7 keeps new rows physically adjacent
    // (see uuidPkV7's doc comment; migrations/0004_schema_hardening.sql item 2).
    id: uuidPkV7(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: now(),
  },
  (t) => [index("events_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

export const signals = pgTable("signals", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  type: text("type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  recommendedAction: jsonb("recommended_action").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: now(),
});

export const signalActions = pgTable("signal_actions", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  signalId: uuid("signal_id").notNull().references(() => signals.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  verb: text("verb").notNull(), // act | dismiss | save
  createdAt: now(),
});

// =====================================================================
// LAYER 7 — TOOL BACKENDS (frontend-migration-scoping.md Phase 4)
// =====================================================================

/** JobPilot's own persistence — the `@bridge/jobpilot` package (scoring, table
 * spec, state machine) is pure logic with no store of its own; these two tables
 * are that missing store, shaped to match `jobsTableSpec`'s columns 1:1 so the
 * @bridge/tables card-feed/kanban views can bind directly. */
export const jobpilotJobs = pgTable(
  "jobpilot_jobs",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    salaryMax: integer("salary_max"),
    url: text("url"),
    source: text("source"), // greenhouse | ashby | lever | manual
    createdAt: now(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("jobpilot_jobs_ws_idx").on(t.workspaceId, t.createdAt)],
);

/** One row per job the candidate is tracking; `stage` mirrors
 * `jobsTableSpec`'s stage enum and `state-machine.ts`'s ApplicationStage. */
export const jobpilotApplications = pgTable(
  "jobpilot_applications",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    jobId: uuid("job_id").notNull().references(() => jobpilotJobs.id),
    stage: text("stage").notNull().default("queued"),
    // pursue | review | pass (AP-023 — no green/yellow feedback semantics). No CHECK
    // constraint yet and no backfill has run for rows persisted before this rename —
    // TASK-010 review remediation item 9 defers that to migration 0016+ once TASK-008
    // RM4's 0015 lands (see @bridge/jobpilot's normalizeLegacyFitFlag for the interim
    // read-side safety net and outputs/2026-07-17-task010-review-remediation.md for
    // the exact backfill SQL).
    flag: text("flag"),
    fitScore: numeric("fit_score"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobpilot_applications_ws_idx").on(t.workspaceId, t.stage)],
);

/** Helpdesk — the one workspace-scoped tool with a public/unauthenticated
 * submitter side. `accessToken` (opaque, unguessable) is the submitter's ONLY
 * credential: knowing it proves ownership of the ticket, the same trust model as
 * a password-reset link. No new Actor type / identity-resolution change was
 * needed (see docs/raw/decisions-log.md) — the public procedures never consult
 * `ctx.identity` at all; they gate on possession of this token instead. */
export const helpdeskTickets = pgTable(
  "helpdesk_tickets",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("open"), // open | pending | resolved | closed
    submitterEmail: text("submitter_email").notNull(),
    submitterName: text("submitter_name"),
    accessToken: text("access_token").unique().notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("helpdesk_tickets_ws_idx").on(t.workspaceId, t.createdAt)],
);

export const helpdeskMessages = pgTable(
  "helpdesk_messages",
  {
    id: uuidPkV7(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    ticketId: uuid("ticket_id").notNull().references(() => helpdeskTickets.id),
    authorType: text("author_type").notNull(), // submitter | agent
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(),
    createdAt: now(),
  },
  (t) => [index("helpdesk_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** Resources — replaces the prototype's Supabase-direct `resources_canonical`
 * read with a governed, workspace-scoped table (frontend-migration-scoping.md
 * gap #4). Simple catalog shape; `tags` is jsonb (a string array) rather than a
 * separate join table since resources have no other relational structure yet. */
export const resources = pgTable(
  "resources",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // book | podcast | vlog | article | other
    url: text("url"),
    notes: text("notes"),
    tags: jsonb("tags").notNull().default([]),
    createdAt: now(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("resources_ws_idx").on(t.workspaceId, t.createdAt)],
);

// =====================================================================
// LAYER 8 — CAPABILITY TRUST MODEL (vision pivot 2026-07-06,
// docs/wiki/vision.md "Capability Trust Model" + "Promotion defaults")
// =====================================================================

/**
 * One row per registered capability (skill/workflow/agent/tool/integration/
 * view/dashboard). Risk is COMPUTED (packages/core/src/capability/risk.ts),
 * never self-declared by the generator — `computedRisk` here is the cached
 * result of that computation, recomputed whenever the manifest or its
 * dependency closure changes. `lineageManifestId` self-references this table
 * (a Fork/copy points back at its origin — see vision.md "Workspaces =
 * projections", the Fork verb); nullable because most manifests have no
 * lineage. Unique (workspace_id, name, version) — the same version-pinning
 * discipline `skills_uq` already uses.
 */
export const capabilityManifests = pgTable(
  "capability_manifests",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    capabilityType: text("capability_type").notNull(), // skill | workflow | agent | tool | integration | view | dashboard
    /** REG-1 Component Registry discriminator (undefined-elements §2) — reuse
     * this table as the registry rather than forking a second source of truth.
     * Nullable: pre-REG-1 rows have no kind; overlap detection falls back to
     * capability_type. Values: agent|skill|automation|workflow|tool|prompt|
     * eval_set|routing_rule|policy|integration|template. */
    kind: text("kind"),
    name: text("name").notNull(),
    version: text("version").notNull().default("1.0.0"),
    origin: text("origin").notNull().default("user_code"), // built_in | template | community | ai_generated | user_code
    audience: text("audience").notNull().default("private"), // private | team | external_visible
    /** inputs/outputs/permissions/connectors/evidence/rollback/evaluation — the
     * generalized Capability Manifest (tool-kit's ToolManifest is the tool-shaped
     * special case; this is the superset covering every capability_type). */
    manifest: jsonb("manifest").notNull().default({}),
    /** Computed (never self-declared): informational | advisory | transformational | operational | external. */
    computedRisk: text("computed_risk").notNull().default("informational"),
    /** [{manifestId, versionRange}] — the dependency closure computeRisk() walks. */
    dependencies: jsonb("dependencies").notNull().default([]),
    lineageManifestId: uuid("lineage_manifest_id"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    createdAt: now(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("capability_manifests_uq").on(t.workspaceId, t.name, t.version),
    index("capability_manifests_ws_idx").on(t.workspaceId, t.capabilityType),
  ],
);

/**
 * Current lifecycle state, one row per manifest (unique manifest_id — this is
 * a 1:1 "current state" projection, not a history log; the ledger is the
 * append-only history of how a manifest got here). States:
 * draft → validated → approved → active → trusted → deprecated → archived
 * (packages/core/src/capability/lifecycle.ts owns the transition guards).
 * `trustedUntil` = the 90-day TTL set on entering `trusted` (PROMOTION_DEFAULTS.trustedTtlDays);
 * dependency change demotes trusted→validated (trustedUntil cleared).
 * `suspended` is a SEPARATE flag from `state` — failure suspends immediately
 * without an approval and without moving the state machine backwards, so the
 * capability can be un-suspended back to its prior state once resolved.
 */
export const capabilityStates = pgTable(
  "capability_states",
  {
    id: uuidPk(),
    manifestId: uuid("manifest_id").notNull().references(() => capabilityManifests.id),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    state: text("state").notNull().default("draft"),
    trustedUntil: timestamp("trusted_until", { withTimezone: true }),
    suspended: boolean("suspended").notNull().default(false),
    suspendReason: text("suspend_reason"),
    /** { runCount, successRate, violationCount, ageDays, ... } — the evidence
     * PROMOTION_DEFAULTS thresholds are evaluated against. */
    evidence: jsonb("evidence").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("capability_states_manifest_uq").on(t.manifestId)],
);

/**
 * A workspace/user-scoped trust grant for a capability CLASS (not a single
 * manifest instance) — e.g. "auto-activate any 'advisory'-risk skill this user
 * authored". `scope` narrows who/where it applies; `autoActivate` decides
 * whether matching capabilities skip the approval gate (still subject to the
 * budgets + external-band hard floor in approvals.ts). Revocable, never hard-deleted.
 */
export const trustGrants = pgTable(
  "trust_grants",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    capabilityClass: text("capability_class").notNull(),
    scope: jsonb("scope").notNull().default({}), // { workspaceId?, userId? }
    grantedBy: uuid("granted_by").references(() => users.id),
    riskBand: text("risk_band").notNull(), // informational | advisory | transformational | operational | external
    autoActivate: boolean("auto_activate").notNull().default(false),
    createdAt: now(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("trust_grants_ws_class_idx").on(t.workspaceId, t.capabilityClass)],
);

/**
 * A generated workspace blueprint (vocabulary, node types used, views,
 * capabilities) — P1 onboarding writes these; the table is created now so the
 * shape exists ahead of that work (see CLAUDE.md status: "workspace_definitions"
 * punch-list item). `version` increments on republish (Publish Blueprint verb,
 * vision.md "Workspaces = projections"); `status` tracks draft/active/archived
 * the same way other registries do.
 */
export const workspaceDefinitions = pgTable(
  "workspace_definitions",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    blueprint: jsonb("blueprint").notNull().default({}),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"), // draft | active | archived
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: now(),
  },
  (t) => [index("workspace_definitions_ws_idx").on(t.workspaceId, t.version)],
);

/**
 * One row per (workspace, package name, version) install — the persistent
 * binding for @bridge/core's `PackageStore` port (packages/core/src/package/
 * ports.ts's `PackageInstallationRow`). Mirrors `capabilityManifests`'
 * shape one level up (ADR-018's format doc, ADR-021's P2 slice 1, ADR-023's
 * Drizzle-backing pass): a package BUNDLES one or more capability manifests,
 * and this table is the shipping-unit row those bundles get installed as.
 * `manifest` jsonb round-trips the FULL parsed `PackageManifest` (name/
 * version/kind/capabilities[]/dependencies/etc — package/types.ts), validated
 * at the read/write boundary the same way capability-store.ts validates
 * `dependencies`/`evidence` — @bridge/core stays zero-runtime-deps, so the
 * zod schema for this jsonb lives in package-store.ts, not here.
 * `lineageManifestId` self-references this table (a rollback fork points
 * back at the historical row it forked from — lifecycle.ts's
 * `rollbackFromHistory`), nullable for a v1 package. Installation identity
 * is unique per workspace/package/version/Module-Agent-need attachment.
 * Re-registering identical content reuses that row; the same signed package
 * may still attach to a different declared Module Agent need.
 */
export const packageInstallations = pgTable(
  "package_installations",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    packageName: text("package_name").notNull(),
    packageVersion: text("package_version").notNull(),
    manifest: jsonb("manifest").notNull().default({}),
    /** Computed (never self-declared, mirrors capability_manifests.computed_risk):
     * informational | advisory | transformational | operational | external. */
    computedRisk: text("computed_risk").notNull().default("informational"),
    /** Single-live-version lifecycle state (package/lifecycle.ts):
     * private | promoted | available | legacy | deprecating | deprecated. */
    state: text("state").notNull().default("private"),
    /** pending_review | installed | rejected — registration/install outcome,
     * orthogonal to `state` (mirrors capability_states.suspended being a
     * separate flag from capability_states.state). */
    status: text("status").notNull().default("pending_review"),
    lineageManifestId: uuid("lineage_manifest_id"),
    /** Installation-local ownership for a signed Commons capability. */
    moduleAttachment: jsonb("module_attachment"),
    createdAt: now(),
  },
  (t) => [
    index("package_installations_ws_name_idx").on(t.workspaceId, t.packageName),
    index("package_installations_ws_state_idx").on(t.workspaceId, t.packageName, t.state),
    uniqueIndex("package_installations_attachment_uq").on(
      t.workspaceId,
      t.packageName,
      t.packageVersion,
      sql`coalesce(${t.moduleAttachment}->>'modulePackageName', '')`,
      sql`coalesce(${t.moduleAttachment}->>'agentId', '')`,
      sql`coalesce(${t.moduleAttachment}->>'needId', '')`,
    ),
  ],
);

// =====================================================================
// LAYER 8 — GOAL/TASK/SKILL-MANIFEST/CHILD-AGENT-RUN (TASK-007, AGS1/AGS2,
// docs/raw/agent-goal-skill-orchestration-plan-2026-07.md). Restart-durable
// backing for @bridge/core's goal-task.ts/skill-manifest.ts/child-agent-run.ts
// in-memory ports — the in-process Maps those ports shipped with are correct
// as the dependency-free default (mirrors every other in-memory port in this
// codebase), but production/persistent mode must not lose live Goals, Tasks,
// registered Skill manifests, or running child Agent Runs across a restart.
// =====================================================================

export const goals = pgTable(
  "goals",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    createdAt: now(),
  },
  (t) => [
    index("goals_ws_type_idx").on(t.workspaceId, t.type),
    unique("goals_workspace_id_id_uq").on(t.workspaceId, t.id),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    goalId: uuid("goal_id").notNull(),
    type: text("type").notNull(),
    /** The ONLY thing that authorizes an eligible Agent to invoke a matching
     * governed Skill for this Task (@bridge/core's goal-task.ts doc comment) —
     * references `agents.id`, never a client-asserted string. */
    assignedAgentId: uuid("assigned_agent_id").notNull(),
    status: text("status").notNull().default("open"), // open | in_progress | done | blocked | cancelled
    createdAt: now(),
  },
  (t) => [
    index("tasks_goal_idx").on(t.goalId),
    index("tasks_assigned_agent_idx").on(t.assignedAgentId),
    unique("tasks_workspace_id_id_uq").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.goalId],
      foreignColumns: [goals.workspaceId, goals.id],
      name: "tasks_workspace_goal_fk",
    }),
    foreignKey({
      columns: [t.workspaceId, t.assignedAgentId],
      foreignColumns: [agents.workspaceId, agents.id],
      name: "tasks_workspace_agent_fk",
    }),
  ],
);

/**
 * The governed Skill contract catalog (@bridge/core's skill-manifest.ts
 * `SkillManifest`). `workspaceId` nullable mirrors `skills.workspaceId` —
 * null = a global/platform-wide manifest (the normal case: manifests are
 * declared once in code at wiring.ts and seeded here idempotently on boot,
 * the same "code declares, DB durably records" pattern as
 * `ensureFoundationalAgentGovernance`'s role/permission seed), non-null only
 * for a future workspace-scoped override. Unique on (skill_id, version) so
 * the boot-time seed upsert is idempotent across restarts.
 */
export const skillManifests = pgTable(
  "skill_manifests",
  {
    id: uuidPk(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    skillId: text("skill_id").notNull(),
    version: text("version").notNull().default("1.0.0"),
    goalTypes: jsonb("goal_types").notNull().default([]),
    taskTypes: jsonb("task_types").notNull().default([]),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    permissions: jsonb("permissions").notNull().default([]),
    plane: text("plane").notNull(),
    dataScopes: jsonb("data_scopes").notNull().default([]),
    riskBand: text("risk_band").notNull(),
    budget: jsonb("budget"),
    evalVersion: text("eval_version").notNull(),
    defaultAgents: jsonb("default_agents"),
    requiredIntegrations: jsonb("required_integrations"),
    childRunPolicy: text("child_run_policy"), // forbidden | allowed
    createdAt: now(),
  },
  (t) => [unique("skill_manifests_uq").on(t.workspaceId, t.skillId, t.version)],
);

/**
 * Bounded child Agent Runs (@bridge/core's child-agent-run.ts `ChildAgentRun`).
 * `parentRunId` is NOT a foreign key — it names the top-level RunCtx/ledger
 * `context.runId` the child Run was spawned under, which is an ephemeral
 * per-request id, not itself a persisted row (mirrors `ledger.actorId`'s
 * un-referenced uuid: the actor may be a user OR an agent, no single table to
 * point at). The append-only lifecycle audit trail lives in `ledger`
 * (unaffected by this table — see `recordChildAgentRunTransition`'s doc
 * comment); this table is the CURRENT-STATE projection a restart must not lose.
 */
export const childAgentRuns = pgTable(
  "child_agent_runs",
  {
    id: uuidPk(),
    parentRunId: uuid("parent_run_id").notNull(),
    parentAgentId: uuid("parent_agent_id").notNull(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    goalId: uuid("goal_id").notNull(),
    taskId: uuid("task_id").notNull(),
    depth: integer("depth").notNull(),
    authorityScope: jsonb("authority_scope").notNull().default([]),
    droppedScope: jsonb("dropped_scope").notNull().default([]),
    eligibleSkills: jsonb("eligible_skills").notNull().default([]),
    dataScope: text("data_scope").notNull(),
    plane: text("plane").notNull(),
    budget: jsonb("budget").notNull(),
    callsUsed: integer("calls_used").notNull().default(0),
    costUsed: doublePrecision("cost_used").notNull().default(0),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    stopCondition: text("stop_condition").notNull(),
    reviewMode: text("review_mode").notNull(), // auto | notify | approve | quorum
    taint: text("taint"),
    status: text("status").notNull().default("running"), // running | completed | cancelled | failed | stopped
    createdAt: now(),
  },
  (t) => [
    index("child_agent_runs_parent_run_idx").on(t.workspaceId, t.parentRunId),
    foreignKey({
      columns: [t.workspaceId, t.parentAgentId],
      foreignColumns: [agents.workspaceId, agents.id],
      name: "child_agent_runs_workspace_agent_fk",
    }),
    foreignKey({
      columns: [t.workspaceId, t.goalId],
      foreignColumns: [goals.workspaceId, goals.id],
      name: "child_agent_runs_workspace_goal_fk",
    }),
    foreignKey({
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
      name: "child_agent_runs_workspace_task_fk",
    }),
  ],
);
