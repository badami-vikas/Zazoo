import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WHATSAPP_TOOLS, requireTool } from "../src/tools.js";

test("v1 ships exactly one Tool", () => {
  assert.equal(WHATSAPP_TOOLS.length, 1);
  assert.equal(WHATSAPP_TOOLS[0]?.id, "contact-extractor");
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
