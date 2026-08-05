/**
 * The completeness gate for the public-cloud boundary.
 *
 * Deny-by-default is correct but SILENT: a procedure nobody adds to the allowlist is
 * simply refused in the cloud, and the first person to find out is the user staring at
 * a surface that says "retry". AP-082 ("most of the modules are broken") and AP-085
 * ("2nd brain is not loading") were that same omission twice in one day — the second
 * missed because Second Brain is a nav preset rather than a Module, so reviewing "the
 * list of Modules" could not have caught it.
 *
 * This test removes the silence. Every procedure the router exposes must be classified
 * EXPLICITLY — allowed, or denied with a stated reason. Anything in neither set fails
 * here, by name, before it can reach a user.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPublicCloudProcedure,
  isPublicCloudProcedureAllowed,
  localOnlyPrefixes,
} from "../src/deployment-boundary.js";
import { appRouter } from "../src/router.js";

function allProcedurePaths(): string[] {
  const procedures = (appRouter as unknown as {
    _def: { procedures: Record<string, unknown> };
  })._def.procedures;
  return Object.keys(procedures).sort();
}

test("the router exposes procedures we can actually enumerate", () => {
  const paths = allProcedurePaths();
  // A guard on the guard: if tRPC ever changes shape and this returns nothing, the
  // completeness test below would vacuously pass and the gate would be silently dead.
  assert.ok(paths.length > 100, `expected a populated router, saw ${paths.length}`);
});

test("every procedure is explicitly classified — allowed or denied with a reason", () => {
  const unclassified = allProcedurePaths().filter(
    (path) => classifyPublicCloudProcedure(path).kind === "unclassified",
  );
  assert.deepEqual(
    unclassified,
    [],
    `\n${unclassified.length} procedure(s) are neither allowed in public cloud nor ` +
      `explicitly closed:\n\n  ${unclassified.join("\n  ")}\n\n` +
      `Decide for each one, in apps/api/src/deployment-boundary.ts:\n` +
      `  • serves ONLY Cloud-Plane stores under the caller's identity + RLS?\n` +
      `      → add the exact path to PUBLIC_CLOUD_PROCEDURES\n` +
      `  • touches the Local Plane, credentials, raw capture, or private scope?\n` +
      `      → add a prefix + reason to LOCAL_ONLY_PREFIXES\n\n` +
      `Leaving it unlisted does NOT mean "closed" — it means the next person to find ` +
      `out is the user, looking at a surface that says "retry".\n`,
  );
});

test("classification is total and unambiguous", () => {
  for (const path of allProcedurePaths()) {
    const verdict = classifyPublicCloudProcedure(path);
    if (verdict.kind === "allowed") {
      assert.equal(
        isPublicCloudProcedureAllowed(path),
        true,
        `${path} classified allowed but the runtime gate refuses it`,
      );
      continue;
    }
    if (verdict.kind === "local-only") {
      assert.equal(
        isPublicCloudProcedureAllowed(path),
        false,
        `${path} is closed by classification yet the runtime gate would serve it`,
      );
      assert.ok(verdict.reason.length > 0, `${path} is closed without a stated reason`);
    }
  }
});

test("permission is exact-path only, so it can never be granted by prefix", () => {
  // The asymmetry that keeps this safe: a new procedure dropped into an already-open
  // namespace must still be decided by a human. If allow-by-prefix ever creeps in, a
  // `relationship.deleteEverything` would be served publicly the moment it is written.
  const invented = "relationship.deleteEverythingForever";
  assert.equal(isPublicCloudProcedureAllowed(invented), false);
  assert.equal(
    classifyPublicCloudProcedure(invented).kind,
    "local-only",
    "relationship.* is a closed namespace, so an invented sibling inherits the closure",
  );

  const inventedOpenNamespace = "taskManagerz.somethingNew";
  assert.equal(
    classifyPublicCloudProcedure(inventedOpenNamespace).kind,
    "unclassified",
    "a procedure in an unknown namespace must force an explicit decision",
  );
});

test("every deny reason is real prose, not a placeholder", () => {
  for (const [prefix, reason] of localOnlyPrefixes()) {
    assert.ok(prefix.length > 0, "a deny prefix must not be empty");
    assert.ok(
      reason.length > 12 && /\s/.test(reason),
      `deny reason for "${prefix}" reads like a placeholder: "${reason}"`,
    );
  }
});
