import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FixedClock,
  SeededRng,
  UuidGen,
  UniversalActionPipeline,
  InMemoryRoleStore,
  InMemoryAgentStore,
  InMemoryEphemeralStore,
  InMemoryPolicyStore,
  InMemoryLedger,
  InMemoryEventBus,
  InMemorySkillRegistry,
  type PolicyFn,
  type RunCtx,
  type ActionRequest,
  type Skill,
  type PostCommitEffect,
  type PostCommitPolicyResult,
} from "../src/index.js";

/**
 * Post-commit policy(post) runs AFTER the ledger row is appended and the
 * action already committed (see pipeline.ts's `#commit` / `toPostCommitResults`).
 * A `block` effect from that phase used to be silently discarded — implying
 * blocking was possible when it never was. The fix narrows the post-commit
 * evaluator's effect type so `block` (and `require_approval`, equally moot
 * post-commit) is unrepresentable at that phase. These tests prove that at
 * both the type level and the runtime level.
 */

// --- Type-level: `block`/`require_approval` are not assignable to PostCommitEffect ---

// @ts-expect-error -- "block" is deliberately excluded from PostCommitEffect: it is
// not actionable post-commit, so it must not even type-check here.
const _blockNotAllowed: PostCommitEffect = "block";

// @ts-expect-error -- "require_approval" is likewise excluded: the review gate has
// already been passed by the time phase="post" runs.
const _requireApprovalNotAllowed: PostCommitEffect = "require_approval";

// Only "allow" remains representable — this line must compile with no error.
const _allowIsFine: PostCommitEffect = "allow";
void _allowIsFine;

const _postResultCannotBlock: PostCommitPolicyResult = {
  policyId: "pol-x",
  phase: "post",
  // @ts-expect-error -- a PostCommitPolicyResult can never carry effect: "block".
  effect: "block",
  reason: "should not typecheck",
};
void _postResultCannotBlock;

// --- Runtime: a phase="post" policy returning "block" cannot stop an already-committed action ---

const echoSkill: Skill = {
  name: "echo",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

function harness(opts?: { policies?: PolicyFn[] }) {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const policies = new InMemoryPolicyStore(opts?.policies ?? []);
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const skills = new InMemorySkillRegistry().register(echoSkill);
  const variance = { observed: [] as unknown[], async observe(entry: unknown) { this.observed.push(entry); } };

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies,
    skills,
    ledger,
    events,
    variance,
  });

  return { roles, agents, ephemeral, policies, ledger, events, skills, variance, pipeline };
}

function freshCtx(startISO = "2026-06-01T00:00:00.000Z", seed = 42): RunCtx {
  const clock = new FixedClock(startISO);
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function req(partial: Partial<ActionRequest>): ActionRequest {
  return {
    organizationId: "ws-1",
    actor: { type: "user", id: "u1" },
    action: "write",
    resourceType: "person",
    inputs: { full_name_override: "Ada" },
    skill: "echo",
    ...partial,
  };
}

test("a phase=post 'block' effect does not stop the action from committing (lie fixed)", async () => {
  // A misbehaving/legacy policy that (wrongly) tries to block post-commit.
  const postBlocker: PolicyFn = (i) =>
    i.phase === "post"
      ? { policyId: "pol-post-block", phase: "post", effect: "block", reason: "too late" }
      : null;
  const h = harness({ policies: [postBlocker] });
  h.roles.direct.set("user:u1", [
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);

  const p = await h.pipeline.propose(req({}), freshCtx());

  // The action commits regardless of the post-phase "block" — proving the type
  // narrowing at the call site reflects reality: post-commit block is a no-op,
  // not a silently-ignored control. There is exactly one ledger row (auto-commit
  // path) and one emitted event.
  assert.equal(p.status, "applied");
  assert.equal(h.ledger.entries.length, 1);
  assert.equal(h.events.events.length, 1);
  assert.equal(h.variance.observed.length, 1);
});
