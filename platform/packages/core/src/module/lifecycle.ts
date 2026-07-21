/**
 * Module versioning — single-live-version-per-organization state machine
 * (docs/raw/capability-module-format.md §3, ADR-018, "Zapier model").
 * States: private -> promoted -> available -> legacy -> deprecating ->
 * deprecated. At most ONE version of a given module name may be `available`
 * in a organization at a time; promoting a new version AUTO-DEMOTES the prior
 * `available` version to `legacy` in the same transaction.
 *
 * Rollback = FORK a new draft version from a historical one, never an
 * in-place revert — matches the append-only-ledger invariant every other
 * Bridge mutation follows (capability lifecycle, blueprint activation). This
 * module is pure: it decides what the resulting rows SHOULD look like; the
 * caller (apps/api) is responsible for the actual store writes/transaction.
 */
import type { ModuleInstallationRow, ModuleVersionState } from "./types.js";

const FORWARD_TRANSITIONS: Record<ModuleVersionState, ModuleVersionState | null> = {
  private: "promoted",
  promoted: "available",
  available: "legacy",
  legacy: "deprecating",
  deprecating: "deprecated",
  deprecated: null,
};

export class InvalidModuleTransitionError extends Error {
  constructor(from: ModuleVersionState, to: ModuleVersionState) {
    super(`module lifecycle: cannot transition ${from} -> ${to}`);
    this.name = "InvalidModuleTransitionError";
  }
}

/** Advance one step forward. Mirrors capability/lifecycle.ts's `advance()`
 * shape (a single legal-next-state table), scoped to the smaller module
 * state set. */
export function advanceModuleState(current: ModuleVersionState): ModuleVersionState {
  const next = FORWARD_TRANSITIONS[current];
  if (!next) throw new InvalidModuleTransitionError(current, current);
  return next;
}

export interface PromoteResult {
  /** The version being promoted — its new state. */
  promoted: { installationId: string; nextState: "available" };
  /** The prior `available` version in this organization for this module name,
   * if any — its new state. Undefined when there was no prior available
   * version (first-ever promotion). */
  demoted?: { installationId: string; nextState: "legacy" };
}

/**
 * Promote `target` to `available`, auto-demoting whatever installation is
 * CURRENTLY `available` for the same (organizationId, moduleName) — never two
 * live versions side by side. Pure: returns the two state changes the caller
 * applies atomically; does not touch a store itself.
 */
export function promoteToAvailable(
  target: ModuleInstallationRow,
  currentlyAvailable: ModuleInstallationRow | null,
): PromoteResult {
  if (target.state !== "promoted") {
    throw new InvalidModuleTransitionError(target.state, "available");
  }
  if (currentlyAvailable && currentlyAvailable.id === target.id) {
    throw new Error("module lifecycle: target is already the available version");
  }
  if (
    currentlyAvailable &&
    (currentlyAvailable.organizationId !== target.organizationId || currentlyAvailable.moduleName !== target.moduleName)
  ) {
    throw new Error("module lifecycle: currentlyAvailable must be the same organization+module as target");
  }

  const result: PromoteResult = { promoted: { installationId: target.id, nextState: "available" } };
  if (currentlyAvailable) {
    result.demoted = { installationId: currentlyAvailable.id, nextState: "legacy" };
  }
  return result;
}

/**
 * Rollback = fork a NEW draft installation row from a historical version,
 * never an in-place revert of `fromHistorical`. The returned row is a
 * proposal shape (no `id`/`createdAt` yet — the caller's store assigns
 * those) with a derived version string
 * (`{fromHistorical.moduleVersion}-rollback-from-{fromHistorical.moduleVersion}`
 * is wrong when rolling back TO a historical version — the new version bumps
 * off the CURRENT available version, per the format doc's example
 * "1.2.0 -> 1.2.1-rollback-from-1.1.0").
 */
export function rollbackFromHistory(args: {
  currentAvailable: ModuleInstallationRow;
  rollbackTarget: ModuleInstallationRow;
}): Omit<ModuleInstallationRow, "id" | "createdAt"> {
  const { currentAvailable, rollbackTarget } = args;
  if (currentAvailable.moduleName !== rollbackTarget.moduleName) {
    throw new Error("module lifecycle: rollback target must be the same module name as the current available version");
  }
  if (currentAvailable.organizationId !== rollbackTarget.organizationId) {
    throw new Error("module lifecycle: rollback target must be in the same organization");
  }
  if (currentAvailable.moduleAttachment || rollbackTarget.moduleAttachment) {
    throw new Error(
      "module lifecycle: signed Commons installations cannot be forked locally; install the exact signed version instead",
    );
  }

  const newVersion = `${currentAvailable.moduleVersion}-rollback-from-${rollbackTarget.moduleVersion}`;
  return {
    organizationId: currentAvailable.organizationId,
    moduleName: currentAvailable.moduleName,
    moduleVersion: newVersion,
    manifest: { ...rollbackTarget.manifest, version: newVersion },
    computedRisk: rollbackTarget.computedRisk,
    state: "private",
    status: "pending_review",
    lineageManifestId: rollbackTarget.id,
  };
}
