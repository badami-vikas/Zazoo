/**
 * DrizzlePolicyParamStore — binds @bridge/core's `PolicyParamStore` port
 * (policy/params.ts) to the `policy_params` table, which has existed in
 * schema.ts since the VAR-1 batch with no reader at all (ADR-169).
 *
 * Why it matters now: the port's single consumer is `router.ts`'s
 * `resolveGates(await ctx.wiring.policyParams.get(organizationId))` — the
 * promotion gate's thresholds. Until ADR-168 that gate could not run at all
 * (no eval history survived a restart), so a defaults-only param store was
 * invisible. Now the gate runs, and it must read the Organization's ACTUAL
 * thresholds rather than a hard-coded copy of the defaults.
 *
 * Row mapping: `param_key` is a dotted path into `PolicyParamsOverride` and
 * `value` is the jsonb at that path — the shape `policy_params`
 * (organization_id, policy_id, param_key, value) was designed for. The key set
 * is an explicit ALLOWLIST and an unrecognised key THROWS. That is deliberate:
 * silently ignoring `aqv.gates.qualityMinn` would leave an operator believing
 * they had tightened a promotion gate that in fact never moved, which is the
 * same class of failure as the amnesiac eval store — a governance control that
 * looks applied and is not.
 *
 * Scope limit, stated rather than hidden: only Organization-level rows
 * (`policy_id IS NULL`) are read. `PolicyParams` is an Organization-wide
 * document with no per-policy dimension, so a policy-scoped row cannot be
 * represented by this port. Such rows are NOT silently folded in — they are
 * ignored by an explicit `isNull` filter, and a test pins that so the
 * limitation stays visible if per-policy params are ever introduced.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  mergePolicyParams,
  type PolicyParamStore,
  type PolicyParams,
  type PolicyParamsOverride,
  type TunableParam,
} from "@bridge/core";
import type { Database } from "./client.js";
import { policyParams } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

/** A rate/probability: every gate threshold is one, so a stored -5 or 7 is
 *  never a valid tightening — it is a row that would silently neuter the gate. */
const rate = z.number().min(0).max(1);
const positiveInt = z.number().int().min(1);

/**
 * The allowlist. Each entry validates the jsonb `value` for that key and
 * applies it to the override document being built.
 *
 * Range checks live here, at the persistence boundary, and are intentionally
 * STRICTER than `InMemoryPolicyParamStore`, which accepts whatever a typed
 * in-process call passes. The asymmetry is deliberate and worth naming: a row
 * is data crossing a trust boundary (hand-edited SQL, a restored backup, a
 * future governed write), whereas `setOverride` is a compile-checked call. A
 * stored `qualityMin: -1` is not a preference, it is a disabled gate.
 */
const APPLIERS: Record<string, { schema: z.ZodTypeAny; apply: (override: PolicyParamsOverride, value: unknown) => void }> = {
  "aqv.windowDays": {
    schema: positiveInt,
    apply: (override, value) => {
      override.aqv = { ...override.aqv, windowDays: value as number };
    },
  },
  "variance.delta": {
    // A nudge step of 0 would make the Variance Adjuster a no-op; >1 is
    // meaningless for a [0,1] knob.
    schema: z.number().gt(0).max(1),
    apply: (override, value) => {
      override.variance = { ...override.variance, delta: value as number };
    },
  },
};

const GATE_KEYS = {
  "aqv.gates.qualityMin": "qualityMin",
  "aqv.gates.routePMin": "routePMin",
  "aqv.gates.routeRMin": "routeRMin",
  "aqv.gates.correctionMax": "correctionMax",
  "aqv.gates.ci": "ci",
} as const;

for (const [key, gate] of Object.entries(GATE_KEYS)) {
  APPLIERS[key] = {
    schema: rate,
    apply: (override, value) => {
      override.aqv = { ...override.aqv, gates: { ...override.aqv?.gates, [gate]: value as number } };
    },
  };
}

APPLIERS["aqv.gates.minCases"] = {
  schema: positiveInt,
  apply: (override, value) => {
    override.aqv = { ...override.aqv, gates: { ...override.aqv?.gates, minCases: value as number } };
  },
};

/** `variance.params.<name>` — a tunable knob. Partial is allowed (the port's
 *  merge keeps default bounds when only `value` is given), but a stored pair of
 *  bounds must be orderable or the clamp becomes nonsense. */
const tunableSchema = z
  .object({
    value: z.number().finite().optional(),
    floor: z.number().finite().optional(),
    ceil: z.number().finite().optional(),
  })
  .strict()
  .refine(
    (param) => param.floor === undefined || param.ceil === undefined || param.floor <= param.ceil,
    { message: "floor must be <= ceil" },
  );

const TUNABLE_PREFIX = "variance.params.";

export class DrizzlePolicyParamStore implements PolicyParamStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async get(organizationId: string): Promise<PolicyParams> {
    const rows = await withOrganizationOnly(this.#db, organizationId, (tx) =>
      tx
        .select({ paramKey: policyParams.paramKey, value: policyParams.value })
        .from(policyParams)
        .where(and(eq(policyParams.organizationId, organizationId), isNull(policyParams.policyId))),
    );
    // No stored rows => DEFAULT_POLICY_PARAMS, exactly like the in-memory
    // adapter. Absence of an override is not an error.
    if (rows.length === 0) return mergePolicyParams(undefined);

    const override: PolicyParamsOverride = {};
    for (const row of rows) {
      if (row.paramKey.startsWith(TUNABLE_PREFIX)) {
        const name = row.paramKey.slice(TUNABLE_PREFIX.length);
        if (name.length === 0) {
          throw new Error(`policy_params: "${row.paramKey}" names no tunable parameter`);
        }
        const parsed = parse(tunableSchema, row.value, row.paramKey);
        const variance = override.variance ?? {};
        override.variance = {
          ...variance,
          params: { ...(variance.params ?? {}), [name]: parsed as Partial<TunableParam> },
        };
        continue;
      }
      const applier = APPLIERS[row.paramKey];
      if (!applier) {
        // Fail loud. A typo'd key that quietly does nothing is a governance
        // control that reports as applied while having no effect.
        throw new Error(
          `policy_params: unknown param_key "${row.paramKey}" for organization ${organizationId} — known keys: ${Object.keys(APPLIERS).sort().join(", ")}, or "${TUNABLE_PREFIX}<name>"`,
        );
      }
      applier.apply(override, parse(applier.schema, row.value, row.paramKey));
    }
    return mergePolicyParams(override);
  }
}

function parse(schema: z.ZodTypeAny, value: unknown, paramKey: string): unknown {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`policy_params.value is invalid for param_key "${paramKey}": ${result.error.message}`);
  }
  return result.data;
}
