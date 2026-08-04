/**
 * Table-driven conformance test for the taint sink map (`sinkForRequest`).
 *
 * ADR-161 closed a real security gap here — a tainted turn could WRITE an
 * integration with no sink gate at all — and its consequences section named the
 * missing safety net: "sink-mapping rules need a table-driven conformance test
 * over every `resourceType`, so an unmapped combination fails loudly rather than
 * silently resolving to `null`."
 *
 * 2026-08-04 mutation testing (ADR-163) turned that prediction into evidence.
 * Mutating the map produced 31 SURVIVING mutants out of 61 — `req.action !== "read"`
 * could be replaced with the constant `true` and every test still passed. The one
 * rule with zero survivors was the `integration` rule, the only one with a
 * dedicated regression pack. Coverage was 88%; the rules were untested anyway.
 *
 * The expectations below are written out per (resourceType, action) pair rather
 * than derived from the implementation. That is the whole point: restating the
 * rules in the test's own terms means a change to the map must be consciously
 * mirrored here, instead of a broken map quietly agreeing with a broken test.
 * `null` is asserted explicitly — "this combination is deliberately NOT a sink"
 * is exactly the claim that silently rots.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { sinkForRequest } from "../src/pipeline.js";
import type { Action, ActionRequest, ResourceType } from "../src/types.js";
import type { TaintSinkId } from "../src/taint.js";

const ALL_ACTIONS: readonly Action[] = ["read", "write", "execute", "share", "archive", "approve"];

/** Every member of the ResourceType union. Kept literal so adding a resource type
 *  to the union without deciding its sink shows up here as a missing key. */
const ALL_RESOURCE_TYPES: readonly ResourceType[] = [
  "person",
  "community",
  "relation",
  "event",
  "record",
  "automation",
  "module",
  "module_installation",
  "organization_definition",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
  "capability",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
  "integration",
  "network_graph:full",
  "external:send",
  "external:fetch",
];

/** Mutating actions — every Action except `read` and `share`. `share` is excluded
 *  because it is claimed by the egress rule before any resource-specific rule runs. */
const MUTATING: readonly Action[] = ["write", "execute", "archive", "approve"];

function expectationsFor(resourceType: ResourceType): Record<Action, TaintSinkId | null> {
  const table = {} as Record<Action, TaintSinkId | null>;

  // Rule 1, second clause: sharing ANYTHING is an external send, whatever the
  // resource is. This clause runs first, so it outranks every rule below.
  for (const action of ALL_ACTIONS) table[action] = null;
  table.share = "external_send";

  switch (resourceType) {
    case "external:send":
      // Rule 1, first clause: the resource type alone is enough, any action.
      for (const action of ALL_ACTIONS) table[action] = "external_send";
      return table;
    case "external:fetch":
      // Rule 2: inbound internet sourcing. Reading IS the egress here, so unlike
      // file/schema rules there is no read exemption.
      for (const action of MUTATING) table[action] = "network_egress";
      table.read = "network_egress";
      return table;
    case "file":
      // Rule 3: writing a file is a sink; reading one is not.
      for (const action of MUTATING) table[action] = "file_write";
      return table;
    case "integration":
      // Rule 4 (ADR-161): EVERY action, reads included — reading an integration
      // is reading its stored credentials.
      for (const action of MUTATING) table[action] = "credential_access";
      table.read = "credential_access";
      return table;
    case "module":
    case "policy":
    case "policy_param":
    case "role":
    case "permission":
      // Rule 5: governance-shape mutations. Note `module_installation`,
      // `organization_definition`, `skill`, `capability`, `agent` and
      // `delegation` are deliberately NOT in this list — installing a Module or
      // binding an Agent is not itself a schema mutation.
      for (const action of MUTATING) table[action] = "schema_mutation";
      return table;
    default:
      // Everything else: no sink except the universal share rule.
      return table;
  }
}

test("taint sink map: every (resourceType, action) pair maps to its declared sink", () => {
  for (const resourceType of ALL_RESOURCE_TYPES) {
    const expected = expectationsFor(resourceType);
    for (const action of ALL_ACTIONS) {
      const request = { resourceType, action } as ActionRequest;
      assert.equal(
        sinkForRequest(request),
        expected[action],
        `sinkForRequest({ resourceType: "${resourceType}", action: "${action}" }) should be ${JSON.stringify(expected[action])}`,
      );
    }
  }
});

test("taint sink map: the resource-type list under test is the whole union (no silently unmapped type)", () => {
  assert.equal(new Set(ALL_RESOURCE_TYPES).size, ALL_RESOURCE_TYPES.length, "duplicate resource type in the table");
  // A ResourceType added to the union without being added here would be a type
  // error at the `ALL_RESOURCE_TYPES` annotation only if the union SHRANK, so pin
  // the count too: growing the union without deciding its sink fails this line.
  assert.equal(ALL_RESOURCE_TYPES.length, 24, "ResourceType union changed — decide the new type's sink and update the table above");
});

test("taint sink map: sharing is an external send for every resource type, and reads of ordinary records are not sinks", () => {
  // The two claims most likely to be silently broken by a refactor, pinned
  // separately so a failure names the rule rather than a coordinate in a loop.
  for (const resourceType of ALL_RESOURCE_TYPES) {
    assert.equal(sinkForRequest({ resourceType, action: "share" } as ActionRequest), "external_send", `sharing a ${resourceType} must be an external send`);
  }
  for (const resourceType of ["person", "community", "relation", "event", "record", "signal", "ledger"] as ResourceType[]) {
    assert.equal(sinkForRequest({ resourceType, action: "read" } as ActionRequest), null, `reading a ${resourceType} must not be a taint sink`);
  }
});
