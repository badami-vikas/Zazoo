import { sql, type SQL } from "drizzle-orm";

export interface RlsRoleAttributes {
  rolname?: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
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
  };
  if (attrs.rolname) role.rolname = attrs.rolname;
  return role;
}

async function queryCurrentRole(db: RlsQueryable): Promise<RlsRoleAttributes | null> {
  const row = firstRow(
    await db.execute(sql`
      SELECT rolname, rolsuper, rolbypassrls
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
          SELECT rolname, rolsuper, rolbypassrls
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
}
