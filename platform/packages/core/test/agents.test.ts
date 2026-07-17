import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOUNDATIONAL_AGENTS,
  parseMention,
  parseSkillMention,
  COMMUNICATIONS_SKILL,
  buildCommunicationsSystemPrompt,
  checkDesignConstraintViolations,
} from "../src/index.js";

test("ADR-046/AGS0: Communications is not in the roster; Internal Strategist is", () => {
  // The type system already proves "communications" can't appear here —
  // FoundationalAgentId no longer includes it, so `a.id === "communications"`
  // wouldn't even compile. This just pins the roster's actual shape — four
  // non-Chief-of-Staff agents (AP-023/AGS0 adds Internal Strategist).
  assert.equal(FOUNDATIONAL_AGENTS.length, 4);
  assert.deepEqual(
    FOUNDATIONAL_AGENTS.map((a) => a.id).sort(),
    ["capability_builder", "governance", "internal_strategist", "learning"],
  );
});

test("AGS0: Internal Strategist is addressable via @mention and never executes directly", () => {
  const strategist = FOUNDATIONAL_AGENTS.find((a) => a.id === "internal_strategist");
  assert.ok(strategist);
  assert.equal(strategist!.neverExecutes, true);
  assert.equal(strategist!.requiresApproval, false);
  const { agentId } = parseMention("@strategist compare these two options");
  assert.equal(agentId, "internal_strategist");
});

test("parseMention no longer resolves @communications (it's a skill now)", () => {
  const { agentId } = parseMention("@communications draft a summary");
  assert.equal(agentId, null);
});

test("parseSkillMention resolves @communications and @comms", () => {
  assert.equal(parseSkillMention("@communications draft a summary").skill, "communications");
  assert.equal(parseSkillMention("@comms draft a summary").rest, "draft a summary");
  assert.equal(parseSkillMention("hello there").skill, null);
});

test("buildCommunicationsSystemPrompt carries no agent-identity execution guardrail", () => {
  const prompt = buildCommunicationsSystemPrompt();
  assert.match(prompt, /Communications skill/);
  assert.match(prompt, /no independent authority/);
  assert.doesNotMatch(prompt, /never execute actions directly/);
});

test("buildCommunicationsSystemPrompt applies animal tone additively", () => {
  const prompt = buildCommunicationsSystemPrompt("wise and calm");
  assert.match(prompt, /wise and calm/);
});

test("checkDesignConstraintViolations flags dummy-data language", () => {
  const violations = checkDesignConstraintViolations("This view renders sample data until the real integration lands.");
  assert.ok(violations.some((v) => /dummy-data/.test(v)));
});

test("checkDesignConstraintViolations flags bare CRM vocab only in kernel-scope drafts", () => {
  const kernelDraft = "Add a new Deal entity to packages/core for tracking.";
  const workspaceDraft = "Add a Deal card to the DealPilot kanban view.";
  const kernelViolations = checkDesignConstraintViolations(kernelDraft);
  const workspaceViolations = checkDesignConstraintViolations(workspaceDraft);
  assert.ok(kernelViolations.some((v) => /CRM vocabulary/.test(v)));
  assert.equal(workspaceViolations.length, 0);
});

test("checkDesignConstraintViolations is silent on a clean draft", () => {
  assert.deepEqual(checkDesignConstraintViolations("Add a Signal for stale Initiatives — Commons content, real connected data only, honest empty state otherwise."), []);
});
