import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyBuilderPrimitiveRisk,
  checkGrantScope,
  checkCommandAllowed,
  runShellExecute,
  type BuilderPrimitiveGrant,
  type BuilderPrimitiveRequest,
} from "../src/capability/builder-primitives.js";
import {
  NotImplementedContainerSandboxProvider,
  type SandboxProvider,
} from "../src/capability/sandbox-provider.js";
// InProcessJsSandboxProvider lives at ../src/server.ts (TASK-017 D3) — see
// sandbox-provider.test.ts's import comment for why.
import { InProcessJsSandboxProvider } from "../src/server.js";

function test_fixture_grant(overrides: Partial<BuilderPrimitiveGrant> = {}): BuilderPrimitiveGrant {
  return {
    organizationId: "test_fixture_organization_1",
    token: "file:read",
    pathPatterns: ["src/**/*.ts"],
    expiresAtISO: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("classifyBuilderPrimitiveRisk: file Skills are operational, not sandbox-mandatory", () => {
  for (const token of ["file:read", "file:write", "file:edit"] as const) {
    const c = classifyBuilderPrimitiveRisk(token);
    assert.equal(c.riskBand, "operational");
    assert.equal(c.sandboxMandatory, false);
  }
});

test("classifyBuilderPrimitiveRisk: shell:execute is operational AND sandbox-mandatory", () => {
  const c = classifyBuilderPrimitiveRisk("shell:execute");
  assert.equal(c.riskBand, "operational");
  assert.equal(c.sandboxMandatory, true);
});

test("checkGrantScope: denies an expired grant", () => {
  const grant = test_fixture_grant({ expiresAtISO: "2020-01-01T00:00:00.000Z" });
  const result = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_1",
    path: "src/index.ts",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "grant_expired");
});

test("checkGrantScope: denies a organization mismatch", () => {
  const grant = test_fixture_grant({ organizationId: "test_fixture_organization_A" });
  const result = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_B",
    path: "src/index.ts",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "organization_mismatch");
});

test("checkGrantScope: an empty pathPatterns array matches nothing (deny-by-default)", () => {
  const grant = test_fixture_grant({ pathPatterns: [] });
  const result = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_1",
    path: "src/index.ts",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "path_not_permitted");
});

test("checkGrantScope: denies a path outside the granted glob", () => {
  const grant = test_fixture_grant({ pathPatterns: ["src/**/*.ts"] });
  const result = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_1",
    path: "secrets/credentials.json",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "path_not_permitted");
});

test("checkGrantScope: allows a path matching a double-star glob", () => {
  const grant = test_fixture_grant({ pathPatterns: ["src/**/*.ts"] });
  const result = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_1",
    path: "src/capability/nested/deep/file.ts",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(result.allowed, true);
});

test("checkGrantScope: allows a path matching a single-star glob within one segment", () => {
  const grant = test_fixture_grant({ pathPatterns: ["src/*.ts"] });
  const result = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_1",
    path: "src/index.ts",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(result.allowed, true);

  const nested = checkGrantScope(grant, {
    organizationId: "test_fixture_organization_1",
    path: "src/nested/index.ts",
    nowISO: "2026-07-06T00:00:00.000Z",
  });
  assert.equal(nested.allowed, false);
});

test("checkCommandAllowed: no allow-list means any command passes", () => {
  const grant = test_fixture_grant({ token: "shell:execute", pathPatterns: ["**"] });
  const result = checkCommandAllowed(grant, "rm");
  assert.equal(result.allowed, true);
});

test("checkCommandAllowed: an allow-list restricts to exact command names", () => {
  const grant = test_fixture_grant({
    token: "shell:execute",
    pathPatterns: ["**"],
    allowedCommands: ["ls", "cat"],
  });
  assert.equal(checkCommandAllowed(grant, "ls").allowed, true);
  const denied = checkCommandAllowed(grant, "rm");
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "command_not_permitted");
});

test("runShellExecute: shell:execute cannot be satisfied by the in-process-js sandbox provider", async () => {
  const provider: SandboxProvider = new InProcessJsSandboxProvider();
  const req: Extract<BuilderPrimitiveRequest, { token: "shell:execute" }> = {
    token: "shell:execute",
    organizationId: "test_fixture_organization_1",
    command: "echo",
    args: ["hi"],
    timeoutMs: 500,
  };
  const result = await runShellExecute(provider, req);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "sandbox_isolation_insufficient");
  }
});

test("runShellExecute: a not-implemented container provider surfaces as a denial, never a silent success", async () => {
  const provider: SandboxProvider = new NotImplementedContainerSandboxProvider();
  const req: Extract<BuilderPrimitiveRequest, { token: "shell:execute" }> = {
    token: "shell:execute",
    organizationId: "test_fixture_organization_1",
    command: "echo",
    timeoutMs: 500,
  };
  await assert.rejects(() => runShellExecute(provider, req), /requires a real/i);
});
