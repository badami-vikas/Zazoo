import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WHATSAPP_TOOLS, requireTool } from "../src/tools.js";

test("the registry has no duplicate Tool ids", () => {
  const ids = WHATSAPP_TOOLS.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate Tool id in ${ids.join(", ")}`);
});

test("the Tools the Page dispatches on are all registered", () => {
  // Every id here has a panel in WhatsAppPage.tsx. A registry entry without a
  // panel renders a heading and nothing under it, which reads as broken.
  const ids = new Set(WHATSAPP_TOOLS.map((tool) => tool.id));
  for (const id of ["contact-extractor", "automation-rules", "scheduled-actions", "agent-assignment"]) {
    assert.ok(ids.has(id), `${id} is missing from the registry`);
  }
});

test("every Tool declares a name, description, modes, and gating capability", () => {
  for (const tool of WHATSAPP_TOOLS) {
    assert.ok(tool.name.length > 0, `${tool.id} has no name`);
    assert.ok(tool.description.length > 0, `${tool.id} has no description`);
    assert.ok(tool.modes.length > 0, `${tool.id} has no modes`);
    assert.ok(tool.capabilityId.startsWith("whatsapp."), `${tool.id} has no Module capability`);
  }
});

test("the contact extractor offers both contacts and groups", () => {
  assert.deepEqual([...requireTool("contact-extractor").modes], ["contacts", "groups"]);
});

test("requireTool throws for an unknown Tool rather than returning undefined", () => {
  assert.throws(() => requireTool("nope"), /Unknown WhatsApp Tool: nope/);
});
