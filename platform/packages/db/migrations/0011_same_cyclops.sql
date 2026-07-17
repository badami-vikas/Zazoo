ALTER TABLE "package_installations" ADD COLUMN "module_attachment" jsonb;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        "workspace_id",
        "package_name",
        "package_version",
        coalesce("module_attachment"->>'modulePackageName', '') AS "module_package_name",
        coalesce("module_attachment"->>'agentId', '') AS "agent_id",
        coalesce("module_attachment"->>'needId', '') AS "need_id"
      FROM "package_installations"
      GROUP BY
        "workspace_id",
        "package_name",
        "package_version",
        coalesce("module_attachment"->>'modulePackageName', ''),
        coalesce("module_attachment"->>'agentId', ''),
        coalesce("module_attachment"->>'needId', '')
      HAVING
        count(*) > 1
        AND count(DISTINCT jsonb_build_object(
          'manifest', "manifest",
          'computedRisk', "computed_risk",
          'state', "state",
          'status', "status",
          'lineageManifestId', "lineage_manifest_id",
          'moduleAttachment', "module_attachment"
        )) > 1
    ) AS "conflicting_duplicates"
  ) THEN
    RAISE EXCEPTION 'package_installations contains conflicting duplicate attachment identities; reconcile them before migration';
  END IF;
END
$$;--> statement-breakpoint
CREATE TEMP TABLE "package_installation_duplicate_map" AS
SELECT "id" AS "duplicate_id", "keeper_id"
FROM (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY
        "workspace_id",
        "package_name",
        "package_version",
        coalesce("module_attachment"->>'modulePackageName', ''),
        coalesce("module_attachment"->>'agentId', ''),
        coalesce("module_attachment"->>'needId', '')
      ORDER BY "created_at", "id"
    ) AS "keeper_id",
    row_number() OVER (
      PARTITION BY
        "workspace_id",
        "package_name",
        "package_version",
        coalesce("module_attachment"->>'modulePackageName', ''),
        coalesce("module_attachment"->>'agentId', ''),
        coalesce("module_attachment"->>'needId', '')
      ORDER BY "created_at", "id"
    ) AS "duplicate_rank"
  FROM "package_installations"
) AS "ranked"
WHERE "duplicate_rank" > 1;--> statement-breakpoint
UPDATE "package_installations" AS "installation"
SET "lineage_manifest_id" = "duplicate"."keeper_id"
FROM "package_installation_duplicate_map" AS "duplicate"
WHERE "installation"."lineage_manifest_id" = "duplicate"."duplicate_id";--> statement-breakpoint
DELETE FROM "package_installations" AS "installation"
USING "package_installation_duplicate_map" AS "duplicate"
WHERE "installation"."id" = "duplicate"."duplicate_id";--> statement-breakpoint
DROP TABLE "package_installation_duplicate_map";--> statement-breakpoint
CREATE UNIQUE INDEX "package_installations_attachment_uq" ON "package_installations" USING btree ("workspace_id","package_name","package_version",coalesce("module_attachment"->>'modulePackageName', ''),coalesce("module_attachment"->>'agentId', ''),coalesce("module_attachment"->>'needId', ''));