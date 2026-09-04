/**
 * The public-cloud boundary is a DENY-list (AP-182). The allowlist era produced
 * AP-082 ("most of the modules are broken") and AP-085 ("2nd brain is not
 * loading") — the same silent omission twice in one day. Now an unlisted
 * procedure is served; what this test guards is that the closures carrying a
 * residency reason are present by name and that the runtime gate agrees with
 * the classifier for every procedure the router exposes.
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
  // agreement test below would vacuously pass and the gate would be silently dead.
  assert.ok(paths.length > 100, `expected a populated router, saw ${paths.length}`);
});

test("classification is total and the runtime gate agrees with it", () => {
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
    assert.equal(
      isPublicCloudProcedureAllowed(path),
      false,
      `${path} is closed by classification yet the runtime gate would serve it`,
    );
    assert.ok(verdict.reason.length > 0, `${path} is closed without a stated reason`);
  }
});

test("a closed namespace stays closed for new siblings; an unlisted namespace is served", () => {
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
    "allowed",
    "the boundary is a deny-list: an unlisted namespace is served, a closed one is not",
  );
});

test("the residency-critical closures are present by name", () => {
  for (const path of [
    "capture.anything",
    "modelProviderKey.set",
    "chat.voice.transcribe",
    "dealpilot.accessCredential",
    "whatsapp.send",
    "integration.connect",
    "google.oauth.start",
    "learning.capture.browser.visit",
  ]) {
    assert.equal(
      isPublicCloudProcedureAllowed(path),
      false,
      `${path} accepts raw capture or credentials and must never be served from the public cloud`,
    );
  }
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
