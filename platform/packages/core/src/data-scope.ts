/**
 * Data-scope — WHICH tier of data an actor may touch for an action.
 *
 * The two-tier network (SCHEMA.sql): `*_canonical` = PUBLIC platform facts;
 * `people`/`communities` = PRIVATE per-user relationship tier. When granting an
 * Agent or Automation step access to data, the user picks a scope — all / public /
 * private — and the agent/step may only reach that tier.
 *
 * Effective scope is the INTERSECTION across layers (narrowest wins, like deny):
 *   requested (the step/agent's dropdown choice) ∩ agent ceiling ∩ granted scope.
 * `public ∩ private = none` (disjoint tiers) — which denies the action: you asked
 * for a tier you weren't granted.
 */

/** User-selectable scope. */
export type DataScope = "all" | "public" | "private";

/** Resolved scope — `none` means the intersection is empty (a conflict → deny). */
export type EffectiveDataScope = DataScope | "none";

/** Intersect two scopes. all = public ∪ private; public ∩ private = none. */
export function intersectDataScope(
  a: EffectiveDataScope,
  b: EffectiveDataScope,
): EffectiveDataScope {
  if (a === "none" || b === "none") return "none";
  if (a === "all") return b;
  if (b === "all") return a;
  if (a === b) return a; // public∩public, private∩private
  return "none"; // public ∩ private
}

/** Union of granted scopes (a grant with no scope = 'all'). */
export function unionDataScope(scopes: Array<DataScope | undefined>): DataScope {
  let hasPublic = false;
  let hasPrivate = false;
  for (const s of scopes) {
    if (s === undefined || s === "all") return "all";
    if (s === "public") hasPublic = true;
    if (s === "private") hasPrivate = true;
  }
  if (hasPublic && hasPrivate) return "all";
  if (hasPublic) return "public";
  if (hasPrivate) return "private";
  return "all"; // no grants matched scope → unconstrained tier (deny handled elsewhere)
}

/** Tiers the effective scope admits — what the data layer filters reads to. */
export function tiersFor(scope: EffectiveDataScope): {
  canonical: boolean;
  relationship: boolean;
} {
  switch (scope) {
    case "all":
      return { canonical: true, relationship: true };
    case "public":
      return { canonical: true, relationship: false };
    case "private":
      return { canonical: false, relationship: true };
    case "none":
      return { canonical: false, relationship: false };
  }
}
