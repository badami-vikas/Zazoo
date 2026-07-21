/**
 * Module-level risk computation (docs/raw/capability-module-format.md §2
 * steps 2-3, ADR-018). Builds on packages/core/src/capability/risk.ts's
 * `computeRisk`/`maxRisk` — never reimplements single-capability risk.
 *
 * Two rules, both from the format doc:
 *  1. Composite module risk = max(computeRisk) over EVERY bundled capability
 *     AND every dependency module's capabilities (cycle-safe).
 *  2. Lethal-trifecta union check: if the UNION of permissions across ALL
 *     bundled capabilities contains a private-data read, an untrusted/
 *     external-ingest read, AND an egress permission — even if no SINGLE
 *     capability carries all three legs — the whole module escalates to
 *     `external`, overriding whatever the composite alone produced. This is
 *     what catches a module composing three individually-safe capabilities
 *     that together assemble the trifecta.
 */
import { computeRisk, maxRisk } from "../capability/risk.js";
import { sandboxTrifectaLegs } from "../capability/sandbox-policy.js";
import type { CapabilityManifest, CapabilityPermission, ResolveDependency, RiskBand } from "../capability/types.js";
import type { ModuleManifest, ResolveModuleDependency } from "./types.js";

/** A permission counts as "untrusted/external ingest" for the trifecta check
 * when it reads a public/all-scope external-fetch-shaped resource, or reads
 * with dataScope "public" (the untrusted-content leg) — mirrors the
 * capability-level lethal-trifecta policy rule (roadmap.md P0). */
function isUntrustedIngest(p: CapabilityPermission): boolean {
  return p.action === "read" && (p.resourceType === "external_fetch" || p.resourceType === "external:fetch" || p.dataScope === "public");
}

/** A permission counts as "private-data read" for the trifecta check. */
function isPrivateRead(p: CapabilityPermission): boolean {
  return p.action === "read" && p.dataScope === "private";
}

/** A permission or connector counts as "egress" for the trifecta check. */
function hasEgress(m: CapabilityManifest): boolean {
  if (m.permissions.some((p) => p.egress || p.action === "send")) return true;
  if (m.connectors.some((c) => c.externalSend)) return true;
  return false;
}

/**
 * The union trifecta check, across ALL capabilities passed in (a module's
 * own bundled capabilities plus every dependency module's capabilities —
 * the same population computeModuleRisk() walks for composite risk). Legs
 * may come from DIFFERENT capabilities — this is deliberately not "does any
 * one capability contain all three." Each capability contributes a leg either
 * through its declared permissions/connectors OR through its GRANTED SANDBOX
 * CAPS (PKG-1: an executable capability's sandbox network -> egress+ingest,
 * filesystem/env -> private-read), so a trifecta assembled via sandbox grants
 * escalates exactly like a permission-derived one.
 */
export function moduleHasLethalTrifecta(capabilities: CapabilityManifest[]): boolean {
  let sawPrivateRead = false;
  let sawUntrustedIngest = false;
  let sawEgress = false;

  for (const cap of capabilities) {
    const sandbox = sandboxTrifectaLegs(cap);
    if (cap.permissions.some(isPrivateRead) || sandbox.privateRead) sawPrivateRead = true;
    if (cap.permissions.some(isUntrustedIngest) || sandbox.untrustedIngest) sawUntrustedIngest = true;
    if (hasEgress(cap) || sandbox.egress) sawEgress = true;
  }

  return sawPrivateRead && sawUntrustedIngest && sawEgress;
}

/**
 * Walk a module's own capabilities plus its full dependency-module closure
 * (cycle-safe via a visited set on `name@version`), collecting every
 * `CapabilityManifest` encountered — the population both the composite-risk
 * max and the trifecta union check operate over.
 */
function collectClosureCapabilities(
  pkg: ModuleManifest,
  resolveDependency: ResolveModuleDependency,
  visited: Set<string>,
): CapabilityManifest[] {
  const key = `${pkg.name}@${pkg.version}`;
  if (visited.has(key)) return [];
  visited.add(key);

  const capabilities = [...pkg.capabilities];
  for (const dep of pkg.dependencies) {
    const depKey = `${dep.manifestId}@${dep.version}`;
    if (visited.has(depKey)) continue;
    const depPkg = resolveDependency(dep.manifestId, dep.version);
    if (!depPkg) continue; // unresolved module dependency — capability-level computeRisk already
    // treats an unresolved CAPABILITY dependency as conservative (operational); an unresolved
    // MODULE dependency has no capabilities to contribute here, so composite risk falls back to
    // the escalation in computeModuleRisk() below rather than silently under-counting.
    capabilities.push(...collectClosureCapabilities(depPkg, resolveDependency, visited));
  }
  return capabilities;
}

export interface ModuleRiskResult {
  /** max(computeRisk) over the full bundled+dependency-closure population. */
  compositeRisk: RiskBand;
  /** True when the trifecta union check escalated the result to `external`. */
  trifectaEscalated: boolean;
  /** compositeRisk, or "external" if trifectaEscalated. The value to store as
   * the module's computed risk / feed into requiredApproval(). */
  effectiveRisk: RiskBand;
  /** Dependency-module ids that could not be resolved (documentation/audit only —
   * mirrors computeRisk()'s conservative "operational" treatment of an unknown
   * capability dependency, surfaced here so callers can log/flag it). */
  unresolvedDependencies: string[];
}

/**
 * Module-level `computeRisk()` — composite max over every bundled
 * capability's own dependency closure (via the existing `computeRisk`), AND
 * over every dependency MODULE's capabilities, THEN the union lethal-
 * trifecta check across the whole population. A module's own
 * `summary`/`description` text is NEVER read as a risk signal — only
 * permissions/connectors/dependencies feed this computation ("a manifest can
 * lie").
 */
export function computeModuleRisk(
  pkg: ModuleManifest,
  resolveCapabilityDependency: ResolveDependency,
  resolveModuleDependency: ResolveModuleDependency,
): ModuleRiskResult {
  const visited = new Set<string>();
  const allCapabilities = collectClosureCapabilities(pkg, resolveModuleDependency, visited);

  const unresolvedDependencies: string[] = [];
  for (const dep of pkg.dependencies) {
    if (!resolveModuleDependency(dep.manifestId, dep.version)) {
      unresolvedDependencies.push(`${dep.manifestId}@${dep.version}`);
    }
  }

  let compositeRisk: RiskBand = "informational";
  for (const cap of allCapabilities) {
    compositeRisk = maxRisk(compositeRisk, computeRisk(cap, resolveCapabilityDependency));
  }
  // An unresolved module dependency is conservative-escalated the same way an
  // unresolved capability dependency is inside computeRisk() ("operational",
  // never silently harmless).
  if (unresolvedDependencies.length > 0) compositeRisk = maxRisk(compositeRisk, "operational");

  const trifectaEscalated = moduleHasLethalTrifecta(allCapabilities);
  const effectiveRisk: RiskBand = trifectaEscalated ? "external" : compositeRisk;

  return { compositeRisk, trifectaEscalated, effectiveRisk, unresolvedDependencies };
}
