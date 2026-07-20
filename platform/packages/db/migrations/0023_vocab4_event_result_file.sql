CREATE TEMP TABLE "vocab4_signal_event_map" ON COMMIT DROP AS
SELECT
  "signal"."id" AS "signal_id",
  COALESCE(
    (
      SELECT "candidate"."id"
      FROM "events" AS "candidate"
      WHERE "candidate"."organization_id" = "signal"."organization_id"
        AND "candidate"."entity_type" = 'signal'
        AND "candidate"."entity_id" = "signal"."id"
      ORDER BY "candidate"."created_at" DESC, "candidate"."id" DESC
      LIMIT 1
    ),
    "signal"."id"
  ) AS "event_id"
FROM "signals" AS "signal";
--> statement-breakpoint

INSERT INTO "events" ("id", "organization_id", "type", "entity_type", "entity_id", "payload", "created_at")
SELECT
  "map"."event_id",
  "signal"."organization_id",
  'relationship.signal',
  'event',
  "map"."event_id",
  jsonb_build_object(
    'relationshipSignal',
    jsonb_build_object(
      'legacySignalId', "signal"."id",
      'type', "signal"."type",
      'subjectType', "signal"."subject_type",
      'subjectId', "signal"."subject_id",
      'payload', "signal"."payload",
      'recommendedAction', "signal"."recommended_action",
      'status', "signal"."status"
    )
  ),
  "signal"."created_at"
FROM "signals" AS "signal"
JOIN "vocab4_signal_event_map" AS "map" ON "map"."signal_id" = "signal"."id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

UPDATE "events" AS "event"
SET
  "type" = CASE
    WHEN "event"."type" LIKE 'relationship.%' THEN "event"."type"
    ELSE 'relationship.signal'
  END,
  "entity_type" = 'event',
  "entity_id" = "event"."id",
  "payload" = "event"."payload" || jsonb_build_object(
    'relationshipSignal',
    jsonb_build_object(
      'legacySignalId', "signal"."id",
      'type', "signal"."type",
      'subjectType', "signal"."subject_type",
      'subjectId', "signal"."subject_id",
      'payload', "signal"."payload",
      'recommendedAction', "signal"."recommended_action",
      'status', "signal"."status"
    )
  )
FROM "signals" AS "signal"
JOIN "vocab4_signal_event_map" AS "map" ON "map"."signal_id" = "signal"."id"
WHERE "event"."id" = "map"."event_id"
  AND "event"."organization_id" = "signal"."organization_id";
--> statement-breakpoint

INSERT INTO "events" ("id", "organization_id", "type", "entity_type", "entity_id", "payload", "created_at")
SELECT
  "action"."id",
  "action"."organization_id",
  'relationship.signal.action',
  'event',
  "map"."event_id",
  jsonb_build_object(
    'kind', 'relationship_signal_action',
    'signalEventId', "map"."event_id",
    'userId', "action"."user_id",
    'verb', "action"."verb",
    'occurredAt', "action"."created_at"
  ),
  "action"."created_at"
FROM "signal_actions" AS "action"
JOIN "vocab4_signal_event_map" AS "map" ON "map"."signal_id" = "action"."signal_id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "edges" (
  "id", "organization_id", "src_type", "src_id", "dst_type", "dst_id",
  "edge_type", "properties", "evidence_refs", "confidence", "observed_at",
  "valid_from", "valid_to", "user_confirmed", "visibility", "source",
  "source_module", "owner_user_id", "decision_ledger_id", "decision_sequence",
  "decision_at", "created_at"
)
SELECT
  gen_random_uuid(),
  "edge"."organization_id",
  CASE WHEN "edge"."src_type" = 'signal' THEN 'event' ELSE "edge"."src_type" END,
  COALESCE("src_map"."event_id", "edge"."src_id"),
  CASE WHEN "edge"."dst_type" = 'signal' THEN 'event' ELSE "edge"."dst_type" END,
  COALESCE("dst_map"."event_id", "edge"."dst_id"),
  "edge"."edge_type",
  "edge"."properties",
  "edge"."evidence_refs",
  "edge"."confidence",
  "edge"."observed_at",
  "edge"."valid_from",
  "edge"."valid_to",
  "edge"."user_confirmed",
  "edge"."visibility",
  "edge"."source",
  "edge"."source_module",
  "edge"."owner_user_id",
  "edge"."decision_ledger_id",
  "edge"."decision_sequence",
  "edge"."decision_at",
  "edge"."created_at"
FROM "edges" AS "edge"
LEFT JOIN "vocab4_signal_event_map" AS "src_map"
  ON "edge"."src_type" = 'signal' AND "src_map"."signal_id" = "edge"."src_id"
LEFT JOIN "vocab4_signal_event_map" AS "dst_map"
  ON "edge"."dst_type" = 'signal' AND "dst_map"."signal_id" = "edge"."dst_id"
WHERE ("edge"."src_type" = 'signal' OR "edge"."dst_type" = 'signal')
  AND NOT (
    "edge"."edge_type" = 'source_event'
    AND COALESCE("src_map"."event_id", "edge"."src_id") = COALESCE("dst_map"."event_id", "edge"."dst_id")
  )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DELETE FROM "edges" WHERE "src_type" = 'signal' OR "dst_type" = 'signal';
--> statement-breakpoint

INSERT INTO "events" ("id", "organization_id", "type", "entity_type", "entity_id", "payload", "created_at")
SELECT
  "entry"."id",
  "entry"."organization_id",
  "entry"."type",
  'interaction',
  "entry"."id",
  jsonb_build_object(
    'kind', "entry"."type",
    'summary', "entry"."content",
    'occurredAt', "entry"."occurred_at",
    'source', 'legacy_timeline',
    'createdBy', "entry"."created_by",
    'visibility', 'organization'
  ),
  "entry"."created_at"
FROM "timeline_entries" AS "entry"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "edges" (
  "organization_id", "src_type", "src_id", "dst_type", "dst_id",
  "edge_type", "properties", "evidence_refs", "confidence", "observed_at",
  "user_confirmed", "visibility", "source", "source_module", "created_at"
)
SELECT
  "entry"."organization_id",
  'event',
  "entry"."id",
  "ref"."entity_type",
  "ref"."entity_id",
  'participant',
  '{}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'entityType', 'event',
    'entityId', "entry"."id",
    'source', 'legacy_timeline'
  )),
  1,
  "entry"."occurred_at",
  true,
  'organization',
  'legacy_timeline',
  'relationship',
  "entry"."created_at"
FROM "timeline_entry_refs" AS "ref"
JOIN "timeline_entries" AS "entry" ON "entry"."id" = "ref"."entry_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "events" ("id", "organization_id", "type", "entity_type", "entity_id", "payload", "created_at")
SELECT
  "legacy"."id",
  "legacy"."organization_id",
  'record.' || COALESCE(NULLIF(trim("legacy"."touchpoint_kind"), ''), 'event'),
  'event',
  "legacy"."id",
  jsonb_build_object(
    'kind', COALESCE(NULLIF(trim("legacy"."touchpoint_kind"), ''), 'event'),
    'recordId', "legacy"."record_id",
    'parentEventId', "legacy"."parent_touchpoint_id",
    'sortOrder', "legacy"."sort_order",
    'depth', "legacy"."depth",
    'alignmentScore', "legacy"."alignment_score",
    'assigneeType', "legacy"."assignee_type",
    'assigneeId', "legacy"."assignee_id",
    'summary', "legacy"."context",
    'dueAt', "legacy"."due_date",
    'status', "legacy"."status",
    'occurredAt', "legacy"."created_at",
    'source', 'legacy_record_event',
    'visibility', 'organization'
  ),
  "legacy"."created_at"
FROM "touchpoints" AS "legacy"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "edges" (
  "organization_id", "src_type", "src_id", "dst_type", "dst_id",
  "edge_type", "properties", "evidence_refs", "confidence", "observed_at",
  "user_confirmed", "visibility", "source", "source_module", "created_at"
)
SELECT
  "legacy"."organization_id",
  'event',
  "legacy"."id",
  'record',
  "legacy"."record_id",
  'participant',
  '{}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'entityType', 'event',
    'entityId', "legacy"."id",
    'source', 'legacy_record_event'
  )),
  1,
  "legacy"."created_at",
  true,
  'organization',
  'legacy_record_event',
  'record',
  "legacy"."created_at"
FROM "touchpoints" AS "legacy"
WHERE "legacy"."record_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "edges" (
  "organization_id", "src_type", "src_id", "dst_type", "dst_id",
  "edge_type", "properties", "evidence_refs", "confidence", "observed_at",
  "user_confirmed", "visibility", "source", "source_module", "created_at"
)
SELECT
  "legacy"."organization_id",
  'event',
  "legacy"."parent_touchpoint_id",
  'event',
  "legacy"."id",
  'parent_event',
  '{}'::jsonb,
  '[]'::jsonb,
  1,
  "legacy"."created_at",
  true,
  'organization',
  'legacy_record_event',
  'record',
  "legacy"."created_at"
FROM "touchpoints" AS "legacy"
WHERE "legacy"."parent_touchpoint_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "files_organization_storage_ref_uq"
  ON "files" ("organization_id", "storage_ref")
  WHERE "storage_ref" IS NOT NULL AND "archived_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "file_refs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "file_refs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "file_refs_tenant_select" ON "file_refs"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "files"
      WHERE "files"."id" = "file_refs"."file_id"
        AND app_private.same_organization("files"."organization_id")
    )
  );
--> statement-breakpoint
CREATE POLICY "file_refs_tenant_insert" ON "file_refs"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "files"
      WHERE "files"."id" = "file_refs"."file_id"
        AND app_private.same_organization("files"."organization_id")
    )
  );
--> statement-breakpoint

UPDATE "events"
SET "payload" = ("payload" - 'artifact') || jsonb_build_object('result', "payload" -> 'artifact')
WHERE "payload" ? 'artifact' AND NOT ("payload" ? 'result');
--> statement-breakpoint

UPDATE "memories"
SET "content" = (
  (("content"::jsonb) - 'artifact') ||
  jsonb_build_object('result', "content"::jsonb -> 'artifact')
)::text
WHERE "content" LIKE '{%'
  AND CASE
    WHEN "content" IS JSON THEN ("content"::jsonb) ? 'artifact'
    ELSE false
  END
  AND NOT CASE
    WHEN "content" IS JSON THEN ("content"::jsonb) ? 'result'
    ELSE false
  END;
--> statement-breakpoint

DROP TABLE "signal_actions";
--> statement-breakpoint
DROP TABLE "signals";
--> statement-breakpoint
CREATE VIEW "signals" WITH (security_invoker = true) AS
SELECT
  "event"."id",
  "event"."organization_id",
  COALESCE("event"."payload" #>> '{relationshipSignal,type}', 'relationship') AS "type",
  "event"."payload" #>> '{relationshipSignal,subjectType}' AS "subject_type",
  ("event"."payload" #>> '{relationshipSignal,subjectId}')::uuid AS "subject_id",
  COALESCE("event"."payload" #> '{relationshipSignal,payload}', '{}'::jsonb) AS "payload",
  COALESCE("event"."payload" #> '{relationshipSignal,recommendedAction}', '{}'::jsonb) AS "recommended_action",
  COALESCE("event"."payload" #>> '{relationshipSignal,status}', 'new') AS "status",
  "event"."created_at"
FROM "events" AS "event"
WHERE "event"."payload" ? 'relationshipSignal';
--> statement-breakpoint
GRANT SELECT ON "signals" TO "bridge_app";
--> statement-breakpoint
DROP TABLE "timeline_entry_refs";
--> statement-breakpoint
DROP TABLE "timeline_entries";
--> statement-breakpoint
DROP TABLE "touchpoints";
--> statement-breakpoint

DROP POLICY IF EXISTS "events_tenant_update" ON "events";
--> statement-breakpoint
DROP POLICY IF EXISTS "events_tenant_delete" ON "events";
