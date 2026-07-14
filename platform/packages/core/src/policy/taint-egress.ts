/**
 * PI-2 — tainted-context egress gate (the RUNTIME data-flow half of the lethal
 * trifecta). The static manifest audit (`package/risk.ts::packageHasLethalTrifecta`:
 * privateRead && untrustedIngest && egress) tells us a package *could* exfiltrate; this
 * gate governs the actual turn: when the effective provenance is `untrusted_external`,
 * any egress (external:send / share) is forced to human review instead of auto-applying.
 *
 * Why require_approval, not block: a human may still legitimately approve a send after
 * seeing it (e.g. replying to the email that carried the untrusted content). The gate
 * closes only the *autonomous* exfiltration path — "untrusted content instructs the
 * agent to forward everything to an attacker" can never auto-commit.
 *
 * Why external:send only (not external:fetch): fetch is INBOUND sourcing (covered by the
 * SEC-7 SSRF allow-list + plane rules); the exfiltration risk is OUTBOUND. Gating fetch
 * here would break normal ingestion without adding data-flow safety.
 *
 * MCP/tool output is DATA, never an instruction that itself triggers a propose(): tool
 * results may *taint* a turn (raising this gate) but never originate a mutation. This is
 * the kernel invariant recorded in ADR-066.
 */
import type { PolicyFn } from "../memory/stores.js";
import type { Action, PolicyResult, ResourceType, TrustOrigin } from "../types.js";

export const TAINTED_EGRESS_POLICY_ID = "pi2-tainted-context-egress";

/** Outbound channels an exfiltration would use. `external:send` is the API send/share
 * gate; inbound `external:fetch` is intentionally excluded (see module docstring). */
export const TAINTED_EGRESS_RESOURCES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "external:send",
]);

/** True when this action leaves the workspace boundary (egress). */
function isEgress(action: Action, resourceType: ResourceType): boolean {
  return TAINTED_EGRESS_RESOURCES.has(resourceType) || action === "share";
}

/**
 * Pure gate used BOTH structurally by the pipeline (always-on kernel guarantee) and by
 * the `taintedEgressPolicy` PolicyFn below. Returns a `require_approval` result when a
 * turn carrying `untrusted_external` content attempts egress; otherwise null.
 */
export function evaluateTaintedEgress(args: {
  action: Action;
  resourceType: ResourceType;
  taint: TrustOrigin | undefined;
}): PolicyResult | null {
  if (args.taint !== "untrusted_external") return null;
  if (!isEgress(args.action, args.resourceType)) return null;
  return {
    policyId: TAINTED_EGRESS_POLICY_ID,
    phase: "runtime",
    effect: "require_approval",
    reason:
      "egress on a turn carrying untrusted_external content requires human approval (PI-2 tainted-context data-flow gate)",
  };
}

/**
 * The same gate expressed as a `PolicyFn`, for deployments/tests that evaluate it at the
 * PolicyStore layer. The pipeline ALREADY enforces `evaluateTaintedEgress` structurally,
 * so wiring this into a PolicyStore is optional (and would merely duplicate the result);
 * it exists so the rule is reusable and independently testable as a policy.
 */
export const taintedEgressPolicy: PolicyFn = (input) => {
  if (input.phase !== "runtime") return null;
  return evaluateTaintedEgress({
    action: input.action,
    resourceType: input.resourceType,
    taint: input.taint,
  });
};
