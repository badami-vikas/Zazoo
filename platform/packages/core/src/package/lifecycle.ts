/**
 * Package versioning — single-live-version-per-workspace state machine
 * (docs/raw/capability-package-format.md §3, ADR-018, "Zapier model").
 * States: private -> promoted -> available -> legacy -> deprecating ->
 * deprecated. At most ONE version of a given package name may be `available`
 * in a workspace at a time; promoting a new version AUTO-DEMOTES the prior
 * `available` version to `legacy` in the same transaction.
 *
 * Rollback = FORK a new draft version from a historical one, never an
 * in-place revert — matches the append-only-ledger invariant every other
 * Bridge mutation follows (capability lifecycle, blueprint activation). This
 * module is pure: it decides what the resulting rows SHOULD look like; the
 * caller (apps/api) is responsible for the actual store writes/transaction.
 */
import type { PackageInstallationRow, PackageVersionState } from "./types.js";

const FORWARD_TRANSITIONS: Record<PackageVersionState, PackageVersionState | null> = {
  private: "promoted",
  promoted: "available",
  available: "legacy",
  legacy: "deprecating",
  deprecating: "deprecated",
  deprecated: null,
};

export class InvalidPackageTransitionError extends Error {
  constructor(from: PackageVersionState, to: PackageVersionState) {
    super(`package lifecycle: cannot transition ${from} -> ${to}`);
    this.name = "InvalidPackageTransitionError";
  }
}

/** Advance one step forward. Mirrors capability/lifecycle.ts's `advance()`
 * shape (a single legal-next-state table), scoped to the smaller package
 * state set. */
export function advancePackageState(current: PackageVersionState): PackageVersionState {
  const next = FORWARD_TRANSITIONS[current];
  if (!next) throw new InvalidPackageTransitionError(current, current);
  return next;
}

export interface PromoteResult {
  /** The version being promoted — its new state. */
  promoted: { installationId: string; nextState: "available" };
  /** The prior `available` version in this workspace for this package name,
   * if any — its new state. Undefined when there was no prior available
   * version (first-ever promotion). */
  demoted?: { installationId: string; nextState: "legacy" };
}

/**
 * Promote `target` to `available`, auto-demoting whatever installation is
 * CURRENTLY `available` for the same (workspaceId, packageName) — never two
 * live versions side by side. Pure: returns the two state changes the caller
 * applies atomically; does not touch a store itself.
 */
export function promoteToAvailable(
  target: PackageInstallationRow,
  currentlyAvailable: PackageInstallationRow | null,
): PromoteResult {
  if (target.state !== "promoted") {
    throw new InvalidPackageTransitionError(target.state, "available");
  }
  if (currentlyAvailable && currentlyAvailable.id === target.id) {
    throw new Error("package lifecycle: target is already the available version");
  }
  if (
    currentlyAvailable &&
    (currentlyAvailable.workspaceId !== target.workspaceId || currentlyAvailable.packageName !== target.packageName)
  ) {
    throw new Error("package lifecycle: currentlyAvailable must be the same workspace+package as target");
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
 * (`{fromHistorical.packageVersion}-rollback-from-{fromHistorical.packageVersion}`
 * is wrong when rolling back TO a historical version — the new version bumps
 * off the CURRENT available version, per the format doc's example
 * "1.2.0 -> 1.2.1-rollback-from-1.1.0").
 */
export function rollbackFromHistory(args: {
  currentAvailable: PackageInstallationRow;
  rollbackTarget: PackageInstallationRow;
}): Omit<PackageInstallationRow, "id" | "createdAt"> {
  const { currentAvailable, rollbackTarget } = args;
  if (currentAvailable.packageName !== rollbackTarget.packageName) {
    throw new Error("package lifecycle: rollback target must be the same package name as the current available version");
  }
  if (currentAvailable.workspaceId !== rollbackTarget.workspaceId) {
    throw new Error("package lifecycle: rollback target must be in the same workspace");
  }
  if (currentAvailable.moduleAttachment || rollbackTarget.moduleAttachment) {
    throw new Error(
      "package lifecycle: signed Commons installations cannot be forked locally; install the exact signed version instead",
    );
  }

  const newVersion = `${currentAvailable.packageVersion}-rollback-from-${rollbackTarget.packageVersion}`;
  return {
    workspaceId: currentAvailable.workspaceId,
    packageName: currentAvailable.packageName,
    packageVersion: newVersion,
    manifest: { ...rollbackTarget.manifest, version: newVersion },
    computedRisk: rollbackTarget.computedRisk,
    state: "private",
    status: "pending_review",
    lineageManifestId: rollbackTarget.id,
  };
}
