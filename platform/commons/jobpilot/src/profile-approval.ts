import type { MasterProfile } from "./master-profile.js";

// Profile approval guard (JP1 deliverable: "master profile is human-approved before any
// downstream skill consumes it — poisoned-profile guard").
//
// A MasterProfile must pass through this guard before any downstream capability (tailoring,
// fit scoring, application preparation) may consume it. The guard enforces two invariants:
//  1. All NeedsHuman fields have been resolved (needsHumanCount === 0).
//  2. An explicit human made the approval decision (approvedBy is a non-empty identity).
//
// An ApprovedProfile is an opaque wrapper — it can only be obtained from approveProfile() and
// cannot be constructed externally without a type cast (which code review would catch).

// Discriminant that makes ApprovedProfile nominally distinct from a plain object.
// Intentionally not exported — callers check via isApprovedProfile() or assertApprovedProfile().
const APPROVAL_TYPE = "approved-profile" as const;

export interface ApprovedProfile {
  readonly _type: typeof APPROVAL_TYPE;
  readonly profile: MasterProfile;
  readonly approvedBy: string; // human identity: email, username, or "human" for tests
  readonly approvedAt: string; // ISO timestamp
}

/**
 * Produce an ApprovedProfile from a MasterProfile that has no unresolved NeedsHuman fields.
 * Throws if the profile still has pending fields — the caller must resolve them first (e.g.
 * by re-running compileProfile with human-supplied overrides, or by constructing a new
 * ParsedSource that incorporates the resolved values).
 */
export function approveProfile(profile: MasterProfile, approvedBy: string, approvedAt: string): ApprovedProfile {
  if (!approvedBy.trim()) throw new Error("approveProfile: approvedBy must be a non-empty human identity");

  if (profile.needsHumanCount > 0) {
    const paths = profile.pendingFields.map((f) => f.fieldPath).join(", ");
    throw new Error(`approveProfile: profile has ${profile.needsHumanCount} unresolved NeedsHuman field(s): ${paths}. Resolve all conflicts before approving.`);
  }

  return { _type: APPROVAL_TYPE, profile, approvedBy, approvedAt };
}

/** Type guard — returns true only for values produced by approveProfile(). */
export function isApprovedProfile(value: unknown): value is ApprovedProfile {
  return typeof value === "object" && value !== null && "_type" in value && (value as Record<string, unknown>)["_type"] === APPROVAL_TYPE;
}

/**
 * Assertion guard — throws if the value has not been human-approved.
 * Downstream skills call this at their entry point to enforce the poisoned-profile invariant:
 *   assertApprovedProfile(masterProfile);   // ← throws if not approved
 *   // safe to consume masterProfile below
 */
export function assertApprovedProfile(value: unknown): asserts value is ApprovedProfile {
  if (!isApprovedProfile(value)) {
    throw new Error("assertApprovedProfile: profile has not been human-approved; poisoned-profile guard blocks downstream consumption");
  }
}
