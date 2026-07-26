import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NotImplementedContainerSandboxProvider,
  UnsupportedSandboxRequestError,
  type SandboxProvider,
  type SandboxRunRequest,
} from "../src/capability/sandbox-provider.js";
// InProcessJsSandboxProvider lives at ../src/server.ts (TASK-017 D3) — the one
// Node-dependent (node:vm) adapter, kept out of capability/sandbox-provider.ts
// so that file (reachable from the browser-facing main barrel via
// builder-primitives.ts) never pulls in a Node builtin.
import { InProcessJsSandboxProvider } from "../src/server.js";

function test_fixture_js_eval_request(overrides: Partial<Extract<SandboxRunRequest, { kind: "js-eval" }>> = {}) {
  return {
    kind: "js-eval" as const,
    code: "1 + 1",
    timeoutMs: 500,
    ...overrides,
  };
}

function test_fixture_shell_request(overrides: Partial<Extract<SandboxRunRequest, { kind: "shell" }>> = {}) {
  return {
    kind: "shell" as const,
    command: "echo",
    args: ["hello"],
    timeoutMs: 500,
    ...overrides,
  };
}

test("InProcessJsSandboxProvider: declares isolationTier in-process-js", () => {
  const provider = new InProcessJsSandboxProvider();
  assert.equal(provider.isolationTier, "in-process-js");
});

test("InProcessJsSandboxProvider: evaluates a narrow JS expression and captures output", async () => {
  const provider = new InProcessJsSandboxProvider();
  const result = await provider.run(test_fixture_js_eval_request({ code: "console.log(2 + 2)" }));
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /4/);
});

test("InProcessJsSandboxProvider: has no access to require/process/filesystem", async () => {
  const provider = new InProcessJsSandboxProvider();
  const result = await provider.run(
    test_fixture_js_eval_request({ code: "console.log(typeof require, typeof process, typeof globalThis.fetch)" }),
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /undefined undefined undefined/);
});

test("InProcessJsSandboxProvider: enforces the timeout budget", async () => {
  const provider = new InProcessJsSandboxProvider();
  const result = await provider.run(
    test_fixture_js_eval_request({ code: "while (true) {}", timeoutMs: 50 }),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
});

test("InProcessJsSandboxProvider: refuses a shell-shaped request at runtime (ADR-027 guard)", async () => {
  const provider = new InProcessJsSandboxProvider();
  // Cast through the wider SandboxProvider port type to simulate a caller that
  // erased the narrowed `{ kind: "js-eval" }` parameter type -- this is the
  // exact fallthrough ADR-027 warns about ("never isolated-vm for shell").
  const asPort: SandboxProvider = provider;
  await assert.rejects(
    () => asPort.run(test_fixture_shell_request()),
    UnsupportedSandboxRequestError,
  );
});

test("InProcessJsSandboxProvider: shell:execute cannot be satisfied by the in-process-js adapter (type + runtime)", async () => {
  const provider = new InProcessJsSandboxProvider();
  const asPort: SandboxProvider = provider;
  try {
    await asPort.run(test_fixture_shell_request());
    assert.fail("expected UnsupportedSandboxRequestError to be thrown");
  } catch (err) {
    assert.ok(err instanceof UnsupportedSandboxRequestError);
    assert.equal(err.isolationTier, "in-process-js");
    assert.equal(err.requestKind, "shell");
  }
});

test("NotImplementedContainerSandboxProvider: declares isolationTier container but never actually runs", async () => {
  const provider = new NotImplementedContainerSandboxProvider();
  assert.equal(provider.isolationTier, "container");
  await assert.rejects(() => provider.run(test_fixture_shell_request()), /requires a real/i);
});

test("NotImplementedContainerSandboxProvider: also refuses js-eval (stub refuses everything)", async () => {
  const provider = new NotImplementedContainerSandboxProvider();
  await assert.rejects(() => provider.run(test_fixture_js_eval_request()));
});
