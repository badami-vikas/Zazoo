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
    "action.decide",
    "chat.model.status",
    "chat.thread.create",
    "chat.thread.list",
    "chat.thread.get",
    "chat.thread.archive",
    "chat.thread.delete",
    "chat.turn.prepareCloud",
    "chat.turn.send",
    "chat.turn.retry",
    "chat.turn.cancel",
    "modules.list",
    "organization.activateSession",
    "organization.list",
    // AP-082 / ADR-140 — Cloud-Plane (Supabase) module surfaces now served in cloud.
    "taskManager.list",
    "taskManager.get",
    "taskManager.create",
    "taskManager.transition",
    "taskManager.decideProposal",
    "relationship.listPeople",
    "relationship.createPerson",
    "relationship.updatePerson",
    "relationship.listCommunities",
    "relationship.createCommunity",
    "relationship.updateCommunity",
    "relationship.listSignals",
    "relationship.recordSignalAction",
    "jobpilot.list",
    "jobpilot.definition",
    "jobpilot.create",
    "jobpilot.transition",
    // AP-083 / ADR-151 — DealPilot Cloud-Plane record half (Drizzle).
    "dealpilot.module",
    "dealpilot.records",
    "dealpilot.detail",
    "dealpilot.createDeal",
    "dealpilot.createSource",
    "dealpilot.createThesis",
    "dealpilot.updateDeal",
    "dealpilot.updateSource",
    // AP-085 / ADR-153 — Second Brain full-Graph preset; graphStore + moduleStore only.
    "graph.full",
  ]) {
    assert.equal(isPublicCloudProcedureAllowed(path), true);
  }
  for (const path of [
    "action.listHistory",
    "chat.model.install",
    "chat.model.cancelInstall",
    "chat.model.start",
    "chat.model.stop",
    // DealPilot capture/credential surfaces stay closed — raw capture + Source
    // credentials stay on the Local Plane (Phase E, not yet shipped).
    "dealpilot.list",
    "dealpilot.captures",
    "dealpilot.commit",
    "dealpilot.discoverDeals",
    "modules.files",
    "modules.addFile",
    "relationship.helpdesk.publicCreate",
    // AP-085 — the Second Brain node Action proposes with dataScope "private";
    // opening `graph.full` must NOT drag it along.
    "relationship.proposeSignalAction",
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

test("public-cloud API allows only Supabase-backed shell and public Chat procedures", async () => {
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
        const chat = await caller.chat.thread.create({
          organizationId: PILOT_ORGANIZATION,
          clientRequestId: "public-cloud-default",
        });
        assert.equal(chat.thread.plane, "cloud");
        assert.equal(chat.thread.dataScope, "public");
        assert.equal(
          (await caller.chat.thread.list({
            organizationId: PILOT_ORGANIZATION,
            status: "active",
          })).items.some((thread) => thread.id === chat.thread.id),
          true,
        );
        await assert.rejects(
          caller.chat.thread.create({
            organizationId: PILOT_ORGANIZATION,
            plane: "local",
            clientRequestId: "forbidden-local-thread",
          }),
          /cannot create Local Plane Chat threads/,
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

        // AP-082 / ADR-140 — a Cloud-Plane module read now passes the boundary
        // (empty result is fine); DealPilot below still fails closed.
        assert.ok(
          Array.isArray(
            await caller.taskManager.list({ organizationId: PILOT_ORGANIZATION }),
          ),
        );

        // AP-083 / ADR-151 — DealPilot record reads now pass the boundary. In this
        // in-memory public-cloud harness there is no DATABASE_URL, so the composite
        // is not wired and the Local record store answers with an empty page.
        assert.ok(
          Array.isArray(
            (
              await caller.dealpilot.records({
                organizationId: PILOT_ORGANIZATION,
                page: "sources",
                limit: 50,
                offset: 0,
              })
            ).items,
          ),
        );
        // AP-085 / ADR-153 — the Second Brain full-Graph preset now passes the
        // boundary (graphStore + moduleStore only). Its own Module/Agent nodes are
        // composed from `modules.list`, so a non-empty graph proves the read
        // reached the Cloud-Plane stores rather than being refused at the gate.
        const fullGraph = await caller.graph.full({
          organizationId: PILOT_ORGANIZATION,
          limit: 100,
        });
        assert.ok(Array.isArray(fullGraph.nodes));
        assert.ok(
          fullGraph.nodes.some((node) => node.recordType === "module"),
          "full graph should carry the installed-Module nodes it composes",
        );

        // ...but the Graph's node Action still fails closed: it proposes with
        // dataScope "private", which the public shell does not serve.
        await assert.rejects(
          caller.relationship.proposeSignalAction({
            organizationId: PILOT_ORGANIZATION,
            signalId: "00000000-0000-4000-8000-000000000000",
          }),
          /desktop Local Plane/,
        );

        // Captures (raw bodies) stay refused in public cloud.
        await assert.rejects(
          caller.dealpilot.captures({
            organizationId: PILOT_ORGANIZATION,
            sourceId: "00000000-0000-4000-8000-000000000000",
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
