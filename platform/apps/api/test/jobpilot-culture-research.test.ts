/**
 * jobpilot.researchCulture (TASK-011, JP3B) — end-to-end over the real
 * `buildWiring()` composition root. Proves: (1) a candidate source whose TYPE
 * is `do_not_use`/`research_only`/`not_yet_integrated` (Glassdoor/Reddit/
 * Google reviews in this slice) is skipped with a recorded reason and NEVER
 * gets a child Agent Run or a network call; (2) a `permitted` source (a
 * company's own official page) gets exactly one bounded child Agent Run and
 * an actual governed fetch; (3) a claim citing a non-permitted source is
 * rejected before any network access; (4) direct Human/Automation invocation
 * of either new governed Skill fails closed, exactly like every other AGS1
 * Skill in this codebase; (5) the fabrication/insider-claim guard fails the
 * whole run closed rather than silently dropping the bad claim; (6) an
 * honest empty "contradictions" bucket is returned, never a fabricated filler
 * row.
 *
 * `globalThis.fetch` is stubbed (same convention as
 * apps/api/test/security-hardening.test.ts's onboarding role-model research
 * test) so this suite never makes a real network call. Test URLs use a
 * literal public IP (not a hostname) so the REAL SSRF guard
 * (`assertOutboundAllowed`) — which still runs for real, unstubbed — never
 * needs a live DNS lookup either; the guard's synchronous private/reserved-IP
 * block check is exercised fully offline. See docs/dummy.md for this fixture.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, PILOT_USER, LEARNING_AGENT, INTERNAL_STRATEGIST_AGENT, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring, identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER }) {
  return appRouter.createCaller({ wiring, run: makeRun(), identity, authenticated: true, verifying: false });
}

// test_fixture literal IP (Cloudflare's real public 1.1.1.1 anycast resolver —
// a genuinely non-reserved public address, not a documentation/example block
// like RFC 5737's 203.0.113.0/24, WHICH THIS GUARD DELIBERATELY BLOCKS, so the
// real SSRF guard's "allowed" path is exercised, not its "blocked" path) so
// the guard never needs a live DNS lookup for a hostname. `globalThis.fetch`
// is stubbed below, so no actual TCP connection to it is attempted either.
const TEST_FIXTURE_COMPANY_PAGE_URL = "https://1.1.1.1/careers/culture";

const STUB_HTML = `<html><body><h1>Culture, Values, And Inclusion</h1><p>test_fixture: we build trust and collaboration.</p></body></html>`;

function stubFetchOnce() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(STUB_HTML, { status: 200 })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("jobpilot.researchCulture: do_not_use/research_only/not_yet_integrated sources are skipped with zero network access and no child Run", async () => {
  const wiring = await buildWiring();
  const restore = stubFetchOnce();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.jobpilot.researchCulture({
      workspaceId: PILOT_WORKSPACE,
      company: "test_fixture Co",
      candidateSources: [
        { sourceType: "company_official_page", sourceLabel: "test_fixture Careers", url: TEST_FIXTURE_COMPANY_PAGE_URL },
        { sourceType: "glassdoor", sourceLabel: "Glassdoor reviews", url: "https://8.8.8.8/reviews" },
        { sourceType: "reddit", sourceLabel: "r/test_fixture thread", url: "https://8.8.4.4/thread" },
        { sourceType: "google_reviews", sourceLabel: "Google reviews", url: "https://9.9.9.9/reviews" },
      ],
      claims: [
        {
          id: "fact1",
          claimType: "fact",
          claimText: "test_fixture Co's official page states it values trust and collaboration",
          sourceType: "company_official_page",
          sourceLabel: "test_fixture Careers",
        },
      ],
    });
    assert.equal(result.sources.length, 1); // only the ONE permitted source was fetched
    assert.equal(result.skippedSources.length, 3);
    assert.deepEqual(
      result.skippedSources.map((s) => s.sourceType).sort(),
      ["glassdoor", "google_reviews", "reddit"],
    );
    for (const skipped of result.skippedSources) {
      assert.ok(skipped.reason.length > 0, `${skipped.sourceType} must carry a reason`);
    }
    // No child Run exists for a skipped source — only ONE child Run total (the permitted one).
    const runs = await wiring.childAgentRuns.listByParentRun(PILOT_WORKSPACE, result.parentRunId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "completed");
  } finally {
    restore();
    await wiring.close();
  }
});

test("jobpilot.researchCulture: the permitted source's child Run is bounded and the fetch is real (SSRF-guarded, stubbed body)", async () => {
  const wiring = await buildWiring();
  const restore = stubFetchOnce();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.jobpilot.researchCulture({
      workspaceId: PILOT_WORKSPACE,
      company: "test_fixture Co",
      candidateSources: [{ sourceType: "company_official_page", sourceLabel: "test_fixture Careers", url: TEST_FIXTURE_COMPANY_PAGE_URL }],
      claims: [
        {
          id: "fact1",
          claimType: "fact",
          claimText: "test_fixture Co's official page states it values trust and collaboration",
          sourceType: "company_official_page",
          sourceLabel: "test_fixture Careers",
        },
        {
          id: "opinion1",
          claimType: "opinion",
          claimText: "A named test_fixture consultant said the interview felt values-driven",
          sourceType: "company_official_page",
          sourceLabel: "test_fixture Careers",
          authorContext: "Consultant, test_fixture city",
        },
      ],
    });
    assert.equal(result.sources.length, 1);
    assert.ok(result.sources[0]?.excerpt.includes("Culture, Values, And Inclusion"));
    assert.equal(result.partition.facts.length, 1);
    assert.equal(result.partition.opinions.length, 1);
    assert.equal(result.partition.contradictions.length, 0); // honest empty bucket, not fabricated
    assert.equal(result.disclosure.used.length, 1);
    assert.equal(result.disclosure.skipped.length, 0);

    const runs = await wiring.childAgentRuns.listByParentRun(PILOT_WORKSPACE, result.parentRunId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.budget.maxCalls, 1); // one bounded call per source
    assert.equal(runs[0]?.callsUsed, 1);
    assert.equal(runs[0]?.reviewMode, "approve"); // touchesExternalRisk forced this
  } finally {
    restore();
    await wiring.close();
  }
});

test("jobpilot.researchCulture: a claim citing a non-permitted source is rejected before any network access", async () => {
  const wiring = await buildWiring();
  const restore = stubFetchOnce();
  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response(STUB_HTML, { status: 200 });
  }) as typeof fetch;
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.jobpilot.researchCulture({
          workspaceId: PILOT_WORKSPACE,
          company: "test_fixture Co",
          candidateSources: [{ sourceType: "company_official_page", sourceLabel: "test_fixture Careers", url: TEST_FIXTURE_COMPANY_PAGE_URL }],
          claims: [
            {
              id: "bad1",
              claimType: "opinion",
              claimText: "A Glassdoor reviewer said X",
              sourceType: "glassdoor", // never offered as a candidate source, and do_not_use regardless
              sourceLabel: "Glassdoor reviews",
            },
          ],
        }),
      /not a permitted source/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = original;
    restore();
    await wiring.close();
  }
});

test("jobpilot.researchCulture: the fabrication/insider-claim guard fails the whole run closed", async () => {
  const wiring = await buildWiring();
  const restore = stubFetchOnce();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.jobpilot.researchCulture({
          workspaceId: PILOT_WORKSPACE,
          company: "test_fixture Co",
          candidateSources: [{ sourceType: "company_official_page", sourceLabel: "test_fixture Careers", url: TEST_FIXTURE_COMPANY_PAGE_URL }],
          claims: [
            {
              id: "bad1",
              claimType: "opinion",
              claimText: "I personally know a friend at test_fixture Co who gave me insider information about the interviewers.",
              sourceType: "company_official_page",
              sourceLabel: "test_fixture Careers",
            },
          ],
        }),
      /fabrication\/insider-claim guard/,
    );
  } finally {
    restore();
    await wiring.close();
  }
});

test("action.propose: a Human directly invoking jobpilot.researchCultureSource fails closed even with a valid goalTaskRef", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({
      workspaceId: PILOT_WORKSPACE,
      type: "jobpilot.culture_research",
      title: "test_fixture goal",
    });
    const task = await caller.agentOrchestration.task.create({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      type: "research_culture_source",
      assignedAgentId: LEARNING_AGENT,
    });
    const proposal = await caller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER, plane: "cloud" },
      action: "read",
      resourceType: "external:fetch",
      inputs: { sourceType: "company_official_page", sourceLabel: "x", url: TEST_FIXTURE_COMPANY_PAGE_URL },
      skill: "jobpilot.researchCultureSource",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    });
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  } finally {
    await wiring.close();
  }
});

test("action.propose: a Human directly invoking jobpilot.synthesizeCultureProfile fails closed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({
      workspaceId: PILOT_WORKSPACE,
      type: "jobpilot.culture_research",
      title: "test_fixture goal",
    });
    const task = await caller.agentOrchestration.task.create({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      type: "synthesize_culture_profile",
      assignedAgentId: INTERNAL_STRATEGIST_AGENT,
    });
    const proposal = await caller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "signal",
      inputs: { evidence: [], skippedSources: [] },
      skill: "jobpilot.synthesizeCultureProfile",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    });
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  } finally {
    await wiring.close();
  }
});
