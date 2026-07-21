/**
 * Drizzle schema — faithful mirror of docs/raw/SCHEMA.sql (Bridge AI Schema v2).
 *
 * Conventions (from the SQL header):
 *   - uuid PKs (gen_random_uuid)
 *   - tenant-scoped tables carry organization_id (RLS deny-by-default, applied in Supabase)
 *   - soft-delete via archived_at (NEVER hard delete)
 *   - append-only tables (events, ledger) revoke UPDATE/DELETE
 *   - TWO TIERS: canonical (platform/global/public) vs relationship (per-user/private)
 *
 * RLS policies + the append-only REVOKEs live in the Supabase migrations, not here —
 * Drizzle owns table shape; the database owns enforcement.
 */
import {
  bigint,
  boolean,
  check,
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
import { UNKNOWN_LABEL, uuidv7 } from "@bridge/core";

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

export const organizations = pgTable("organizations", {
  id: uuidPk(),
  name: text("name").notNull(),
  createdAt: now(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id),
  defaultVisibility: text("default_visibility").notNull().default("private"),
  settings: jsonb("settings").notNull().default({}),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id"),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const teams = pgTable("teams", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("private"),
  canonicalCommunityId: uuid("canonical_community_id").references(() => communitiesCanonical.id),
  nameOverride: text("name_override"),
  descriptionOverride: text("description_override"),
  locationOverride: text("location_override"),
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    visibility: text("visibility").notNull().default("private"),
    canonicalPersonId: uuid("canonical_person_id").references(() => peopleCanonical.id),
    fullNameOverride: text("full_name_override"),
    currentTitleOverride: text("current_title_override"),
    bioOverride: text("bio_override"),
    locationOverride: text("location_override"),
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
    index("people_org_user_idx").on(t.organizationId, t.userId),
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
  owningModule: text("owning_module"),
});

export interface RelationEvidenceRef {
  entityType: string;
  entityId: string;
  source?: string;
}

export const edges = pgTable(
  "edges",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    srcType: text("src_type").notNull(),
    srcId: uuid("src_id").notNull(),
    dstType: text("dst_type").notNull(),
    dstId: uuid("dst_id").notNull(),
    edgeType: text("edge_type").notNull(),
    properties: jsonb("properties").notNull().default({}),
    evidenceRefs: jsonb("evidence_refs").$type<RelationEvidenceRef[]>().notNull().default([]),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull().default(sql`1`),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3,
    }).notNull().defaultNow(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    userConfirmed: boolean("user_confirmed").notNull().default(false),
    visibility: text("visibility").notNull().default("private"),
    source: text("source").notNull().default("user"),
    sourceModule: text("source_module").notNull().default("legacy"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    decisionLedgerId: uuid("decision_ledger_id"),
    decisionSequence: bigint("decision_sequence", { mode: "number" }),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
    }).notNull().defaultNow(),
  },
  (t) => [
    index("edges_src_idx").on(t.organizationId, t.srcType, t.srcId),
    index("edges_dst_idx").on(t.organizationId, t.dstType, t.dstId),
    index("edges_relation_page_idx").on(t.organizationId, t.observedAt, t.createdAt, t.id),
    uniqueIndex("edges_semantic_uq").on(
      t.organizationId,
      t.srcType,
      t.srcId,
      t.dstType,
      t.dstId,
      t.edgeType,
      t.ownerUserId,
    ),
    check("edges_confidence_check", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check("edges_evidence_refs_array_check", sql`jsonb_typeof(${t.evidenceRefs}) = 'array'`),
    check(
      "edges_valid_range_check",
      sql`${t.validTo} IS NULL OR ${t.validFrom} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
    check("edges_visibility_check", sql`${t.visibility} IN ('private', 'organization', 'public')`),
    check("edges_source_module_check", sql`length(trim(${t.sourceModule})) > 0`),
    check(
      "edges_decision_provenance_check",
      sql`(${t.decisionLedgerId} IS NULL AND ${t.decisionSequence} IS NULL AND ${t.decisionAt} IS NULL) OR (${t.decisionLedgerId} IS NOT NULL AND ${t.decisionSequence} IS NOT NULL AND ${t.decisionAt} IS NOT NULL)`,
    ),
  ],
);

// =====================================================================
// LAYER 3 — OPERATIONAL PLANE
// =====================================================================
export const records = pgTable("records", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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

export const recordParticipants = pgTable(
  "record_participants",
  {
    recordId: uuid("record_id").notNull().references(() => records.id),
    personId: uuid("person_id").notNull().references(() => people.id),
    role: text("role"),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.personId] })],
);

export const recordCommunities = pgTable(
  "record_communities",
  {
    recordId: uuid("record_id").notNull().references(() => records.id),
    communityId: uuid("community_id").notNull().references(() => communities.id),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.communityId] })],
);

/**
 * memories — the MEM-1 "learns how you work" home (roadmap undefined-element #3).
 * A thin, derived, CLASSIFIED layer of confirmed/superseded learned facts that
 * sits alongside the append-only Event ledger: a capture lands as an Event and,
 * when wired, a derived Memory candidate points back at that Event.
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** episodic | semantic | procedural | preference */
    type: text("type").notNull(),
    /** The element (Person/Community/Record…) this fact is about, if any.
     * No FK — it can reference any node type across the graph. */
    subjectRecordId: uuid("subject_record_id"),
    /** Classification: public | organization | team | private | restricted. */
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
    taintLabel: jsonb("taint_label").notNull().default(UNKNOWN_LABEL),
    /** local | cloud — captures/derived-facts default to the local plane. */
    plane: text("plane").notNull(),
    /** Provenance actor: provider/agent/user id that produced this Memory. */
    createdBy: text("created_by").notNull(),
    /** Owner for authority-scoping team/private/restricted reads. */
    ownerUserId: uuid("owner_user_id"),
    /** TASK-010 review round-5/6/7 — durable, DB-backed per-lineage ordering.
     * Allocated ATOMICALLY inside `casSupersede`'s own SERIALIZABLE
     * transaction (`(current?.lineageRevision ?? 0) + 1` scoped to
     * `(organization_id, owner_user_id, subject_record_id)`, the SAME triple
     * `currentForLineage`/`casSupersede` already key a lineage on) —
     * correct across ANY number of server processes/restarts, unlike the
     * process-local monotonic timestamp counter (`monotonicRedFlagNowISO`
     * in apps/api/src/router.ts), which remains in use for `createdAt` and
     * for global cross-lineage ordering (a per-lineage revision is
     * meaningless across different lineages — see
     * `@bridge/core`'s `MemoryQuery.orderBy` doc). `NULL` on every
     * pre-migration row and on any write not made through `casSupersede`
     * (no backfill is possible or needed — `history`'s per-lineage
     * ordering treats `NULL` as older than any allocated revision, so a
     * fresh lineage's first row always gets revision 1 and this is purely
     * additive). */
    lineageRevision: bigint("lineage_revision", { mode: "number" }),
    createdAt: now(),
  },
  (t) => [index("memories_org_subject_idx").on(t.organizationId, t.subjectRecordId)],
);


export const files = pgTable("files", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  source: text("source").notNull(),
  storageRef: text("storage_ref"),
  contentText: text("content_text"),
  metadata: jsonb("metadata").notNull().default({}),
  taintLabel: jsonb("taint_label").notNull().default(UNKNOWN_LABEL),
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
    organizationId: uuid("organization_id").references(() => organizations.id),
    name: text("name").notNull(),
    version: text("version").notNull().default("1.0.0"),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    implRef: text("impl_ref"),
    status: text("status").notNull().default("active"),
  },
  (t) => [unique("skills_uq").on(t.organizationId, t.name, t.version)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    identityType: text("identity_type").notNull().default("service_principal"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    assumesRoleId: uuid("assumes_role_id"),
    goal: text("goal"),
    allowedSkills: text("allowed_skills").array().notNull().default(sql`'{}'`),
    capabilityScope: jsonb("capability_scope").notNull().default({}),
    status: text("status").notNull().default("active"),
  },
  (t) => [unique("agents_organization_id_id_uq").on(t.organizationId, t.id)],
);

export const automations = pgTable(
  "automations",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    trigger: jsonb("trigger").notNull(),
    cadence: text("cadence"),
    agentId: uuid("agent_id").notNull(),
    agentPlane: text("agent_plane").notNull(),
    skillPipeline: jsonb("skill_pipeline").notNull().default([]),
    policyScopeId: uuid("policy_scope_id"),
    outputSurface: text("output_surface"),
    supportsRecord: uuid("supports_record").references(() => records.id),
    isTemplate: boolean("is_template").notNull().default(false),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("automations_organization_id_id_uq").on(t.organizationId, t.id),
    unique("automations_organization_id_agent_id_uq").on(
      t.organizationId,
      t.id,
      t.agentId,
    ),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: "automations_organization_agent_fk",
    }),
    check("automations_agent_plane_check", sql`${t.agentPlane} IN ('local', 'cloud')`),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    automationId: uuid("automation_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    runId: text("run_id"),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    output: jsonb("output"),
    ledgerId: uuid("ledger_id"),
    taintLabel: jsonb("taint_label").notNull().default(UNKNOWN_LABEL),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.automationId, t.agentId],
      foreignColumns: [automations.organizationId, automations.id, automations.agentId],
      name: "automation_runs_organization_automation_owner_fk",
    }),
  ],
);

export const integrations = pgTable("integrations", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: now(),
  },
  (t) => [unique("external_records_uq").on(t.organizationId, t.source, t.sourceRecordId)],
);

// =====================================================================
// LAYER 5 — GOVERNANCE SPINE
// =====================================================================
export const roles = pgTable("roles", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
  (t) => [index("permissions_actor_idx").on(t.organizationId, t.actorType, t.actorId, t.resourceType)],
);

export const ephemeralGrants = pgTable(
  "ephemeral_grants",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
  (t) => [index("ephemeral_grants_active_idx").on(t.organizationId, t.actorType, t.actorId)],
);

export const delegations = pgTable("delegations", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    policyId: uuid("policy_id").references(() => policies.id),
    paramKey: text("param_key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("policy_params_uq").on(t.organizationId, t.policyId, t.paramKey)],
);

export const ledger = pgTable("ledger", {
  // Append-only, high-write table — UUIDv7 keeps new rows physically adjacent
  // (see uuidPkV7's doc comment; migrations/0004_schema_hardening.sql item 2).
  id: uuidPkV7(),
  appendSequence: bigint("append_sequence", { mode: "number" }).default(
    sql`nextval('ledger_append_sequence_seq'::regclass)`,
  ).notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
  /** Original Run context (Record/Community/Automation + runId) — audit completeness;
   * lets a replayed decide() thread the SAME context instead of a synthetic one. */
  context: jsonb("context"),
  /** Provenance / trust origin of the input that drove this action (PI-1):
   * operator | user_content | untrusted_external. Nullable — absent on rows not
   * ingested from a tagged source. Tag-and-persist only; gating is PI-2. */
  trustOrigin: text("trust_origin"),
  taintLabel: jsonb("taint_label").notNull().default(UNKNOWN_LABEL),
  createdAt: now(),
});

export const relationMaterializationEffects = pgTable(
  "relation_materialization_effects",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    proposalLedgerId: uuid("proposal_ledger_id").notNull(),
    decisionLedgerId: uuid("decision_ledger_id").notNull(),
    status: text("status")
      .$type<"pending" | "applied" | "failed">()
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    leaseRecoveryCount: integer("lease_recovery_count").notNull().default(0),
    maxLeaseRecoveries: integer("max_lease_recoveries").notNull().default(3),
    relationCount: integer("relation_count"),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("relation_materialization_effects_proposal_uq").on(
      t.organizationId,
      t.proposalLedgerId,
    ),
    unique("relation_materialization_effects_decision_uq").on(
      t.organizationId,
      t.decisionLedgerId,
    ),
    index("relation_materialization_effects_retry_idx").on(
      t.organizationId,
      t.ownerUserId,
      t.status,
      t.nextRetryAt,
      t.leaseExpiresAt,
    ),
    index("relation_materialization_effects_outstanding_idx").on(
      t.organizationId,
      t.ownerUserId,
      t.id,
    ).where(sql`${t.status} IN ('pending', 'failed')`),
    check(
      "relation_materialization_effects_status_check",
      sql`${t.status} IN ('pending', 'applied', 'failed')`,
    ),
    check(
      "relation_materialization_effects_attempts_check",
      sql`${t.attemptCount} >= 0 AND ${t.maxAttempts} > 0 AND ${t.attemptCount} <= ${t.maxAttempts} AND ${t.leaseRecoveryCount} >= 0 AND ${t.maxLeaseRecoveries} > 0 AND ${t.leaseRecoveryCount} <= ${t.maxLeaseRecoveries}`,
    ),
    check(
      "relation_materialization_effects_relation_count_check",
      sql`${t.relationCount} IS NULL OR ${t.relationCount} >= 0`,
    ),
    check(
      "relation_materialization_effects_decision_check",
      sql`${t.proposalLedgerId} <> ${t.decisionLedgerId}`,
    ),
    check(
      "relation_materialization_effects_state_check",
      sql`(${t.status} = 'pending' AND ${t.appliedAt} IS NULL AND ${t.lastError} IS NULL AND ((${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL))) OR (${t.status} = 'failed' AND ${t.appliedAt} IS NULL AND ${t.lastError} IS NOT NULL AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.status} = 'applied' AND ${t.appliedAt} IS NOT NULL AND ${t.lastError} IS NULL AND ${t.nextRetryAt} IS NULL AND ${t.relationCount} IS NOT NULL AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
  ],
);

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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    taintLabel: jsonb("taint_label").notNull().default(UNKNOWN_LABEL),
    createdAt: now(),
  },
  (t) => [index("events_org_created_idx").on(t.organizationId, t.createdAt)],
);

/** Relationship Signal is a read projection over participant-linked Events. */
export const signals = pgTable("signals", {
  id: uuidPk(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  type: text("type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  recommendedAction: jsonb("recommended_action").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: now(),
});

// =====================================================================
// LAYER 7 — TOOL BACKENDS (frontend-migration-scoping.md Phase 4)
// =====================================================================

/** JobPilot's own persistence — the `@bridge/jobpilot` module (scoring, table
 * spec, state machine) is pure logic with no store of its own; these two tables
 * are that missing store, shaped to match `jobsTableSpec`'s columns 1:1 so the
 * @bridge/tables card-feed/kanban views can bind directly. */
export const jobpilotJobs = pgTable(
  "jobpilot_jobs",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    salaryMax: integer("salary_max"),
    url: text("url"),
    source: text("source"), // greenhouse | ashby | lever | manual
    createdAt: now(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("jobpilot_jobs_org_idx").on(t.organizationId, t.createdAt)],
);

/** One row per job the candidate is tracking; `stage` mirrors
 * `jobsTableSpec`'s stage enum and `state-machine.ts`'s ApplicationStage. */
export const jobpilotApplications = pgTable(
  "jobpilot_applications",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    jobId: uuid("job_id").notNull().references(() => jobpilotJobs.id),
    stage: text("stage").notNull().default("queued"),
    // pursue | review | pass (AP-023 — no green/yellow feedback semantics).
    // TASK-010 review remediation item 9 / round-6: backfilled and constrained
    // in migration 0016 once TASK-008 RM4's 0015 landed — legacy
    // green/yellow/red rows are rewritten to pursue/review/pass and the CHECK
    // constraint below then enforces no other value can ever be written again.
    // See @bridge/jobpilot's normalizeLegacyFitFlag for the (now redundant but
    // still harmless) read-side safety net this constraint makes unnecessary
    // going forward.
    flag: text("flag"),
    fitScore: numeric("fit_score"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobpilot_applications_org_idx").on(t.organizationId, t.stage),
    check("jobpilot_applications_flag_valid_ck", sql`${t.flag} IS NULL OR ${t.flag} IN ('pursue', 'review', 'pass')`),
  ],
);

/** Helpdesk — the one organization-scoped tool with a public/unauthenticated
 * submitter side. `accessToken` (opaque, unguessable) is the submitter's ONLY
 * credential: knowing it proves ownership of the ticket, the same trust model as
 * a password-reset link. No new Actor type / identity-resolution change was
 * needed (see docs/raw/decisions-log.md) — the public procedures never consult
 * `ctx.identity` at all; they gate on possession of this token instead. */
export const helpdeskTickets = pgTable(
  "helpdesk_tickets",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("open"), // open | pending | resolved | closed
    submitterEmail: text("submitter_email").notNull(),
    submitterName: text("submitter_name"),
    accessToken: text("access_token").unique().notNull(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("helpdesk_tickets_org_idx").on(t.organizationId, t.createdAt)],
);

export const helpdeskMessages = pgTable(
  "helpdesk_messages",
  {
    id: uuidPkV7(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    ticketId: uuid("ticket_id").notNull().references(() => helpdeskTickets.id),
    authorType: text("author_type").notNull(), // submitter | agent
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(),
    createdAt: now(),
  },
  (t) => [index("helpdesk_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** Resources — replaces the prototype's Supabase-direct `resources_canonical`
 * read with a governed, organization-scoped table (frontend-migration-scoping.md
 * gap #4). Simple catalog shape; `tags` is jsonb (a string array) rather than a
 * separate join table since resources have no other relational structure yet. */
export const resources = pgTable(
  "resources",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // book | podcast | vlog | article | other
    url: text("url"),
    notes: text("notes"),
    tags: jsonb("tags").notNull().default([]),
    createdAt: now(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("resources_org_idx").on(t.organizationId, t.createdAt)],
);

// =====================================================================
// LAYER 8 — CAPABILITY TRUST MODEL (vision pivot 2026-07-06,
// docs/wiki/vision.md "Capability Trust Model" + "Promotion defaults")
// =====================================================================

/**
 * One row per registered capability (skill/automation/agent/integration/
 * view/dashboard). Risk is COMPUTED (packages/core/src/capability/risk.ts),
 * never self-declared by the generator — `computedRisk` here is the cached
 * result of that computation, recomputed whenever the manifest or its
 * dependency closure changes. `lineageManifestId` self-references this table
 * (a Fork/copy points back at its origin — see vision.md "Organizations =
 * projections", the Fork verb); nullable because most manifests have no
 * lineage. Unique (organization_id, name, version) — the same version-pinning
 * discipline `skills_uq` already uses.
 */
export const capabilityManifests = pgTable(
  "capability_manifests",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    capabilityType: text("capability_type").notNull(), // skill | automation | agent | integration | view | dashboard
    /** REG-1 Component Registry discriminator (undefined-elements §2) — reuse
     * this table as the registry rather than forking a second source of truth.
     * Nullable: pre-REG-1 rows have no kind; overlap detection falls back to
     * capability_type. Values: agent|skill|automation|prompt|
     * eval_set|routing_rule|policy|integration|template. */
    kind: text("kind"),
    name: text("name").notNull(),
    version: text("version").notNull().default("1.0.0"),
    origin: text("origin").notNull().default("user_code"), // built_in | template | community | ai_generated | user_code
    audience: text("audience").notNull().default("private"), // private | team | external_visible
    /** inputs/outputs/permissions/connectors/evidence/rollback/evaluation — the
     * generalized Capability Manifest covering every capability_type. */
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
    unique("capability_manifests_uq").on(t.organizationId, t.name, t.version),
    index("capability_manifests_org_idx").on(t.organizationId, t.capabilityType),
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
 * A organization/user-scoped trust grant for a capability CLASS (not a single
 * manifest instance) — e.g. "auto-activate any 'advisory'-risk skill this user
 * authored". `scope` narrows who/where it applies; `autoActivate` decides
 * whether matching capabilities skip the approval gate (still subject to the
 * budgets + external-band hard floor in approvals.ts). Revocable, never hard-deleted.
 */
export const trustGrants = pgTable(
  "trust_grants",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    capabilityClass: text("capability_class").notNull(),
    scope: jsonb("scope").notNull().default({}), // { organizationId?, userId? }
    grantedBy: uuid("granted_by").references(() => users.id),
    riskBand: text("risk_band").notNull(), // informational | advisory | transformational | operational | external
    autoActivate: boolean("auto_activate").notNull().default(false),
    createdAt: now(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("trust_grants_org_class_idx").on(t.organizationId, t.capabilityClass)],
);

/**
 * A generated organization blueprint (vocabulary, node types used, views,
 * capabilities) — P1 onboarding writes these; the table is created now so the
 * shape exists ahead of that work (see CLAUDE.md status: "organization_definitions"
 * punch-list item). `version` increments on republish (Publish Blueprint verb,
 * vision.md "Organizations = projections"); `status` tracks draft/active/archived
 * the same way other registries do.
 */
export const organizationDefinitions = pgTable(
  "organization_definitions",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    blueprint: jsonb("blueprint").notNull().default({}),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"), // draft | active | archived
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: now(),
  },
  (t) => [index("organization_definitions_org_idx").on(t.organizationId, t.version)],
);

/**
 * One row per (organization, module name, version) install — the persistent
 * binding for @bridge/core's `ModuleStore` port (packages/core/src/module/
 * ports.ts's `ModuleInstallationRow`). Mirrors `capabilityManifests`'
 * shape one level up (ADR-018's format doc, ADR-021's P2 slice 1, ADR-023's
 * Drizzle-backing pass): a module BUNDLES one or more capability manifests,
 * and this table is the shipping-unit row those bundles get installed as.
 * `manifest` jsonb round-trips the FULL parsed `ModuleManifest` (name/
 * version/kind/capabilities[]/dependencies/etc — module/types.ts), validated
 * at the read/write boundary the same way capability-store.ts validates
 * `dependencies`/`evidence` — @bridge/core stays zero-runtime-deps, so the
 * zod schema for this jsonb lives in module-store.ts, not here.
 * `lineageManifestId` self-references this table (a rollback fork points
 * back at the historical row it forked from — lifecycle.ts's
 * `rollbackFromHistory`), nullable for a v1 module. Installation identity
 * is unique per organization/module/version/Module-Agent-need attachment.
 * Re-registering identical content reuses that row; the same signed module
 * may still attach to a different declared Module Agent need.
 */
export const moduleInstallations = pgTable(
  "module_installations",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    moduleName: text("module_name").notNull(),
    moduleVersion: text("module_version").notNull(),
    manifest: jsonb("manifest").notNull().default({}),
    /** Computed (never self-declared, mirrors capability_manifests.computed_risk):
     * informational | advisory | transformational | operational | external. */
    computedRisk: text("computed_risk").notNull().default("informational"),
    /** Single-live-version lifecycle state (module/lifecycle.ts):
     * private | promoted | available | legacy | deprecating | deprecated. */
    state: text("state").notNull().default("private"),
    /** pending_review | installed | rejected — registration/install outcome,
     * orthogonal to `state` (mirrors capability_states.suspended being a
     * separate flag from capability_states.state). */
    status: text("status").notNull().default("pending_review"),
    lineageManifestId: uuid("lineage_manifest_id"),
    /** Installation-local ownership for a signed Commons capability. */
    moduleAttachment: jsonb("module_attachment"),
    /** Exact verified generalized Commons envelope for a root Module install. */
    commonsSource: jsonb("commons_source"),
    createdAt: now(),
  },
  (t) => [
    index("module_installations_org_name_idx").on(t.organizationId, t.moduleName),
    index("module_installations_org_state_idx").on(t.organizationId, t.moduleName, t.state),
    uniqueIndex("module_installations_attachment_uq").on(
      t.organizationId,
      t.moduleName,
      t.moduleVersion,
      sql`coalesce(${t.moduleAttachment}->>'ownerModuleName', '')`,
      sql`coalesce(${t.moduleAttachment}->>'agentId', '')`,
      sql`coalesce(${t.moduleAttachment}->>'needId', '')`,
    ),
  ],
);

// =====================================================================
// LAYER 8 — TASK/SKILL-MANIFEST/CHILD-AGENT-RUN (TASK-007/TASK-021, AGS1/AGS2,
// docs/raw/agent-goal-skill-orchestration-plan-2026-07.md). Restart-durable
// backing for @bridge/core's Task contracts, skill-manifest.ts, and child-agent-run.ts
// in-memory ports — the in-process Maps those ports shipped with are correct
// as the dependency-free default (mirrors every other in-memory port in this
// codebase), but production/persistent mode must not lose live Tasks,
// registered Skill manifests, or running child Agent Runs across a restart.
// =====================================================================

export const tasks = pgTable(
  "tasks",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    anchorTaskId: uuid("anchor_task_id"),
    parentTaskId: uuid("parent_task_id"),
    path: text("path").notNull(),
    level: integer("level").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(1),
    title: text("title").notNull(),
    type: text("type").notNull(),
    isGoal: boolean("is_goal").notNull().default(false),
    outcomes: jsonb("outcomes").notNull().default([]),
    anchor: boolean("anchor").notNull().default(false),
    reviewCadence: text("review_cadence"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    exitTest: text("exit_test"),
    priority: text("priority").notNull().default("P2"),
    ownerType: text("owner_type").notNull().default("human"),
    ownerId: uuid("owner_id"),
    requiredSkillId: text("required_skill_id"),
    scheduledFor: date("scheduled_for"),
    evidenceRefs: jsonb("evidence_refs").notNull().default([]),
    verification: jsonb("verification"),
    visibility: text("visibility").notNull().default("organization"),
    version: integer("version").notNull().default(1),
    /** The ONLY thing that authorizes an eligible Agent to invoke a matching
     * governed Skill for this Task (@bridge/core's goal-task.ts doc comment) —
     * references `agents.id`, never a client-asserted string. */
    assignedAgentId: uuid("assigned_agent_id"),
    status: text("status").notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: now(),
  },
  (t) => [
    index("tasks_anchor_idx").on(t.anchorTaskId),
    index("tasks_parent_idx").on(t.organizationId, t.parentTaskId, t.sortOrder),
    index("tasks_assigned_agent_idx").on(t.assignedAgentId),
    unique("tasks_organization_path_uq").on(t.organizationId, t.path),
    unique("tasks_organization_id_id_uq").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.anchorTaskId],
      foreignColumns: [t.organizationId, t.id],
      name: "tasks_organization_anchor_fk",
    }),
    foreignKey({
      columns: [t.organizationId, t.parentTaskId],
      foreignColumns: [t.organizationId, t.id],
      name: "tasks_organization_parent_fk",
    }),
    foreignKey({
      columns: [t.organizationId, t.assignedAgentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: "tasks_organization_agent_fk",
    }),
  ],
);

export const taskChangeProposals = pgTable(
  "task_change_proposals",
  {
    id: uuidPkV7(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    kind: text("kind").notNull(),
    taskId: uuid("task_id").notNull(),
    actorId: text("actor_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending_review"),
    idempotencyKey: text("idempotency_key"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    result: jsonb("result"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [
    index("task_change_proposals_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    unique("task_change_proposals_org_kind_idempotency_uq").on(
      t.organizationId,
      t.kind,
      t.idempotencyKey,
    ),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: "task_change_proposals_organization_task_fk",
    }),
  ],
);

/**
 * The governed Skill contract catalog (@bridge/core's skill-manifest.ts
 * `SkillManifest`). `organizationId` nullable mirrors `skills.organizationId` —
 * null = a global/platform-wide manifest (the normal case: manifests are
 * declared once in code at wiring.ts and seeded here idempotently on boot,
 * the same "code declares, DB durably records" pattern as
 * `ensureFoundationalAgentGovernance`'s role/permission seed), non-null only
 * for a future organization-scoped override. Unique on (skill_id, version) so
 * the boot-time seed upsert is idempotent across restarts.
 */
export const skillManifests = pgTable(
  "skill_manifests",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
  (t) => [unique("skill_manifests_uq").on(t.organizationId, t.skillId, t.version)],
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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    anchorTaskId: uuid("anchor_task_id").notNull(),
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
    taintLabel: jsonb("taint_label").notNull().default(UNKNOWN_LABEL),
    status: text("status").notNull().default("running"), // running | completed | cancelled | failed | stopped
    createdAt: now(),
  },
  (t) => [
    index("child_agent_runs_parent_run_idx").on(t.organizationId, t.parentRunId),
    foreignKey({
      columns: [t.organizationId, t.parentAgentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: "child_agent_runs_organization_agent_fk",
    }),
    foreignKey({
      columns: [t.organizationId, t.anchorTaskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: "child_agent_runs_organization_anchor_fk",
    }),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: "child_agent_runs_organization_task_fk",
    }),
  ],
);

export const taintSinkTraces = pgTable(
  "taint_sink_traces",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Opaque lineage reference: Ledger/Event logs are Plane-partitioned and may
     * live in a different database, so a cross-Plane FK would be invalid. */
    ledgerId: uuid("ledger_id"),
    sink: text("sink").notNull(),
    taintLabel: jsonb("taint_label").notNull(),
    sourceChain: jsonb("source_chain").notNull(),
    policy: text("policy").notNull(),
    reason: text("reason").notNull(),
    traceHash: text("trace_hash").notNull(),
    plane: text("plane").notNull(),
    createdAt: now(),
  },
  (t) => [
    unique("taint_sink_traces_hash_uq").on(
      t.organizationId,
      t.ledgerId,
      t.sink,
      t.traceHash,
    ),
    index("taint_sink_traces_ledger_idx").on(t.organizationId, t.ledgerId),
  ],
);

export const taintDeclassifications = pgTable(
  "taint_declassifications",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    beforeLabel: jsonb("before_label").notNull(),
    afterLabel: jsonb("after_label").notNull(),
    reason: text("reason").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    /** Opaque Plane-partitioned Ledger reference; see taintSinkTraces.ledgerId. */
    decisionLedgerId: uuid("decision_ledger_id"),
    ruleId: text("rule_id"),
    ruleVersion: text("rule_version"),
    parentTraceHash: text("parent_trace_hash").notNull(),
    plane: text("plane").notNull(),
    createdAt: now(),
  },
  (t) => [
    index("taint_declassifications_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  ],
);
