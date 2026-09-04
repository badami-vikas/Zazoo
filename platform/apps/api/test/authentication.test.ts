import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { makeContextFactory } from "../src/context.js";
import { authModeFromEnv } from "../src/identity.js";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE } from "../src/wiring.js";

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("action.propose rejects an unauthenticated request when a verifier is configured", async () => {
  const wiring = await buildWiring();
  try {
    await withEnv(
      {
        SUPABASE_JWT_SECRET: "test_fixture_auth_secret",
        SUPABASE_URL: undefined,
        DATABASE_URL: undefined,
        NODE_ENV: "development",
      },
      async () => {
        const ctx = await makeContextFactory(wiring)();
        const caller = appRouter.createCaller(ctx);

        await assert.rejects(
          () =>
            caller.action.propose({
              workspaceId: PILOT_WORKSPACE,
              actor: { type: "user", id: wiring.pilotUserId },
              action: "write",
              resourceType: "touchpoint",
              inputs: { note: "test_fixture_unauthenticated_proposal" },
              skill: "stageMutation",
            }),
          (err: unknown) => {
            assert.ok(err instanceof TRPCError);
            assert.equal(err.code, "UNAUTHORIZED");
            return true;
          },
        );
      },
    );
  } finally {
    await wiring.close();
  }
});

test("an unauthenticated internal Helpdesk mutation is rejected when a verifier is configured", async () => {
  const wiring = await buildWiring();
  try {
    await withEnv(
      {
        SUPABASE_JWT_SECRET: "test_fixture_auth_secret",
        SUPABASE_URL: undefined,
        DATABASE_URL: undefined,
        NODE_ENV: "development",
      },
      async () => {
        const caller = appRouter.createCaller(await makeContextFactory(wiring)());
        await assert.rejects(
          () =>
            caller.helpdesk.stageAnswer({
              workspaceId: PILOT_WORKSPACE,
              subject: "test_fixture_subject",
              body: "test_fixture_body",
              routedToPersonId: "test_fixture_person",
              routedToDisplayName: "Test Fixture Person",
              draftBody: "test_fixture_draft",
            }),
          (err: unknown) => {
            assert.ok(err instanceof TRPCError);
            assert.equal(err.code, "UNAUTHORIZED");
            return true;
          },
        );
      },
    );
  } finally {
    await wiring.close();
  }
});

async function proposeAsPilot(caller: ReturnType<typeof appRouter.createCaller>) {
  return caller.action.propose({
    workspaceId: PILOT_WORKSPACE,
    actor: { type: "user", id: "test_fixture_pilot_user" },
    action: "write",
    resourceType: "touchpoint",
    inputs: { note: "test_fixture_auth_mode_proposal" },
    skill: "stageMutation",
  });
}

test("persistent and production modes reject unauthenticated pilot-fallback writes without a verifier", async () => {
  const wiring = await buildWiring();
  try {
    for (const env of [
      { DATABASE_URL: "postgres://test_fixture_persistent", NODE_ENV: "development" },
      { DATABASE_URL: undefined, NODE_ENV: "production" },
    ]) {
      await withEnv(
        { SUPABASE_JWT_SECRET: undefined, SUPABASE_URL: undefined, ...env },
        async () => {
          const caller = appRouter.createCaller(await makeContextFactory(wiring)());
          await assert.rejects(() => proposeAsPilot(caller), (err: unknown) => {
            assert.ok(err instanceof TRPCError);
            assert.equal(err.code, "UNAUTHORIZED");
            return true;
          });
        },
      );
    }
  } finally {
    await wiring.close();
  }
});

test("pure in-memory local development preserves the pilot fallback for mutations", async () => {
  const wiring = await buildWiring();
  try {
    await withEnv(
      {
        SUPABASE_JWT_SECRET: undefined,
        SUPABASE_URL: undefined,
        DATABASE_URL: undefined,
        NODE_ENV: "development",
      },
      async () => {
        const caller = appRouter.createCaller(await makeContextFactory(wiring)());
        const proposal = await proposeAsPilot(caller);
        assert.ok(proposal.id);
      },
    );
  } finally {
    await wiring.close();
  }
});

test("public Helpdesk ticket creation and token-authorized reply remain available without authentication", async () => {
  const wiring = await buildWiring();
  try {
    await withEnv(
      {
        SUPABASE_JWT_SECRET: "test_fixture_auth_secret",
        SUPABASE_URL: undefined,
        DATABASE_URL: undefined,
        NODE_ENV: "development",
      },
      async () => {
        const caller = appRouter.createCaller(await makeContextFactory(wiring)());
        const created = await caller.helpdesk.public.createTicket({
          workspaceId: PILOT_WORKSPACE,
          subject: "test_fixture_public_ticket",
          submitterEmail: "test_fixture_submitter@example.com",
          body: "test_fixture_initial_message",
        });
        const reply = await caller.helpdesk.public.reply({
          accessToken: created.ticket.accessToken,
          body: "test_fixture_token_reply",
        });
        assert.equal(reply.authorType, "submitter");
        assert.equal(reply.body, "test_fixture_token_reply");
      },
    );
  } finally {
    await wiring.close();
  }
});

test("auth mode reports verifier and fallback state without secret material", async () => {
  await withEnv(
    {
      SUPABASE_JWT_SECRET: "test_fixture_super_secret_value",
      SUPABASE_URL: "https://test_fixture_project.supabase.co",
      DATABASE_URL: undefined,
      NODE_ENV: "development",
    },
    async () => {
      const mode = authModeFromEnv();
      assert.deepEqual(mode, {
        verifier: "supabase-hs256",
        persistent: false,
        pilotFallbackAllowed: false,
      });
      assert.equal(JSON.stringify(mode).includes("test_fixture_super_secret_value"), false);
    },
  );
});
