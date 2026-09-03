import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModulePrimitivePolicy } from "@bridge/core";
import { HostPrimitiveExecutor, type PrimitiveAuditEntry } from "../src/builder/primitive-executor.js";

async function fixture(policy: ModulePrimitivePolicy = {}) {
  const root = await mkdtemp(join(tmpdir(), "bridge-primitive-exec-"));
  const audit: PrimitiveAuditEntry[] = [];
  const executor = new HostPrimitiveExecutor({
    workingDirectory: root,
    policy,
    audit: async (entry) => {
      audit.push(entry);
    },
  });
  return { root, audit, executor };
}

test("execution-first: a write lands on disk with no approval round trip", async () => {
  const { root, executor } = await fixture();
  const outcome = await executor.run({
    token: "file:write",
    path: "notes/plan.md",
    content: "hello",
  });
  assert.equal(outcome.status, "ok");
  assert.equal(await readFile(join(root, "notes/plan.md"), "utf8"), "hello");
});

test("a shell command actually runs in the working directory", async () => {
  const { root, executor } = await fixture();
  await writeFile(join(root, "a.txt"), "x");
  const outcome = await executor.run({ token: "shell:execute", command: "ls" });
  assert.equal(outcome.status, "ok");
  assert.match(outcome.status === "ok" ? outcome.output : "", /a\.txt/);
});

test("a failing command reports failure with its exit code, not a throw", async () => {
  const { executor } = await fixture();
  const outcome = await executor.run({ token: "shell:execute", command: "exit 3" });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.status === "failed" ? outcome.output : "", /exit 3/);
});

test("high-risk commands escalate instead of running", async () => {
  const { executor } = await fixture();
  const outcome = await executor.run({
    token: "shell:execute",
    command: "curl https://example.com",
  });
  assert.equal(outcome.status, "needs_approval");
});

test("the absolute deny list is refused and never executes", async () => {
  const { root, executor } = await fixture({ allow: ["*"] });
  await writeFile(join(root, "keep.txt"), "keep");
  const outcome = await executor.run({
    token: "shell:execute",
    command: "rm -rf / && git push origin main",
  });
  assert.equal(outcome.status, "refused");
  assert.equal(await readFile(join(root, "keep.txt"), "utf8"), "keep");
});

test("a path escaping the working directory is refused at both gates", async () => {
  const { executor } = await fixture();
  const outcome = await executor.run({ token: "file:read", path: "../../etc/passwd" });
  assert.equal(outcome.status, "refused");
});

test("every call is audited — executed, escalated and refused alike", async () => {
  const { audit, executor } = await fixture();
  await executor.run({ token: "file:write", path: "a.txt", content: "1" });
  await executor.run({ token: "shell:execute", command: "curl https://example.com" });
  await executor.run({ token: "shell:execute", command: "git push" });
  assert.deepEqual(
    audit.map((entry) => [entry.decision, entry.status]),
    [
      ["execute", "ok"],
      ["approve", "needs_approval"],
      ["refuse", "refused"],
    ],
  );
  // The audit records what was touched, never the content written.
  assert.ok(audit.every((entry) => entry.reason.length > 0));
  assert.ok(!JSON.stringify(audit).includes("\"1\""));
});

test("edit refuses an ambiguous match rather than guessing", async () => {
  const { root, executor } = await fixture();
  await writeFile(join(root, "b.txt"), "x x");
  const ambiguous = await executor.run({
    token: "file:edit",
    path: "b.txt",
    oldString: "x",
    newString: "y",
  });
  assert.equal(ambiguous.status, "failed");
  const explicit = await executor.run({
    token: "file:edit",
    path: "b.txt",
    oldString: "x",
    newString: "y",
    replaceAll: true,
  });
  assert.equal(explicit.status, "ok");
  assert.equal(await readFile(join(root, "b.txt"), "utf8"), "y y");
});

test("the shell env does not carry the API process's secrets", async () => {
  const { executor } = await fixture();
  process.env.BRIDGE_TOOLBELT_SECRET_PROBE = "must-not-leak";
  try {
    const outcome = await executor.run({
      token: "shell:execute",
      command: "echo \"[$BRIDGE_TOOLBELT_SECRET_PROBE]\"",
    });
    assert.equal(outcome.status, "ok");
    assert.match(outcome.status === "ok" ? outcome.output : "", /\[\]/);
  } finally {
    delete process.env.BRIDGE_TOOLBELT_SECRET_PROBE;
  }
});

test("the primitiveExecutor does not masquerade as a sandbox", async () => {
  const { executor } = await fixture();
  assert.equal(executor.isolation, "host-process");
  assert.equal("run" in executor, true);
  // No isolationTier property: a caller shopping for a SandboxProvider cannot
  // accidentally accept this (ADR-027 keeps container/microVM for untrusted
  // capability bodies).
  assert.equal((executor as unknown as Record<string, unknown>).isolationTier, undefined);
});
