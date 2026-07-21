CREATE INDEX IF NOT EXISTS "events_org_created_idx"
  ON "events" ("organization_id", "created_at");