/**
 * Sub-module navigation (ADR-178).
 *
 * The invariant every test here defends is the same one: a Module that is
 * installed is a Module the user can SEE. Hierarchy is presentation, and no
 * presentation rule may cause a surface to vanish — that is the AP-082/AP-085
 * failure class, where a Module went missing and the user found out first.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { BUILT_IN_MODULES, buildModuleNavTree, requireBuiltInModule } from "../src/index.js";

type Nav = { moduleName: string; parentModule?: string | undefined };

const names = (mods: Nav[]) => mods.map((m) => m.moduleName);

test("a Module with no parent is a nav root", () => {
  const tree = buildModuleNavTree([{ moduleName: "a" }, { moduleName: "b" }]);
  assert.deepEqual(
    tree.map((node) => node.module.moduleName),
    ["a", "b"],
  );
  assert.deepEqual(tree.map((node) => node.children.length), [0, 0]);
});

test("a Module nests under the parent it declares, in input order", () => {
  const tree = buildModuleNavTree([
    { moduleName: "network" },
    { moduleName: "whatsapp", parentModule: "network" },
    { moduleName: "gmail", parentModule: "network" },
    { moduleName: "tasks" },
  ]);
  assert.deepEqual(tree.map((node) => node.module.moduleName), ["network", "tasks"]);
  assert.deepEqual(names(tree[0]!.children), ["whatsapp", "gmail"]);
});

test("a child declared BEFORE its parent still nests", () => {
  // Install order is not authoring order — modules.list ordering must not
  // decide whether the hierarchy renders.
  const tree = buildModuleNavTree([
    { moduleName: "whatsapp", parentModule: "network" },
    { moduleName: "network" },
  ]);
  assert.deepEqual(tree.map((node) => node.module.moduleName), ["network"]);
  assert.deepEqual(names(tree[0]!.children), ["whatsapp"]);
});

test("a Module whose parent is NOT installed renders at root, never hidden", () => {
  const tree = buildModuleNavTree([{ moduleName: "whatsapp", parentModule: "network" }]);
  assert.deepEqual(tree.map((node) => node.module.moduleName), ["whatsapp"]);
});

test("nesting is capped at one level — a grandchild re-attaches to the root", () => {
  const tree = buildModuleNavTree([
    { moduleName: "network" },
    { moduleName: "whatsapp", parentModule: "network" },
    { moduleName: "whatsapp-groups", parentModule: "whatsapp" },
  ]);
  assert.equal(tree.length, 1);
  assert.deepEqual(names(tree[0]!.children), ["whatsapp", "whatsapp-groups"]);
});

test("a parent cycle terminates and both Modules stay visible", () => {
  const tree = buildModuleNavTree([
    { moduleName: "a", parentModule: "b" },
    { moduleName: "b", parentModule: "a" },
  ]);
  const visible = tree.flatMap((node) => [node.module.moduleName, ...names(node.children)]);
  assert.deepEqual(visible.sort(), ["a", "b"]);
});

test("every installed Module appears exactly once in the tree", () => {
  // The property that actually matters, asserted over the real catalog rather
  // than a hand-built fixture: grouping is a re-arrangement, never a filter.
  const input: Nav[] = BUILT_IN_MODULES.map(({ manifest }) => ({
    moduleName: manifest.name,
    parentModule: manifest.module?.parentModule,
  }));
  const tree = buildModuleNavTree(input);
  const rendered = tree.flatMap((node) => [node.module.moduleName, ...names(node.children)]);
  assert.equal(rendered.length, input.length);
  assert.deepEqual(new Set(rendered), new Set(names(input)));
});

test("WhatsApp is a sub-module of NetworkManager and the parent is a nav root", () => {
  const whatsapp = requireBuiltInModule("whatsapp").manifest;
  assert.equal(whatsapp.module?.parentModule, "relationship");
  // One level: the declared parent must not itself be a sub-module.
  const parent = requireBuiltInModule(whatsapp.module!.parentModule!).manifest;
  assert.equal(parent.module?.parentModule, undefined);
  assert.equal(parent.module?.displayName, "NetworkManager");
});

test("every declared parent in the catalog resolves to an installed Module", () => {
  const catalogNames = new Set(BUILT_IN_MODULES.map(({ manifest }) => manifest.name));
  for (const { manifest } of BUILT_IN_MODULES) {
    const parent = manifest.module?.parentModule;
    if (parent === undefined) continue;
    assert.ok(
      catalogNames.has(parent),
      `${manifest.name} declares parent "${parent}", which is not a built-in Module`,
    );
    assert.notEqual(parent, manifest.name, `${manifest.name} declares itself as its parent`);
  }
});
