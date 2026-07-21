REVOKE ALL ON TABLE
  "communities_canonical",
  "community_members",
  "decision_traces",
  "embedding_models",
  "embeddings",
  "integration_sync_state",
  "node_types",
  "people_canonical",
  "record_communities",
  "record_participants",
  "role_permissions",
  "team_members"
FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      "communities_canonical",
      "community_members",
      "decision_traces",
      "embedding_models",
      "embeddings",
      "integration_sync_state",
      "node_types",
      "people_canonical",
      "record_communities",
      "record_participants",
      "role_permissions",
      "team_members"
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      "communities_canonical",
      "community_members",
      "decision_traces",
      "embedding_models",
      "embeddings",
      "integration_sync_state",
      "node_types",
      "people_canonical",
      "record_communities",
      "record_participants",
      "role_permissions",
      "team_members"
    FROM authenticated;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "communities_canonical" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "community_members" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decision_traces" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "embedding_models" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "embeddings" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_sync_state" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "node_types" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "people_canonical" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "record_communities" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "record_participants" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_members" DISABLE ROW LEVEL SECURITY;
