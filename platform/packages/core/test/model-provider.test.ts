import { test } from "node:test";
import assert from "node:assert/strict";
import { EchoModelProvider, type ModelProvider } from "../src/index.js";

test("EchoModelProvider echoes system+prompt and defaults to local plane", async () => {
  const p: ModelProvider = new EchoModelProvider();
  assert.equal(p.plane, "local");
  const out = await p.complete({ system: "sys", prompt: "hello" });
  assert.equal(out.text, "sys\nhello");
});

test("EchoModelProvider omits system cleanly", async () => {
  const p = new EchoModelProvider();
  const out = await p.complete({ prompt: "hi" });
  assert.equal(out.text, "hi");
});

test("EchoModelProvider can simulate a cloud-plane provider", async () => {
  const p = new EchoModelProvider("cloud-echo", "cloud");
  assert.equal(p.plane, "cloud");
  assert.equal(p.id, "cloud-echo");
});

test("EchoModelProvider.embed is deterministic for the same input", async () => {
  const p = new EchoModelProvider();
  const a = await p.embed!(["hello", "world"]);
  const b = await p.embed!(["hello", "world"]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.length, 8);
});
