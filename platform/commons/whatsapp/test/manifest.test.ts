import { strict as assert } from "node:assert";
import { test } from "node:test";
import { whatsappModule } from "../src/module.js";
import { WHATSAPP_TOOLS } from "../src/tools.js";

test("every Tool is gated by a capability the Module manifest declares", () => {
  const whatsapp = whatsappModule.manifest;
  const declared = new Set(whatsapp.capabilities.map((capability) => capability.id));
  for (const tool of WHATSAPP_TOOLS) {
    assert.ok(declared.has(tool.capabilityId), `${tool.id} has no declared capability`);
  }
});

test("the Module's Agent owns the Contact Extractor Skill", () => {
  const whatsapp = whatsappModule.manifest;
  const steward = whatsapp.module?.agents.find((agent) => agent.id === "contact-steward");
  assert.ok(steward, "contact-steward Agent is missing");
  assert.ok(steward.skillIds.includes("whatsapp.tool.contact-extractor"));
  // The session is desktop-local; a cloud-plane Agent could not reach it.
  assert.equal(steward.plane, "local");
});
