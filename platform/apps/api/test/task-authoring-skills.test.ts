/**
 * The four model-backed TM3 planning Skills resolve through the real registry
 * and EXECUTE.
 *
 * Before this slice all four were registered manifests whose `run()` fell
 * through to `return { proposedOutput: inputs }` — externally indistinguishable
 * from a Skill that had planned something. These assertions fail if that echo
 * ever returns.
 *
 * The wiring under test has no model configured, so every result here takes
 * the Playbook-scaffold path. That is the point: the honest offline answer is
 * the Playbook's own questions with nothing drafted, never an empty list that
 * reads as "the methodology found nothing to say".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { buildWiring } from "../src/wiring.js";

function runCtx(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

const AUTHORING_SKILLS = [
  "task-manager.goal-outcome-framing",
  "task-manager.candidate-task-generation",
  "task-manager.premortem-scenario",
  "task-manager.task-decomposition",
] as const;

test("the four authoring Skills execute a Playbook instead of echoing inputs", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const ctx = runCtx();
  const inputs = {
    title: "Cut onboarding time in half",
    exitTest: "A new user reaches their first Signal in under ten minutes",
    parentPath: "4.2",
    // A field the echo would have handed straight back, so its ABSENCE from
    // the output is what proves the Skill ran.
    echoCanary: "must-not-appear",
  };

  for (const skillId of AUTHORING_SKILLS) {
    const skill = wiring.skillRegistry.get(skillId);
    assert.ok(skill, `${skillId} must be registered`);
    // A model call is not pure data — the pipeline's skill_execution taint
    // sink has to see these.
    assert.equal(skill.executionClass, "authority_bearing", `${skillId} must not claim to be pure_data`);

    const output = await skill.run(inputs, ctx);
    const result = output.proposedOutput as Record<string, unknown>;
    assert.equal(result["echoCanary"], undefined, `${skillId} echoed its inputs`);
    assert.equal(result["status"], "proposed", `${skillId} must propose, never settle`);

    // It ran under a named, versioned methodology — not an implicit prompt.
    assert.ok(typeof result["playbookId"] === "string" && (result["playbookId"] as string).length > 0);
    assert.ok(typeof result["methodology"] === "string" && (result["methodology"] as string).length > 0);

    // No model is configured here, so the honest answer is the Playbook's
    // questions plus a stated reason — never fabricated planning content.
    assert.equal(result["source"], "playbook_scaffold", `${skillId} claimed a model answer with no model`);
    assert.ok((result["prompts"] as unknown[]).length >= 3, `${skillId} returned no usable questions`);
    assert.ok(
      typeof result["note"] === "string" && (result["note"] as string).length > 0,
      `${skillId} returned an empty result with no explanation`,
    );
  }
});

test("each authoring Skill returns its own shape, and drafts nothing without a model", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const ctx = runCtx();

  const framing = (
    await wiring.skillRegistry
      .get("task-manager.goal-outcome-framing")!
      .run({ title: "Cut onboarding time in half" }, ctx)
  ).proposedOutput as Record<string, unknown>;
  assert.equal(framing["kind"], "goal_outcome_framing");
  assert.deepEqual(framing["outcomes"], []);
  // Not `false`: the scaffold has not assessed this, and `false` would read
  // as a considered answer.
  assert.equal(framing["isGoalProposed"], null);

  const candidates = (
    await wiring.skillRegistry
      .get("task-manager.candidate-task-generation")!
      .run({ title: "Cut onboarding time in half" }, ctx)
  ).proposedOutput as Record<string, unknown>;
  assert.equal(candidates["kind"], "candidate_task_generation");
  assert.deepEqual(candidates["candidates"], []);

  const premortem = (
    await wiring.skillRegistry
      .get("task-manager.premortem-scenario")!
      .run({ title: "Cut onboarding time in half", horizon: "end of the quarter" }, ctx)
  ).proposedOutput as Record<string, unknown>;
  assert.equal(premortem["kind"], "premortem_scenario");
  assert.equal(premortem["horizon"], "end of the quarter");
  assert.deepEqual(premortem["failureModes"], []);

  const decomposition = (
    await wiring.skillRegistry
      .get("task-manager.task-decomposition")!
      .run({ title: "Cut onboarding time in half", parentPath: "4.2" }, ctx)
  ).proposedOutput as Record<string, unknown>;
  assert.equal(decomposition["kind"], "task_decomposition");
  assert.equal(decomposition["parentPath"], "4.2");
  assert.deepEqual(decomposition["children"], []);
});

test("decomposition refuses to place children with no parent path", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  // A model-invented dot-path could collide with a live Task or silently
  // reorder the queue, so a missing parent path fails loudly rather than
  // getting guessed.
  await assert.rejects(
    () =>
      wiring.skillRegistry
        .get("task-manager.task-decomposition")!
        .run({ title: "Anything" }, runCtx()),
    /requires the parent Task's 'parentPath'/,
  );
});

test("a Playbook that does not support the requested Skill is refused", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  // Silently swapping in the default Playbook would answer a different
  // question than the caller asked, hiding their bug.
  await assert.rejects(
    () =>
      wiring.skillRegistry
        .get("task-manager.task-decomposition")!
        .run({ title: "Anything", parentPath: "1", playbookId: "pre-mortem" }, runCtx()),
    /does not support task-decomposition/,
  );
});
