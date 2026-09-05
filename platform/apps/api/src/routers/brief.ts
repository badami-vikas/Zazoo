import { z } from "zod";
import { listSuggestions as listLearningSuggestions, listCommitmentSuggestions, listClaimSuggestions } from "@bridge/core";
import { authenticatedProcedure, organizationGuard, t } from "../router-shared.js";
import { pendingProposalTask } from "./action.js";
import { compareApprovalImportance, rankPendingProposal } from "./approval-importance.js";

/**
 * Organization + team-member management — plain authenticated CRUD (direct DB
 * writes), NOT a governed pipeline action. Creating a organization or inviting a
 * teammate doesn't have an external effect requiring approval, so this bypasses
 * pipeline.propose() and calls the store directly.
 */
/**
 * Onboarding (ADR-033/R-030) — the server-side home for onboarding
 * personalization that used to live ONLY in browser localStorage
 * (avatar-store.ts). `verifyPhoneOtp` is an explicit, user-authorized DUMMY
 * flow (2026-07-08 ruling: "use dummy flow for now" — no real SMS provider
 * is wired) — it accepts any 6-digit code and is labeled as demo/test mode
 * in the client copy so it's never presented as a working integration.
 */
/** K6 (TASK-050) — the morning brief: the day's commitments in three
 * buckets, pending suggestions, approvals nudges, recent capture activity,
 * and deterministic next actions — every section read live from the REAL
 * stores at call time (nothing is cached or fabricated; an empty section is
 * an honest empty state). The commitment buckets and approvals render
 * regardless of the learning flight (they are governed data the owner
 * already holds); only the learning-loop sections gate on it. */
export const briefRouter = t.router({
  morning: authenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        /** "Brief as of" — tests pin it for determinism; omitted = now. */
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const now = input.snapshotAt ?? ctx.run.clock.nowISO();
      const nowDate = new Date(now);
      const sameLocalDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

      const page = await ctx.wiring.graphStore.listCommitmentsForOwner(
        input.organizationId,
        ctx.identity.id,
        { limit: 100, offset: 0, status: "pending", snapshotAt: nowDate },
      );
      const personNames = new Map<string, string | null>();
      const personNameOf = async (personId: string): Promise<string | null> => {
        if (!personNames.has(personId)) {
          const person = await ctx.wiring.graphStore.getPerson(
            input.organizationId, ctx.identity.id, personId,
          );
          personNames.set(personId, person?.displayName ?? null);
        }
        return personNames.get(personId) ?? null;
      };
      type BriefCommitment = {
        id: string;
        personId: string;
        personName: string | null;
        text: string;
        dueAt: string | null;
        occurredAt: string;
      };
      const commitments: Record<"overdue" | "dueToday" | "upcoming", BriefCommitment[]> = {
        overdue: [], dueToday: [], upcoming: [],
      };
      for (const item of page.items) {
        // Due earlier today is still "due today" until midnight; only a
        // strictly-earlier calendar day is overdue. No due date = upcoming.
        const bucket = !item.dueAt
          ? "upcoming"
          : sameLocalDay(item.dueAt, nowDate)
            ? "dueToday"
            : item.dueAt.getTime() < nowDate.getTime()
              ? "overdue"
              : "upcoming";
        commitments[bucket].push({
          id: item.id,
          personId: item.personId,
          personName: await personNameOf(item.personId),
          text: item.text,
          dueAt: item.dueAt?.toISOString() ?? null,
          occurredAt: item.occurredAt.toISOString(),
        });
      }

      const learningEnabled = ctx.wiring.learningObservationEnabled;
      const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
      const commitmentSuggestions = learningEnabled
        ? await listCommitmentSuggestions(ctx.wiring.memoryStore, scope, "proposed")
        : [];
      const learningSuggestions = learningEnabled
        ? await listLearningSuggestions(ctx.wiring.memoryStore, scope, undefined, "proposed")
        : [];
      const claimSuggestions = learningEnabled && ctx.wiring.claimSubstrateEnabled
        ? await listClaimSuggestions(ctx.wiring.memoryStore, scope, "proposed")
        : [];

      // TASK-097: Home shows the five that matter most, not the five newest —
      // rank a window of the queue, then keep five. ponytail: the window is
      // 50; page the whole queue if a Local Plane ever holds more undecided
      // rows than that after the scheduler's duplicate sweep.
      const pendingApprovals = await ctx.wiring.pipeline.listPending(input.organizationId, {
        limit: 50, offset: 0, privateOwnerUserId: ctx.identity.id,
      });
      const rankedApprovals = pendingApprovals.items
        .map((item) => ({ ...item, importance: rankPendingProposal(item) }))
        .sort(compareApprovalImportance)
        .slice(0, 5);
      const approvalTasks = await Promise.all(
        rankedApprovals.map((item) => pendingProposalTask(ctx.wiring, item)),
      );
      const approvalNudges = rankedApprovals.map((item, index) => {
        const task = approvalTasks[index] ?? null;
        const inputs = item.request.inputs;
        const display =
          typeof inputs === "object" && inputs !== null && !Array.isArray(inputs) &&
          typeof (inputs as Record<string, unknown>).display === "object" &&
          (inputs as Record<string, unknown>).display !== null
            ? ((inputs as Record<string, unknown>).display as Record<string, unknown>)
            : null;
        return {
          proposalId: item.id,
          resourceType: item.request.resourceType,
          resource: typeof display?.resource === "string" ? display.resource : null,
          createdAt: item.createdAt,
          // ADR 2026-09-04 "Approvals belong to Tasks": Home names the Task an
          // approval waits under and links there, never to Settings.
          skill: item.request.skill ?? null,
          action: item.request.action,
          task,
          /** TASK-097: tier + trust + rank, so Home orders and labels from data. */
          importance: item.importance,
        };
      });

      // Recent capture activity: observed signals from the last 24 hours,
      // grouped by source module — the K1/K2/K5 lanes made visible.
      const signalRows = await ctx.wiring.memoryStore.retrieve({ limit: 200 }, scope);
      const cutoff = nowDate.getTime() - 24 * 60 * 60 * 1000;
      const activityByModule = new Map<string, { count: number; lastAt: string }>();
      for (const row of signalRows) {
        try {
          const value = JSON.parse(row.content) as {
            anchor?: { kind?: string; moduleId?: string };
            observedAt?: string | null;
          };
          if (value.anchor?.kind !== "observed_signal" || !value.anchor.moduleId) continue;
          const at = value.observedAt ?? row.createdAt;
          const atMs = new Date(at).getTime();
          if (Number.isNaN(atMs) || atMs <= cutoff || atMs > nowDate.getTime()) continue;
          const bucket = activityByModule.get(value.anchor.moduleId);
          if (!bucket) {
            activityByModule.set(value.anchor.moduleId, { count: 1, lastAt: at });
          } else {
            bucket.count += 1;
            if (at > bucket.lastAt) bucket.lastAt = at;
          }
        } catch {
          // not a signal row
        }
      }
      const recentActivity = [...activityByModule.entries()]
        .map(([moduleId, value]) => ({ moduleId, ...value }))
        .sort((a, b) => b.count - a.count);

      // Deterministic next actions — derivations of the sections above,
      // never model output.
      const nextActions: string[] = [];
      if (commitments.overdue.length > 0) {
        nextActions.push(`${commitments.overdue.length} commitment${commitments.overdue.length === 1 ? " is" : "s are"} overdue — complete or reschedule them.`);
      }
      if (commitments.dueToday.length > 0) {
        nextActions.push(`${commitments.dueToday.length} commitment${commitments.dueToday.length === 1 ? " is" : "s are"} due today.`);
      }
      if (commitmentSuggestions.length > 0) {
        nextActions.push(`${commitmentSuggestions.length} commitment suggestion${commitmentSuggestions.length === 1 ? " awaits" : "s await"} your review.`);
      }
      if (learningSuggestions.length + claimSuggestions.length > 0) {
        nextActions.push(`${learningSuggestions.length + claimSuggestions.length} learning suggestion${learningSuggestions.length + claimSuggestions.length === 1 ? " awaits" : "s await"} your review in Settings.`);
      }
      if (pendingApprovals.total > 0) {
        nextActions.push(`${pendingApprovals.total} proposal${pendingApprovals.total === 1 ? " awaits" : "s await"} your decision in Approvals.`);
      }

      return {
        generatedAt: now,
        learningEnabled,
        commitments,
        suggestions: {
          commitments: commitmentSuggestions,
          learning: learningSuggestions.length,
          claims: claimSuggestions.length,
        },
        approvals: { total: pendingApprovals.total, items: approvalNudges },
        recentActivity,
        nextActions,
      };
    }),
});
