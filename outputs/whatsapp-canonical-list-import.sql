-- WhatsApp contacts → a separate list on canonical People
-- Staged 2026-08-01. NOT RUN: the Bridge Supabase project is not reachable from
-- the authoring session (the connected MCP account holds only CorpSim, and the
-- prototype .env is correctly withheld). Review, then run with psql.
--
-- Shape follows the existing ETA / WashU lists exactly, as read from
-- "Design Bridge AI Interface (Copy)/src/app/data/db.ts":
--   a list        = communities row with kind='list', name_override=<list name>
--   membership    = community_members(community_id, person_id)  ← per-workspace people.id
--   the People grid keys off people_canonical.id, reached via people.canonical_person_id
--
-- Residency note: this deliberately places WhatsApp contacts on the CLOUD plane,
-- reversing the "local-only, opt-in promote" decision recorded in the design
-- spec, at the owner's explicit instruction (2026-08-01). It follows the
-- data-residency rule for firehose imports — canonical-only, kept OUT of the
-- relationship graph — so no Signals, Events, or Relations are created here.
--
--   Source CSV: ~/Documents/Bridge/Avilo Advisory/WhatsApp/Contacts/
--               whatsapp-contacts-2026-08-01.csv   (8,384 rows)
--
-- Usage:
--   psql "$BRIDGE_DATABASE_URL" -v ON_ERROR_STOP=1 -f whatsapp-canonical-list-import.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE RUNNING — two things this script cannot verify without a connection:
--   1. Whether people_canonical has a phone column. Section 2 writes ONLY
--      full_name and dedup_key; the phone stays in the staging table so nothing
--      fails on a missing column. Uncomment the phone line once confirmed.
--   2. The organization_id / user_id to own the per-workspace people rows.
--      Section 0 resolves them from existing data and ABORTS if ambiguous,
--      rather than picking one and silently attributing 8,384 contacts.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on
BEGIN;

-- ── 0. Resolve the owning organization and user ─────────────────────────────
CREATE TEMP TABLE wa_owner AS
SELECT organization_id, user_id, count(*) AS existing_people
FROM people
GROUP BY organization_id, user_id
ORDER BY count(*) DESC
LIMIT 1;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM wa_owner;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Could not resolve a single owning (organization_id, user_id); set it explicitly.';
  END IF;
END $$;

-- ── 1. Stage the CSV ────────────────────────────────────────────────────────
CREATE TEMP TABLE wa_import (
  full_name      text,
  phone_e164     text,
  identity_kind  text,   -- 'phone' | 'lid'
  note           text,
  dedupe_key     text     -- whatsapp:+E164  |  whatsapp-lid:<id>
);

\copy wa_import FROM '/Users/vikasbadami/Documents/Bridge/Avilo Advisory/WhatsApp/Contacts/whatsapp-contacts-2026-08-01.csv' WITH (FORMAT csv, HEADER true)

-- The CSV escapes spreadsheet-formula characters with a leading apostrophe;
-- strip it so stored names match what WhatsApp actually reported.
UPDATE wa_import SET full_name = ltrim(full_name, '''') WHERE full_name LIKE '''%';

-- Guard: a LID identity must never carry a phone number. If this fires, the
-- extractor regressed — investigate before importing.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM wa_import
  WHERE identity_kind = 'lid' AND coalesce(phone_e164, '') <> '';
  IF bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % LID rows carry a phone number (fabricated identity).', bad;
  END IF;
END $$;

-- ── 2. Select-or-insert canonical people ────────────────────────────────────
-- Select-or-insert rather than ON CONFLICT: there is no composite unique
-- constraint to conflict against. Two statements, not one CTE — within a single
-- statement the SELECT sees the pre-INSERT snapshot and would re-insert rows.

CREATE TEMP TABLE wa_matched AS
SELECT w.dedupe_key, pc.id AS canonical_person_id
FROM wa_import w
JOIN people_canonical pc ON pc.dedup_key = w.dedupe_key;

WITH inserted AS (
  INSERT INTO people_canonical (full_name, dedup_key)
  -- , phones            -- uncomment with the column below once confirmed
  SELECT w.full_name, w.dedupe_key
  -- , CASE WHEN w.phone_e164 <> '' THEN ARRAY[w.phone_e164] ELSE NULL END
  FROM wa_import w
  WHERE NOT EXISTS (SELECT 1 FROM wa_matched m WHERE m.dedupe_key = w.dedupe_key)
  RETURNING id, dedup_key
)
INSERT INTO wa_matched (dedupe_key, canonical_person_id)
SELECT dedup_key, id FROM inserted;

-- ── 3. Per-workspace people rows ────────────────────────────────────────────
CREATE TEMP TABLE wa_people AS
SELECT m.dedupe_key, p.id AS person_id
FROM wa_matched m
JOIN people p ON p.canonical_person_id = m.canonical_person_id
JOIN wa_owner o ON o.organization_id = p.organization_id AND o.user_id = p.user_id;

WITH inserted AS (
  INSERT INTO people (organization_id, user_id, canonical_person_id, source, visibility)
  SELECT o.organization_id, o.user_id, m.canonical_person_id, 'whatsapp', 'private'
  FROM wa_matched m
  CROSS JOIN wa_owner o
  WHERE NOT EXISTS (SELECT 1 FROM wa_people wp WHERE wp.dedupe_key = m.dedupe_key)
  RETURNING id, canonical_person_id
)
INSERT INTO wa_people (dedupe_key, person_id)
SELECT m.dedupe_key, i.id
FROM inserted i
JOIN wa_matched m ON m.canonical_person_id = i.canonical_person_id;

-- ── 4. The list itself ──────────────────────────────────────────────────────
INSERT INTO communities (organization_id, user_id, kind, name_override, source)
SELECT o.organization_id, o.user_id, 'list', 'WhatsApp', 'whatsapp'
FROM wa_owner o
WHERE NOT EXISTS (
  SELECT 1 FROM communities c
  WHERE c.kind = 'list' AND c.name_override = 'WhatsApp'
    AND c.organization_id = o.organization_id AND c.user_id = o.user_id
);

-- ── 5. Membership ───────────────────────────────────────────────────────────
INSERT INTO community_members (community_id, person_id)
SELECT c.id, wp.person_id
FROM wa_people wp
CROSS JOIN wa_owner o
JOIN communities c
  ON c.kind = 'list' AND c.name_override = 'WhatsApp'
 AND c.organization_id = o.organization_id AND c.user_id = o.user_id
ON CONFLICT (community_id, person_id) DO NOTHING;

-- ── 6. Report, then decide ──────────────────────────────────────────────────
SELECT 'staged contacts'      AS metric, count(*) FROM wa_import
UNION ALL SELECT 'canonical people resolved', count(*) FROM wa_matched
UNION ALL SELECT 'workspace people resolved', count(*) FROM wa_people
UNION ALL SELECT 'list members', count(*)
  FROM community_members cm
  JOIN communities c ON c.id = cm.community_id
 WHERE c.kind = 'list' AND c.name_override = 'WhatsApp';

-- Inspect the report above, then:
COMMIT;    -- or ROLLBACK;
