/**
 * Risk computation — the risk axis is COMPUTED from a manifest's declared
 * permissions/connectors, NEVER self-declared by whatever generated it (docs/
 * wiki/vision.md "Capability Trust Model"). This is deliberately pure/sync:
 * no store access here — callers resolve the dependency closure via a
 * `ResolveDependency` function so this module stays testable with plain
 * objects and cycle-safe by construction (a visited-set, not recursion depth).
 */
import type { CapabilityManifest, CapabilityPermission, ResolveDependency, RiskBand } from "./types.js";

/** Total order over risk bands — index = severity. Composite risk = max index
 * over the dependency closure. */
const RISK_ORDER: readonly RiskBand[] = [
  "informational",
  "advisory",
  "transformational",
  "operational",
  "external",
];

function riskIndex(band: RiskBand): number {
  return RISK_ORDER.indexOf(band);
}

/** The higher (more severe) of two risk bands. */
export function maxRisk(a: RiskBand, b: RiskBand): RiskBand {
  return riskIndex(a) >= riskIndex(b) ? a : b;
}

/**
 * Base risk mapping for a SINGLE permission (before considering dependencies
 * or connectors): read-only/no-egress -> informational; a permission that
 * merely produces recommendations (write to a "recommendation"/"signal"-shaped
 * resource) -> advisory; a write to ordinary workspace data -> transformational;
 * a write to a shared/governed resource (permission/role/policy/ledger/agent/
 * delegation — the governance spine itself) -> operational; ANY egress
 * (external send, or dataScope spanning beyond private with write) -> external.
 */
function riskForPermission(p: CapabilityPermission): RiskBand {
  if (p.egress) return "external";

  const GOVERNED_RESOURCES = new Set([
    "permission",
    "role",
    "role_permission",
    "policy",
    "policy_param",
    "ledger",
    "agent",
    "delegation",
    "capability_manifest",
    "capability_state",
    "trust_grant",
  ]);

  if (p.action === "read") return "informational";

  if (p.action === "send") return "external";

  // action === "write"
  if (GOVERNED_RESOURCES.has(p.resourceType)) return "operational";

  // A write whose resourceType/dataScope shape looks advisory (recommendation/
  // signal-only output, never touching durable workspace state) stays advisory.
  if (p.resourceType === "signal" || p.resourceType === "recommendation") return "advisory";

  return "transformational";
}

/** Risk contributed by a connector alone (independent of permissions): any
 * connector capable of an external send is itself `external`. */
function riskForConnectors(manifest: CapabilityManifest): RiskBand {
  return manifest.connectors.some((c) => c.externalSend) ? "external" : "informational";
}

/**
 * Audience raises effective approval requirements but does NOT itself change
 * the computed risk band stored on the manifest (risk stays a property of
 * WHAT the capability does; audience is a separate axis approvals.ts
 * combines with risk — "informational × shared ≠ auto"). Exposed here as a
 * pure helper so callers needn't duplicate the axis-separation reasoning.
 */
export function baseRiskForManifest(manifest: CapabilityManifest): RiskBand {
  let risk: RiskBand = "informational";
  for (const p of manifest.permissions) risk = maxRisk(risk, riskForPermission(p));
  risk = maxRisk(risk, riskForConnectors(manifest));
  return risk;
}

/**
 * Composite risk = max over the manifest's own risk AND its full dependency
 * closure (docs/wiki/vision.md: "Composite risk = max over dependency
 * closure"). Cycle-safe: a `visited` set (by manifest id) short-circuits
 * revisits instead of recursing forever on a dependency cycle. A dependency
 * that cannot be resolved (missing from the registry) is treated as
 * `operational` (conservative — an unknown dependency is never assumed safe),
 * not silently skipped.
 */
export function computeRisk(manifest: CapabilityManifest, resolveDependency: ResolveDependency): RiskBand {
  const visited = new Set<string>();

  function walk(m: CapabilityManifest): RiskBand {
    if (visited.has(m.id)) return "informational"; // already counted on this path
    visited.add(m.id);

    let risk = baseRiskForManifest(m);
    for (const dep of m.dependencies) {
      if (visited.has(dep.manifestId)) continue; // cycle guard
      const depManifest = resolveDependency(dep.manifestId);
      if (!depManifest) {
        // Unknown dependency — conservative: assume at least operational risk
        // rather than silently treating a missing manifest as harmless.
        risk = maxRisk(risk, "operational");
        continue;
      }
      risk = maxRisk(risk, walk(depManifest));
    }
    return risk;
  }

  return walk(manifest);
}
