const DENIED_KEYS = new Set([
  "organizationid", "organizationname", "installationid", "tenantid",
  "userid", "username", "useremail", "email", "emailaddress", "personid",
  "ownerid", "createdby", "updatedby", "authorid", "accountid", "fullname",
  "firstname", "lastname", "primarycontact", "contactname", "customername",
  "clientname", "companyname", "apikey", "accesstoken", "refreshtoken",
  "secret", "password", "credential",
]);
const DENIED_SUFFIXES = ["secret", "token", "password", "credential", "apikey", "contact"];
const DENIED_VALUES = [
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
  /\bAccountKey=[A-Za-z0-9+/=]{32}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter)\b/i,
];

function deniedKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return DENIED_KEYS.has(normalized) || DENIED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function findOrganizationDataPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findOrganizationDataPaths(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      return deniedKey(key) ? [childPath] : findOrganizationDataPaths(child, childPath);
    });
  }
  return typeof value === "string" && DENIED_VALUES.some((pattern) => pattern.test(value))
    ? [path || "$"]
    : [];
}
