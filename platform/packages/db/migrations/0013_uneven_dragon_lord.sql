ALTER TABLE "agents" ADD COLUMN "allowed_skill_names" text[];--> statement-breakpoint
UPDATE "agents" AS "agent"
SET "allowed_skill_names" = ARRAY(
  SELECT "skill"."name"
  FROM unnest("agent"."allowed_skills") WITH ORDINALITY AS "allowed"("skill_id", "position")
  JOIN "skills" AS "skill" ON "skill"."id" = "allowed"."skill_id"
  WHERE "skill"."workspace_id" IS NULL OR "skill"."workspace_id" = "agent"."workspace_id"
  ORDER BY "allowed"."position"
);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agents"
    WHERE cardinality("allowed_skills") <> cardinality("allowed_skill_names")
  ) THEN
    RAISE EXCEPTION 'agents.allowed_skills contains an unresolved or cross-workspace Skill reference';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "allowed_skill_names" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "allowed_skill_names" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "allowed_skills";--> statement-breakpoint
ALTER TABLE "agents" RENAME COLUMN "allowed_skill_names" TO "allowed_skills";--> statement-breakpoint
ALTER TABLE "rituals" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "rituals" ADD COLUMN "agent_plane" text;--> statement-breakpoint
UPDATE "rituals"
SET
  "agent_id" = "rituals"."agent_ids"[1],
  "agent_plane" = 'local'
FROM "agents"
WHERE cardinality("rituals"."agent_ids") = 1
  AND "agents"."id" = "rituals"."agent_ids"[1]
  AND "agents"."workspace_id" = "rituals"."workspace_id"
  AND jsonb_typeof("rituals"."skill_pipeline") = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements("rituals"."skill_pipeline") AS "step"
    WHERE jsonb_typeof("step") IS DISTINCT FROM 'object'
      OR jsonb_typeof("step"->'skill') IS DISTINCT FROM 'string'
      OR length("step"->>'skill') = 0
      OR jsonb_typeof("step"->'action') IS DISTINCT FROM 'string'
      OR "step"->>'action' NOT IN ('read', 'write', 'execute', 'archive', 'approve')
      OR jsonb_typeof("step"->'resourceType') IS DISTINCT FROM 'string'
      OR "step"->>'resourceType' NOT IN (
        'person',
        'community',
        'initiative',
        'touchpoint',
        'ritual',
        'tool',
        'file',
        'signal',
        'policy',
        'policy_param',
        'skill',
        'agent',
        'role',
        'permission',
        'ledger',
        'delegation',
        'integration',
        'network_graph:full'
      )
      OR (
        "step" ? 'resourceId'
        AND (
          jsonb_typeof("step"->'resourceId') IS DISTINCT FROM 'string'
          OR length("step"->>'resourceId') = 0
        )
      )
      OR (
        "step" ? 'inputs'
        AND jsonb_typeof("step"->'inputs') IS DISTINCT FROM 'object'
      )
      OR (
        "step" ? 'dataScope'
        AND (
          jsonb_typeof("step"->'dataScope') IS DISTINCT FROM 'string'
          OR "step"->>'dataScope' NOT IN ('all', 'public', 'private')
        )
      )
  );--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;