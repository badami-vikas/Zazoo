REVOKE ALL ON TABLE "organizations", "users" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "organizations", "users" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "organizations", "users" FROM authenticated;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "organizations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
