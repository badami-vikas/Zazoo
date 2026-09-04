import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { LEARNING_AGENT, materializeCultureSourceFetch, cancelCultureSourceFetch } from "../wiring.js";
import type { Actor, DataScope } from "@bridge/core";
import { resolveSkillForTask, cancelChildAgentRun, ResearchRunAlreadyTerminalError, ResearchRunNotFoundError, RESEARCH_STEP_TOOLS, RESEARCH_STOP_REASONS } from "@bridge/core";
import { transition } from "@bridge/jobpilot";
import {
  authenticatedProcedure,
  completeResearchRun,
  createGovernedModelProvider,
  createGuardedPageReader,
  executeResearchRun,
  goalCreateInput,
  organizationGuard,
  recordResearchStep,
  resolveConfiguredModel,
  resolveSkillInput,
  runWebResearchSkill,
  startResearchRun,
  t,
  taskCreateInput,
  taskReassignInput,
  webResearchOutputSchema,
  type ResearchExecutorHooks,
} from "../router-shared.js";

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
    create: authenticatedProcedure.input(goalCreateInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
      return ctx.wiring.goalTasks.createGoal(
        { organizationId: input.organizationId, type: input.type, title: input.title },
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
      );
    }),
    list: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .use(organizationGuard).query(async ({ input, ctx }) => {
      return ctx.wiring.goalTasks.listGoals(input.organizationId);
    }),
  }),

  task: t.router({
    create: authenticatedProcedure.input(taskCreateInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
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
    listByGoal: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), goalId: z.string().min(1) }))
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return ctx.wiring.goalTasks.listTasksByGoal(input.organizationId, input.goalId);
      }),
    /** The ONLY thing that changes governed-Skill eligibility for a Task —
     * never a Skill manifest's `defaultAgents` preference list. */
    reassign: authenticatedProcedure.input(taskReassignInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
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
    webResearch: authenticatedProcedure
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
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        return runWebResearchSkill(ctx, input.organizationId, input);
      }),

    /** Read-only preview of AGS1 resolution — never invokes the Skill. Lets
     * the UI show WHY an Agent is (or is not) eligible before a real call. */
    resolve: authenticatedProcedure.input(resolveSkillInput).use(organizationGuard).query(async ({ input, ctx }) => {
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
    start: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            objective: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        return startResearchRun(ctx, input.organizationId, input.objective);
      }),
    /**
     * TASK-028 — the kernel drives the Research Run itself: start the Run,
     * then run the plan→search→read→synthesize loop server-side under the
     * same governed web-research Skill and child-Run evidence the desktop
     * executor records. Returns the running Run immediately; the loop is
     * detached and observable through `research.get` / `research.steps`.
     */
    execute: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            objective: z.string().trim().min(1).max(500),
            maxSteps: z.number().int().min(1).max(24).optional(),
          })
          .strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        // A planner is not optional: without a model the loop cannot choose
        // a next step, and a Run that cannot plan must not be started and
        // then quietly fail. Local plane only — this never opts a Run into
        // cloud model egress on the user's behalf.
        const model = resolveConfiguredModel(ctx.wiring.models, "reasoning");
        if (!model) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "no local-plane model is configured, so a background Research Run has nothing to plan with",
          });
        }
        const governedModel = createGovernedModelProvider(
          ctx,
          input.organizationId,
          model,
          "research_run_planning",
        );
        const run = await startResearchRun(ctx, input.organizationId, input.objective);
        const reader = createGuardedPageReader();
        const warnings: string[] = [];

        const hooks: ResearchExecutorHooks = {
          reader,
          onWarning: (message) => {
            warnings.push(message);
          },
          async search(objective, query) {
            const proposal = await runWebResearchSkill(ctx, input.organizationId, {
              objective: objective.slice(0, 500),
              scope: "public_web",
              searchQueries: [query.slice(0, 160)],
              budget: {
                maxResults: 5,
                maxResponseBytes: 256 * 1_024,
                maxProviderAttempts: 2,
                timeoutMs: 10_000,
              },
            });
            const parsed = webResearchOutputSchema.safeParse(
              proposal.output?.proposedOutput,
            );
            if (!parsed.success) return [];
            return parsed.data.citations.map((citation) => ({
              url: citation.url,
              title: null,
              excerpt: citation.summary,
              providerId: citation.providerId,
              retrievedAt: citation.retrievedAt,
            }));
          },
          async chat(messages) {
            const system = messages
              .filter((message) => message.role === "system")
              .map((message) => message.content)
              .join("\n\n");
            const prompt = messages
              .filter((message) => message.role !== "system")
              .map((message) => message.content)
              .join("\n\n");
            const completion = await governedModel.provider.complete({
              ...(system.length > 0 ? { system } : {}),
              prompt,
              maxTokens: 1_024,
              tier: "reasoning",
              cache: { strategy: "stable_system_prefix", ttl: "5m" },
            });
            return completion.text;
          },
          async appendStep(entry) {
            await recordResearchStep(ctx, input.organizationId, run, {
              stepIndex: entry.stepIndex,
              tool: entry.tool,
              summary: entry.summary.slice(0, 4_000),
              sourceUrl: entry.sourceUrl,
              ...(entry.quarantined
                ? {
                    quarantined: {
                      sourceUrl: entry.quarantined.sourceUrl.slice(0, 2_048),
                      text: entry.quarantined.text.slice(0, 400_000),
                    },
                  }
                : {}),
            });
          },
          async loadSteps() {
            const rows = await ctx.wiring.researchRuns.listSteps(
              input.organizationId,
              ctx.identity.id,
              run.id,
            );
            return rows.map((row) => ({
              stepIndex: row.stepIndex,
              tool: row.tool,
              summary: row.summary,
              sourceUrl: row.sourceUrl,
              ...(row.quarantinedText && row.quarantinedSourceUrl
                ? {
                    quarantined: {
                      trustOrigin: "untrusted_external" as const,
                      taintLabel: "untrusted_external" as const,
                      sourceUrl: row.quarantinedSourceUrl,
                      text: row.quarantinedText,
                    },
                  }
                : {}),
            }));
          },
          async stopRequested() {
            const current = await ctx.wiring.researchRuns.get(
              input.organizationId,
              ctx.identity.id,
              run.id,
            );
            return current?.stopRequested ?? false;
          },
          async finish(outcome) {
            await completeResearchRun(ctx, input.organizationId, run.id, outcome);
          },
        };

        const loop = executeResearchRun(
          {
            runId: run.id,
            objective: run.objective,
            ...(input.maxSteps ? { bounds: { maxSteps: input.maxSteps } } : {}),
          },
          hooks,
        );
        // `executeResearchRun` never rejects — it always freezes an outcome —
        // so detaching cannot strand an unhandled rejection.
        void loop;
        return run;
      }),

    recordStep: authenticatedProcedure
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
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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

        try {
          return await recordResearchStep(ctx, input.organizationId, run, input);
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

    requestStop: authenticatedProcedure
      .input(
        z.object({ organizationId: z.string().min(1), researchRunId: z.string().min(1) }).strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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

    complete: authenticatedProcedure
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
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        try {
          return await completeResearchRun(ctx, input.organizationId, input.researchRunId, {
            status: input.status,
            stopReason: input.stopReason,
            brief: input.brief,
            citations: input.citations,
            blockedActions: input.blockedActions,
            injectionReports: input.injectionReports,
            stepsTaken: input.stepsTaken,
          });
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
    get: authenticatedProcedure
      .input(
        z.object({ organizationId: z.string().min(1), researchRunId: z.string().min(1) }).strict(),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return ctx.wiring.researchRuns.get(input.organizationId, ctx.identity.id, input.researchRunId);
      }),

    list: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            limit: z.number().int().min(1).max(100).default(25),
          })
          .strict(),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return ctx.wiring.researchRuns.list(input.organizationId, ctx.identity.id, input.limit);
      }),

    /** Step timeline. Quarantined text stays out of responses unless the
     * caller is the executor resuming a Run (`includeQuarantined`) — the
     * Page renders engine-authored summaries, never raw page text. */
    steps: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            researchRunId: z.string().min(1),
            includeQuarantined: z.boolean().default(false),
          })
          .strict(),
      )
      .use(organizationGuard).query(async ({ input, ctx }) => {
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
    get: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), childRunId: z.string().min(1) }))
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return ctx.wiring.childAgentRuns.get(input.organizationId, input.childRunId);
      }),

    listByParentRun: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), parentRunId: z.string().min(1) }))
      .use(organizationGuard).query(async ({ input, ctx }) => {
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
    cancel: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), childRunId: z.string().min(1) }))
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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
