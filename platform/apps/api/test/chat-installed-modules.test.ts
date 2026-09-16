/**
 * Chat is told which Modules the person already has.
 *
 * The bug: asked to "install dealpilot", Chief of Staff offered to design a
 * Deal Manager Module from scratch — while DealPilot was installed and its own
 * Files folder was visible to it. Nothing in the assembled context ever said
 * what existed, so every "add X" read as "invent X".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { chatInstalledModuleSnippets, chatModuleAwareness } from "../src/router-shared.js";
import type { Wiring } from "../src/wiring.js";

function wiringWith(items: unknown[], catalog?: { name: string }[]): Wiring {
  return {
    moduleStore: { list: async () => ({ items, total: items.length, limit: 10_000, offset: 0 }) },
    ...(catalog
      ? {
          commonsRegistry: {
            listAvailable: async () => ({
              items: catalog,
              total: catalog.length,
              limit: 50,
              offset: 0,
            }),
          },
        }
      : {}),
  } as unknown as Wiring;
}

const installed = (moduleName: string, displayName?: string) => ({
  moduleName,
  status: "installed",
  state: "available",
  manifest: displayName ? { module: { displayName } } : {},
});

test("the installed Modules reach the model, under their own display names", async () => {
  const snippets = await chatInstalledModuleSnippets(
    wiringWith([installed("deal-pilot", "DealManager"), installed("task-manager", "Tasks")]),
    "org-1",
  );
  assert.equal(snippets.length, 1);
  // The name the person sees in the rail is the name the model must recognise —
  // being told "deal-pilot" while the user says "DealManager" is the same miss.
  assert.match(snippets[0]!.text, /DealManager/);
  assert.match(snippets[0]!.text, /Tasks/);
  assert.match(snippets[0]!.text, /Do not offer to design or build one of these/);
});

test("a Module that is not actually available is not claimed as installed", async () => {
  // A promoted-but-not-available row is mid-install: saying it exists would
  // trade one wrong answer for another.
  const snippets = await chatInstalledModuleSnippets(
    wiringWith([{ ...installed("deal-pilot", "DealManager"), state: "promoted" }]),
    "org-1",
  );
  assert.deepEqual(snippets, []);
});

test("nothing installed says nothing, rather than an empty list", async () => {
  assert.deepEqual(await chatInstalledModuleSnippets(wiringWith([]), "org-1"), []);
});

test("the Commons catalog is offered minus what is already installed", async () => {
  const { snippets } = await chatModuleAwareness(
    wiringWith(
      [installed("deal-pilot", "DealManager")],
      [{ name: "deal-pilot" }, { name: "academics" }],
    ),
    "org-1",
  );
  const catalog = snippets.find((s) => s.source === "commons:catalog");
  assert.ok(catalog, "an addable Module should be mentioned");
  assert.match(catalog.text, /academics/);
  // Already installed — offering to "add" it is the confusion, not the fix.
  assert.doesNotMatch(catalog.text, /deal-pilot/);
});

test("an unreachable registry simply does not mention a catalog", async () => {
  const { snippets } = await chatModuleAwareness(
    wiringWith([installed("deal-pilot", "DealManager")]),
    "org-1",
  );
  assert.equal(snippets.find((s) => s.source === "commons:catalog"), undefined);
  // …but what IS installed is still stated. A dead registry must not cost the
  // model the knowledge that DealManager exists.
  assert.ok(snippets.some((s) => s.source === "modules:installed"));
});

test("a Module store that throws costs the turn nothing", async () => {
  const wiring = {
    moduleStore: { list: async () => { throw new Error("local plane unavailable"); } },
  } as unknown as Wiring;
  assert.deepEqual(await chatInstalledModuleSnippets(wiring, "org-1"), []);
});
