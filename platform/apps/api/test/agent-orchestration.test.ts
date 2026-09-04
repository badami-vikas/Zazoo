/**
 * agentOrchestration.* (TASK-007, AGS0-AGS2) — end-to-end over the real
 * `buildWiring()` composition root: typed Goal/Task creation, the fail-closed
 * Goal/Task-bound Skill resolver, invoking a governed Skill through the SAME
 * `action.propose` gate every other mutation uses, and bounded child Agent
 * Runs (authority/budget/taint/review-mode narrowing + depth cap + cancel).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  createChildAgentRun,
  SearchProvidersUnavailableError,
  labelFromLegacyTrustOrigin,
  type ContentGuard,
  type SearchProviderOutcome,
  type SearchProviderRouter,
  type SearchRequest,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_ORGANIZATION,
  PILOT_USER,
  INTERNAL_STRATEGIST_AGENT,
  LEARNING_AGENT,
  GOVERNANCE_AGENT,
  CAPABILITY_BUILDER_AGENT,
  RELATIONSHIP_LEARNING_GOAL_TYPE,
  SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
  LEARNING_WEB_RESEARCH_GOAL_TYPE,
  RESEARCH_PUBLIC_WEB_TASK_TYPE,
  type Wiring,
} from "../src/wiring.js";
import { WEB_RESEARCH_SKILL_ID } from "../src/web-research-skill.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelFromLegacyTrustOrigin(
      "operator",
      "agent-orchestration-test",
    ),
  };
}

async function makeCaller(
  wiring: Wiring,
  identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

async function seedGoalAndTask(caller: Awaited<ReturnType<typeof makeCaller>>, assignedAgentId: string) {
  const goal = await caller.agentOrchestration.goal.create({
    organizationId: PILOT_ORGANIZATION,
    type: RELATIONSHIP_LEARNING_GOAL_TYPE,
    title: "test_fixture goal",
  });
  const task = await caller.agentOrchestration.task.create({
    organizationId: PILOT_ORGANIZATION,
    goalId: goal.id,
    type: SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
    assignedAgentId,
  });
  return { goal, task };
}

function researchFixture(): {
  router: SearchProviderRouter;
  contentGuard: ContentGuard;
  calls: SearchRequest[];
  inspections: string[];
} {
  const calls: SearchRequest[] = [];
  const inspections: string[] = [];
  const contentHash = `sha256:${"a".repeat(64)}`;
  const router: SearchProviderRouter = {
    providers: () => new Map(),
    async search(request): Promise<SearchProviderOutcome> {
      calls.push(request);
      return {
        citations: [
          {
            url: "https://example.com/evidence",
            title: "RAW_TITLE_NEVER_PERSIST",
            publishedAt: null,
            excerpts: ["RAW_SNIPPET_NEVER_PERSIST"],
            providerId: "test-fixture-search",
            retrievedAt: request.requestedAt,
            contentHash,
            trustOrigin: "untrusted_external",
          },
        ],
        warnings: [],
        provenance: {
          providerId: "test-fixture-search",
          providerTier: 1,
          providerAccess: "free_direct",
          providerRequestId: "test-fixture-provider-request",
          termsUrl: "https://example.com/terms",
          searchedAt: request.requestedAt,
          responseBytes: 512,
          contentHash,
          rights: {
            status: "verified",
            verifiedAt: "2026-07-18T00:00:00.000Z",
            sourceUrl: "https://example.com/terms",
            allowedDataScope: "public",
            restrictions: ["public test fixture only"],
          },
        },
        trustOrigin: "untrusted_external",
        attempts: [
          {
            providerId: "test-fixture-search",
            providerTier: 1,
            providerAccess: "free_direct",
            providerHealth: "healthy",
            status: "succeeded",
            detail: "deterministic test fixture",
          },
        ],
      };
    },
  };
  const contentGuard: ContentGuard = {
    async inspect(input) {
      inspections.push(input.content);
      return {
        safe: true,
        categories: [],
        extraction: {
          summary: "Quarantined source finding",
          entities: ["Example"],
        },
        reason: "deterministic test quarantine",
      };
    },
  };
  return { router, contentGuard, calls, inspections };
}

test("agentOrchestration: a Task assigned to a non-default eligible Agent (Internal Strategist) resolves the governed skill", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    const resolution = await caller.agentOrchestration.skill.resolve({
      organizationId: PILOT_ORGANIZATION,
      goalId: goal.id,
      taskId: task.id,
      agentId: INTERNAL_STRATEGIST_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(resolution.ok, true);
    assert.equal(resolution.manifest?.skillId, "stageStrategicRecommendation");
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration: the SAME governed skill resolves for Learning too, on a DIFFERENT Task assigned to it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, LEARNING_AGENT);
    const resolution = await caller.agentOrchestration.skill.resolve({
      organizationId: PILOT_ORGANIZATION,
      goalId: goal.id,
      taskId: task.id,
      agentId: LEARNING_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(resolution.ok, true);
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration: reassigning a Task changes eligibility — the old Agent loses it, the new one gains it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, LEARNING_AGENT);
    const before = await caller.agentOrchestration.skill.resolve({
      organizationId: PILOT_ORGANIZATION,
      goalId: goal.id,
      taskId: task.id,
      agentId: INTERNAL_STRATEGIST_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(before.ok, false);
    assert.equal(before.reason, "not-assigned-agent");

    await caller.agentOrchestration.task.reassign({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.id,
      assignedAgentId: INTERNAL_STRATEGIST_AGENT,
    });

    const after = await caller.agentOrchestration.skill.resolve({
      organizationId: PILOT_ORGANIZATION,
      goalId: goal.id,
      taskId: task.id,
      agentId: INTERNAL_STRATEGIST_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(after.ok, true);
  } finally {
    await wiring.close();
  }
});

test("server-owned Agent runtime: an eligible assigned Agent invoking the governed skill via goalTaskRef drafts", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    const proposal = await wiring.pipeline.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
      action: "write",
      resourceType: "signal",
      inputs: { text: "a strategic recommendation" },
      skill: "stageStrategicRecommendation",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    }, makeRun());
    assert.equal(proposal.status, "pending_review");
  } finally {
    await wiring.close();
  }
});

test("web-research runs as the server-selected Learning Agent through cloud/public Goal-Task authority and persists taint", async () => {
  const fixture = researchFixture();
  const wiring = await buildWiring({
    searchProviders: fixture.router,
    webResearchContentGuard: fixture.contentGuard,
  });
  try {
    const caller = await makeCaller(wiring);
    const memoriesBefore = await wiring.memoryStore.retrieve(
      { limit: 100 },
      { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER },
    );
    const proposal = await caller.agentOrchestration.skill.webResearch({
      organizationId: PILOT_ORGANIZATION,
      objective: "Find current public evidence",
      scope: "public_web",
      searchQueries: ["current public evidence"],
      budget: {
        maxResults: 3,
        maxResponseBytes: 64 * 1_024,
        maxProviderAttempts: 1,
        timeoutMs: 5_000,
      },
    });

    assert.equal(proposal.status, "pending_review");
    assert.deepEqual(proposal.request.actor, {
      type: "agent",
      id: LEARNING_AGENT,
      plane: "cloud",
    });
    assert.deepEqual(proposal.request.onBehalfOf, {
      type: "user",
      id: PILOT_USER,
    });
    assert.equal(proposal.request.dataScope, "public");
    assert.equal(proposal.request.skill, WEB_RESEARCH_SKILL_ID);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0]?.maxResults, 3);
    assert.equal(fixture.calls[0]?.maxResponseBytes, 64 * 1_024);
    assert.equal(fixture.calls[0]?.maxProviderAttempts, 1);
    assert.equal(fixture.inspections.length, 1);
    assert.match(fixture.inspections[0] ?? "", /RAW_SNIPPET_NEVER_PERSIST/);
    const task = await wiring.goalTasks.getTask(
      PILOT_ORGANIZATION,
      proposal.request.goalTaskRef!.taskId,
    );
    const goal = await wiring.goalTasks.getGoal(
      PILOT_ORGANIZATION,
      proposal.request.goalTaskRef!.goalId,
    );
    assert.ok(task);
    assert.ok(goal);
    assert.equal(task.assignedAgentId, LEARNING_AGENT);
    assert.equal(task.type, RESEARCH_PUBLIC_WEB_TASK_TYPE);
    assert.equal(goal.type, LEARNING_WEB_RESEARCH_GOAL_TYPE);
    const resolution = await caller.agentOrchestration.skill.resolve({
      organizationId: PILOT_ORGANIZATION,
      goalId: goal.id,
      taskId: task.id,
      agentId: LEARNING_AGENT,
      skillId: WEB_RESEARCH_SKILL_ID,
      requestedDataScope: "public",
    });
    assert.equal(resolution.ok, true);
    assert.equal(resolution.manifest?.plane, "cloud");
    assert.equal(proposal.output?.trustOrigin, "untrusted_external");
    assert.equal(
      (proposal.output?.proposedOutput as { trustOrigin?: string })
        .trustOrigin,
      "untrusted_external",
    );
    const ledger = await wiring.ledger.get(proposal.id);
    assert.equal(ledger?.actorId, LEARNING_AGENT);
    assert.equal(ledger?.trustOrigin, "untrusted_external");
    assert.equal(ledger?.dataScope, "public");
    const memoriesAfter = await wiring.memoryStore.retrieve(
      { limit: 100 },
      { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER },
    );
    assert.equal(memoriesAfter.length, memoriesBefore.length + 1);
    const memory = memoriesAfter.find(
      (candidate) => candidate.id === proposal.resultEvidence.memoryId,
    );
    assert.ok(memory);
    assert.equal(memory.trustOrigin, "untrusted_external");
    assert.equal(memory.sourceRefType, "ledger");
    assert.equal(memory.sourceRefId, proposal.resultEvidence.resultId);
    assert.doesNotMatch(memory.content, /RAW_(TITLE|SNIPPET)_NEVER_PERSIST/);
    assert.match(memory.content, /Quarantined source finding/);
    const event = await wiring.graphStore.getEvent(
      PILOT_ORGANIZATION,
      proposal.resultEvidence.eventId,
    );
    assert.equal(event?.type, "learning.web_research.result_recorded");
    assert.equal(event?.entityType, "result");
    assert.equal(
      (event?.payload as { trustOrigin?: string }).trustOrigin,
      "untrusted_external",
    );
    assert.doesNotMatch(
      JSON.stringify(event?.payload),
      /RAW_(TITLE|SNIPPET)_NEVER_PERSIST/,
    );
  } finally {
    await wiring.close();
  }
});

test("web-research surfaces attributable provider unavailability instead of returning an empty success", async () => {
  const unavailable: SearchProviderRouter = {
    providers: () => new Map(),
    async search() {
      throw new SearchProvidersUnavailableError([
        {
          providerId: "parallel-search-mcp",
          providerTier: 1,
          providerAccess: "free_direct",
          providerHealth: "unavailable",
          status: "unavailable",
          code: "timeout",
          detail: "provider parallel-search-mcp failed with timeout",
        },
      ]);
    },
  };
  const wiring = await buildWiring({ searchProviders: unavailable });
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.agentOrchestration.skill.webResearch({
          organizationId: PILOT_ORGANIZATION,
          objective: "Find current public evidence",
          scope: "public_web",
          searchQueries: ["current public evidence"],
          budget: {
            maxResults: 3,
            maxResponseBytes: 64 * 1_024,
            maxProviderAttempts: 1,
            timeoutMs: 5_000,
          },
        }),
      /web research unavailable \(parallel-search-mcp:unavailable\)/,
    );
  } finally {
    await wiring.close();
  }
});

test("web-research rejects unsafe quarantine verdicts before Result or Memory persistence", async () => {
  const fixture = researchFixture();
  const unsafeGuard: ContentGuard = {
    async inspect() {
      return {
        safe: false,
        categories: ["prompt_injection"],
        extraction: {
          summary: "RAW_SNIPPET_NEVER_PERSIST",
          entities: [],
        },
        reason: "external content attempted to instruct the Agent",
      };
    },
  };
  const wiring = await buildWiring({
    searchProviders: fixture.router,
    webResearchContentGuard: unsafeGuard,
  });
  try {
    const caller = await makeCaller(wiring);
    const memoriesBefore = await wiring.memoryStore.retrieve(
      { limit: 100 },
      { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER },
    );
    const resultsBefore = await wiring.ledger.listPending(PILOT_ORGANIZATION, {
      limit: 100,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    await assert.rejects(
      () =>
        caller.agentOrchestration.skill.webResearch({
          organizationId: PILOT_ORGANIZATION,
          objective: "Find current public evidence",
          scope: "public_web",
          searchQueries: ["current public evidence"],
          budget: {
            maxResults: 3,
            maxResponseBytes: 64 * 1_024,
            maxProviderAttempts: 1,
            timeoutMs: 5_000,
          },
        }),
      /quarantine produced no persistable citations/,
    );
    const memoriesAfter = await wiring.memoryStore.retrieve(
      { limit: 100 },
      { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER },
    );
    const resultsAfter = await wiring.ledger.listPending(PILOT_ORGANIZATION, {
      limit: 100,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    assert.equal(fixture.calls.length, 1);
    assert.equal(memoriesAfter.length, memoriesBefore.length);
    assert.equal(resultsAfter.total, resultsBefore.total);
  } finally {
    await wiring.close();
  }
});

test("web-research fails before provider access when the installed Relationship Module binding is unavailable", async () => {
  const fixture = researchFixture();
  const wiring = await buildWiring({
    searchProviders: fixture.router,
    webResearchContentGuard: fixture.contentGuard,
  });
  try {
    const versions = await wiring.moduleStore.listVersions(
      PILOT_ORGANIZATION,
      "relationship",
    );
    const installed = versions.find(
      (row) => row.status === "installed" && row.state === "available",
    );
    assert.ok(installed);
    await wiring.moduleStore.setState(installed.id, "legacy");
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.agentOrchestration.skill.webResearch({
          organizationId: PILOT_ORGANIZATION,
          objective: "Find current public evidence",
          scope: "public_web",
          searchQueries: ["current public evidence"],
          budget: {
            maxResults: 3,
            maxResponseBytes: 64 * 1_024,
            maxProviderAttempts: 1,
            timeoutMs: 5_000,
          },
        }),
      /does not bind web-research to the Learning Agent/,
    );
    assert.equal(fixture.calls.length, 0);
  } finally {
    await wiring.close();
  }
});

test("web-research authority rejects local-plane and direct-Human invocation before provider access", async () => {
  const fixture = researchFixture();
  const wiring = await buildWiring({
    searchProviders: fixture.router,
    webResearchContentGuard: fixture.contentGuard,
  });
  try {
    const caller = await makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({
      organizationId: PILOT_ORGANIZATION,
      type: LEARNING_WEB_RESEARCH_GOAL_TYPE,
      title: "test_fixture public research goal",
    });

    const task = await caller.agentOrchestration.task.create({
      organizationId: PILOT_ORGANIZATION,
      goalId: goal.id,
      type: RESEARCH_PUBLIC_WEB_TASK_TYPE,
      assignedAgentId: LEARNING_AGENT,
    });
    const common = {
      organizationId: PILOT_ORGANIZATION,
      action: "read" as const,
      resourceType: "external:fetch" as const,
      inputs: {
        objective: "Find public evidence",
        scope: "public_web",
        searchQueries: ["public evidence"],
        budget: {
          maxResults: 3,
          maxResponseBytes: 64 * 1_024,
          maxProviderAttempts: 1,
          timeoutMs: 5_000,
        },
      },
      skill: WEB_RESEARCH_SKILL_ID,
      dataScope: "public" as const,
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    };
    const run = makeRun();

    const local = await wiring.pipeline.propose(
      {
        ...common,
        actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
      },
      run,
    );
    assert.equal(local.status, "rejected");
    assert.match(local.rejectionReason ?? "", /plane|external fetch/i);
    assert.equal(fixture.calls.length, 0, "the plane rejection happens before provider access");

    // AP-182: a direct Human invocation is a governance FLAG, not a refusal.
    const directHuman = await wiring.pipeline.propose(
      {
        ...common,
        actor: { type: "user", id: PILOT_USER, plane: "cloud" },
      },
      run,
    );
    assert.notEqual(directHuman.status, "rejected");
    assert.ok(
      directHuman.policyResults.some((r) => r.policyId === "governance.flag" && /invoked directly by a user actor/.test(r.reason)),
    );
  } finally {
    await wiring.close();
  }
});

test("action.propose handles null inputs without crashing policy evaluation", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const proposal = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "person",
      inputs: null,
      skill: "stageMutation",
    });
    assert.equal(proposal.status, "applied");
    assert.equal(proposal.output?.proposedOutput, null);
  } finally {
    await wiring.close();
  }
});

test("action.propose: a Human directly invoking the governed skill fails closed even with a valid goalTaskRef", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const asHuman = await makeCaller(wiring, { type: "user", id: PILOT_USER }); // PILOT_USER holds a real signal:write grant
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    await assert.rejects(
      () =>
        Reflect.apply(asHuman.action.propose, asHuman.action, [{
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "signal",
          inputs: { text: "a strategic recommendation" },
          skill: "stageStrategicRecommendation",
          goalTaskRef: { goalId: goal.id, taskId: task.id },
        }]),
      /stageMutation|invalid literal/i,
    );
  } finally {
    await wiring.close();
  }
});

test("server-owned Agent runtime/AP-182: a governed Skill with no goalTaskRef is flagged on the ledger and still drafts", async () => {
  const wiring = await buildWiring();
  try {
    const proposal = await wiring.pipeline.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
      action: "write",
      resourceType: "signal",
      inputs: { text: "a strategic recommendation" },
      skill: "stageStrategicRecommendation",
    }, makeRun());
    assert.equal(proposal.status, "pending_review", proposal.rejectionReason);
    assert.ok(
      proposal.policyResults.some((r) => r.policyId === "governance.flag" && /without a Goal\/Task assignment/.test(r.reason)),
      "the missing Goal/Task must be recorded as a governance flag",
    );
  } finally {
    await wiring.close();
  }
});

test("server-owned child Run creation is inspectable and cancellable through the authenticated organization-scoped API", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    const parentRunId = crypto.randomUUID();
    const run = await createChildAgentRun(
      { store: wiring.childAgentRuns, ledger: wiring.ledger },
      {
        runId: parentRunId,
        agentId: INTERNAL_STRATEGIST_AGENT,
        organizationId: PILOT_ORGANIZATION,
        authorityScope: ["signal:write"],
        eligibleSkills: ["stageStrategicRecommendation"],
        dataScope: "all",
        plane: "local",
        budgetRemaining: { calls: 3, cost: 3 },
        reviewMode: "approve",
        childRunPolicy: "allowed",
        delegationDepth: 0,
      },
      {
        goalId: goal.id,
        taskId: task.id,
        delegatedScope: ["signal:write", "ledger:write"],
        selectedSkills: ["stageStrategicRecommendation"],
        budget: { maxCalls: 3, maxCost: 3 },
        deadline: "2099-01-01T00:00:00.000Z",
        stopCondition: "test_fixture stop condition",
      },
      makeRun(),
    );
    assert.deepEqual(run.authorityScope, ["signal:write"]); // narrowed to the agent's real scope
    assert.deepEqual(run.droppedScope, ["ledger:write"]);
    assert.deepEqual(run.eligibleSkills, ["stageStrategicRecommendation"]);
    assert.equal(run.budget.maxCalls, 3); // narrowed to the (smaller) parent ceiling
    assert.equal(run.depth, 1);

    const fetched = await caller.agentOrchestration.childRun.get({
      organizationId: PILOT_ORGANIZATION,
      childRunId: run.id,
    });
    assert.deepEqual(fetched, run);

    const byParent = await caller.agentOrchestration.childRun.listByParentRun({
      organizationId: PILOT_ORGANIZATION,
      parentRunId,
    });
    assert.equal(byParent.length, 1);

    const cancelled = await caller.agentOrchestration.childRun.cancel({
      organizationId: PILOT_ORGANIZATION,
      childRunId: run.id,
    });
    assert.equal(cancelled.status, "cancelled");
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration exposes no client-controlled child Run creation procedure", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    assert.equal("create" in caller.agentOrchestration.childRun, false);
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration queries require organization membership", async () => {
  const wiring = await buildWiring();
  try {
    const outsider = await makeCaller(wiring, { type: "user", id: crypto.randomUUID() });
    await assert.rejects(
      () => outsider.agentOrchestration.goal.list({ organizationId: PILOT_ORGANIZATION }),
      /not a member/,
    );
  } finally {
    await wiring.close();
  }
});

test("Agent-backed routes reject non-members before provisioning Tasks", async () => {
  const wiring = await buildWiring();
  try {
    const outsider = await makeCaller(wiring, { type: "user", id: crypto.randomUUID() });
    const before = await wiring.goalTasks.listGoals(PILOT_ORGANIZATION);

    await assert.rejects(
      () =>
        outsider.capture.stage({
          organizationId: PILOT_ORGANIZATION,
          localMediaId: "test_fixture_local_media",
          capturedAt: "2026-07-18T12:00:00.000Z",
        }),
      /not a member/,
    );
    await assert.rejects(
      () => outsider.dealpilot.discoverDeals({ organizationId: PILOT_ORGANIZATION, sourceId: "source-1" }),
      /not a member/,
    );
    await assert.rejects(() => outsider.google.syncGmail(), /not a member/);
    await assert.rejects(() => outsider.google.syncCalendar(), /not a member/);
    await assert.rejects(() => outsider.google.listEvents(), /not a member/);
    await assert.rejects(
      () =>
        outsider.onboarding.recommendFromRoleModel({
          organizationId: PILOT_ORGANIZATION,
          figure: "test fixture figure",
          admiredFor: "test fixture trait",
        }),
      /not a member/,
    );

    assert.equal((await wiring.goalTasks.listGoals(PILOT_ORGANIZATION)).length, before.length);
  } finally {
    await wiring.close();
  }
});

test("AGS3: all five foundational Agents have durable boundaries — Governance and Capability Builder can ALSO be assigned a Task and resolve a governed Skill (assignment governs, not a fixed 2-agent roster)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({
      organizationId: PILOT_ORGANIZATION,
      type: RELATIONSHIP_LEARNING_GOAL_TYPE,
      title: "test_fixture AGS3 durable-boundary goal",
    });

    for (const agentId of [GOVERNANCE_AGENT, CAPABILITY_BUILDER_AGENT]) {
      const task = await caller.agentOrchestration.task.create({
        organizationId: PILOT_ORGANIZATION,
        goalId: goal.id,
        type: SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
        assignedAgentId: agentId,
      });
      const resolution = await caller.agentOrchestration.skill.resolve({
        organizationId: PILOT_ORGANIZATION,
        goalId: goal.id,
        taskId: task.id,
        agentId,
        skillId: "stageStrategicRecommendation",
      });
      assert.equal(resolution.ok, true, `expected ${agentId} to resolve the governed skill once assigned its own Task`);
    }
  } finally {
    await wiring.close();
  }
});
