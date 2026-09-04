import { z } from "zod";
import { PILOT_ORGANIZATION } from "../wiring.js";
import { authUrl } from "@bridge/integrations-google";
import { assertGoogleIntegrationOwner, authenticatedProcedure, t } from "../router-shared.js";

export const googleRouter = t.router({
  /** Connection + manifest surfaces for the Integrations UI. */
  list: authenticatedProcedure.query(async ({ ctx }) => {
    await assertGoogleIntegrationOwner(ctx);
    const info = await ctx.wiring.google.connectionInfo();
    const m = ctx.wiring.googleManifest;
    return {
      oauthConfigured: ctx.wiring.googleOAuth !== null,
      gatewayKind: ctx.wiring.googleGatewayKind,
      integrationId: ctx.wiring.google.integrationId,
      connection: info,
      surfaces: [
        { provider: "gmail", name: "Gmail" },
        { provider: "google-calendar", name: "Google Calendar" },
      ],
      manifest: { capabilities: m.capabilities, output_contract: m.output_contract, intake_policy: m.intake_policy },
    };
  }),

  /** The Google consent URL (read AND write scopes, offline). */
  connectUrl: authenticatedProcedure.mutation(async ({ ctx }) => {
    await assertGoogleIntegrationOwner(ctx);
    if (!ctx.wiring.googleOAuth) {
      return { url: null as string | null, error: "oauth_not_configured" as const };
    }
    const { state, codeChallenge } =
      await ctx.wiring.googleOAuthStates.issue(
      PILOT_ORGANIZATION,
      ctx.wiring.google.integrationId,
      ctx.identity.id,
    );
    return {
      url: authUrl(ctx.wiring.googleOAuth, state, codeChallenge),
    };
  }),

  /** Revoke locally (delete the local token). */
  disconnect: authenticatedProcedure.mutation(async ({ ctx }) => {
    await assertGoogleIntegrationOwner(ctx);
    await ctx.wiring.google.disconnect();
    return { ok: true };
  }),

  /** Source Gmail through the gate → propose Events/Memories/Signals. */
  syncGmail: authenticatedProcedure
    .input(z.object({ maxResults: z.number().int().positive().max(100).optional(), query: z.string().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      return ctx.wiring.google.syncGmail(ctx.run, {
        ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
        ...(input?.query ? { query: input.query } : {}),
      });
    }),

  /** Source Calendar through the gate → propose Events. */
  syncCalendar: authenticatedProcedure
    .input(
      z
        .object({
          maxResults: z.number().int().positive().max(100).optional(),
          timeMin: z.string().optional(),
          timeMax: z.string().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      return ctx.wiring.google.syncCalendar(ctx.run, {
        ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
        ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
        ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
      });
    }),

  /** Read-only projection: FULL Calendar events for the Calendar surface (gated
   * external:fetch, auto-approved as the user's own view). No Event proposals. */
  listEvents: authenticatedProcedure
    .input(
      z
        .object({
          maxResults: z.number().int().positive().max(250).optional(),
          timeMin: z.string().optional(),
          timeMax: z.string().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      const events = await ctx.wiring.google.listCalendarEvents(ctx.run, {
        ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
        ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
        ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
      });
      return { events };
    }),

  /** Compose an outbound email/event as a DRAFT → external:send proposal (>= L2).
   * For calendar, `action` = create (default) | update | delete. The real Google
   * write runs in the EgressExecutor only after a human approves. */
  proposeSend: authenticatedProcedure
    .input(
      z.object({
        kind: z.enum(["email", "calendar"]),
        action: z.enum(["create", "update", "delete"]).optional(),
        envelope: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      return ctx.wiring.google.proposeSend(ctx.run, {
        kind: input.kind,
        ...(input.action ? { action: input.action } : {}),
        envelope: input.envelope as never,
      });
    }),
});
