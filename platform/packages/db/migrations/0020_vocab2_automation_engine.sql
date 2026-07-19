-- VOCAB2: make Automation the only persisted execution primitive and preserve
-- evidence-backed Agent attribution for every Automation Run.

CREATE OR REPLACE FUNCTION pg_temp.vocab2_transform_jsonb(input_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  output_value jsonb;
BEGIN
  CASE jsonb_typeof(input_value)
    WHEN 'object' THEN
      SELECT COALESCE(
        jsonb_object_agg(
          CASE entry.key
            WHEN 'ritualId' THEN 'automationId'
            WHEN 'ritualIds' THEN 'automationIds'
            WHEN 'ritual_id' THEN 'automation_id'
            WHEN 'ritual_ids' THEN 'automation_ids'
            WHEN 'workflowId' THEN 'automationId'
            WHEN 'workflowIds' THEN 'automationIds'
            WHEN 'workflow_id' THEN 'automation_id'
            WHEN 'workflow_ids' THEN 'automation_ids'
            WHEN 'brainId' THEN 'engineId'
            WHEN 'brainIds' THEN 'engineIds'
            WHEN 'brain_id' THEN 'engine_id'
            WHEN 'brain_ids' THEN 'engine_ids'
            WHEN 'toolId' THEN 'skillId'
            WHEN 'toolIds' THEN 'skillIds'
            WHEN 'tool_id' THEN 'skill_id'
            WHEN 'tool_ids' THEN 'skill_ids'
            WHEN 'sourceToolId' THEN 'sourceConnectorId'
            WHEN 'source_tool_id' THEN 'source_connector_id'
            WHEN 'tool' THEN 'skill'
            ELSE entry.key
          END,
          CASE
            WHEN entry.key IN (
              'resourceType',
              'resource_type',
              'contextType',
              'context_type',
              'entityType',
              'entity_type',
              'subjectType',
              'subject_type',
              'scopeType',
              'scope_type'
            ) AND entry.value = to_jsonb('tool'::text)
              THEN to_jsonb('module'::text)
            ELSE pg_temp.vocab2_transform_jsonb(entry.value)
          END
        ),
        '{}'::jsonb
      )
      INTO output_value
      FROM jsonb_each(input_value) AS entry;
      RETURN output_value;
    WHEN 'array' THEN
      SELECT COALESCE(
        jsonb_agg(pg_temp.vocab2_transform_jsonb(entry.value) ORDER BY entry.ordinality),
        '[]'::jsonb
      )
      INTO output_value
      FROM jsonb_array_elements(input_value) WITH ORDINALITY AS entry(value, ordinality);
      RETURN output_value;
    WHEN 'string' THEN
      RETURN CASE input_value #>> '{}'
        WHEN 'ritual' THEN to_jsonb('automation'::text)
        WHEN 'workflow' THEN to_jsonb('automation'::text)
        WHEN 'brain' THEN to_jsonb('engine'::text)
        WHEN 'tool' THEN to_jsonb('skill'::text)
        ELSE input_value
      END;
    ELSE
      RETURN input_value;
  END CASE;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tools") THEN
    RAISE EXCEPTION
      'VOCAB2 cannot classify populated legacy Tools; migrate each row explicitly to a Skill, Integration, or Module first';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "agents"
    WHERE cardinality("allowed_tools") > 0
  ) THEN
    RAISE EXCEPTION
      'VOCAB2 cannot classify Agent allowed_tools entries; replace them with governed Skill bindings first';
  END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "rituals" AS ritual
    LEFT JOIN "agents" AS agent
      ON agent."workspace_id" = ritual."workspace_id"
     AND agent."id" = ritual."agent_id"
    WHERE ritual."agent_id" IS NULL
       OR agent."id" IS NULL
       OR ritual."agent_plane" NOT IN ('local', 'cloud')
  ) THEN
    RAISE EXCEPTION
      'VOCAB2 cannot migrate unresolved Ritual ownership; bind one valid Agent and Plane to every row first';
  END IF;
END;
$$;
--> statement-breakpoint

ALTER TABLE "ritual_runs" ADD COLUMN "agent_id" uuid;
--> statement-breakpoint

WITH run_actor_evidence AS (
  SELECT
    run."id" AS run_id,
    MIN(ledger_row."actor_id"::text)::uuid AS agent_id
  FROM "ritual_runs" AS run
  JOIN "ledger" AS ledger_row
    ON ledger_row."workspace_id" = run."workspace_id"
   AND ledger_row."actor_type" = 'agent'
   AND ledger_row."context"->>'runId' = COALESCE(run."run_id", run."id"::text)
  GROUP BY run."id"
  HAVING COUNT(DISTINCT ledger_row."actor_id") = 1
)
UPDATE "ritual_runs" AS run
SET "agent_id" = evidence."agent_id"
FROM run_actor_evidence AS evidence
WHERE evidence.run_id = run."id";
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ritual_runs" AS run
    LEFT JOIN "rituals" AS ritual
      ON ritual."workspace_id" = run."workspace_id"
     AND ritual."id" = run."ritual_id"
    WHERE run."agent_id" IS NULL
       OR ritual."id" IS NULL
       OR run."agent_id" <> ritual."agent_id"
  ) THEN
    RAISE EXCEPTION
      'VOCAB2 cannot migrate an unattributable or non-owner Ritual Run; reconcile it from immutable Ledger evidence first';
  END IF;
END;
$$;
--> statement-breakpoint

UPDATE "rituals"
SET "skill_pipeline" = pg_temp.vocab2_transform_jsonb("skill_pipeline");
--> statement-breakpoint
UPDATE "capability_manifests"
SET
  "capability_type" = CASE
    WHEN "capability_type" = 'workflow' THEN 'automation'
    WHEN "capability_type" = 'tool' THEN 'skill'
    ELSE "capability_type"
  END,
  "kind" = CASE
    WHEN "kind" = 'workflow' THEN 'automation'
    WHEN "kind" = 'tool' THEN 'skill'
    ELSE "kind"
  END,
  "manifest" = pg_temp.vocab2_transform_jsonb("manifest"),
  "dependencies" = pg_temp.vocab2_transform_jsonb("dependencies");
--> statement-breakpoint
UPDATE "package_installations"
SET
  "manifest" = pg_temp.vocab2_transform_jsonb(
    CASE
      WHEN "manifest"->>'kind' = 'tool'
        THEN jsonb_set("manifest", '{kind}', to_jsonb('module'::text))
      ELSE "manifest"
    END
  ),
  "module_attachment" = CASE
    WHEN "module_attachment" IS NULL THEN NULL
    ELSE pg_temp.vocab2_transform_jsonb("module_attachment")
  END;
--> statement-breakpoint

UPDATE "workspace_definitions"
SET "blueprint" = pg_temp.vocab2_transform_jsonb("blueprint");
--> statement-breakpoint
UPDATE "policies"
SET
  "scope_type" = CASE
    WHEN "scope_type" = 'ritual' THEN 'automation'
    WHEN "scope_type" = 'workflow' THEN 'automation'
    WHEN "scope_type" = 'brain' THEN 'engine'
    WHEN "scope_type" = 'tool' THEN 'module'
    ELSE "scope_type"
  END,
  "rule" = pg_temp.vocab2_transform_jsonb("rule");
--> statement-breakpoint
UPDATE "policy_params"
SET "value" = pg_temp.vocab2_transform_jsonb("value");
--> statement-breakpoint
UPDATE "delegations"
SET "scope" = pg_temp.vocab2_transform_jsonb("scope");
--> statement-breakpoint
UPDATE "trust_grants"
SET
  "capability_class" = CASE
    WHEN "capability_class" = 'workflow' THEN 'automation'
    WHEN "capability_class" = 'tool' THEN 'skill'
    ELSE "capability_class"
  END,
  "scope" = pg_temp.vocab2_transform_jsonb("scope");
--> statement-breakpoint
UPDATE "ledger"
SET
  "resource_type" = CASE
    WHEN "resource_type" = 'ritual' THEN 'automation'
    WHEN "resource_type" = 'workflow' THEN 'automation'
    WHEN "resource_type" = 'brain' THEN 'engine'
    WHEN "resource_type" = 'tool' THEN 'module'
    ELSE "resource_type"
  END,
  "context" = CASE
    WHEN "context" IS NULL THEN NULL
    ELSE pg_temp.vocab2_transform_jsonb("context")
  END,
  "policy_results" = CASE
    WHEN "policy_results" IS NULL THEN NULL
    ELSE pg_temp.vocab2_transform_jsonb("policy_results")
  END;
--> statement-breakpoint
UPDATE "decision_traces"
SET "context" = pg_temp.vocab2_transform_jsonb("context");
--> statement-breakpoint
UPDATE "permissions"
SET "resource_type" = CASE
  WHEN "resource_type" = 'ritual' THEN 'automation'
  WHEN "resource_type" = 'workflow' THEN 'automation'
  WHEN "resource_type" = 'brain' THEN 'engine'
  WHEN "resource_type" = 'tool' THEN 'module'
  ELSE "resource_type"
END;
--> statement-breakpoint
UPDATE "role_permissions"
SET "resource_type" = CASE
  WHEN "resource_type" = 'ritual' THEN 'automation'
  WHEN "resource_type" = 'workflow' THEN 'automation'
  WHEN "resource_type" = 'brain' THEN 'engine'
  WHEN "resource_type" = 'tool' THEN 'module'
  ELSE "resource_type"
END;
--> statement-breakpoint
UPDATE "ephemeral_grants"
SET
  "context_type" = CASE
    WHEN "context_type" = 'ritual' THEN 'automation'
    WHEN "context_type" = 'workflow' THEN 'automation'
    WHEN "context_type" = 'brain' THEN 'engine'
    WHEN "context_type" = 'tool' THEN 'module'
    ELSE "context_type"
  END,
  "resource_type" = CASE
    WHEN "resource_type" = 'ritual' THEN 'automation'
    WHEN "resource_type" = 'workflow' THEN 'automation'
    WHEN "resource_type" = 'brain' THEN 'engine'
    WHEN "resource_type" = 'tool' THEN 'module'
    ELSE "resource_type"
  END;
--> statement-breakpoint
UPDATE "events"
SET
  "type" = regexp_replace(
    regexp_replace(
      regexp_replace("type", '^ritual([.:])', 'automation\1'),
      '^workflow([.:])',
      'automation\1'
    ),
    '^brain([.:])',
    'engine\1'
  ),
  "entity_type" = CASE
    WHEN "entity_type" = 'ritual' THEN 'automation'
    WHEN "entity_type" = 'workflow' THEN 'automation'
    WHEN "entity_type" = 'brain' THEN 'engine'
    WHEN "entity_type" = 'tool' THEN 'module'
    ELSE "entity_type"
  END,
  "payload" = pg_temp.vocab2_transform_jsonb("payload");
--> statement-breakpoint
UPDATE "signals"
SET
  "type" = regexp_replace(
    regexp_replace(
      regexp_replace("type", '^ritual([.:])', 'automation\1'),
      '^workflow([.:])',
      'automation\1'
    ),
    '^brain([.:])',
    'engine\1'
  ),
  "subject_type" = CASE
    WHEN "subject_type" = 'ritual' THEN 'automation'
    WHEN "subject_type" = 'workflow' THEN 'automation'
    WHEN "subject_type" = 'brain' THEN 'engine'
    WHEN "subject_type" = 'tool' THEN 'module'
    ELSE "subject_type"
  END,
  "payload" = pg_temp.vocab2_transform_jsonb("payload"),
  "recommended_action" = pg_temp.vocab2_transform_jsonb("recommended_action");
--> statement-breakpoint
UPDATE "node_types"
SET "type" = CASE
  WHEN "type" = 'ritual' THEN 'automation'
  WHEN "type" = 'workflow' THEN 'automation'
  WHEN "type" = 'brain' THEN 'engine'
  WHEN "type" = 'tool' THEN 'module'
  ELSE "type"
END;
--> statement-breakpoint
UPDATE "edges"
SET
  "src_type" = CASE
    WHEN "src_type" = 'ritual' THEN 'automation'
    WHEN "src_type" = 'workflow' THEN 'automation'
    WHEN "src_type" = 'brain' THEN 'engine'
    WHEN "src_type" = 'tool' THEN 'module'
    ELSE "src_type"
  END,
  "dst_type" = CASE
    WHEN "dst_type" = 'ritual' THEN 'automation'
    WHEN "dst_type" = 'workflow' THEN 'automation'
    WHEN "dst_type" = 'brain' THEN 'engine'
    WHEN "dst_type" = 'tool' THEN 'module'
    ELSE "dst_type"
  END;
--> statement-breakpoint

ALTER TABLE "ritual_runs" DROP CONSTRAINT IF EXISTS "ritual_runs_ritual_id_rituals_id_fk";
--> statement-breakpoint
ALTER TABLE "rituals" DROP CONSTRAINT IF EXISTS "rituals_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "rituals" ALTER COLUMN "agent_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "rituals" ALTER COLUMN "agent_plane" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ritual_runs" ALTER COLUMN "agent_id" SET NOT NULL;
--> statement-breakpoint
DROP TABLE "tools";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "allowed_tools";
--> statement-breakpoint
ALTER TABLE "rituals" DROP COLUMN "agent_ids";
--> statement-breakpoint

ALTER TABLE "rituals" RENAME TO "automations";
--> statement-breakpoint
ALTER TABLE "ritual_runs" RENAME TO "automation_runs";
--> statement-breakpoint
ALTER TABLE "automation_runs" RENAME COLUMN "ritual_id" TO "automation_id";
--> statement-breakpoint

ALTER TABLE "automations" RENAME CONSTRAINT "rituals_pkey" TO "automations_pkey";
--> statement-breakpoint
ALTER TABLE "automation_runs" RENAME CONSTRAINT "ritual_runs_pkey" TO "automation_runs_pkey";
--> statement-breakpoint
ALTER TABLE "automations" RENAME CONSTRAINT "rituals_workspace_id_workspaces_id_fk" TO "automations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "automations" RENAME CONSTRAINT "rituals_supports_initiative_initiatives_id_fk" TO "automations_supports_initiative_initiatives_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_runs" RENAME CONSTRAINT "ritual_runs_workspace_id_workspaces_id_fk" TO "automation_runs_workspace_id_workspaces_id_fk";
--> statement-breakpoint

ALTER TABLE "automations"
  ADD CONSTRAINT "automations_workspace_id_id_uq"
  UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "automations"
  ADD CONSTRAINT "automations_workspace_id_agent_id_uq"
  UNIQUE ("workspace_id", "id", "agent_id");
--> statement-breakpoint
ALTER TABLE "automations"
  ADD CONSTRAINT "automations_workspace_agent_fk"
  FOREIGN KEY ("workspace_id", "agent_id")
  REFERENCES "agents" ("workspace_id", "id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "automations"
  ADD CONSTRAINT "automations_agent_plane_check"
  CHECK ("agent_plane" IN ('local', 'cloud'));
--> statement-breakpoint
ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_workspace_automation_owner_fk"
  FOREIGN KEY ("workspace_id", "automation_id", "agent_id")
  REFERENCES "automations" ("workspace_id", "id", "agent_id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER POLICY "rituals_tenant_select" ON "automations" RENAME TO "automations_tenant_select";
--> statement-breakpoint
ALTER POLICY "rituals_tenant_insert" ON "automations" RENAME TO "automations_tenant_insert";
--> statement-breakpoint
ALTER POLICY "rituals_tenant_update" ON "automations" RENAME TO "automations_tenant_update";
--> statement-breakpoint
ALTER POLICY "rituals_tenant_delete" ON "automations" RENAME TO "automations_tenant_delete";
--> statement-breakpoint
ALTER POLICY "ritual_runs_tenant_select" ON "automation_runs" RENAME TO "automation_runs_tenant_select";
--> statement-breakpoint
ALTER POLICY "ritual_runs_tenant_insert" ON "automation_runs" RENAME TO "automation_runs_tenant_insert";
--> statement-breakpoint
ALTER POLICY "ritual_runs_tenant_update" ON "automation_runs" RENAME TO "automation_runs_tenant_update";
--> statement-breakpoint
ALTER POLICY "ritual_runs_tenant_delete" ON "automation_runs" RENAME TO "automation_runs_tenant_delete";
--> statement-breakpoint

ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
