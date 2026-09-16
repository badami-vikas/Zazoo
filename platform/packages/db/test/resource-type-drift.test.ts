/**
 * The Automation step validator accepts exactly the kernel's ResourceTypes.
 *
 * On 2026-09-08 the zod enum in `automation-stores.ts` was found five members
 * behind `ResourceType` — `relation`, `module_installation`,
 * `organization_definition`, `capability`, `claim`. It was a hand-written
 * mirror of a compile-time-only union, so nothing could have caught it, and the
 * symptom pointed the wrong way: declaring an Automation step over any of the
 * five failed as `Invalid Automation skill_pipeline jsonb: invalid_enum_value`,
 * which reads like a corrupt database row rather than a list nobody updated.
 * A second mirror in `apps/api/src/router-shared.ts` had drifted too, on a
 * different pair of members.
 *
 * The fix is structural — `RESOURCE_TYPES` is a runtime array in @bridge/core
 * and `ResourceType` is derived from it, so both validators now build FROM the
 * kernel list instead of restating it. These tests exist because that is a
 * convention, not a constraint: nothing stops someone pasting a literal array
 * back in, and the failure would again be silent until an Automation broke.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCE_TYPES, type ResourceType } from "@bridge/core";
import { automationStepDefSchema, parseAutomationSteps } from "../src/automation-stores.js";

test("the step validator's resource types ARE the kernel's, not a copy", () => {
  const accepted = automationStepDefSchema.shape.resourceType.options;
  // deepEqual, not a subset check: a member the kernel dropped must not linger
  // as something an Automation can still be declared over.
  assert.deepEqual([...accepted], [...RESOURCE_TYPES]);
});

test("no ResourceType is listed twice", () => {
  // A duplicate is how a careless merge resolves; zod would accept it silently
  // and the deepEqual above would then be comparing two equally wrong lists.
  assert.equal(new Set(RESOURCE_TYPES).size, RESOURCE_TYPES.length);
});

test("every ResourceType survives a real Automation step round trip", () => {
  // The actual reported failure, one step per member. `parseAutomationSteps`
  // is the only gate this jsonb passes in either direction, so this is the
  // path that broke — not the enum in isolation.
  const steps = RESOURCE_TYPES.map((resourceType) => ({
    skill: "probe",
    action: "read" as const,
    resourceType,
  }));
  assert.deepEqual(parseAutomationSteps(steps), steps);
});

test("the five members that had drifted are specifically accepted", () => {
  // Named rather than left to the loop above, so the regression is legible in
  // the failure output if the list is ever trimmed back.
  const regressed: ResourceType[] = [
    "relation",
    "module_installation",
    "organization_definition",
    "capability",
    "claim",
  ];
  for (const resourceType of regressed) {
    assert.ok(
      RESOURCE_TYPES.includes(resourceType),
      `${resourceType} is missing from RESOURCE_TYPES`,
    );
    assert.doesNotThrow(
      () => parseAutomationSteps([{ skill: "probe", action: "read", resourceType }]),
      `an Automation step over ${resourceType} must be declarable`,
    );
  }
});

test("something that is not a ResourceType is still refused", () => {
  // The guard above must not have been bought by making the enum permissive.
  assert.throws(
    () => parseAutomationSteps([{ skill: "probe", action: "read", resourceType: "sandwich" }]),
    /Invalid Automation skill_pipeline jsonb/,
  );
});
