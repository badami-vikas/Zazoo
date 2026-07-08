/**
 * Publish-side privacy gate — the "generalized knowledge only" rule
 * (CLAUDE.md: Commons carries capability knowledge, NEVER user data)
 * enforced in code at the only door into the registry.
 *
 * Strategy: recursively walk the RAW publish payload (before/independent of
 * manifest parsing, so unknown extra fields can't smuggle data past the shape
 * guard) and flag any key that names workspace- or user-specific state. The
 * error lists every offending JSON path so a publisher can generalize the
 * manifest instead of guessing.
 */

/** Keys that mark WORKSPACE-SPECIFIC or USER-IDENTIFYING data. Matched
 * case-insensitively after stripping underscores, so workspaceId /
 * workspace_id / WorkspaceID all hit. */
const DENIED_KEYS: readonly string[] = [
  // workspace instance state — a manifest describes a capability, not an install
  "workspaceid",
  "workspacename",
  "installationid",
  "tenantid",
  // user / person identifiers
  "userid",
  "username",
  "useremail",
  "email",
  "emailaddress",
  "personid",
  "ownerid",
  "createdby",
  "updatedby",
  "authorid",
  "accountid",
  // credentials / secrets — never registry content
  "apikey",
  "accesstoken",
  "refreshtoken",
  "secret",
  "password",
  "credential",
];

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isDeniedKey(key: string): boolean {
  return DENIED_KEYS.includes(normalizeKey(key));
}

/**
 * Walk `value` and return the JSON path of every denied key, e.g.
 * ["workspaceId", "capabilities[0].createdBy"]. Empty array = clean.
 */
export function findWorkspaceDataPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findWorkspaceDataPaths(item, `${path}[${i}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = path === "" ? key : `${path}.${key}`;
      if (isDeniedKey(key)) return [childPath];
      return findWorkspaceDataPaths(child, childPath);
    });
  }
  return [];
}
