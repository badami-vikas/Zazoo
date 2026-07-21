import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_MODULES, requireBuiltInModule } from "../src/index.js";

test("built-in Module catalog has one manifest per Module name", () => {
  const names = BUILT_IN_MODULES.map(({ manifest }) => manifest.name);
  assert.deepEqual(names, ["deal-pilot", "job-pilot", "relationship"]);
  assert.equal(new Set(names).size, names.length);
});

test("every built-in Module route is declared by its manifest", () => {
  for (const { manifest } of BUILT_IN_MODULES) {
    assert.ok(manifest.module);
    assert.ok(manifest.module.route.startsWith("/"));
    for (const page of manifest.module.pages) {
      assert.ok(page.route.startsWith(`${manifest.module.route.split("/").slice(0, -1).join("/")}/`));
    }
    assert.equal(requireBuiltInModule(manifest.name).manifest, manifest);
  }
});
