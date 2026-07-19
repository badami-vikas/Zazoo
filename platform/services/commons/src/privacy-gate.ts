/**
 * Publish-side privacy gate — the "generalized knowledge only" rule
 * (CLAUDE.md: Commons carries capability knowledge, NEVER user data)
 * enforced in code at the only door into the registry.
 *
 * Strategy: recursively walk the RAW publish payload (before/independent of
 * manifest parsing, so unknown extra fields can't smuggle data past the shape
 * guard) and flag keys or scalar values that carry organization/user-specific
 * state. The error lists every offending JSON path so a publisher can
 * generalize the manifest instead of guessing.
 */

/** Keys that mark ORGANIZATION-SPECIFIC or USER-IDENTIFYING data. Matched
 * case-insensitively after stripping underscores, so organizationId /
 * organization_id / OrganizationID all hit. */
const DENIED_KEYS: readonly string[] = [
  // organization instance state — a manifest describes a capability, not an install
  "organizationid",
  "organizationname",
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
  "fullname",
  "firstname",
  "lastname",
  "primarycontact",
  "contactname",
  "customername",
  "clientname",
  "companyname",
  "organizationname",
  // credentials / secrets — never registry content
  "apikey",
  "accesstoken",
  "refreshtoken",
  "secret",
  "password",
  "credential",
];
const DENIED_KEY_SUFFIXES = [
  "secret",
  "token",
  "password",
  "credential",
  "apikey",
  "contact",
] as const;

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isDeniedKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return DENIED_KEYS.includes(normalized) || DENIED_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

const DENIED_VALUE_PATTERNS: readonly RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /\b(?:ws|usr|user|tenant|acct|account|person)_[a-z0-9_-]{6,}\b/i,
  /\b(?:customer|client|contact|organization|tenant|user|person):[^\s,;]+/i,
  /(?:^|\/)users?\/[^/\s]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b(?:sk|pk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|A3T[A-Z0-9])[A-Z0-9]{16}\b/,
  /\b(?:aws[_ -]?secret[_ -]?access[_ -]?key|secretAccessKey)\b\s*[:=]\s*[A-Za-z0-9/+=]{40}\b/i,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:xox[baprs]|xapp)-[0-9A-Za-z-]{10,}\b/,
  /\bGOCSPX-[0-9A-Za-z_-]{16,}\b/,
  /\bAccountKey=[A-Za-z0-9+/=]{32,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter)\b/i,
];

function isDeniedValue(value: unknown): boolean {
  return typeof value === "string" && DENIED_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Walk `value` and return the JSON path of every denied key, e.g.
 * ["organizationId", "capabilities[0].createdBy"]. Empty array = clean.
 */
export function findOrganizationDataPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findOrganizationDataPaths(item, `${path}[${i}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = path === "" ? key : `${path}.${key}`;
      if (isDeniedKey(key)) return [childPath];
      return findOrganizationDataPaths(child, childPath);
    });
  }
  if (isDeniedValue(value)) return [path || "$"];
  return [];
}
