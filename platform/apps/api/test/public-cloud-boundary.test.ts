import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import {
  isPublicCloudProcedureAllowed,
  isPublicCloudScratchPath,
  renderWebOrigin,
} from "../src/deployment-boundary.js";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_ORGANIZATION,
  PILOT_USER,
} from "../src/wiring.js";

function runContext(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(63);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function withPublicCloudEnv<T>(operation: () => Promise<T>): Promise<T> {
  const keys = [
    "BRIDGE_LOCAL_RESIDENCY",
    "BRIDGE_DEALPILOT_CREDENTIAL_VAULT",
    "DATABASE_URL",
  ] as const;
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.BRIDGE_LOCAL_RESIDENCY = "public-cloud";
  process.env.BRIDGE_DEALPILOT_CREDENTIAL_VAULT = "disabled";
  delete process.env.DATABASE_URL;
  try {
    return await operation();
  } finally {
    for (const key of keys) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("public-cloud procedure and Render-origin contracts are narrow", () => {
  for (const path of [
    "health",
    "action.propose",
    "modules.list",
    "organization.activateSession",
    "organization.list",
  ]) {
    assert.equal(isPublicCloudProcedureAllowed(path), true);
  }
  for (const path of [
    "action.listHistory",
    "dealpilot.records",
    "modules.files",
    "relationship.helpdesk.publicCreate",
  ]) {
    assert.equal(isPublicCloudProcedureAllowed(path), false);
  }
  assert.equal(
    renderWebOrigin({ BRIDGE_RENDER_WEB_HOST: "bridge-pilot-web.onrender.com" }),
    "https://bridge-pilot-web.onrender.com",
  );
  assert.throws(
    () => renderWebOrigin({ BRIDGE_RENDER_WEB_HOST: "https://invalid.example" }),
    /bare HTTPS hostname/,
  );
  assert.equal(isPublicCloudScratchPath("/tmp/bridge-public-only/local"), true);
  assert.equal(isPublicCloudScratchPath("/var/lib/bridge/local"), false);
  assert.equal(
    isPublicCloudScratchPath(
      "/tmp/bridge-public-only/../../var/lib/bridge",
    ),
    false,
  );
});

test("public-cloud API allows only Supabase-backed shell procedures", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-public-cloud-"));
  try {
    await withPublicCloudEnv(async () => {
      const wiring = await buildWiring({
        localDir: join(root, "local"),
        moduleFilesBridgeRoot: join(root, "files"),
      });
      try {
        assert.equal(wiring.publicCloudOnly, true);
        const caller = appRouter.createCaller({
          wiring,
          run: runContext(),
          identity: { type: "user", id: PILOT_USER },
          authenticated: true,
          verifying: false,
        });
        await caller.organization.activateSession();
        assert.equal((await caller.organization.list()).length, 1);
        const modules = await caller.modules.list({
          organizationId: PILOT_ORGANIZATION,
          limit: 50,
          offset: 0,
        });
        assert.ok(modules.total > 0);
        assert.equal(
          modules.items.every(
            (item) =>
              item.state === "available" &&
              item.status === "installed" &&
              item.moduleAttachment === undefined,
          ),
          true,
        );
        await assert.rejects(
          caller.action.propose({
            organizationId: PILOT_ORGANIZATION,
            actor: { type: "user", id: PILOT_USER },
            action: "write",
            resourceType: "module",
            inputs: { kind: "public_cloud_probe" },
            skill: "stageMutation",
          }),
          /explicit public data scope/,
        );
        const publicProposal = await caller.action.propose({
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "module",
          inputs: { kind: "public_cloud_probe" },
          skill: "stageMutation",
          dataScope: "public",
        });
        assert.equal(publicProposal.status, "applied");

        await assert.rejects(
          caller.dealpilot.records({
            organizationId: PILOT_ORGANIZATION,
            page: "sources",
            limit: 50,
            offset: 0,
          }),
          (error: unknown) =>
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "PRECONDITION_FAILED",
        );
        await assert.rejects(
          caller.modules.files({
            organizationId: PILOT_ORGANIZATION,
            moduleName: "deal-pilot",
          }),
          /desktop Local Plane/,
        );
        await assert.rejects(
          wiring.dealpilot.credentialVault.put(
            {
              organizationId: PILOT_ORGANIZATION,
              sourceId: "00000000-0000-4000-8000-000000000000",
            },
            {},
          ),
          /desktop Local Plane/,
        );
      } finally {
        await wiring.close();
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
