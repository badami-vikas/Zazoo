import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { LEARNING_AGENT, INTERNAL_STRATEGIST_AGENT, resolveAuthorizedCultureSource, computeSourcePolicyHash, materializeCultureSourceFetch, cancelCultureSourceFetch, reconcileIntentChildConsistency, selfHealDeadSynthesisPointer, isResultExpired, CULTURE_SOURCE_REGISTRY, type SynthesizeCultureProfileOutput } from "../wiring.js";
import { type Action, type DataScope, type ResourceType, createChildAgentRun, hashTaintValue, labelAtSource, type ParentRunEnvelope, uuidv7 } from "@bridge/core";
import { jobsTableSpec, scoreJobFit, transition, InvalidTransitionError, classifyCultureSource, MAX_CULTURE_SOURCES_PER_RUN, JOB_FUNCTIONS, type ApplicationStage, type CandidateProfile, type JobProfile, type GroundedClaimInput } from "@bridge/jobpilot";
import { t, procedure, provisionCultureResearchTask, provisionCultureSynthesisTask, paginatedInput, synthesizeCultureProfileOutputSchema } from "../router-shared.js";

/**
 * JobPilot — wires the pure `@bridge/jobpilot` module (scoring, state-machine,
 * table spec) to real persistence for the first time (frontend-migration-
 * scoping.md Phase 4). Job/application CRUD is organization-authenticated, not
 * routed through the governed pipeline — tracking a job posting has no
 * external effect requiring approval, same tier as organization membership.
 * `transition` validates against @bridge/jobpilot's own state machine BEFORE
 * persisting, so an invalid stage jump is rejected here, not silently written.
 */
export const jobpilotRouter = t.router({
  definition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      return jobsTableSpec;
    }),

  create: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        title: z.string().min(1),
        company: z.string().min(1),
        location: z.string().optional(),
        salaryMax: z.number().int().positive().optional(),
        url: z.string().url().optional(),
        source: z.string().optional(),
        isRemote: z.boolean().optional(),
        descriptionKeywords: z.array(z.string()).optional(),
        candidate: z.object({
          categories: z.array(z.string()),
          skills: z.array(z.string()),
          minSalary: z.number().optional(),
          locations: z.array(z.string()).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const job: JobProfile = {
        title: input.title,
        company: input.company,
        ...(input.location ? { location: input.location } : {}),
        ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
        ...(input.isRemote != null ? { isRemote: input.isRemote } : {}),
        ...(input.descriptionKeywords ? { descriptionKeywords: input.descriptionKeywords } : {}),
      };
      const candidate: CandidateProfile = {
        categories: input.candidate.categories,
        skills: input.candidate.skills,
        ...(input.candidate.minSalary != null ? { minSalary: input.candidate.minSalary } : {}),
        ...(input.candidate.locations ? { locations: input.candidate.locations } : {}),
      };
      const fit = scoreJobFit(job, candidate);
      const { job: jobRow, application } = await ctx.wiring.jobpilotStore.createJob({
        organizationId: input.organizationId,
        title: input.title,
        company: input.company,
        ...(input.location ? { location: input.location } : {}),
        ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.source ? { source: input.source } : {}),
      });
      const scored = await ctx.wiring.jobpilotStore.updateApplication(application.id, { fitScore: fit.score, flag: fit.flag });
      return { job: jobRow, application: scored ?? application, fit };
    }),

  list: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.jobpilotStore.listJobs(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  /** Moves an application's stage — rejects invalid jumps via @bridge/jobpilot's
   * own transition() BEFORE writing (queued->tailoring->evaluating->... only). */
  transition: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        applicationId: z.string().uuid(),
        from: z.string(),
        to: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const application = await ctx.wiring.jobpilotStore.getApplication(input.applicationId, input.organizationId);
      if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "unknown application" });
      try {
        transition(application.stage as ApplicationStage, input.to as ApplicationStage, application.id, "user");
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const updated = await ctx.wiring.jobpilotStore.updateApplication(application.id, { stage: input.to });
      return updated;
    }),

  /**
   * TASK-076 — onboarding: upload resume, select interested jobs, rank-order
   * job functions, then the wizard is done for good. The resume file itself
   * goes through the existing `modules.addFile` Module File path (same
   * storage every other Module upload uses); these procedures only track
   * which file was chosen and the ranked selection.
   */
  onboarding: t.router({
    get: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const profile = await ctx.wiring.jobpilotStore.getCandidateProfile(input.organizationId);
        return { profile, availableFunctions: JOB_FUNCTIONS };
      }),

    saveResume: procedure
      .input(z.object({ organizationId: z.string().min(1), resumeFileName: z.string().min(1) }))
      .mutation(({ input, ctx }) => {
        return ctx.wiring.jobpilotStore.saveOnboardingResume(input.organizationId, input.resumeFileName);
      }),

    /** Step 3 — index 0 of `selectedFunctions` is the top-ranked function.
     * Persisting this is the end of onboarding (`completedAt` is set here). */
    complete: procedure
      .input(z.object({
        organizationId: z.string().min(1),
        selectedFunctions: z
          .array(z.string())
          .min(1)
          .refine(
            (values) => values.every((value) => (JOB_FUNCTIONS as readonly string[]).includes(value)),
            "unknown job function",
          ),
      }))
      .mutation(({ input, ctx }) => {
        return ctx.wiring.jobpilotStore.completeOnboarding(input.organizationId, input.selectedFunctions);
      }),
  }),

  /**
   * JP3B (TASK-011) — cited company-culture research, TWO-PHASE (remediated
   * 2026-07-17, see outputs/2026-07-17-jobpilot-culture-research-task011.md).
   *
   * `propose` resolves ONLY server-owned `sourceId`s (never a client-supplied
   * URL/type/label — see `resolveAuthorizedCultureSource`), gates every
   * non-`permitted` source type before any child Run or network access, and
   * creates a genuinely side-effect-free pipeline proposal per permitted
   * source (the Skill's `run()` is pure). NOTHING is fetched yet.
   *
   * A human decision (`action.decide`) must approve a specific proposal
   * before `materialize` will perform the real, guarded fetch for it — a
   * vetoed or never-decided proposal can never reach the network. `cancel`
   * aborts an in-flight fetch for real (or, before any fetch starts, simply
   * guarantees one never will). `synthesize` only accepts claims that
   * `groundClaims` can verify against the results THIS run actually
   * fetched — an absent/mutated quote or a forged contradiction reference
   * fails the whole batch closed.
   */
  cultureResearch: t.router({
    /** Lists the server-owned authorized sources for a company — the ONLY
     * way a client learns which `sourceId`s exist to propose. Never
     * exposes the underlying URL (irrelevant to the client until fetched
     * and disclosed) — just enough to render a source picker and an
     * honest "why is Glassdoor/Reddit/Google reviews skipped" explanation
     * for ineligible sources, matching the disclosure the propose/synthesize
     * flow already builds server-side. */
    sources: procedure
      .input(z.object({ organizationId: z.string().min(1), company: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return CULTURE_SOURCE_REGISTRY.filter((s) => s.organizationId === input.organizationId && s.company === input.company).map((s) => {
          const classification = classifyCultureSource(s.sourceType);
          return { id: s.id, sourceLabel: s.sourceLabel, sourceType: s.sourceType, eligibility: classification.eligibility, reason: classification.reason };
        });
      }),

    propose: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          company: z.string().min(1),
          sourceIds: z.array(z.string().min(1)).min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {

        // Dedupe before anything else — a caller listing the same id many
        // times must not reserve many times the budget/fan-out.
        const dedupedIds = Array.from(new Set(input.sourceIds));
        if (dedupedIds.length > MAX_CULTURE_SOURCES_PER_RUN) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `at most ${MAX_CULTURE_SOURCES_PER_RUN} sources may be researched per run (received ${dedupedIds.length} distinct ids)`,
          });
        }

        // Resolve every id server-side. ANY unknown, or cross-organization/
        // cross-company, id fails the WHOLE request closed — a forged id in
        // the batch is treated as a misuse signal, not a partial skip.
        const resolved = dedupedIds.map((id) => ({ id, source: resolveAuthorizedCultureSource(input.organizationId, input.company, id) }));
        const unknown = resolved.filter((r) => !r.source);
        if (unknown.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `unknown or unauthorized source id(s) for this organization/company: ${unknown.map((u) => u.id).join(", ")}`,
          });
        }
        const sources = resolved.map((r) => r.source!);

        const permitted = sources.filter((s) => classifyCultureSource(s.sourceType).eligibility === "permitted");
        const skipped = sources
          .filter((s) => classifyCultureSource(s.sourceType).eligibility !== "permitted")
          .map((s) => {
            const classification = classifyCultureSource(s.sourceType);
            return { sourceId: s.id, sourceType: s.sourceType, sourceLabel: s.sourceLabel, eligibility: classification.eligibility, reason: classification.reason };
          });

        const onBehalfOf = { type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team", id: ctx.identity.id };
        const researchGoalTask = await provisionCultureResearchTask(ctx.wiring, input.organizationId);

        const [learningScope, learningDataScope] = await Promise.all([
          ctx.wiring.agents.capabilityScope(LEARNING_AGENT),
          ctx.wiring.agents.dataScope(LEARNING_AGENT),
        ]);
        const parentRunId = uuidv7();
        // FIXED budget from the server-owned cap — NEVER derived from the
        // caller's request length (TASK-011 remediation #4).
        const parentEnvelope: ParentRunEnvelope = {
          runId: parentRunId,
          agentId: LEARNING_AGENT,
          organizationId: input.organizationId,
          authorityScope: learningScope,
          eligibleSkills: ["jobpilot.researchCultureSource"],
          dataScope: learningDataScope,
          plane: "cloud",
          budgetRemaining: { calls: MAX_CULTURE_SOURCES_PER_RUN, cost: MAX_CULTURE_SOURCES_PER_RUN },
          reviewMode: "approve",
          childRunPolicy: "allowed",
          delegationDepth: 0,
          onBehalfOf,
        };

        const pending: Array<{ proposalId: string; childRunId: string; sourceId: string; sourceType: string; sourceLabel: string }> = [];
        for (const source of permitted) {
          const childRun = await createChildAgentRun(
            { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
            parentEnvelope,
            {
              goalId: researchGoalTask.goalId,
              taskId: researchGoalTask.taskId,
              delegatedScope: ["external:fetch:read"],
              selectedSkills: ["jobpilot.researchCultureSource"],
              budget: { maxCalls: 1, maxCost: 1 },
              deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
              stopCondition: `fetch "${source.sourceLabel}" once, only after human approval, and stop`,
              requestedDataScope: "public",
              touchesExternalRisk: true,
            },
            ctx.run,
          );

          // TASK-011 remediation (2026-07-18 final review, issue 1) —
          // create the DURABLE culture-fetch intent record BEFORE the
          // ledger proposal exists, pinning the canonical URL/redirect-
          // origin allowlist/goal+task/skill/actor from the SERVER-owned
          // registry right now. `materialize`/`cancel` will re-resolve the
          // registry fresh again later and refuse to proceed if it no
          // longer matches — this pin is what a restart or a race can
          // never silently bypass.
          await ctx.wiring.cultureFetchStore.create({
            childRunId: childRun.id,
            parentRunId,
            organizationId: input.organizationId,
            company: input.company,
            sourceId: source.id,
            sourceType: source.sourceType,
            sourceLabel: source.sourceLabel,
            canonicalUrl: source.url,
            allowedRedirectOrigins: source.allowedRedirectOrigins,
            // TASK-011 remediation (2026-07-19, issue 7) — pin the FULL
            // security-policy snapshot, not just the URL, so materialize
            // can detect an eligibility/redirect-origin change at the SAME
            // URL between propose and materialize.
            policySnapshot: {
              registryVersion: computeSourcePolicyHash(source),
              eligibility: classifyCultureSource(source.sourceType).eligibility,
            },
            goalId: researchGoalTask.goalId,
            taskId: researchGoalTask.taskId,
            skill: "jobpilot.researchCultureSource",
            action: "read",
            actorId: LEARNING_AGENT,
          });

          // TASK-011 remediation (2026-07-19 coordinator distributed-
          // defects RE-review round 2, issue 6) — PREALLOCATE the
          // proposal's id and durably BIND it to the intent record BEFORE
          // any real ledger proposal can exist bearing that id. This
          // eliminates the "approvable orphan" crash window entirely
          // (rather than merely arguing a post-hoc window is inert): the
          // ONLY way `pipeline.propose` can produce an approvable
          // (`pending_review`) or auto-applied ledger row is via
          // `#appendLedger`, which honors `options.proposalId` — so by
          // construction, a real ledger row can only ever bear an id this
          // intent record was ALREADY bound to before propose() was even
          // called. `pipeline.propose`'s own internal rejection path
          // (`#reject`) always mints its OWN fresh id and never reaches
          // `pending_review`/`applied`, so a rejection leaves this bound
          // id permanently pointing at nothing — inert dead weight, never
          // approvable, never visible in `action.listPending`.
          const proposalId = ctx.run.ids.next();
          await ctx.wiring.cultureFetchStore.attachProposal(input.organizationId, childRun.id, proposalId);

          // PURE — no network access. Proposing this is genuinely side-effect-free.
          const proposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: "agent", id: LEARNING_AGENT, plane: "cloud" },
              onBehalfOf,
              action: "read" as Action,
              resourceType: "external:fetch" as ResourceType,
              skill: "jobpilot.researchCultureSource",
              dataScope: "public" as DataScope,
              inputs: { sourceId: source.id, organizationId: input.organizationId, company: input.company },
              taintLabel: labelAtSource("system_generated", {
                ref: `culture-source-intent:${source.id}`,
                valueHash: hashTaintValue({
                  organizationId: input.organizationId,
                  company: input.company,
                  sourceId: source.id,
                }),
                sensitivity: "public",
                instructionRisk: "none",
              }),
              goalTaskRef: { goalId: researchGoalTask.goalId, taskId: researchGoalTask.taskId },
              context: { type: "child_agent_run", id: childRun.id, runId: parentRunId },
              // TASK-011 remediation (2026-07-19 coordinator distributed-
              // defects RE-review round 2, issue 9) — this Run's whole
              // purpose is to fetch UNTRUSTED external content (a company's
              // own public page, never operator/user-authored) — tag the
              // turn's provenance accordingly (PI-1) so it is threaded
              // through the persisted ledger row and any downstream taint
              // checks, never defaulting to an implicit "trusted" origin.
              trustOrigin: "untrusted_external",
            },
            ctx.run,
            { proposalId },
          );
          if (proposal.status === "rejected") {
            throw new TRPCError({ code: "BAD_REQUEST", message: proposal.rejectionReason ?? "culture-research proposal was rejected" });
          }
          pending.push({ proposalId: proposal.id, childRunId: childRun.id, sourceId: source.id, sourceType: source.sourceType, sourceLabel: source.sourceLabel });
        }

        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 13) — record this run as the LATEST for this
        // company via the durable O(1) pointer, replacing the organization-
        // wide scan `listByCompany` previously used by `latestRun`.
        await ctx.wiring.cultureLatestRunPointerStore.recordLatestRun(input.organizationId, input.company, parentRunId);

        return { parentRunId, pending, skipped };
      }),

    /** Real, guarded fetch — invoked ONLY after `action.decide` has approved
     * `proposalId` (re-checked from the ledger here, never trusted from the
     * caller). Idempotent: re-materializing an already-resolved source
     * returns the stored record instead of refetching. */
    materialize: procedure
      .input(z.object({ organizationId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        try {
          const record = await materializeCultureSourceFetch(
            {
              childAgentRuns: ctx.wiring.childAgentRuns,
              ledger: ctx.wiring.ledger,
              fetchStore: ctx.wiring.cultureFetchStore,
              abortControllers: ctx.wiring.cultureFetchAbortControllers,
            },
            input.organizationId,
            input.proposalId,
            input.childRunId,
            ctx.run,
          );
          return record;
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
        }
      }),

    /** Cancels a pending/in-flight source fetch — aborts a REAL in-flight
     * request when one is running, or guarantees one never starts. */
    cancel: procedure
      .input(z.object({ organizationId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        try {
          const record = await cancelCultureSourceFetch(
            {
              childAgentRuns: ctx.wiring.childAgentRuns,
              ledger: ctx.wiring.ledger,
              fetchStore: ctx.wiring.cultureFetchStore,
              abortControllers: ctx.wiring.cultureFetchAbortControllers,
            },
            input.organizationId,
            input.proposalId,
            input.childRunId,
            { type: ctx.identity.type, id: ctx.identity.id },
            ctx.run,
          );
          return record;
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
        }
      }),

    status: procedure
      .input(z.object({ organizationId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const record = await ctx.wiring.cultureFetchStore.getByProposal(input.organizationId, input.proposalId, input.childRunId);
        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown culture-research proposal" });
        }
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 3) — self-repair any intent/child terminal
        // inconsistency on every read a client polls, not only inside
        // `materialize`'s own retry path.
        await reconcileIntentChildConsistency(ctx.wiring, input.organizationId, record, ctx.run);
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 7) — never serve expired evidence: purge an
        // expired result's raw content on this read (idempotent,
        // metadata-preserving) and return the (possibly just-purged)
        // current record rather than the pre-purge snapshot.
        const purged = await ctx.wiring.cultureFetchStore.purgeExpiredResultContentIfNeeded(input.organizationId, input.childRunId, ctx.run.clock.nowISO());
        return purged ?? record;
      }),

    /**
     * Internal Strategist's synthesis — claims must GROUND against results
     * this run actually fetched (`groundClaims`, invoked inside the Skill).
     * Skipped sources are recomputed SERVER-SIDE from the registry (never
     * trusted from the client) so the disclosure is authoritative.
     */
    synthesize: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          company: z.string().min(1),
          /** TASK-011 remediation (2026-07-18 final review, issue 6) — the
           * EXACT parent Agent Run this synthesis is scoped to. Fetched
           * results are resolved ONLY from this run's own child Runs,
           * never pooled across historical/concurrent runs for the same
           * company. */
          parentRunId: z.string().min(1),
          claims: z.array(
            z.object({
              id: z.string().min(1),
              claimType: z.enum(["fact", "opinion", "theme", "contradiction", "inference"]),
              quote: z.string().optional(),
              sourceId: z.string().optional(),
              contentHash: z.string().optional(),
              // TASK-011 remediation (2026-07-19 coordinator distributed-
              // defects RE-review, issue 11) — `authorContext` REMOVED
              // from the accepted input shape entirely. Accepting
              // arbitrary caller text here and rendering it verbatim as
              // "who said it" attribution was a genuine fabrication
              // vector; this slice's Tier-1 sources carry no
              // server-extracted per-claim author metadata to derive it
              // from honestly. `groundClaims` never assigns anything but
              // `null` to this field now regardless.
              supportingClaimIds: z.array(z.string()).optional(),
              contradicts: z.array(z.string()).optional(),
            }),
          ),
        }),
      )
      .mutation(async ({ input, ctx }) => {

        // TASK-011 remediation (2026-07-18 final review, issue 6) — resolve
        // fetched results from THIS EXACT parent Run's own child Runs
        // only, via the durable `cultureFetchStore`, never by scanning
        // every fetch this organization/company has ever made (which would
        // silently pool evidence across historical or concurrent runs).
        const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
        if (childRuns.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `unknown parent Run "${input.parentRunId}" for this organization` });
        }
        const intentRecords = (
          await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.organizationId, childRun.id)))
        ).filter((r): r is NonNullable<typeof r> => r != null);
        const mismatchedCompany = intentRecords.find((r) => r.company !== input.company);
        if (mismatchedCompany) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `parent Run "${input.parentRunId}" does not belong to company "${input.company}"` });
        }
        const fetchedIntents = intentRecords.filter((r) => r.status === "fetched" && r.result);
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issues 7/8) — an EXPIRED result must never be
        // consumed by a NEW synthesis attempt ("never serve expired
        // evidence" applies to synthesis input, not just direct reads).
        // Treat an expired source as NOT fetched for this purpose —
        // `groundClaims` will then correctly reject any claim citing it
        // as `unknown-source`, rather than confusingly failing quote
        // verification against silently-blanked content.
        const nowISO = ctx.run.clock.nowISO();
        const unexpiredFetchedIntents = fetchedIntents.filter((r) => !isResultExpired(r.result!, nowISO));
        const seenSourceIds = new Set<string>();
        for (const r of unexpiredFetchedIntents) {
          if (seenSourceIds.has(r.sourceId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `duplicate fetched result for source "${r.sourceId}" under this run` });
          }
          seenSourceIds.add(r.sourceId);
        }
        const fetchedResults = unexpiredFetchedIntents.map((r) => r.result!);
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 8) — reject an EMPTY submission BEFORE ever
        // calling `pipeline.propose`/recording the synthesis pointer.
        // Without this, a caller could submit zero claims and/or find
        // zero unexpired fetched results, and STILL have a synthesis
        // proposal created and durably pointed to — poisoning the
        // first-write-wins synthesis pointer for this parentRunId with a
        // worthless/empty result BEFORE any real fetch has even
        // completed, permanently blocking a later legitimate synthesis
        // attempt from ever winning that pointer.
        if (input.claims.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "synthesize requires at least one claim — an empty submission is rejected before any proposal is created" });
        }
        if (fetchedResults.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "synthesize requires at least one unexpired fetched result for this parent Run — no claim can ground against zero evidence" });
        }
        const skippedSources = CULTURE_SOURCE_REGISTRY.filter(
          (s) => s.organizationId === input.organizationId && s.company === input.company && classifyCultureSource(s.sourceType).eligibility !== "permitted",
        ).map((s) => {
          const classification = classifyCultureSource(s.sourceType);
          return { sourceLabel: s.sourceLabel, sourceType: s.sourceType, reason: classification.reason };
        });

        const onBehalfOf = { type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team", id: ctx.identity.id };
        const synthesisGoalTask = await provisionCultureSynthesisTask(ctx.wiring, input.organizationId);

        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review round 2, issue 7) — self-heal a STALE pointer before
        // preallocating a new one. Preallocating the pointer before
        // `propose` (below) closes the "append-without-pointer orphan"
        // window, but introduces its mirror: a genuine process crash
        // strictly BETWEEN `recordProposal` succeeding and `propose` ever
        // creating a real ledger row would otherwise leave a dead pointer
        // that permanently blocks every future synthesis attempt for this
        // parentRunId (recordProposal is first-write-wins and would keep
        // refusing to rebind it). Detect this specific case — a pointer
        // whose proposalId does NOT resolve to any real ledger row at
        // all — and release it before this attempt's own preallocation. A
        // pointer whose proposalId DOES resolve (however that proposal was
        // ultimately decided) is left untouched here; that case is a live,
        // real synthesis and is not this function's concern.
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review round 2, issue 7 — hardened after a fresh independent
        // review found the original inline self-heal check unsafe: a bare
        // "ledger.get returned null" check cannot distinguish a genuinely
        // dead pointer (crash between recordProposal and propose) from a
        // live, in-flight concurrent synthesize() call for the SAME
        // parentRunId that simply hasn't reached #appendLedger yet — the
        // ORIGINAL version could self-heal (release + rebind) a still-live
        // winner's pointer out from under it, permanently orphaning their
        // soon-to-exist valid ledger row against the NEW
        // assertCultureProposalBindingValid backstop. `selfHealDeadSynthesisPointer`
        // additionally requires the pointer to be older than a grace
        // period before ever releasing it — see its own doc comment.
        await selfHealDeadSynthesisPointer(
          { cultureSynthesisPointerStore: ctx.wiring.cultureSynthesisPointerStore, ledger: ctx.wiring.ledger },
          input.organizationId,
          input.parentRunId,
          ctx.run.clock.nowISO(),
        );

        // PREALLOCATE the proposal id and durably record the (parentRunId
        // -> proposalId) pointer BEFORE any real ledger proposal can exist
        // bearing that id — the same preallocation pattern as the research
        // `propose` handler (issue 6). This closes the "append-without-
        // pointer orphan" crash window structurally rather than relying
        // solely on `synthesisResult`'s own self-repair (which still
        // requires a client-supplied proposalId and remains as defense in
        // depth for any pointer later lost/corrupted). `recordProposal` is
        // first-write-wins (`writeIfAbsent`): a losing concurrent
        // `synthesize` call for the SAME parentRunId now fails BEFORE ever
        // creating a real ledger proposal at all, rather than after.
        const proposalId = ctx.run.ids.next();
        try {
          await ctx.wiring.cultureSynthesisPointerStore.recordProposal(input.organizationId, input.parentRunId, input.company, proposalId);
        } catch (error) {
          throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : String(error) });
        }

        let synthesisProposal;
        try {
          synthesisProposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
              onBehalfOf,
              action: "write" as Action,
              resourceType: "signal" as ResourceType,
              skill: "jobpilot.synthesizeCultureProfile",
              dataScope: "all" as DataScope,
              // TASK-011 remediation (2026-07-19 coordinator distributed-
              // defects RE-review round 2, issue 8) — NO result bodies
              // here. `req.inputs` is persisted VERBATIM into the
              // immutable ledger row by `pipeline.propose`; the Skill
              // resolves its own results internally (see
              // `createSynthesizeCultureProfileSkill`) so the ledger never
              // durably retains full raw fetched content.
              inputs: { organizationId: input.organizationId, parentRunId: input.parentRunId, claims: input.claims as GroundedClaimInput[], skippedSources },
              taintLabel: labelAtSource("web_search", {
                ref: `culture-synthesis:${input.parentRunId}`,
                valueHash: hashTaintValue({
                  claims: input.claims,
                  skippedSources,
                }),
                sensitivity: "public",
                instructionRisk: "data",
              }),
              goalTaskRef: { goalId: synthesisGoalTask.goalId, taskId: synthesisGoalTask.taskId },
              // TASK-011 remediation (2026-07-19 coordinator distributed-
              // defects RE-review round 2, issue 9) — Internal Strategist
              // is reasoning DIRECTLY over untrusted external evidence
              // (the fetched results) here, even though the claims
              // themselves are grounded/validated — the turn's provenance
              // (PI-1) must reflect that, threaded through the persisted
              // ledger row, `action.decide`, and `synthesisResult`'s own
              // response (never silently defaulting to a trusted origin
              // just because the OUTPUT happens to be schema-validated).
              trustOrigin: "untrusted_external",
            },
            ctx.run,
            { proposalId },
          );
        } catch (error) {
          // The Skill threw synchronously (e.g. a claim-grounding failure)
          // BEFORE any real ledger row was ever created — release OUR OWN
          // preallocated pointer binding (never a different, concurrently-
          // won one) so a legitimate retry for this parentRunId is not
          // permanently blocked by a doomed attempt.
          await ctx.wiring.cultureSynthesisPointerStore.releaseIfMatching(input.organizationId, input.parentRunId, proposalId, ctx.wiring.ledger).catch(() => {});
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
        }
        if (synthesisProposal.status === "rejected") {
          // `#reject`'s ledger row bears its OWN auto-generated id, never
          // OUR preallocated one — release it the same way, for the same
          // reason (an authority/policy rejection must not permanently
          // consume the pointer for this parentRunId either).
          await ctx.wiring.cultureSynthesisPointerStore.releaseIfMatching(input.organizationId, input.parentRunId, proposalId, ctx.wiring.ledger).catch(() => {});
          throw new TRPCError({ code: "BAD_REQUEST", message: synthesisProposal.rejectionReason ?? "culture-research synthesis was rejected" });
        }
        return { proposalId: synthesisProposal.id, status: synthesisProposal.status };
      }),

    /**
     * TASK-011 remediation (2026-07-19 coordinator distributed-defects
     * review, issue 13) — the SERVER-AUTHORITATIVE resume query. Returns
     * the latest culture-research parent Run (and its pending sources +
     * synthesis proposal id, if any) for one (organizationId, company),
     * derived entirely from durable server state via
     * `DurableCultureFetchStore.listByCompany` +
     * `DurableCultureSynthesisPointerStore` — NEVER from anything the
     * client supplies. The web UI calls this on every mount and treats its
     * result as authoritative; any local `localStorage` pointer is only a
     * paint-ahead cache, overwritten by whatever this query returns
     * (including `null`, if the server has no record — e.g. storage from a
     * stale/foreign organization). This is what makes "clear storage / change
     * device, still see pending/completed research" possible.
     */
    latestRun: procedure
      .input(z.object({ organizationId: z.string().min(1), company: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 13) — an O(1) durable pointer lookup, NOT a
        // organization-wide scan-then-limit-then-filter (the prior
        // `listByCompany` approach, which could silently hide the real
        // latest run behind enough unrelated Memories at scale). The
        // pointer names the exact `parentRunId`; its pending sources are
        // then resolved via `childAgentRuns.listByParentRun` (already
        // indexed by organization+parentRunId) rather than any broad scan.
        const pointer = await ctx.wiring.cultureLatestRunPointerStore.getLatestRun(input.organizationId, input.company);
        if (!pointer) return null;
        const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, pointer.parentRunId);
        const intentRecords = (
          await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.organizationId, childRun.id)))
        ).filter((r): r is NonNullable<typeof r> => r != null && r.company === input.company);
        const pending = intentRecords
          .filter((r) => r.proposalId)
          .map((r) => ({ proposalId: r.proposalId!, childRunId: r.childRunId, sourceId: r.sourceId, sourceType: r.sourceType, sourceLabel: r.sourceLabel }));
        const synthesisPointer = await ctx.wiring.cultureSynthesisPointerStore.getForParentRun(input.organizationId, pointer.parentRunId);
        return {
          parentRunId: pointer.parentRunId,
          pending,
          ...(synthesisPointer ? { synthesisProposalId: synthesisPointer.proposalId } : {}),
        };
      }),

    /**
     * Reads the PERSISTED, APPROVED synthesis result — TASK-011 remediation
     * (2026-07-18 final review, issue 7; hardened 2026-07-19 coordinator
     * distributed-defects review, issue 9). The web UI polls this instead of
     * holding any hand-authored culture data: before a synthesis proposal
     * is approved, this returns `{ status: "not_available" }`, an honest
     * empty state the UI must render as such, never as a placeholder claim.
     * Only an `approve` decision unlocks the real, grounded, cited
     * partition/disclosure the Skill produced — and only if the proposal
     * is GENUINELY a `jobpilot.synthesizeCultureProfile` output bound to
     * the caller's own (organizationId, company, parentRunId): an arbitrary
     * OTHER approved proposal (any skill), or a synthesis proposal for a
     * DIFFERENT run/company, is rejected as `not_available` rather than
     * rendered — never trust `resourceType`/`action`/a loose shape match
     * alone; the strict `synthesizeCultureProfileOutputSchema` AND a
     * re-derivation of the run's real fetched results must both agree.
     */
    synthesisResult: procedure
      .input(z.object({ organizationId: z.string().min(1), company: z.string().min(1), proposalId: z.string().min(1), parentRunId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal || proposal.organizationId !== input.organizationId) {
          return { status: "not_available" as const };
        }
        // Corroborate the Skill's identity via its declared action/resourceType
        // (LedgerEntry has no `skill` field of its own) — a proposal from ANY
        // other skill that happens to also be action:"write"/resourceType:"signal"
        // is still filtered out below by the strict output-schema parse plus
        // the parentRunId/result cross-check, but this is a cheap first gate.
        if (proposal.action !== "write" || proposal.resourceType !== "signal") {
          return { status: "not_available" as const };
        }
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 8) — the ACTOR must be the real Internal
        // Strategist Agent identity, not merely "some agent that happened
        // to write a signal". Corroborates the "exact persisted actor
        // binding" requirement directly from the immutable ledger row.
        if (proposal.actorType !== "agent" || proposal.actorId !== INTERNAL_STRATEGIST_AGENT) {
          return { status: "not_available" as const };
        }
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (!decision || decision.userDecision !== "approve") {
          return { status: "not_available" as const };
        }
        const parsed = synthesizeCultureProfileOutputSchema.safeParse(
          proposal.proposedOutput,
        );
        if (!parsed.success) {
          // NOT a jobpilot.synthesizeCultureProfile output at all (or a
          // malformed/foreign one) — fail closed, never render it.
          return { status: "not_available" as const };
        }
        const result = parsed.data as SynthesizeCultureProfileOutput;
        if (result.parentRunId !== input.parentRunId) {
          return { status: "not_available" as const };
        }
        // Re-derive this run's REAL fetched results and cross-check every
        // `resultHashes` entry against them — a persisted result whose
        // hashes no longer match the run's own durable fetch records (e.g.
        // stale/tampered) must not be rendered as if it were still valid.
        const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
        const intentRecords = (
          await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.organizationId, childRun.id)))
        ).filter((r): r is NonNullable<typeof r> => r != null);
        const realCompanyMatch = intentRecords.every((r) => r.company === input.company);
        if (childRuns.length === 0 || !realCompanyMatch) {
          return { status: "not_available" as const };
        }
        const realHashesBySourceId = new Map(
          intentRecords.filter((r) => r.status === "fetched" && r.result).map((r) => [r.sourceId, r.result!.contentHash]),
        );
        const hashesMatch = result.resultHashes.every((a) => realHashesBySourceId.get(a.sourceId) === a.contentHash);
        if (!hashesMatch) {
          return { status: "not_available" as const };
        }
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review, issue 5) — self-repair the "propose crashed AFTER the
        // ledger append succeeded but BEFORE recordProposal ever ran"
        // window: this proposal is genuinely valid/approved/well-formed
        // (every check above already passed), so if the durable
        // synthesis-pointer binding for its parentRunId is missing or
        // stale, repair it now rather than leaving `latestRun`'s "resume"
        // flow permanently unable to discover an otherwise-perfectly-good
        // synthesis result. Idempotent and best-effort: a genuine
        // concurrent winner for the SAME parentRunId is left alone.
        const pointer = await ctx.wiring.cultureSynthesisPointerStore.getForParentRun(input.organizationId, input.parentRunId);
        if (!pointer || pointer.proposalId !== input.proposalId) {
          await ctx.wiring.cultureSynthesisPointerStore.recordProposal(input.organizationId, input.parentRunId, input.company, input.proposalId).catch(() => {
            // Another (also valid) proposal already legitimately holds
            // the pointer for this parentRunId — that is a real,
            // resolved outcome, not a bug to surface here; this read
            // path's job is only to REPAIR a missing binding, never to
            // fight over who owns it.
          });
        }
        return { status: "available" as const, proposalId: input.proposalId, approvedAt: decision.createdAt, result, trustOrigin: proposal.trustOrigin ?? null };
      }),
  }),
});
