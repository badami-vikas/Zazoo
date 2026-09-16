import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABSOLUTE_DENY,
  commandSegments,
  decideBuilderPrimitive,
  pathEscapesWorkingDirectory,
  type ModulePrimitivePolicy,
} from "../src/capability/primitive-policy.js";
import { createChatBackendRegistry, isChatBackendId } from "../src/chat-backend.js";

const OPEN: ModulePrimitivePolicy = {};

test("execution-first: an ordinary command runs with no policy declared", () => {
  const decision = decideBuilderPrimitive(
    { token: "shell:execute", command: "pnpm test" },
    OPEN,
  );
  assert.equal(decision.outcome, "execute");
});

test("execution-first: reads and writes inside the working directory just run", () => {
  assert.equal(
    decideBuilderPrimitive({ token: "file:read", path: "src/index.ts" }, OPEN).outcome,
    "execute",
  );
  assert.equal(
    decideBuilderPrimitive({ token: "file:write", path: "src/new.ts" }, OPEN).outcome,
    "execute",
  );
});

test("an empty policy is not a default-deny (ADR-263)", () => {
  for (const command of ["ls", "node build.js", "git commit -m wip"]) {
    assert.equal(
      decideBuilderPrimitive({ token: "shell:execute", command }, OPEN).outcome,
      "execute",
      command,
    );
  }
});

test("the absolute deny list refuses, and no Module allow list can unlock it", () => {
  const permissive: ModulePrimitivePolicy = { allow: ["*"] };
  for (const command of ["git push origin main", "sudo rm x", "rm -rf /"]) {
    const decision = decideBuilderPrimitive({ token: "shell:execute", command }, permissive);
    assert.equal(decision.outcome, "refuse", command);
  }
});

test("a denied command cannot hide behind a chained separator", () => {
  const decision = decideBuilderPrimitive(
    { token: "shell:execute", command: "pnpm test && git push origin main" },
    OPEN,
  );
  assert.equal(decision.outcome, "refuse");
  assert.equal(decision.matchedPattern, "git push*");
});

test("commandSegments splits every shell separator it claims to", () => {
  assert.deepEqual(commandSegments("a && b; c | d || e"), ["a", "b", "c", "d", "e"]);
});

test("network and system-state commands need a human even when allowed", () => {
  const decision = decideBuilderPrimitive(
    { token: "shell:execute", command: "curl https://example.com" },
    { allow: ["*"] },
  );
  assert.equal(decision.outcome, "approve");
});

test("a command outside the Module's allow list escalates rather than refusing", () => {
  const decision = decideBuilderPrimitive(
    { token: "shell:execute", command: "node scripts/migrate.js" },
    { allow: ["pnpm *", "git status"] },
  );
  assert.equal(decision.outcome, "approve");
});

test("a write outside the declared paths escalates; inside them it executes", () => {
  const policy: ModulePrimitivePolicy = { writePaths: ["src/**"] };
  assert.equal(
    decideBuilderPrimitive({ token: "file:write", path: "src/a/b.ts" }, policy).outcome,
    "execute",
  );
  assert.equal(
    decideBuilderPrimitive({ token: "file:write", path: "docs/README.md" }, policy).outcome,
    "approve",
  );
});

test("path traversal out of the working directory is refused, not escalated", () => {
  for (const path of ["../secrets.env", "a/../../b", "/etc/passwd"]) {
    assert.equal(pathEscapesWorkingDirectory(path), true, path);
    assert.equal(
      decideBuilderPrimitive({ token: "file:read", path }, OPEN).outcome,
      "refuse",
      path,
    );
  }
  assert.equal(pathEscapesWorkingDirectory("a/../b"), false);
});

test("every decision carries a reason", () => {
  const decisions = [
    decideBuilderPrimitive({ token: "shell:execute", command: "ls" }, OPEN),
    decideBuilderPrimitive({ token: "shell:execute", command: "git push" }, OPEN),
    decideBuilderPrimitive({ token: "file:write", path: "../x" }, OPEN),
  ];
  for (const decision of decisions) {
    assert.ok(decision.reason.length > 0);
  }
});

test("the deny list keeps the merge in the user's hands", () => {
  assert.ok(ABSOLUTE_DENY.includes("git merge*"));
  assert.ok(ABSOLUTE_DENY.includes("git push*"));
});

test("chat backend registry: unknown ids resolve to null, duplicates throw", () => {
  const backend = {
    id: "claude_code" as const,
    label: "Claude Code",
    plane: "cloud" as const,
    agentic: true,
    readiness: async () => ({ ready: true }),
    send: async () => ({ reply: "", backendSessionId: null }),
  };
  const registry = createChatBackendRegistry([backend]);
  assert.equal(registry.get("claude_code"), backend);
  assert.equal(registry.get("bridge"), null);
  assert.equal(registry.list().length, 1);
  assert.throws(() => createChatBackendRegistry([backend, backend]));
  assert.equal(isChatBackendId("claude_code"), true);
  assert.equal(isChatBackendId("nope"), false);
});
