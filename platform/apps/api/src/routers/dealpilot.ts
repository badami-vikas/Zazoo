import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PILOT_ORGANIZATION } from "../wiring.js";
import { hashTaintValue, labelAtSource, type Proposal } from "@bridge/core";
import { CredentialAccessError, SourceDiscoveryGateError, dealPilotModuleManifest, proposeThesisSourceDiscovery, scoreThesisFit, runSourceDiscovery, type SourceRecord, type ThesisProfile } from "@bridge/dealpilot";
import { DEALPILOT_SOURCE_AUTOMATION_ID } from "../built-in-modules.js";
import { t, stableDealPilotCaptureProposalId, isDealPilotCaptureProposal, assertPilotOrganization, dealpilotProcedure, withHumanInputTaint } from "../router-shared.js";

export const dealpilotRouter = t.router({
  module: dealpilotProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input, ctx }) => {
      return dealPilotModuleManifest(ctx.wiring.dealpilot.bindings);
    }),

  records: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        page: z.enum(["deals", "sources", "theses"]),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.wiring.dealpilot.store.list(input.page, input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /** Compatibility endpoint for callers migrating from the pre-DP0 candidate feed. */
  list: dealpilotProcedure
    .input(
      z
        .object({
          organizationId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({}),
    )
    .query(async ({ input, ctx }) => {
      if (input.organizationId) assertPilotOrganization(input.organizationId);
      const organizationId = input.organizationId ?? PILOT_ORGANIZATION;
      const records = await ctx.wiring.dealpilot.store.list("deals", organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      const items = await Promise.all(
        records.items.map(async (record) => {
          const profile = (await ctx.wiring.dealpilot.store.candidateProfile(organizationId, record.id)) ?? {
            name: record.kind === "deal" ? record.company : record.id,
          };
          return {
            id: record.id,
            profile,
            fit: scoreThesisFit(profile, { industries: [], geo: [] }),
          };
        }),
      );
      return { items, total: records.total, hasMore: records.hasMore };
    }),

  detail: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        kind: z.enum(["deal", "source", "thesis"]),
        id: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const detail = await ctx.wiring.dealpilot.store.detail(
        input.kind,
        input.organizationId,
        input.id,
        ctx.wiring.dealpilot.bindings,
      );
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `${input.kind} Record not found` });
      if (detail.record.kind !== "source") return detail;
      // Credential metadata lives in the Local-Plane vault, which refuses reads in
      // public-cloud mode. Serve the Source Record itself in the cloud with no
      // credential projection; on the desktop keep the existing projection (which
      // itself reports per-field "unavailable" when there is no stored credential).
      const credentialProjection = ctx.wiring.publicCloudOnly
        ? null
        : await ctx.wiring.dealpilot.credentials.metadata(
            { organizationId: input.organizationId, sourceId: detail.record.id },
            detail.record.credentialRef,
          );
      return {
        ...detail,
        credentialProjection,
        credentialCleanupAvailable: Boolean(
          detail.record.credentialRef &&
            detail.record.credentialOwnerId === ctx.identity.id &&
            !ctx.wiring.publicCloudOnly,
        ),
      };
    }),

  createDeal: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        company: z.string().trim().min(1).max(300),
        revenue: z.number().nonnegative().optional(),
        ebitda: z.number().optional(),
        sde: z.number().optional(),
        askingPrice: z.number().nonnegative().optional(),
        rag: z.enum(["red", "yellow", "green"]).optional(),
        fitScore: z.number().int().min(0).max(100).optional(),
        evidenceScore: z.number().int().min(0).max(100).optional(),
        p0Flags: z.number().int().min(0).max(999).optional(),
        thesisTag: z.string().trim().max(120).optional(),
        sourceChannel: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.wiring.dealpilot.store.createDeal({
        organizationId: input.organizationId,
        company: input.company,
        ...(input.revenue != null ? { revenue: input.revenue } : {}),
        ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
        ...(input.sde != null ? { sde: input.sde } : {}),
        ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
        ...(input.rag != null ? { rag: input.rag } : {}),
        ...(input.fitScore != null ? { fitScore: input.fitScore } : {}),
        ...(input.evidenceScore != null ? { evidenceScore: input.evidenceScore } : {}),
        ...(input.p0Flags != null ? { p0Flags: input.p0Flags } : {}),
        ...(input.thesisTag != null ? { thesisTag: input.thesisTag } : {}),
        ...(input.sourceChannel != null ? { sourceChannel: input.sourceChannel } : {}),
      });
    }),

  createSource: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().trim().min(1).max(300),
        link: z.string().url(),
        connectionType: z.enum(["url", "email_alert", "api", "account"]),
        spendCap: z.number().nonnegative(),
        rightsAttested: z.boolean(),
        userId: z.string().max(500).optional(),
        password: z.string().max(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const sourceId = ctx.run.ids.next();
      const sourceInput = {
        id: sourceId,
        organizationId: input.organizationId,
        name: input.name,
        link: input.link,
        connectionType: input.connectionType,
        spendCap: input.spendCap,
        rightsState: input.rightsAttested ? "attested" as const : "unattested" as const,
        ...(input.rightsAttested ? { rightsAttestedBy: ctx.identity.id } : {}),
      };
      if (!input.userId && !input.password) {
        return ctx.wiring.dealpilot.store.createSource(sourceInput);
      }
      // A credential-bearing Source writes secret bytes to the Local-Plane
      // vault (ADR-151/AP-083 keep that desktop-only). Record-only Source
      // creation above is served in the cloud; entering a credential is not.
      if (ctx.wiring.publicCloudOnly) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Source credentials are entered on the Bridge desktop app (the Local Plane) and are not accepted by the public cloud API.",
        });
      }
      const scope = { organizationId: input.organizationId, sourceId };
      const credentialRef =
        ctx.wiring.dealpilot.credentialVault.reserve(scope);
      await ctx.wiring.dealpilot.store.prepareCredentialCreate({
        ...sourceInput,
        credentialOwnerId: ctx.identity.id,
        credentialRef,
      });
      try {
        await ctx.wiring.dealpilot.credentialVault.write(
          scope,
          credentialRef,
          {
            ...(input.userId ? { userId: input.userId } : {}),
            ...(input.password ? { password: input.password } : {}),
          },
        );
        return await ctx.wiring.dealpilot.store.completeCredentialCreate(
          input.organizationId,
          sourceId,
          credentialRef,
        );
      } catch (error) {
        const cleanupErrors: unknown[] = [];
        let credentialDeleted = false;
        try {
          await ctx.wiring.dealpilot.credentialVault.delete(
            scope,
            credentialRef,
          );
          credentialDeleted = true;
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        if (credentialDeleted) {
          try {
            await ctx.wiring.dealpilot.store.discardCredentialCreate(
              input.organizationId,
              sourceId,
              credentialRef,
            );
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            "Source creation failed and its pending OS credential operation could not be reconciled",
          );
        }
        throw error;
      }
    }),

  /**
   * Crawls every eligible Source once and returns what was found, ranked by Thesis fit.
   *
   * Read-mostly by design: the only writes are each Source's `spendToDate` and `lastCheckedAt`,
   * settled from what the run actually consumed. Nothing becomes a Deal here — listings are
   * returned for review, and promoting one is a separate, explicit act. The per-Source gate
   * (rights attested, not paused, inside spend cap) runs inside `runSourceDiscovery` before any
   * request goes out, so an unchecked or unattested Source is refused rather than crawled.
   */
  runDiscovery: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        /** Optional ranking profile. Omitted means "return what was found, unranked". */
        thesis: z
          .object({
            industries: z.array(z.string().trim().min(1)).max(50).default([]),
            geo: z.array(z.string().trim().min(1)).max(50).default([]),
            sdeMin: z.number().nonnegative().optional(),
            sdeMax: z.number().nonnegative().optional(),
            revenueMin: z.number().nonnegative().optional(),
            revenueMax: z.number().nonnegative().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const sources: SourceRecord[] = [];
      let offset = 0;
      do {
        const page = await ctx.wiring.dealpilot.store.list("sources", input.organizationId, {
          limit: 200,
          offset,
        });
        sources.push(...page.items.filter((r): r is SourceRecord => r.kind === "source"));
        offset += page.items.length;
        if (!page.hasMore || page.items.length === 0) break;
      } while (true);

      // Built key-by-key: `exactOptionalPropertyTypes` will not accept Zod's
      // `number | undefined` where ThesisProfile declares `sdeMin?: number`, and omitting the
      // key is the correct way to say "this bound was not set".
      let thesis: ThesisProfile | undefined;
      if (input.thesis) {
        thesis = { industries: input.thesis.industries, geo: input.thesis.geo };
        if (input.thesis.sdeMin !== undefined) thesis.sdeMin = input.thesis.sdeMin;
        if (input.thesis.sdeMax !== undefined) thesis.sdeMax = input.thesis.sdeMax;
        if (input.thesis.revenueMin !== undefined) thesis.revenueMin = input.thesis.revenueMin;
        if (input.thesis.revenueMax !== undefined) thesis.revenueMax = input.thesis.revenueMax;
      }
      const result = await runSourceDiscovery({
        organizationId: input.organizationId,
        sources,
        connectorFor: (source) => ctx.wiring.dealpilot.listingCrawlerFor(source),
        ...(thesis ? { thesis } : {}),
      });

      // Settle what the run actually spent. A Source that was refused spent nothing and is not
      // touched, so a paused Source's lastCheckedAt does not drift forward as if it had run.
      const checkedAt = new Date().toISOString();
      for (const [sourceId, spend] of Object.entries(result.spendBySourceId)) {
        const source = sources.find((candidate) => candidate.id === sourceId);
        if (!source) continue;
        await ctx.wiring.dealpilot.store.updateSource(sourceId, input.organizationId, {
          spendToDate: source.spendToDate + spend,
          lastCheckedAt: checkedAt,
        });
      }
      return result;
    }),

  createThesis: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().trim().min(1).max(300),
        focus: z.string().trim().min(1).max(1_000),
        targetCagr: z.number().optional(),
        criteria: z.array(z.string().trim().min(1)).default([]),
        exclusions: z.array(z.string().trim().min(1)).default([]),
        sourcingStrategy: z.string().trim().max(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const thesis = await ctx.wiring.dealpilot.store.createThesis({
        organizationId: input.organizationId,
        name: input.name,
        focus: input.focus,
        criteria: input.criteria,
        exclusions: input.exclusions,
        ...(input.targetCagr != null ? { targetCagr: input.targetCagr } : {}),
        ...(input.sourcingStrategy ? { sourcingStrategy: input.sourcingStrategy } : {}),
      });
      const discoveryTask = await proposeThesisSourceDiscovery(
        ctx.wiring.dealpilot.store,
        input.organizationId,
        thesis.id,
      );
      const discovery = await ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "read",
          resourceType: "module",
          skill: "stageMutation",
          inputs: discoveryTask,
          // Source-inventory discovery reads only Cloud-Plane Source Records; in
          // public-cloud mode the pipeline requires an explicit public data scope.
          ...(ctx.wiring.publicCloudOnly ? { dataScope: "public" as const } : {}),
        },
        ctx.run,
      );
      return { thesis, discovery };
    }),

  updateDeal: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        id: z.string().min(1),
        company: z.string().trim().min(1).max(300).optional(),
        stage: z
          .enum([
            "sourced",
            "triage",
            "engaged",
            "nda_cim",
            "diligence",
            "ic",
            "loi",
            "closing",
            "portfolio",
            "passed",
          ])
          .optional(),
        revenue: z.number().nonnegative().optional(),
        ebitda: z.number().optional(),
        sde: z.number().optional(),
        askingPrice: z.number().nonnegative().optional(),
        evidenceHealth: z.enum(["unknown", "partial", "supported", "contradicted"]).optional(),
        rag: z.enum(["red", "yellow", "green"]).optional(),
        fitScore: z.number().int().min(0).max(100).optional(),
        evidenceScore: z.number().int().min(0).max(100).optional(),
        p0Flags: z.number().int().min(0).max(999).optional(),
        thesisTag: z.string().trim().max(120).optional(),
        sourceChannel: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.wiring.dealpilot.store.updateDeal(input.id, input.organizationId, {
        ...(input.company !== undefined ? { company: input.company } : {}),
        ...(input.stage !== undefined ? { stage: input.stage } : {}),
        ...(input.revenue !== undefined ? { revenue: input.revenue } : {}),
        ...(input.ebitda !== undefined ? { ebitda: input.ebitda } : {}),
        ...(input.sde !== undefined ? { sde: input.sde } : {}),
        ...(input.askingPrice !== undefined ? { askingPrice: input.askingPrice } : {}),
        ...(input.evidenceHealth !== undefined ? { evidenceHealth: input.evidenceHealth } : {}),
        ...(input.rag !== undefined ? { rag: input.rag } : {}),
        ...(input.fitScore !== undefined ? { fitScore: input.fitScore } : {}),
        ...(input.evidenceScore !== undefined ? { evidenceScore: input.evidenceScore } : {}),
        ...(input.p0Flags !== undefined ? { p0Flags: input.p0Flags } : {}),
        ...(input.thesisTag !== undefined ? { thesisTag: input.thesisTag } : {}),
        ...(input.sourceChannel !== undefined ? { sourceChannel: input.sourceChannel } : {}),
      });
    }),

  /** Edits non-secret Source Record fields. Source credentials are never
   * accepted here — they stay on the Local Plane (ADR-151/AP-083). */
  updateSource: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        id: z.string().min(1),
        name: z.string().trim().min(1).max(300).optional(),
        link: z.string().url().optional(),
        connectionType: z.enum(["url", "email_alert", "api", "account"]).optional(),
        spendCap: z.number().nonnegative().optional(),
        health: z.enum(["ready", "degraded", "paused"]).optional(),
        schedule: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // rightsState is deliberately NOT editable here: attesting data rights is a
      // governed act that must record rightsAttestedAt/By through its own flow, not
      // a generic table edit (attested rights gate Source discovery).
      return ctx.wiring.dealpilot.store.updateSource(input.id, input.organizationId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.link !== undefined ? { link: input.link } : {}),
        ...(input.connectionType !== undefined ? { connectionType: input.connectionType } : {}),
        ...(input.spendCap !== undefined ? { spendCap: input.spendCap } : {}),
        ...(input.health !== undefined ? { health: input.health } : {}),
        ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
      });
    }),

  discoverDeals: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let proposal;
      try {
        await ctx.wiring.dealpilot.validateSourceDiscovery(
          input.organizationId,
          input.sourceId,
        );
        const result = await ctx.wiring.automationExecutor.runById(
          {
            organizationId: input.organizationId,
            automationId: DEALPILOT_SOURCE_AUTOMATION_ID,
            onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
            params: { organizationId: input.organizationId, sourceId: input.sourceId },
          },
          withHumanInputTaint(
            ctx.run,
            `dealpilot:discover:${ctx.identity.id}:${input.sourceId}`,
            input,
          ),
        );
        proposal = result.proposals[0];
        if (!proposal) throw new Error("DealPilot discovery Automation produced no proposal");
      } catch (error) {
        if (error instanceof SourceDiscoveryGateError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        throw new TRPCError({
          code:
            error instanceof Error &&
            (error.message.includes("supports Deal discovery only") || error.message.includes("Source Record not found"))
              ? "PRECONDITION_FAILED"
              : "BAD_GATEWAY",
          message: error instanceof Error ? error.message : "Source connector failed",
        });
      }
      const output = proposal.output?.proposedOutput as {
        spend?: { estimated: number; actual: number; cap: number; exceeded: boolean };
      } | undefined;
      return {
        ...proposal,
        spend: output?.spend ?? { estimated: 0, actual: 0, cap: 0, exceeded: false },
      };
    }),

  captures: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.wiring.dealpilot.store.listPendingCaptures(input.organizationId, {
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        limit: input.limit,
        offset: input.offset,
      });
    }),

  commit: dealpilotProcedure
    .input(z.object({ organizationId: z.string().min(1), captureId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const captureStatus = await ctx.wiring.dealpilot.store.captureStatus(
        input.organizationId,
        input.captureId,
      );
      if (captureStatus === "committed") {
        return { committed: false, alreadyCommitted: true as const };
      }
      if (captureStatus === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
      }
      const capture = await ctx.wiring.dealpilot.store.getCapture(input.organizationId, input.captureId);
      if (!capture) throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
      const proposalId = stableDealPilotCaptureProposalId(
        input.organizationId,
        input.captureId,
      );
      const request = {
        organizationId: input.organizationId,
        actor: { type: ctx.identity.type, id: ctx.identity.id },
        action: "write" as const,
        resourceType: "module" as const,
        skill: "stageMutation",
        inputs: { kind: "dealpilot_capture_commit", captureId: input.captureId },
        taintLabel: labelAtSource("email_google_intake", {
          ref: `dealpilot:capture:${input.captureId}`,
          valueHash: hashTaintValue(capture.payload),
          sensitivity: "organization",
          instructionRisk: "data",
        }),
      };
      const materialize = async (proposal?: Proposal) => {
        const committed = await ctx.wiring.dealpilot.store.commitCapture(
          input.organizationId,
          input.captureId,
        );
        if (!committed.committed && committed.alreadyCommitted) {
          return { committed: false, alreadyCommitted: true as const };
        }
        if (!committed.committed) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
        }
        return {
          committed: true,
          captureId: input.captureId,
          candidateId: committed.recordId,
          proposal:
            proposal ??
            ({
              id: proposalId,
              status: "applied",
              recovered: true,
            } as const),
        };
      };
      const recoverProposal = async () => {
        const existing = await ctx.wiring.ledger.get(proposalId);
        if (!existing) return null;
        if (!isDealPilotCaptureProposal(existing, input.organizationId, input.captureId)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "DealPilot capture proposal identity collides with a different ledger entry",
          });
        }
        const decision =
          existing.userDecision ??
          (await ctx.wiring.ledger.decisionFor(proposalId))?.userDecision ??
          null;
        if (decision === "auto" || decision === "approve" || decision === "edit") {
          return materialize();
        }
        return {
          committed: false,
          proposal: {
            id: proposalId,
            status: decision === "veto" ? "rejected" : "pending_review",
            recovered: true,
          } as const,
        };
      };

      const recovered = await recoverProposal();
      if (recovered) return recovered;
      let proposal: Proposal;
      try {
        proposal = await ctx.wiring.pipeline.propose(request, ctx.run, { proposalId });
      } catch (cause) {
        const winner = await recoverProposal();
        if (winner) return winner;
        throw cause;
      }
      if (proposal.status !== "applied") return { committed: false, proposal };
      return materialize(proposal);
    }),

  reauthenticateCredential: dealpilotProcedure
    .input(z.object({ organizationId: z.string().min(1), sourceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const source = await ctx.wiring.dealpilot.store.get("source", input.organizationId, input.sourceId);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
      if (source.kind !== "source" || source.credentialOwnerId !== ctx.identity.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
      }
      try {
        return ctx.wiring.dealpilot.credentials.reauthenticate({
          actorType: ctx.identity.type,
          actorId: ctx.identity.id,
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          ...(ctx.reauthenticatedAt != null ? { reauthenticatedAt: ctx.reauthenticatedAt } : {}),
        });
      } catch (error) {
        if (error instanceof CredentialAccessError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
        }
        throw error;
      }
    }),

  accessCredential: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceId: z.string().min(1),
        token: z.string().min(1),
        field: z.enum(["userId", "password"]),
        action: z.enum(["reveal", "copy"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const source = await ctx.wiring.dealpilot.store.get("source", input.organizationId, input.sourceId);
      if (!source || source.kind !== "source") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
      }
      if (source.credentialOwnerId !== ctx.identity.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
      }
      try {
        return await ctx.wiring.dealpilot.credentials.access({
          reference: source.credentialRef,
          organizationId: input.organizationId,
          sourceId: source.id,
          actorType: ctx.identity.type,
          actorId: ctx.identity.id,
          token: input.token,
          field: input.field,
          action: input.action,
        });
      } catch (error) {
        if (error instanceof CredentialAccessError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
        }
        throw error;
      }
    }),

  clearCredential: dealpilotProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceId: z.string().min(1),
        token: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const source = await ctx.wiring.dealpilot.store.get(
        "source",
        input.organizationId,
        input.sourceId,
      );
      if (!source || source.kind !== "source") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
      }
      if (
        source.credentialOwnerId !== ctx.identity.id ||
        !source.credentialRef
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Source credential revocation is not authorized",
        });
      }
      try {
        const audit =
          ctx.wiring.dealpilot.credentials.authorizeCredentialRevocation({
          reference: source.credentialRef,
          organizationId: input.organizationId,
          sourceId: source.id,
          actorType: ctx.identity.type,
          actorId: ctx.identity.id,
          token: input.token,
        });
        await ctx.wiring.dealpilot.store.prepareCredentialRevocation(
          input.organizationId,
          source.id,
          ctx.identity.id,
          source.credentialRef,
          audit,
        );
        await ctx.wiring.dealpilot.credentialVault.delete(
          { organizationId: input.organizationId, sourceId: source.id },
          source.credentialRef,
        );
        const revocation =
          await ctx.wiring.dealpilot.store.completeCredentialRevocation(
            input.organizationId,
            source.id,
            ctx.identity.id,
            source.credentialRef,
          );
        return {
          revoked: true as const,
          cleared: revocation.cleared,
          credentialProjection:
            await ctx.wiring.dealpilot.credentials.metadata(
              { organizationId: input.organizationId, sourceId: source.id },
              revocation.source.credentialRef,
            ),
        };
      } catch (error) {
        if (error instanceof CredentialAccessError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
        }
        throw error;
      }
    }),
});
