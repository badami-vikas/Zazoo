-- VOCAB3: make Organization, Module, Database, Record, Field, and Relation the
-- only persisted product contracts while preserving tenant isolation and data.

CREATE OR REPLACE FUNCTION pg_temp.vocab3_json_key(input_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE input_key
    WHEN 'workspace' THEN 'organization'
    WHEN 'workspaceId' THEN 'organizationId'
    WHEN 'workspaceIds' THEN 'organizationIds'
    WHEN 'workspace_id' THEN 'organization_id'
    WHEN 'workspace_ids' THEN 'organization_ids'
    WHEN 'workspaceVocab' THEN 'organizationVocab'
    WHEN 'workspaceDefinition' THEN 'organizationDefinition'
    WHEN 'workspaceDefinitions' THEN 'organizationDefinitions'
    WHEN 'workspaceDefinitionId' THEN 'organizationDefinitionId'
    WHEN 'workspaceDefinitionIds' THEN 'organizationDefinitionIds'
    WHEN 'workspace_definition' THEN 'organization_definition'
    WHEN 'workspace_definitions' THEN 'organization_definitions'
    WHEN 'workspace_definition_id' THEN 'organization_definition_id'
    WHEN 'workspace_definition_ids' THEN 'organization_definition_ids'
    WHEN 'package' THEN 'module'
    WHEN 'packageId' THEN 'moduleId'
    WHEN 'packageIds' THEN 'moduleIds'
    WHEN 'package_id' THEN 'module_id'
    WHEN 'package_ids' THEN 'module_ids'
    WHEN 'packageName' THEN 'moduleName'
    WHEN 'packageVersion' THEN 'moduleVersion'
    WHEN 'package_name' THEN 'module_name'
    WHEN 'package_version' THEN 'module_version'
    WHEN 'packageInstallationId' THEN 'moduleInstallationId'
    WHEN 'packageInstallationIds' THEN 'moduleInstallationIds'
    WHEN 'package_installation_id' THEN 'module_installation_id'
    WHEN 'package_installation_ids' THEN 'module_installation_ids'
    WHEN 'modulePackageName' THEN 'ownerModuleName'
    WHEN 'initiative' THEN 'record'
    WHEN 'initiatives' THEN 'records'
    WHEN 'initiativeId' THEN 'recordId'
    WHEN 'initiativeIds' THEN 'recordIds'
    WHEN 'initiative_id' THEN 'record_id'
    WHEN 'initiative_ids' THEN 'record_ids'
    WHEN 'supportsInitiative' THEN 'supportsRecord'
    WHEN 'supports_initiative' THEN 'supports_record'
    WHEN 'projectId' THEN 'recordId'
    WHEN 'projectIds' THEN 'recordIds'
    WHEN 'project_id' THEN 'record_id'
    WHEN 'project_ids' THEN 'record_ids'
    WHEN 'elementId' THEN 'recordId'
    WHEN 'elementIds' THEN 'recordIds'
    WHEN 'element_id' THEN 'record_id'
    WHEN 'element_ids' THEN 'record_ids'
    WHEN 'elementType' THEN 'recordType'
    WHEN 'elementTypes' THEN 'recordTypes'
    WHEN 'element_type' THEN 'record_type'
    WHEN 'element_types' THEN 'record_types'
    WHEN 'subjectElementId' THEN 'subjectRecordId'
    WHEN 'subject_element_id' THEN 'subject_record_id'
    ELSE input_key
  END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.vocab3_discriminator(input_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE input_value
    WHEN 'workspace' THEN 'organization'
    WHEN 'workspaces' THEN 'organizations'
    WHEN 'workspace_definition' THEN 'organization_definition'
    WHEN 'workspace_definitions' THEN 'organization_definitions'
    WHEN 'package' THEN 'module'
    WHEN 'packages' THEN 'modules'
    WHEN 'package_install' THEN 'module_install'
    WHEN 'package_installation' THEN 'module_installation'
    WHEN 'initiative' THEN 'record'
    WHEN 'initiatives' THEN 'records'
    WHEN 'project' THEN 'record'
    WHEN 'projects' THEN 'records'
    WHEN 'element' THEN 'record'
    WHEN 'elements' THEN 'records'
    ELSE regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(input_value, '^workspace([.:])', 'organization\1'),
            '^package([.:])',
            'module\1'
          ),
          '^initiative([.:])',
          'record\1'
        ),
        '^project([.:])',
        'record\1'
      ),
      '^element([.:])',
      'record\1'
    )
  END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.vocab3_transform_jsonb(
  input_value jsonb,
  parent_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  output_value jsonb;
  conflicting_key text;
BEGIN
  CASE jsonb_typeof(input_value)
    WHEN 'object' THEN
      SELECT mapped_key
      INTO conflicting_key
      FROM (
        SELECT
          pg_temp.vocab3_json_key(entry.key) AS mapped_key,
          COUNT(DISTINCT entry.value) AS distinct_values,
          COUNT(*) AS source_keys
        FROM jsonb_each(input_value) AS entry
        GROUP BY pg_temp.vocab3_json_key(entry.key)
      ) AS collisions
      WHERE source_keys > 1
        AND distinct_values > 1
      LIMIT 1;

      IF conflicting_key IS NOT NULL THEN
        RAISE EXCEPTION
          'VOCAB3 cannot merge conflicting JSON keys into canonical key "%"',
          conflicting_key;
      END IF;

      SELECT COALESCE(
        jsonb_object_agg(
          pg_temp.vocab3_json_key(entry.key),
          pg_temp.vocab3_transform_jsonb(
            entry.value,
            pg_temp.vocab3_json_key(entry.key)
          )
        ),
        '{}'::jsonb
      )
      INTO output_value
      FROM jsonb_each(input_value) AS entry;
      RETURN output_value;
    WHEN 'array' THEN
      SELECT COALESCE(
        jsonb_agg(
          pg_temp.vocab3_transform_jsonb(entry.value, parent_key)
          ORDER BY entry.ordinality
        ),
        '[]'::jsonb
      )
      INTO output_value
      FROM jsonb_array_elements(input_value) WITH ORDINALITY AS entry(value, ordinality);
      RETURN output_value;
    WHEN 'string' THEN
      IF parent_key IS NOT NULL
        AND (
          parent_key IN ('type', 'kind', 'scope', 'visibility')
          OR parent_key ~ '(Id|Ids|Type|Types|Kind|Kinds|Scope|Scopes|Visibility)$'
          OR parent_key ~ '(_id|_ids|_type|_types|_kind|_kinds|_scope|_scopes|_visibility)$'
        )
      THEN
        RETURN to_jsonb(pg_temp.vocab3_discriminator(input_value #>> '{}'));
      END IF;
      RETURN input_value;
    ELSE
      RETURN input_value;
  END CASE;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.vocab3_identifier(input_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(
    replace(
      replace(
        replace(
          replace(input_value, 'subject_element', 'subject_record'),
          'workspace',
          'organization'
        ),
        'package',
        'module'
      ),
      'initiative',
      'record'
    ),
    '_ws_',
    '_org_'
  );
$$;
--> statement-breakpoint

DO $$
DECLARE
  pair record;
  old_table regclass;
  new_table regclass;
BEGIN
  FOR pair IN
    SELECT *
    FROM (
      VALUES
        ('workspaces', 'organizations'),
        ('workspace_settings', 'organization_settings'),
        ('workspace_members', 'organization_members'),
        ('workspace_definitions', 'organization_definitions'),
        ('package_installations', 'module_installations'),
        ('initiatives', 'records'),
        ('initiative_participants', 'record_participants'),
        ('initiative_communities', 'record_communities')
    ) AS pairs(old_name, new_name)
  LOOP
    old_table := to_regclass(format('public.%I', pair.old_name));
    new_table := to_regclass(format('public.%I', pair.new_name));
    IF old_table IS NOT NULL AND new_table IS NOT NULL THEN
      RAISE EXCEPTION
        'VOCAB3 found ambiguous tables "%" and "%"; reconcile them before retrying',
        pair.old_name,
        pair.new_name;
    END IF;
    IF old_table IS NULL AND new_table IS NULL THEN
      RAISE EXCEPTION
        'VOCAB3 expected either table "%" or "%", but neither exists',
        pair.old_name,
        pair.new_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS legacy
    JOIN information_schema.columns AS canonical
      ON canonical.table_schema = legacy.table_schema
     AND canonical.table_name = legacy.table_name
    WHERE legacy.table_schema = 'public'
      AND (
        (legacy.column_name = 'workspace_id' AND canonical.column_name = 'organization_id')
        OR (legacy.column_name = 'initiative_id' AND canonical.column_name = 'record_id')
        OR (legacy.column_name = 'package_name' AND canonical.column_name = 'module_name')
        OR (legacy.column_name = 'package_version' AND canonical.column_name = 'module_version')
        OR (legacy.column_name = 'supports_initiative' AND canonical.column_name = 'supports_record')
        OR (legacy.column_name = 'subject_element_id' AND canonical.column_name = 'subject_record_id')
      )
  ) THEN
    RAISE EXCEPTION
      'VOCAB3 found both legacy and canonical columns on one table; reconcile them before retrying';
  END IF;

  IF EXISTS (
    SELECT pg_temp.vocab3_discriminator("type")
    FROM "node_types"
    GROUP BY pg_temp.vocab3_discriminator("type")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'VOCAB3 cannot merge conflicting node_types rows into one canonical Record type';
  END IF;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT *
    FROM (
      VALUES
        ('workspaces', 'organizations'),
        ('workspace_settings', 'organization_settings'),
        ('workspace_members', 'organization_members'),
        ('workspace_definitions', 'organization_definitions'),
        ('package_installations', 'module_installations'),
        ('initiatives', 'records'),
        ('initiative_participants', 'record_participants'),
        ('initiative_communities', 'record_communities')
    ) AS pairs(old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', pair.old_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I RENAME TO %I', pair.old_name, pair.new_name);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  pair record;
  target record;
BEGIN
  FOR pair IN
    SELECT *
    FROM (
      VALUES
        ('workspace_id', 'organization_id'),
        ('initiative_id', 'record_id'),
        ('package_name', 'module_name'),
        ('package_version', 'module_version'),
        ('supports_initiative', 'supports_record'),
        ('subject_element_id', 'subject_record_id')
    ) AS pairs(old_name, new_name)
  LOOP
    FOR target IN
      SELECT "table_schema", "table_name"
      FROM information_schema.columns
      WHERE "table_schema" = 'public'
        AND "column_name" = pair.old_name
      ORDER BY "table_name"
    LOOP
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE "table_schema" = target.table_schema
          AND "table_name" = target.table_name
          AND "column_name" = pair.new_name
      ) THEN
        RAISE EXCEPTION
          'VOCAB3 found both columns "%.%" and "%.%"',
          target.table_name,
          pair.old_name,
          target.table_name,
          pair.new_name;
      END IF;
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME COLUMN %I TO %I',
        target.table_schema,
        target.table_name,
        pair.old_name,
        pair.new_name
      );
    END LOOP;
  END LOOP;
END;
$$;
--> statement-breakpoint

ALTER TABLE "communities" DROP CONSTRAINT IF EXISTS "communities_visibility_check";
--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT IF EXISTS "people_visibility_check";
--> statement-breakpoint
ALTER TABLE "edges" DROP CONSTRAINT IF EXISTS "edges_visibility_check";
--> statement-breakpoint
ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "workspace_settings_default_visibility_check";
--> statement-breakpoint
ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "organization_settings_default_visibility_check";
--> statement-breakpoint

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT "table_schema", "table_name", "column_name"
    FROM information_schema.columns
    WHERE "table_schema" = 'public'
      AND "data_type" = 'jsonb'
    ORDER BY "table_name", "ordinal_position"
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = pg_temp.vocab3_transform_jsonb(%I) WHERE %I IS NOT NULL',
      target.table_schema,
      target.table_name,
      target.column_name,
      target.column_name,
      target.column_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT "table_schema", "table_name", "column_name"
    FROM information_schema.columns
    WHERE "table_schema" = 'public'
      AND "data_type" = 'text'
      AND "column_name" IN (
        'type',
        'entity_type',
        'subject_type',
        'scope_type',
        'resource_type',
        'context_type',
        'visibility',
        'scope',
        'kind',
        'capability_class',
        'default_visibility'
      )
    ORDER BY "table_name", "ordinal_position"
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = pg_temp.vocab3_discriminator(%I) '
      'WHERE %I IS NOT NULL AND pg_temp.vocab3_discriminator(%I) IS DISTINCT FROM %I',
      target.table_schema,
      target.table_name,
      target.column_name,
      target.column_name,
      target.column_name,
      target.column_name,
      target.column_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

ALTER TABLE "communities"
  ADD CONSTRAINT "communities_visibility_check"
  CHECK ("visibility" IN ('private', 'team', 'organization'));
--> statement-breakpoint
ALTER TABLE "people"
  ADD CONSTRAINT "people_visibility_check"
  CHECK ("visibility" IN ('private', 'team', 'organization'));
--> statement-breakpoint
ALTER TABLE "edges"
  ADD CONSTRAINT "edges_visibility_check"
  CHECK ("visibility" IN ('private', 'organization', 'public'));
--> statement-breakpoint
ALTER TABLE "organization_settings"
  ADD CONSTRAINT "organization_settings_default_visibility_check"
  CHECK ("default_visibility" IN ('private', 'team', 'organization'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.same_organization(row_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT row_organization_id = app_private.current_organization_id();
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.visible_relationship_record(
  row_organization_id uuid,
  row_visibility text,
  row_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_private.same_organization(row_organization_id)
    AND CASE row_visibility
      WHEN 'organization' THEN true
      WHEN 'private' THEN row_user_id = app_private.current_user_id()
      WHEN 'team' THEN row_user_id = app_private.current_user_id()
      ELSE false
    END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.visible_memory_record(
  row_organization_id uuid,
  row_scope text,
  row_owner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_private.same_organization(row_organization_id)
    AND CASE row_scope
      WHEN 'public' THEN true
      WHEN 'organization' THEN true
      WHEN 'team' THEN row_owner_user_id = app_private.current_user_id()
      WHEN 'private' THEN row_owner_user_id = app_private.current_user_id()
      WHEN 'restricted' THEN row_owner_user_id = app_private.current_user_id()
      ELSE false
    END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  policy_row record;
  next_qual text;
  next_check text;
  statement text;
BEGIN
  FOR policy_row IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      policy.polname AS policy_name,
      pg_get_expr(policy.polqual, policy.polrelid) AS qualifier,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS checker
    FROM pg_policy AS policy
    JOIN pg_class AS relation
      ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND (
        COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') LIKE '%same_workspace%'
        OR COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '') LIKE '%same_workspace%'
        OR COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') LIKE '%visible_relationship_row%'
        OR COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '') LIKE '%visible_relationship_row%'
        OR COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') LIKE '%visible_memory_row%'
        OR COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '') LIKE '%visible_memory_row%'
        OR COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') LIKE '%''workspace''%'
        OR COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '') LIKE '%''workspace''%'
      )
    ORDER BY relation.relname, policy.polname
  LOOP
    next_qual := replace(replace(
      replace(
        replace(policy_row.qualifier, 'same_workspace', 'same_organization'),
        'visible_relationship_row',
        'visible_relationship_record'
      ),
      'visible_memory_row',
      'visible_memory_record'
    ), '''workspace''', '''organization''');
    next_check := replace(replace(
      replace(
        replace(policy_row.checker, 'same_workspace', 'same_organization'),
        'visible_relationship_row',
        'visible_relationship_record'
      ),
      'visible_memory_row',
      'visible_memory_record'
    ), '''workspace''', '''organization''');
    statement := format(
      'ALTER POLICY %I ON %I.%I',
      policy_row.policy_name,
      policy_row.schema_name,
      policy_row.table_name
    );
    IF next_qual IS NOT NULL THEN
      statement := statement || format(' USING (%s)', next_qual);
    END IF;
    IF next_check IS NOT NULL THEN
      statement := statement || format(' WITH CHECK (%s)', next_check);
    END IF;
    EXECUTE statement;
  END LOOP;
END;
$$;
--> statement-breakpoint

DROP FUNCTION IF EXISTS app_private.visible_relationship_row(uuid, text, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_private.visible_memory_row(uuid, text, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_private.same_workspace(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_private.current_workspace_id();
--> statement-breakpoint

DO $$
DECLARE
  target record;
  canonical_name text;
BEGIN
  FOR target IN
    SELECT
      constraint_row.oid AS constraint_oid,
      constraint_row.conname AS constraint_name,
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      constraint_row.conrelid AS relation_oid
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
    ORDER BY relation.relname, constraint_row.conname
  LOOP
    canonical_name := pg_temp.vocab3_identifier(target.constraint_name);
    IF canonical_name <> target.constraint_name THEN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = target.relation_oid
          AND conname = canonical_name
          AND oid <> target.constraint_oid
      ) THEN
        RAISE EXCEPTION
          'VOCAB3 cannot rename constraint "%" on "%": "%" already exists',
          target.constraint_name,
          target.table_name,
          canonical_name;
      END IF;
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        target.schema_name,
        target.table_name,
        target.constraint_name,
        canonical_name
      );
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  target record;
  canonical_name text;
BEGIN
  FOR target IN
    SELECT
      index_row.oid AS index_oid,
      index_row.relname AS index_name,
      namespace.nspname AS schema_name
    FROM pg_class AS index_row
    JOIN pg_namespace AS namespace
      ON namespace.oid = index_row.relnamespace
    WHERE namespace.nspname = 'public'
      AND index_row.relkind = 'i'
    ORDER BY index_row.relname
  LOOP
    canonical_name := pg_temp.vocab3_identifier(target.index_name);
    IF canonical_name <> target.index_name THEN
      IF to_regclass(format('%I.%I', target.schema_name, canonical_name)) IS NOT NULL THEN
        RAISE EXCEPTION
          'VOCAB3 cannot rename index "%": "%" already exists',
          target.index_name,
          canonical_name;
      END IF;
      EXECUTE format(
        'ALTER INDEX %I.%I RENAME TO %I',
        target.schema_name,
        target.index_name,
        canonical_name
      );
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  target record;
  canonical_name text;
BEGIN
  FOR target IN
    SELECT
      policy.policyname AS policy_name,
      policy.schemaname AS schema_name,
      policy.tablename AS table_name
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
    ORDER BY policy.tablename, policy.policyname
  LOOP
    canonical_name := pg_temp.vocab3_identifier(target.policy_name);
    IF canonical_name <> target.policy_name THEN
      IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = target.schema_name
          AND tablename = target.table_name
          AND policyname = canonical_name
      ) THEN
        RAISE EXCEPTION
          'VOCAB3 cannot rename policy "%" on "%": "%" already exists',
          target.policy_name,
          target.table_name,
          canonical_name;
      END IF;
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I RENAME TO %I',
        target.policy_name,
        target.schema_name,
        target.table_name,
        canonical_name
      );
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  target record;
  stale_rows bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('workspaces'),
        ('workspace_settings'),
        ('workspace_members'),
        ('workspace_definitions'),
        ('package_installations'),
        ('initiatives'),
        ('initiative_participants'),
        ('initiative_communities')
    ) AS legacy(table_name)
    WHERE to_regclass(format('public.%I', legacy.table_name)) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'VOCAB3 left a retired table in the public schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE "table_schema" = 'public'
      AND "column_name" IN (
        'workspace_id',
        'initiative_id',
        'package_name',
        'package_version',
        'supports_initiative',
        'subject_element_id'
      )
  ) THEN
    RAISE EXCEPTION 'VOCAB3 left a retired column in the public schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS function_row
    JOIN pg_namespace AS namespace
      ON namespace.oid = function_row.pronamespace
    WHERE namespace.nspname = 'app_private'
      AND (
        function_row.proname LIKE '%workspace%'
        OR pg_get_functiondef(function_row.oid) LIKE '%app.workspace_id%'
        OR pg_get_functiondef(function_row.oid) LIKE '%same_workspace%'
      )
  ) THEN
    RAISE EXCEPTION 'VOCAB3 left a retired tenant-context function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        policyname ~ '(workspace|package|initiative)'
        OR tablename ~ '(workspace|package|initiative)'
        OR COALESCE(qual, '') ~ '(workspace|same_workspace|visible_relationship_row|visible_memory_row)'
        OR COALESCE(with_check, '') ~ '(workspace|same_workspace|visible_relationship_row|visible_memory_row)'
      )
  ) THEN
    RAISE EXCEPTION 'VOCAB3 left a retired RLS policy contract';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    JOIN pg_namespace AS namespace
      ON namespace.oid = constraint_row.connamespace
    WHERE namespace.nspname = 'public'
      AND constraint_row.conname ~ '(workspace|package|initiative|subject_element)'
  ) THEN
    RAISE EXCEPTION 'VOCAB3 left a retired constraint name';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'i'
      AND (
        relation.relname ~ '(workspace|package|initiative|subject_element)'
        OR relation.relname LIKE '%\_ws\_%' ESCAPE '\'
      )
  ) THEN
    RAISE EXCEPTION 'VOCAB3 left a retired index name';
  END IF;

  FOR target IN
    SELECT "table_schema", "table_name", "column_name"
    FROM information_schema.columns
    WHERE "table_schema" = 'public'
      AND "data_type" = 'jsonb'
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I.%I WHERE %I IS NOT NULL '
      'AND pg_temp.vocab3_transform_jsonb(%I) IS DISTINCT FROM %I',
      target.table_schema,
      target.table_name,
      target.column_name,
      target.column_name,
      target.column_name
    )
    INTO stale_rows;
    IF stale_rows > 0 THEN
      RAISE EXCEPTION
        'VOCAB3 left % non-canonical JSON rows in %.%.%',
        stale_rows,
        target.table_schema,
        target.table_name,
        target.column_name;
    END IF;
  END LOOP;
END;
$$;
