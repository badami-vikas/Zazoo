/**
 * The extension's pure capture pipeline (AI Harness K8, TASK-052). Every
 * decision that matters is in this file, dependency-injected and tested
 * under node — the chrome glue (background.ts) only wires events to these
 * functions.
 *
 * The privacy shape, in order of enforcement:
 *
 *  1. **Non-web schemes never capture.** chrome://, file://, about:,
 *     devtools:// — anything that is not http(s) — returns null from
 *     `extractCaptureDomain` before a policy is even consulted.
 *  2. **The URL dies here.** `extractCaptureDomain` reduces the URL to its
 *     bare hostname; paths, query strings, fragments, ports, and
 *     credentials are discarded in-browser. The visit payload has no url
 *     field, so the URL cannot leave the process even by mistake.
 *  3. **The verdict is the API's own function.** `decideVisit` calls the
 *     SAME compiled `browserCaptureVerdict` from @bridge/core that the
 *     server re-evaluates on arrival — default-deny, deny-wins, label-
 *     boundary subdomain matching. The two sides cannot drift.
 *  4. **Dormant by default.** No policy fetched (Bridge unreachable, not
 *     configured, consent off, kill switch on) reads as `capturing: false`,
 *     and `decideVisit` reports nothing.
 *
 * Private windows are excluded a layer above all of this: the manifest
 * declares `"incognito": "not_allowed"`, so Chrome never runs any of this
 * code in an incognito profile — the capture path is absent there, not
 * filtered.
 */
import {
  browserCaptureVerdict,
  normalizeBrowserDomain,
  type BrowserDomainPolicy,
} from "@bridge/core/learning/browser-capture";

/** What the extension knows after asking Bridge: whether capture is on at
 * all (flight AND consent AND not paused) plus the domain lists. */
export interface ExtensionCapturePolicy extends BrowserDomainPolicy {
  capturing: boolean;
}

export function dormantPolicy(): ExtensionCapturePolicy {
  return { capturing: false, allowlist: [], denylist: [] };
}

/** Reduce a URL to a bare, normalized hostname — or null for anything that
 * is not an http(s) page. This is the moment the URL ceases to exist. */
export function extractCaptureDomain(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return normalizeBrowserDomain(parsed.hostname);
}

export type VisitDecision =
  | { report: true; domain: string }
  | { report: false; reason: "not_capturing" | "not_http" | "denylisted" | "not_allowlisted" };

/** The whole in-browser gate for one page load. */
export function decideVisit(policy: ExtensionCapturePolicy, url: string): VisitDecision {
  if (!policy.capturing) return { report: false, reason: "not_capturing" };
  const domain = extractCaptureDomain(url);
  if (!domain) return { report: false, reason: "not_http" };
  const verdict = browserCaptureVerdict(policy, domain);
  if (verdict !== "allowed") return { report: false, reason: verdict };
  return { report: true, domain };
}

/** The exact wire shape of one reported visit. Mirrors the server's input
 * schema (visit title clamp included) and — the point — has no url field. */
export interface VisitPayload {
  organizationId: string;
  visitId: string;
  domain: string;
  title: string;
  visitedAt: string;
}

export function buildVisitPayload(args: {
  organizationId: string;
  visitId: string;
  domain: string;
  title: string;
  visitedAt: string;
}): VisitPayload {
  return {
    organizationId: args.organizationId,
    visitId: args.visitId,
    domain: args.domain,
    title: args.title.trim().slice(0, 300),
    visitedAt: args.visitedAt,
  };
}

export const VISIT_DEDUPE_WINDOW_MS = 60_000;

/** SPA navigations and tab refreshes re-fire `onUpdated` for the same page;
 * one visit per (tab, domain, title) per window keeps the signal a visit,
 * not a heartbeat. */
export class VisitDeduper {
  #last = new Map<number, { key: string; at: number }>();

  shouldSend(
    tabId: number,
    domain: string,
    title: string,
    nowMs: number,
    windowMs = VISIT_DEDUPE_WINDOW_MS,
  ): boolean {
    const key = `${domain}\u0000${title}`;
    const prev = this.#last.get(tabId);
    if (prev && prev.key === key && nowMs - prev.at < windowMs) return false;
    this.#last.set(tabId, { key, at: nowMs });
    return true;
  }

  forget(tabId: number): void {
    this.#last.delete(tabId);
  }
}
