import assert from "node:assert/strict";
import test from "node:test";
import { classifyPatShape, maskPat, parseOAuthScopesHeader } from "../src/pat.js";

test("classifyPatShape recognizes classic and fine-grained token shapes", () => {
  assert.equal(classifyPatShape(`ghp_${"a".repeat(36)}`), "classic");
  assert.equal(classifyPatShape(`github_pat_${"a".repeat(22)}`), "fine-grained");
  assert.equal(classifyPatShape("not-a-token"), undefined);
  assert.equal(classifyPatShape(""), undefined);
});

test("maskPat never returns anything but the last 4 characters", () => {
  const pat = `ghp_${"a".repeat(32)}wxyz`;
  const masked = maskPat(pat);
  assert.equal(masked.kind, "classic");
  assert.equal(masked.last4, "wxyz");
  assert.ok(!JSON.stringify(masked).includes(pat.slice(0, -4)));
});

test("maskPat rejects a value that is not a recognized token shape", () => {
  assert.throws(() => maskPat("hunter2"), /not a recognized/);
});

test("parseOAuthScopesHeader splits and trims, and tolerates absence", () => {
  assert.deepEqual(parseOAuthScopesHeader("repo, read:user"), ["repo", "read:user"]);
  assert.deepEqual(parseOAuthScopesHeader(undefined), []);
  assert.deepEqual(parseOAuthScopesHeader(""), []);
});
