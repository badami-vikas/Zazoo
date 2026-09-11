import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLocalStateStore } from "@bridge/local";
import { OtpProofStore } from "../src/otp-proof-store.js";

const ORG = "org-1";

test("OTP proof is single-use, expires, and survives a restart over the same state", async () => {
  let now = 1_000_000;
  const state = new InMemoryLocalStateStore();
  const store = new OtpProofStore(state, () => now);

  assert.equal(await store.consume(ORG, "u1"), false, "nothing issued");
  await store.issue(ORG, "u1", 600_000);
  now += 599_999;
  const restarted = new OtpProofStore(state, () => now);
  assert.equal(await restarted.consume(ORG, "u1"), true, "valid after restart");
  assert.equal(await restarted.consume(ORG, "u1"), false, "single-use");

  await store.issue(ORG, "u2", 600_000);
  now += 600_001;
  assert.equal(await store.consume(ORG, "u2"), false, "expired");
  assert.equal(await store.consume(ORG, "u2"), false);
});
