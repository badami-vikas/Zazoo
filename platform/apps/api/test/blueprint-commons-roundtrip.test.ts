/**
 * BLUEPRINT-1 (Month-6) — a WorkspaceBlueprint round-trips as a versioned,
 * Commons-publishable manifest through the real apps/api transport seam:
 *   blueprint -> workspaceBlueprintToPackageManifest (kind workspace_definition,
 *   capabilities composed by reference) -> sign -> served over the (mocked)
 *   Commons HTTP contract -> HttpCommonsClient.getVersion VERIFIES the signature
 *   (PKG-2) -> workspaceBlueprintFromPackageManifest re-runs the declarative gate
 *   -> compileBlueprint produces the generated workspace.
 * Also asserts the declarative gate rejects a non-declarative payload at the
 * install boundary. Signing uses node:crypto with the Commons signer's exact
 * conventions (see pkg2-commons-signing.test.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  BlueprintValidationError,
  compileBlueprint,
  parseWorkspaceBlueprint,
  workspaceBlueprintFromPackageManifest,
  workspaceBlueprintToPackageManifest,
  type PackageManifest,
  type WorkspaceBlueprint,
} from "@bridge/core";
import { HttpCommonsClient } from "../src/commons-client.js";
import { signCommonsEntryForTest } from "./commons-fixtures.js";

function makeKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE_BLUEPRINT: WorkspaceBlueprint = {
  vocabulary: { Person: "Contact" },
  entities: [
    {
      nodeType: "person",
      label: "Person",
      fields: [
        { id: "full_name", label: "Full name", kind: "text" },
        { id: "stage", label: "Stage", kind: "select", options: ["new", "active"] },
      ],
    },
  ],
  views: [{ entity: "person", kind: "table" }],
  capabilities: ["cap.people-directory@1.0.0"],
};

test("BLUEPRINT-1: a blueprint round-trips manifest -> transport(verify) -> extract -> compile", async (t) => {
  const keyPair = makeKeyPair();
  const manifest = workspaceBlueprintToPackageManifest(SAMPLE_BLUEPRINT, { name: "test-fixture-people-ws", version: "1.0.0" });

  // A workspace_definition composes capabilities by reference — its own
  // top-level capabilities[] is empty; the payload lives in manifest.blueprint.
  assert.equal(manifest.kind, "workspace_definition");
  assert.equal(manifest.capabilities.length, 0);
  assert.ok(manifest.blueprint);
  assert.equal(manifest.blueprint?.schemaVersion, 1);

  const entry = signCommonsEntryForTest(manifest, keyPair);
  t.mock.method(globalThis, "fetch", async () => jsonResponse(entry));

  const client = new HttpCommonsClient("http://localhost:4780", { trustedPublicKeys: [keyPair.publicKeyPem] });
  const fetched = await client.getVersion("test-fixture-people-ws", "1.0.0");
  assert.ok(fetched, "signed workspace_definition entry passes verify-on-install");

  const extracted = workspaceBlueprintFromPackageManifest(fetched.manifest);
  const compiled = compileBlueprint(extracted, ["person"], ["relationship"]);
  assert.equal(compiled.tableSpecs.length, 1);
  assert.equal(compiled.tableSpecs[0]?.columns.length, 2);
  assert.equal(compiled.viewConfigs.length, 1);
  assert.equal(compiled.viewConfigs[0]?.entity, "person");
  assert.equal(compiled.navigation.length, 1);
});

test("BLUEPRINT-1: the declarative gate rejects a non-declarative payload (smuggled code key)", () => {
  assert.throws(
    () => parseWorkspaceBlueprint({ vocabulary: {}, entities: [], views: [], capabilities: [], handler: "() => {}" }),
    BlueprintValidationError,
  );
});

test("BLUEPRINT-1: extraction re-validates — a non-workspace_definition manifest yields no blueprint", () => {
  const notABlueprint: PackageManifest = {
    name: "test-fixture-plain-tool",
    version: "1.0.0",
    kind: "tool",
    summary: "plain tool",
    description: "plain tool",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
  assert.throws(() => workspaceBlueprintFromPackageManifest(notABlueprint), BlueprintValidationError);
});
