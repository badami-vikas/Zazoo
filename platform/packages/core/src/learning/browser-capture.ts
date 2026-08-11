/**
 * Browser-visit domain policy (AI Harness K8, ADR-210 — "Capture: browser").
 *
 * Consent (capture-consent.ts) answers WHETHER the browser source may emit
 * at all; this policy answers WHICH domains may. Two design commitments,
 * both fail-closed:
 *
 *  - **Default-deny.** A domain captures only when it matches an allowlist
 *    entry, so the empty policy captures NOTHING. "Capture everything
 *    except a denylist" would make the first browser rung an ambient
 *    everything-sensor behind a single toggle; naming the work domains you
 *    want Bridge to notice is the consent-shaped version of the same
 *    feature, and widening later is a policy edit, not a schema change.
 *  - **Deny wins.** A domain matching both lists is denied. The denylist
 *    exists to carve exceptions out of coarse allowlist entries
 *    (allow `google.com`, deny `mail.google.com`), which only works if
 *    deny is checked first.
 *
 * Matching is exact-or-subdomain on LABEL BOUNDARIES: `docs.google.com`
 * matches the entry `google.com`, but `evilgoogle.com` does not. The parse
 * fails closed exactly like capture consent: a malformed stored value, a
 * non-array list, or an entry that is not a plausible hostname all read as
 * absent — there is no way to store a value that widens capture beyond
 * well-formed, explicitly written entries.
 */

/** Hostname-shaped labels only: letters/digits/hyphens, no leading or
 * trailing hyphen, dot-separated. Rejects schemes, paths, ports, spaces —
 * anything that could smuggle URL structure into a policy entry. */
const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export interface BrowserDomainPolicy {
  allowlist: string[];
  denylist: string[];
}

export function emptyBrowserDomainPolicy(): BrowserDomainPolicy {
  return { allowlist: [], denylist: [] };
}

/** Lowercase, trim, strip one trailing dot; null when the result is not a
 * plausible bare hostname. The single normalization used for BOTH policy
 * entries and observed domains, so comparisons are always like-for-like. */
export function normalizeBrowserDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (domain.length === 0 || domain.length > 253) return null;
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

function readDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const domain = normalizeBrowserDomain(entry);
    if (domain && !out.includes(domain)) out.push(domain);
  }
  return out;
}

/** Parse a stored policy, failing CLOSED: anything malformed reads as the
 * empty (capture-nothing) policy, and malformed entries are dropped rather
 * than repaired. */
export function readBrowserDomainPolicy(value: unknown): BrowserDomainPolicy {
  if (typeof value !== "object" || value === null) return emptyBrowserDomainPolicy();
  const record = value as Record<string, unknown>;
  return {
    allowlist: readDomainList(record["allowlist"]),
    denylist: readDomainList(record["denylist"]),
  };
}

/** Exact match, or a subdomain on a label boundary. `entry` is assumed
 * normalized (policy lists are; observed domains normalize in the verdict). */
export function browserDomainMatches(domain: string, entry: string): boolean {
  return domain === entry || domain.endsWith(`.${entry}`);
}

export type BrowserCaptureVerdict = "allowed" | "denylisted" | "not_allowlisted";

/** THE per-domain gate, asked on BOTH sides of the process boundary: the
 * extension asks before a visit payload is ever built (a denied domain is
 * never sent anywhere), and the API asks again before writing (defense in
 * depth against a stale or bypassed extension). Order is load-bearing:
 * malformed → denied, denylist → denied, allowlist required. */
export function browserCaptureVerdict(
  policy: BrowserDomainPolicy,
  domain: unknown,
): BrowserCaptureVerdict {
  const normalized = normalizeBrowserDomain(domain);
  if (!normalized) return "not_allowlisted";
  if (policy.denylist.some((entry) => browserDomainMatches(normalized, entry))) {
    return "denylisted";
  }
  return policy.allowlist.some((entry) => browserDomainMatches(normalized, entry))
    ? "allowed"
    : "not_allowlisted";
}
