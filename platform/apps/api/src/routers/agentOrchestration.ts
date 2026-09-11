import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { LEARNING_AGENT, cancelCultureSourceFetch } from "../wiring.js";
import { type DataScope, resolveSkillForTask, cancelChildAgentRun, SearchProvidersUnavailableError, completeChildAgentRun, createChildAgentRun, failChildAgentRun, ResearchRunAlreadyTerminalError, ResearchRunNotFoundError, RESEARCH_STEP_TOOLS, RESEARCH_STOP_REASONS, hashTaintValue, labelAtSource, type ParentRunEnvelope } from "@bridge/core";
import { WEB_RESEARCH_SKILL_ID } from "../web-research-skill.js";
import { transition } from "@bridge/jobpilot";
import { t, procedure, provisionWebResearchTask, provisionResearchRunTask, assertWebResearchModuleBinding, persistWebResearchOutcome, goalCreateInput, taskCreateInput, taskReassignInput, resolveSkillInput } from "../router-shared.js";

/**
 * AGS0-AGS2 (TASK-007) — typed Goals/Tasks, the fail-closed Goal/Task-bound
 * Skill resolver, and bounded child Agent Runs. `skill.resolve` is a
 * read-only preview (never invokes anything); `skill.invoke` is the real
 * governed call — it goes through the SAME `pipeline.propose` every other
 * mutation uses, so a direct Human/Automation invocation of a governed
 * Skill fails closed there exactly as it would through `action.propose`
 * (see pipeline.ts's AGS1 gate) — this router adds no separate enforcement
 * path, only a more ergonomic Goal/Task-shaped surface over the same gate.
 */
export const agentOrchestrationRouter = t.router({
  goal: t.router({
    create: procedure.input(goalCreateInput).mutation(async ({ input, ctx }) => {
      return ctx.wiring.goalTasks.createGoal(
        { organizationId: input.organizationId, type: input.type, title: input.title },
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
      );
    }),
    list: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
      return ctx.wiring.goalTasks.listGoals(input.organizationId);
    }),
  }),

  task: t.router({
    create: procedure.input(taskCreateInput).mutation(async ({ input, ctx }) => {
      const goal = await ctx.wiring.goalTasks.getGoal(input.organizationId, input.goalId);
      const [agentOrganizationId, agentActive] = await Promise.all([
        ctx.wiring.agents.organizationId(input.assignedAgentId),
        ctx.wiring.agents.isActive(input.assignedAgentId),
      ]);
      if (!goal) {
        throw new TRPCError({ code: "NOT_FOUND", message: `unknown goal ${input.goalId}` });
      }
      if (agentOrganizationId !== input.organizationId || !agentActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this organization" });
      }
      return ctx.wiring.goalTasks.createTask(
        {
          organizationId: input.organizationId,
          goalId: input.goalId,
          type: input.type,
          assignedAgentId: input.assignedAgentId,
        },
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
      );
    }),
    listByGoal: procedure
      .input(z.object({ organizationId: z.string().min(1), goalId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return ctx.wiring.goalTasks.listTasksByGoal(input.organizationId, input.goalId);
      }),
    /** The ONLY thing that changes governed-Skill eligibility for a Task —
     * never a Skill manifest's `defaultAgents` preference list. */
    reassign: procedure.input(taskReassignInput).mutation(async ({ input, ctx }) => {
      const [agentOrganizationId, agentActive] = await Promise.all([
        ctx.wiring.agents.organizationId(input.assignedAgentId),
        ctx.wiring.agents.isActive(input.assignedAgentId),
      ]);
      if (agentOrganizationId !== input.organizationId || !agentActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this organization" });
      }
      return ctx.wiring.goalTasks.reassignTask(
        input.organizationId,
        input.taskId,
        input.assignedAgentId,
      );
    }),
  }),

  skill: t.router({
    webResearch: procedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            objective: z.string().trim().min(1).max(500),
            scope: z.literal("public_web"),
            searchQueries: z
              .array(z.string().trim().min(1).max(160))
              .min(1)
              .max(3),
            budget: z.object({
              maxResults: z.number().int().min(1).max(10),
              maxResponseBytes: z
                .number()
                .int()
                .min(1_024)
                .max(512 * 1_024),
              maxProviderAttempts: z.number().int().min(1).max(3),
              timeoutMs: z.number().int().min(1_000).max(15_000),
            }).strict(),
          })
          .strict(),
      )
      .mutation(async ({ input, ctx }) => {
        await assertWebResearchModuleBinding(
          ctx.wiring,
          input.organizationId,
        );
        const goalTaskRef = await provisionWebResearchTask(
          ctx.wiring,
          input.organizationId,
        );
        try {
          const proposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: {
                type: "agent",
                id: LEARNING_AGENT,
                plane: "cloud",
              },
              onBehalfOf: { type: "user", id: ctx.identity.id },
              action: "read",
              resourceType: "external:fetch",
              inputs: {
                objective: input.objective,
                scope: input.scope,
                searchQueries: input.searchQueries,
                budget: input.budget,
              },
              taintLabel: labelAtSource("human_input", {
                ref: `web-research:${ctx.identity.id}:${goalTaskRef.taskId}`,
                valueHash: hashTaintValue({
                  objective: input.objective,
                  searchQueries: input.searchQueries,
                }),
                sensitivity: "public",
                instructionRisk: "instruction_like",
              }),
              skill: WEB_RESEARCH_SKILL_ID,
              dataScope: "public",
              goalTaskRef,
              context: {
                type: "record",
                id: goalTaskRef.taskId,
                runId: ctx.run.ids.next(),
              },
            },
            ctx.run,
          );
          if (proposal.status === "rejected") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                proposal.rejectionReason ??
                "web research was rejected before persistence",
            });
          }
          const resultEvidence = await persistWebResearchOutcome(
            ctx.wiring,
            ctx.run,
            ctx.identity.id,
            input.organizationId,
            goalTaskRef,
            proposal,
          );
          return { ...proposal, resultEvidence };
        } catch (error) {
          if (error instanceof SearchProvidersUnavailableError) {
            const attempts = error.attempts
              .map((attempt) => `${attempt.providerId}:${attempt.status}`)
              .join(", ");
            throw new TRPCError({
              code: "BAD_GATEWAY",
              message: `web research unavailable (${attempts})`,
              cause: error,
            });
          }
          throw error;
        }
      }),

    /** Read-only preview of AGS1 resolution — never invokes the Skill. Lets
     * the UI show WHY an Agent is (or is not) eligible before a real call. */
    resolve: procedure.input(resolveSkillInput).query(async ({ input, ctx }) => {
      const goal = await ctx.wiring.goalTasks.getGoal(input.organizationId, input.goalId);
      const task = await ctx.wiring.goalTasks.getTask(input.organizationId, input.taskId);
      if (!goal || !task || task.goalId !== goal.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown or mismatched Goal/Task" });
      }
      const [agentScope, agentDataScope, agentOrganizationId, agentActive] = await Promise.all([
        ctx.wiring.agents.capabilityScope(input.agentId),
        ctx.wiring.agents.dataScope(input.agentId),
        ctx.wiring.agents.organizationId(input.agentId),
        ctx.wiring.agents.isActive(input.agentId),
      ]);
      const candidates = input.skillId
        ? ctx.wiring.skillManifests.forSkill(input.organizationId, input.skillId)
        : ctx.wiring.skillManifests.all(input.organizationId);
      const candidatePlanes = new Set(candidates.map((candidate) => candidate.plane));
      const intendedPlane =
        candidatePlanes.size === 1 ? candidates[0]!.plane : "local";
      return resolveSkillForTask(candidates, {
        goal,
        task,
        agent: {
          id: input.agentId,
          organizationId: agentOrganizationId,
          active: agentActive,
          capabilityScope: agentScope,
          // Preview the server-owned workflow plane when the candidate set is
          // unambiguous; actual invocation still enforces its runtime Actor plane.
          plane: intendedPlane,
          dataScope: agentDataScope,
        },
        ...(input.skillId ? { skillId: input.skillId } : {}),
        ...(input.requestedDataScope ? { requestedDataScope: input.requestedDataScope as DataScope } : {}),
      });
    }),
  }),

  /**
   * TASK-028 kernel-Run migration — durable, owner-scoped Research Run
   * records. The @bridge/research engine still EXECUTES wherever the
   * executor lives (today: the desktop overlay, per the user-approved
   * prototype-first path); this surface is the kernel's authoritative
   * projection of that loop: `start` mints the Run + its Goal/Task +
   * parent-Run envelope id, `recordStep` lands each executed step as a
   * TERMINAL child Agent Run (inspectable via `childRun.listByParentRun`
   * like every other delegation) plus an append-only step-evidence row
   * BR4 resume replays, `requestStop` is the cross-surface cooperative
   * interrupt the executor polls, and `complete` freezes the outcome
   * exactly once (enforced by store CAS + the 0035 DB trigger).
   */
  research: t.router({
    start: procedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            objective: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .mutation(async ({ input, ctx }) => {
        const goalTaskRef = await provisionResearchRunTask(ctx.wiring, input.organizationId);
        return ctx.wiring.researchRuns.create({
          id: ctx.run.ids.next(),
          organizationId: input.organizationId,
          ownerUserId: ctx.identity.id,
          objective: input.objective,
          status: "running",
          stopRequested: false,
          parentRunId: ctx.run.ids.next(),
          goalId: goalTaskRef.goalId,
          taskId: goalTaskRef.taskId,
          stopReason: null,
          brief: null,
          citations: [],
          blockedActions: [],
          injectionReports: [],
          stepsTaken: 0,
          startedAt: ctx.run.clock.nowISO(),
          endedAt: null,
        });
      }),

    recordStep: procedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            researchRunId: z.string().min(1),
            stepIndex: z.number().int().min(0).max(999),
            tool: z.enum(RESEARCH_STEP_TOOLS),
            summary: z.string().trim().min(1).max(4_000),
            sourceUrl: z.string().trim().min(1).max(2_048).nullish(),
            /** Untrusted external text this step gathered — kept ONLY so a
             * resumed Run replays its observations; never instructions. */
            quarantined: z
              .object({
                sourceUrl: z.string().trim().min(1).max(2_048),
                text: z.string().max(400_000),
              })
              .strict()
              .nullish(),
            /** The executor marks a step whose tool call itself failed. */
            failed: z.boolean().optional(),
          })
          .strict(),
      )
      .mutation(async ({ input, ctx }) => {
        const run = await ctx.wiring.researchRuns.get(
          input.organizationId,
          ctx.identity.id,
          input.researchRunId,
        );
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "unknown Research Run" });
        if (run.status !== "running") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Research Run is already ${run.status}`,
          });
        }

        const onBehalfOf = {
          type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team",
          id: ctx.identity.id,
        };
        const [learningScope, learningDataScope] = await Promise.all([
          ctx.wiring.agents.capabilityScope(LEARNING_AGENT),
          ctx.wiring.agents.dataScope(LEARNING_AGENT),
        ]);
        // The step already executed under the engine's green-tier authority
        // (AP-088): reading the public web is autonomous, so the child Run
        // records at "notify", never a retroactive "approve" that would
        // imply a Human decision existed. Steps run on the user's machine —
        // the LOCAL plane; the quarantined text they carry is untrusted web.
        const parentEnvelope: ParentRunEnvelope = {
          runId: run.parentRunId,
          agentId: LEARNING_AGENT,
          organizationId: input.organizationId,
          authorityScope: learningScope,
          eligibleSkills: [WEB_RESEARCH_SKILL_ID],
          dataScope: learningDataScope,
          plane: "local",
          budgetRemaining: { calls: 1_000, cost: 1_000 },
          reviewMode: "notify",
          childRunPolicy: "allowed",
          delegationDepth: 0,
          onBehalfOf,
          taintLabel: labelAtSource("human_input", {
            ref: `research-run:${run.id}`,
            valueHash: hashTaintValue({ objective: run.objective }),
            sensitivity: "public",
            instructionRisk: "instruction_like",
          }),
        };
        const childRun = await createChildAgentRun(
          { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
          parentEnvelope,
          {
            goalId: run.goalId,
            taskId: run.taskId,
            delegatedScope: ["external:fetch:read"],
            selectedSkills: [WEB_RESEARCH_SKILL_ID],
            budget: { maxCalls: 1, maxCost: 1 },
            deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
            stopCondition: `record one ${input.tool} step of Research Run ${run.id} and stop`,
            requestedDataScope: "public",
            ...(input.quarantined
              ? {
                  requestedTaintLabel: labelAtSource("web_search", {
                    ref: input.quarantined.sourceUrl,
                    valueHash: hashTaintValue({ text: input.quarantined.text }),
                    sensitivity: "public",
                    instructionRisk: "instruction_like",
                  }),
                }
              : {}),
          },
          ctx.run,
        );
        const transition = input.failed ? failChildAgentRun : completeChildAgentRun;
        await transition(
          { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
          input.organizationId,
          childRun.id,
          { type: "agent", id: LEARNING_AGENT },
          ctx.run,
        );

        try {
          const step = await ctx.wiring.researchRuns.appendStep({
            id: ctx.run.ids.next(),
            runId: run.id,
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            stepIndex: input.stepIndex,
            tool: input.tool,
            summary: input.summary,
            sourceUrl: input.sourceUrl ?? null,
            childRunId: childRun.id,
            quarantinedText: input.quarantined?.text ?? null,
            quarantinedSourceUrl: input.quarantined?.sourceUrl ?? null,
            createdAt: ctx.run.clock.nowISO(),
          });
          return { step, childRunId: childRun.id };
        } catch (error) {
          if (error instanceof ResearchRunAlreadyTerminalError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          }
          if (error instanceof ResearchRunNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }
      }),

    requestStop: procedure
      .input(
        z.object({ organizationId: z.string().min(1), researchRunId: z.string().min(1) }).strict(),
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await ctx.wiring.researchRuns.requestStop(
            input.organizationId,
            ctx.identity.id,
            input.researchRunId,
          );
        } catch (error) {
          if (error instanceof ResearchRunNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }
      }),

    complete: procedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            researchRunId: z.string().min(1),
            status: z.enum(["completed", "cancelled", "failed"]),
            stopReason: z.enum(RESEARCH_STOP_REASONS),
            brief: z.string().max(20_000).nullable(),
            citations: z.array(z.string().min(1).max(2_048)).max(200),
            blockedActions: z.array(z.string().min(1).max(2_000)).max(50),
            injectionReports: z.array(z.string().min(1).max(2_000)).max(50),
            stepsTaken: z.number().int().min(0).max(999),
          })
          .strict(),
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await ctx.wiring.researchRuns.complete(
            input.organizationId,
            ctx.identity.id,
            input.researchRunId,
            {
              status: input.status,
              stopReason: input.stopReason,
              brief: input.brief,
              citations: input.citations,
              blockedActions: input.blockedActions,
              injectionReports: input.injectionReports,
              stepsTaken: input.stepsTaken,
            },
            ctx.run.clock.nowISO(),
          );
        } catch (error) {
          if (error instanceof ResearchRunAlreadyTerminalError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          }
          if (error instanceof ResearchRunNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: error.message });
          }
          throw error;
        }
      }),

    /** Light poll target for the executor (stopRequested) — run row only. */
    get: procedure
      .input(
        z.object({ organizationId: z.string().min(1), researchRunId: z.string().min(1) }).strict(),
      )
      .query(async ({ input, ctx }) => {
        return ctx.wiring.researchRuns.get(input.organizationId, ctx.identity.id, input.researchRunId);
      }),

    list: procedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            limit: z.number().int().min(1).max(100).default(25),
          })
          .strict(),
      )
      .query(async ({ input, ctx }) => {
        return ctx.wiring.researchRuns.list(input.organizationId, ctx.identity.id, input.limit);
      }),

    /** Step timeline. Quarantined text stays out of responses unless the
     * caller is the executor resuming a Run (`includeQuarantined`) — the
     * Page renders engine-authored summaries, never raw page text. */
    steps: procedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            researchRunId: z.string().min(1),
            includeQuarantined: z.boolean().default(false),
          })
          .strict(),
      )
      .query(async ({ input, ctx }) => {
        const steps = await ctx.wiring.researchRuns.listSteps(
          input.organizationId,
          ctx.identity.id,
          input.researchRunId,
        );
        if (input.includeQuarantined) return steps;
        return steps.map((step) => ({
          ...step,
          quarantinedText: step.quarantinedText === null ? null : "[quarantined external text withheld]",
        }));
      }),
  }),

  childRun: t.router({
    get: procedure
      .input(z.object({ organizationId: z.string().min(1), childRunId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return ctx.wiring.childAgentRuns.get(input.organizationId, input.childRunId);
      }),

    listByParentRun: procedure
      .input(z.object({ organizationId: z.string().min(1), parentRunId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
      }),

    /** Governance/Human may stop any child Run within policy. The acting
     * identity is SERVER-RESOLVED (`ctx.identity`), never client-asserted —
     * same rule every mutation in this router follows.
     *
     * TASK-011 remediation (2026-07-19 coordinator distributed-defects
     * RE-review round 2, issue 5) — a culture-research fetch's cancellation
     * is NOT just a child-Run status flip: it has its OWN durable
     * cancellation mechanism (`DurableCultureFetchStore.requestCancel` +
     * the in-flight `AbortController`) that actually stops the real
     * outbound socket, cross-instance-safe via the durable
     * `cancelRequested` flag `materializeCultureSourceFetch`'s own poll
     * loop watches. Calling `cancelChildAgentRun` directly here (as this
     * generic endpoint used to, unconditionally) would race that
     * mechanism: the child Run could be marked "cancelled" while the
     * underlying fetch keeps running, unaware, eventually landing
     * "fetched"/"failed" against an already-terminal child Run — a
     * fetched/cancelled mismatch this endpoint must not create. Route
     * THROUGH the registered per-operation cancellation for any child Run
     * that IS a culture-research fetch; only fall back to the generic
     * child-Run-only transition for every other (non-culture) child Run.
     */
    cancel: procedure
      .input(z.object({ organizationId: z.string().min(1), childRunId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
      const cultureFetchRecord = await ctx.wiring.cultureFetchStore.get(input.organizationId, input.childRunId);
      if (cultureFetchRecord && cultureFetchRecord.proposalId) {
        await cancelCultureSourceFetch(
          {
            childAgentRuns: ctx.wiring.childAgentRuns,
            ledger: ctx.wiring.ledger,
            fetchStore: ctx.wiring.cultureFetchStore,
            abortControllers: ctx.wiring.cultureFetchAbortControllers,
          },
          input.organizationId,
          cultureFetchRecord.proposalId,
          input.childRunId,
          { type: ctx.identity.type, id: ctx.identity.id },
          ctx.run,
        );
        // `cancelCultureSourceFetch` already transitions the child Run
        // itself (via its own fenced/lease-aware path) whenever its own
        // durable write actually commits. Whether that happened just now,
        // already happened earlier, or the fetch had already reached a
        // DIFFERENT terminal outcome (fetched/failed) before this request
        // arrived, the child Run's CURRENT, authoritative record is always
        // the correct thing to return here — never a stale optimistic
        // "cancelled" that might not match what the fetch actually
        // resolved to (no fetched/cancelled mismatch is swallowed; the
        // caller sees the real converged state).
        const current = await ctx.wiring.childAgentRuns.get(input.organizationId, input.childRunId);
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "unknown child Run" });
        return current;
      }
      return cancelChildAgentRun(
        { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
        input.organizationId,
        input.childRunId,
        { type: ctx.identity.type, id: ctx.identity.id },
        ctx.run,
      );
    }),
  }),
});
