import { sql, type SQL } from "drizzle-orm";

export interface RlsRoleAttributes {
  rolname?: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb?: boolean;
  rolcreaterole?: boolean;
  rolinherit?: boolean;
  rolreplication?: boolean;
}

export type RlsEnvironment = string | { NODE_ENV?: string; BRIDGE_ENV?: string };

export interface RlsPostureOptions {
  env: RlsEnvironment;
  roleAttributes?: RlsRoleAttributes;
  queryRoleAttributes?: (query: SQL) => Promise<RlsRoleAttributes | null>;
}

export interface RlsQueryable {
  execute(query: SQL): Promise<unknown>;
}

function isProduction(env: RlsEnvironment): boolean {
  if (typeof env === "string") return env === "production";
  return env.NODE_ENV === "production" || env.BRIDGE_ENV === "production";
}

function firstRow(result: unknown): unknown {
  if (Array.isArray(result)) return result[0];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return rows?.[0];
  }
  return undefined;
}

function coerceRoleAttributes(row: unknown): RlsRoleAttributes | null {
  if (!row || typeof row !== "object") return null;
  const attrs = row as Partial<RlsRoleAttributes>;
  const role: RlsRoleAttributes = {
    rolsuper: attrs.rolsuper === true,
    rolbypassrls: attrs.rolbypassrls === true,
    rolcreatedb: attrs.rolcreatedb === true,
    rolcreaterole: attrs.rolcreaterole === true,
    rolinherit: attrs.rolinherit === true,
    rolreplication: attrs.rolreplication === true,
  };
  if (attrs.rolname) role.rolname = attrs.rolname;
  return role;
}

async function queryCurrentRole(db: RlsQueryable): Promise<RlsRoleAttributes | null> {
  const row = firstRow(
    await db.execute(sql`
      SELECT
        rolname,
        rolsuper,
        rolbypassrls,
        rolcreatedb,
        rolcreaterole,
        rolinherit,
        rolreplication
      FROM pg_roles
      WHERE rolname = current_user
    `),
  );
  return coerceRoleAttributes(row);
}

export async function assertRlsPosture(db: RlsQueryable, options: RlsPostureOptions): Promise<void> {
  if (!isProduction(options.env)) return;

  const role =
    options.roleAttributes ??
    (options.queryRoleAttributes
      ? await options.queryRoleAttributes(sql`
        SELECT
          rolname,
          rolsuper,
          rolbypassrls,
          rolcreatedb,
          rolcreaterole,
          rolinherit,
          rolreplication
        FROM pg_roles
        WHERE rolname = current_user
        `)
      : await queryCurrentRole(db));

  if (!role) {
    throw new Error("RLS posture check failed: current database role was not found");
  }
  if (role.rolsuper || role.rolbypassrls) {
    const name = role.rolname ? ` ${role.rolname}` : "";
    throw new Error(`RLS posture check failed: production app role${name} must not be superuser or BYPASSRLS`);
  }
  if (
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolinherit ||
    role.rolreplication
  ) {
    const name = role.rolname ? ` ${role.rolname}` : "";
    throw new Error(
      `RLS posture check failed: production app role${name} must be ` +
        "NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION",
    );
  }

  // Injected attributes are used by focused unit tests. A real production boot
  // reaches this probe and proves the role can evaluate RLS plus access the
  // tables/sequences needed by the Fastify runtime.
  if (options.roleAttributes) return;

  try {
    await db.execute(sql`SELECT app_private.current_organization_id()`);
    const privileges = firstRow(
      await db.execute(sql`
        SELECT
          has_table_privilege(
            current_user,
            'public.organization_members',
            'SELECT,INSERT,UPDATE,DELETE'
          ) AS table_access,
          has_sequence_privilege(
            current_user,
            'public.ledger_append_sequence_seq',
            'USAGE,SELECT,UPDATE'
          ) AS sequence_access
      `),
    ) as { table_access?: unknown; sequence_access?: unknown } | undefined;
    if (
      privileges?.table_access !== true ||
      privileges.sequence_access !== true
    ) {
      throw new Error(
        "runtime role lacks required public table or sequence privileges",
      );
    }
  } catch (error) {
    throw new Error(
      "RLS posture check failed: runtime role cannot evaluate app_private RLS " +
        "helpers or access required tables/sequences; apply migration " +
        "0022_supabase_runtime_role.sql and connect as bridge_app",
      { cause: error },
    );
  }
}
