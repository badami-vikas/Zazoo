import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { classifyPatShape, maskPat } from "@bridge/integrations-github";
import { reposTableSpec, pullsTableSpec, issuesTableSpec, pullsTriageBoardView, issuesUpdatedListView } from "@bridge/devpilot";
import { DEVPILOT_GITHUB_POLL_AUTOMATION_ID, DEVPILOT_REVIEW_PR_AUTOMATION_ID, DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID, DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID } from "@bridge/module-manifests";
import { assertDevpilotFlightEnabled, assertHumanIdentity, devpilotProcedure, procedure, t, withHumanInputTaint } from "../router-shared.js";

/**
 * DealPilot — the first Module on the generic manifest intake seam.
 * `source` quarantines through the pipeline as `external:fetch` (audited, policy-gated);
 * `commit` is the human "Add" that materializes ONE quarantined capture into DealPilot's
 * facts + candidate list (capture ≠ commit). Thesis storage is basic get/set, in-memory
 * (wiring.ts) — no thesis-management UI yet, that's a separate future item.
 */
export const devpilotRouter = t.router({
  /** Table specs + default Views for the three Pages — mirrors JobPilot's
   * `definition` procedure (apps/web has no build dependency on
   * @bridge/devpilot, same as it has none on @bridge/dealpilot/@bridge/jobpilot). */
  definitions: devpilotProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      return {
        repos: reposTableSpec,
        pulls: pullsTableSpec,
        issues: issuesTableSpec,
        pullsTriageBoardView: pullsTriageBoardView(),
        issuesUpdatedListView: issuesUpdatedListView(),
      };
    }),

  /** Always answerable (flight off included), like `learning.status`, so
   * clients can honestly hide the surface instead of rendering dead
   * controls. */
  status: devpilotProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const githubIntegration = (await ctx.wiring.integrationStore.list(input.organizationId)).find(
        (row) => row.provider === "github" && row.status === "active",
      );
      // 200 mirrors the sync Skill's own per-cycle tracked-repo bound — tracked
      // repos are user-curated (toggled one at a time), never realistically
      // more than that, so this stays an exact count without a dedicated
      // COUNT query.
      const trackedRepos = githubIntegration
        ? await ctx.wiring.devpilot.store.listRepos(input.organizationId, { limit: 200, offset: 0 }, true)
        : [];
      // Every sync cycle upserts ALL repos (phase 1) before syncing pulls/issues
      // for tracked ones (phase 2), so the max `syncedAt` among the tracked set
      // is an honest "last synced" reading without a second, differently-
      // ordered query (listRepos only orders by `pushedAt`, GitHub's own
      // activity time — not when WE last synced).
      const latestSyncedAt = trackedRepos.reduce<Date | null>(
        (latest, repo) => (!latest || repo.syncedAt > latest ? repo.syncedAt : latest),
        null,
      );
      const lastSyncAt = latestSyncedAt ? latestSyncedAt.toISOString() : null;
      return {
        enabled: ctx.wiring.devpilotEnabled,
        githubConnected: Boolean(githubIntegration),
        trackedRepoCount: trackedRepos.length,
        lastSyncAt,
      };
    }),

  github: t.router({
    connect: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), personalAccessToken: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        assertHumanIdentity(ctx, "Connecting a GitHub Personal Access Token");
        if (ctx.wiring.publicCloudOnly) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "GitHub Personal Access Tokens require the Local Plane — connect from the desktop app",
          });
        }
        const kind = classifyPatShape(input.personalAccessToken);
        if (!kind) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Not a recognized GitHub Personal Access Token shape" });
        }
        const gateway = ctx.wiring.devpilot.gateways.forToken(input.personalAccessToken);
        let viewer;
        try {
          viewer = await gateway.viewer();
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `GitHub rejected this token: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        const existing = (await ctx.wiring.integrationStore.list(input.organizationId)).find(
          (row) => row.provider === "github",
        );
        const integration = existing ?? (await ctx.wiring.integrationStore.connect(input.organizationId, "github", []));
        await ctx.wiring.localPlane.secrets.putToken({
          integrationId: integration.id,
          organizationId: input.organizationId,
          provider: "github",
          accessToken: input.personalAccessToken,
          // Fine-grained PATs carry no enumerable scope header (permissions
          // are per-repository); classic PATs' scopes aren't requested here
          // since D1 asks for read-only fine-grained tokens by convention.
          scope: "",
          tokenType: "pat",
          updatedAt: new Date().toISOString(),
        });
        const masked = maskPat(input.personalAccessToken);
        return { connected: true, login: viewer.login, kind: masked.kind, last4: masked.last4 };
      }),

    disconnect: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertHumanIdentity(ctx, "Disconnecting a GitHub Personal Access Token");
        const existing = (await ctx.wiring.integrationStore.list(input.organizationId)).find(
          (row) => row.provider === "github",
        );
        if (!existing) return { ok: true };
        await ctx.wiring.localPlane.secrets.deleteToken(existing.id);
        await ctx.wiring.integrationStore.disconnect(input.organizationId, existing.id);
        return { ok: true };
      }),

    status: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const existing = (await ctx.wiring.integrationStore.list(input.organizationId)).find(
          (row) => row.provider === "github" && row.status === "active",
        );
        if (!existing) return { connected: false as const };
        const token = await ctx.wiring.localPlane.secrets.getToken(existing.id);
        if (!token) return { connected: false as const };
        const masked = maskPat(token.accessToken);
        return { connected: true as const, kind: masked.kind, last4: masked.last4 };
      }),
  }),

  repos: t.router({
    list: devpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().min(0).default(0),
          trackedOnly: z.boolean().default(false),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        return ctx.wiring.devpilot.store.listRepos(
          input.organizationId,
          { limit: input.limit, offset: input.offset },
          input.trackedOnly,
        );
      }),

    setTracked: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), repoId: z.string().min(1), tracked: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        const row = await ctx.wiring.devpilot.store.setTracked(input.organizationId, input.repoId, input.tracked);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" });
        return row;
      }),
  }),

  pulls: t.router({
    list: devpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        return ctx.wiring.devpilot.store.listPulls(input.organizationId, { limit: input.limit, offset: input.offset });
      }),

    /**
     * DevPilot D2 — drafts a code review from a tracked Pull Request's
     * live diff. Runs the `devpilot.review-pr` governed Automation (same
     * shape as Task Manager's planning Playbooks): the invocation gets an
     * attributable reviewer-Agent Run and a proposal that halts for a
     * Human's separate approve/edit/veto decision — nothing is posted to
     * GitHub, ever, from this path.
     */
    reviewDraft: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), pullId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        const result = await ctx.wiring.automationExecutor.runById(
          {
            organizationId: input.organizationId,
            automationId: DEVPILOT_REVIEW_PR_AUTOMATION_ID,
            onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
            params: { organizationId: input.organizationId, pullId: input.pullId },
          },
          withHumanInputTaint(ctx.run, `devpilot:review-pr:${ctx.identity.id}:${input.pullId}`, input),
        );
        const proposal = result.proposals[0];
        if (!proposal) throw new Error("devpilot.reviewPr Automation produced no proposal");
        return { proposalId: proposal.id, status: proposal.status, draft: proposal.output?.proposedOutput };
      }),

    /** DevPilot D2 — same shape as reviewDraft, best-practice focus. */
    suggestPracticeDraft: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), pullId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        const result = await ctx.wiring.automationExecutor.runById(
          {
            organizationId: input.organizationId,
            automationId: DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID,
            onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
            params: { organizationId: input.organizationId, pullId: input.pullId },
          },
          withHumanInputTaint(ctx.run, `devpilot:suggest-practice:${ctx.identity.id}:${input.pullId}`, input),
        );
        const proposal = result.proposals[0];
        if (!proposal) throw new Error("devpilot.suggestPractice Automation produced no proposal");
        return { proposalId: proposal.id, status: proposal.status, draft: proposal.output?.proposedOutput };
      }),
  }),

  issues: t.router({
    list: devpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        return ctx.wiring.devpilot.store.listIssues(input.organizationId, { limit: input.limit, offset: input.offset });
      }),

    /** DevPilot D2 — drafts a triage analysis from a tracked Issue's live
     * body. Same governed-Automation shape as pulls.reviewDraft. */
    analyzeDraft: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), issueId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        const result = await ctx.wiring.automationExecutor.runById(
          {
            organizationId: input.organizationId,
            automationId: DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID,
            onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
            params: { organizationId: input.organizationId, issueId: input.issueId },
          },
          withHumanInputTaint(ctx.run, `devpilot:analyze-issue:${ctx.identity.id}:${input.issueId}`, input),
        );
        const proposal = result.proposals[0];
        if (!proposal) throw new Error("devpilot.analyzeIssue Automation produced no proposal");
        return { proposalId: proposal.id, status: proposal.status, draft: proposal.output?.proposedOutput };
      }),
  }),

  sync: t.router({
    /** Manually re-runs the SAME governed Automation the 15-min scheduler
     * triggers (DealPilot's discoverDeals precedent) — the manual path and
     * the scheduled path share one attributable Agent Run shape, so a
     * learning signal from either carries the same moduleId:"devpilot". */
    run: devpilotProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertDevpilotFlightEnabled(ctx);
        const result = await ctx.wiring.automationExecutor.runById(
          {
            organizationId: input.organizationId,
            automationId: DEVPILOT_GITHUB_POLL_AUTOMATION_ID,
            onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
            params: { organizationId: input.organizationId },
          },
          withHumanInputTaint(ctx.run, `devpilot:sync:${ctx.identity.id}`, input),
        );
        const proposal = result.proposals[0];
        if (!proposal) throw new Error("DevPilot GitHub sync Automation produced no proposal");
        return proposal.output?.proposedOutput;
      }),
  }),
});
