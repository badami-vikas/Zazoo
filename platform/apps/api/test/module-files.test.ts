import assert from "node:assert/strict";
import test from "node:test";
import { dirname, isAbsolute, relative } from "node:path";

import { moduleFilesRoot, safePathSegment } from "../src/module-files.js";

test("module file roots encode path-special dot segments", () => {
  assert.equal(safePathSegment("."), "-");
  assert.equal(safePathSegment(".."), "--");

  const organizationRoot = moduleFilesRoot("Acme", ".");
  const traversalRoot = moduleFilesRoot("Acme", "..");
  const baseRoot = dirname(moduleFilesRoot("Acme", "Modules"));
  const moduleBase = relative(baseRoot, organizationRoot);
  const traversalBase = relative(baseRoot, traversalRoot);

  assert.equal(isAbsolute(moduleBase), false);
  assert.equal(isAbsolute(traversalBase), false);
  assert.equal(moduleBase.startsWith(".."), false);
  assert.equal(traversalBase.startsWith(".."), false);
});
