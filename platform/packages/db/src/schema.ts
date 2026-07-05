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
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
 * dependency (see docs/raw/decisions-log.md). The column DEFAULT is still
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
    // as the role_permissions coalesce-NULL index below and in 0001). This entry
    // exists so `drizzle-kit push`/`generate` don't fight the hand-written index
    // by re-diffing it away — Drizzle only "knows" the table has this shape via
    // the migration journal, not via a declared index here.
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

export const agents = pgTable("agents", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  identityType: text("identity_type").notNull().default("service_principal"),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  assumesRoleId: uuid("assumes_role_id"),
  goal: text("goal"),
  allowedSkills: uuid("allowed_skills").array().notNull().default(sql`'{}'`),
  allowedTools: uuid("allowed_tools").array().notNull().default(sql`'{}'`),
  capabilityScope: jsonb("capability_scope").notNull().default({}),
  status: text("status").notNull().default("active"),
});

export const rituals = pgTable("rituals", {
  id: uuidPk(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  trigger: jsonb("trigger").notNull(),
  cadence: text("cadence"),
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
  (t) => [
    // SCHEMA.sql uses a coalesce(resource_id, '0000…') expression so NULL (type-wide)
    // grants are unique. Drizzle's unique().on() takes columns only, so the
    // coalesce-NULL form lives in the Supabase migration DDL; the shape is here.
    unique("role_permissions_uq").on(t.roleId, t.resourceType, t.action, t.resourceId),
  ],
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
  id: uuidPk(),
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
    id: uuidPk(),
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
