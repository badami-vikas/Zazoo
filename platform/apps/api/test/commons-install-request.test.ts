/**
 * "install dealpilot" means install the one in Commons — not design a new one.
 *
 * The matcher is deliberately narrow: a false positive installs software the
 * person did not ask for, so both an install verb and the catalog entry's own
 * name have to be present. Everything vaguer stays a design conversation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { commonsInstallRequest } from "../src/builder/run.js";

const CATALOG = [
  { name: "deal-pilot" },
  { name: "d2c" },
  { name: "d2c-research" },
  { name: "academics" },
];

test("the reported sentence installs the Module that exists", () => {
  assert.equal(commonsInstallRequest("install dealpilot", CATALOG), "deal-pilot");
});

test("the name is recognised however it is spaced or hyphenated", () => {
  for (const written of ["deal-pilot", "deal pilot", "dealpilot", "DealPilot"]) {
    assert.equal(
      commonsInstallRequest(`can you add ${written} please`, CATALOG),
      "deal-pilot",
      written,
    );
  }
});

test("a longer name wins over the shorter one it contains", () => {
  // "d2c" is a prefix of "d2c-research"; installing the wrong one is worse
  // than installing nothing.
  assert.equal(commonsInstallRequest("install d2c-research", CATALOG), "d2c-research");
  assert.equal(commonsInstallRequest("install d2c", CATALOG), "d2c");
});

test("describing a need is not an install instruction", () => {
  // No name: this is the design conversation the Builder agent owns.
  assert.equal(commonsInstallRequest("install something for tracking deals", CATALOG), null);
  // No verb: talking about a Module is not asking for it.
  assert.equal(commonsInstallRequest("what does deal-pilot do?", CATALOG), null);
});

test("a name that only appears inside another word does not count", () => {
  assert.equal(commonsInstallRequest("install academicsystems", CATALOG), null);
});

test("an empty catalog matches nothing", () => {
  assert.equal(commonsInstallRequest("install deal-pilot", []), null);
});
