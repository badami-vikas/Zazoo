-- Migration 001: add recon enrichment columns to people_canonical and communities_canonical
-- Run against the Bridge AI Supabase project (ref: emtbimowmqqhixqlxhzb)
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- ── people_canonical additions ──────────────────────────────────────────────

ALTER TABLE people_canonical
  ADD COLUMN IF NOT EXISTS instagram_handle      text,
  ADD COLUMN IF NOT EXISTS tiktok_handle         text,
  ADD COLUMN IF NOT EXISTS bluesky_handle        text,
  ADD COLUMN IF NOT EXISTS mastodon_url          text,
  ADD COLUMN IF NOT EXISTS orcid_id              text,
  ADD COLUMN IF NOT EXISTS scholar_url           text,
  ADD COLUMN IF NOT EXISTS previous_companies    jsonb,
  ADD COLUMN IF NOT EXISTS education             jsonb,
  ADD COLUMN IF NOT EXISTS skills                text[],
  ADD COLUMN IF NOT EXISTS recon_run_at          timestamptz,
  ADD COLUMN IF NOT EXISTS recon_signals         jsonb;
--> statement-breakpoint

-- GIN index for fast signal/skills queries
CREATE INDEX IF NOT EXISTS people_canonical_recon_signals_idx
  ON people_canonical USING gin (recon_signals);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS people_canonical_skills_idx
  ON people_canonical USING gin (skills);
--> statement-breakpoint

-- ── communities_canonical additions ─────────────────────────────────────────

ALTER TABLE communities_canonical
  ADD COLUMN IF NOT EXISTS tech_stack            text[],
  ADD COLUMN IF NOT EXISTS twitter_handle        text,
  ADD COLUMN IF NOT EXISTS github_org            text,
  ADD COLUMN IF NOT EXISTS employee_count_approx integer,
  ADD COLUMN IF NOT EXISTS founded_year          integer,
  ADD COLUMN IF NOT EXISTS hiring_signals        jsonb,
  ADD COLUMN IF NOT EXISTS recon_run_at          timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS communities_canonical_tech_stack_idx
  ON communities_canonical USING gin (tech_stack);
--> statement-breakpoint
