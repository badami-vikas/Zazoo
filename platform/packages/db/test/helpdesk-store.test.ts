/**
 * DrizzleHelpdeskStore against a real pglite-backed Postgres. Proves both trust
 * paths (frontend-migration-scoping.md gap #3): the PUBLIC submitter path gated
 * only on possession of the opaque `accessToken` (createTicket → getTicketByToken
 * → replyByToken, with unknown tokens returning null indistinguishably), and the
 * AUTHENTICATED agent path (listTickets / getTicket / replyAsAgent) which is
 * workspace-scoped. Ticket status transitions: replyByToken reopens, replyAsAgent
 * can set a status.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createLocalDb, DrizzleHelpdeskStore, schema } from "../src/index.js";

const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

test("helpdesk: public token flow + authenticated agent flow", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_helpdesk" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const [agent] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_agent@example.com", name: "Support Agent" })
      .returning({ id: schema.users.id });
    assert.ok(agent);
    const store = new DrizzleHelpdeskStore(db);

    const createInput = {
      workspaceId: ws.id,
      subject: "Cannot log in",
      submitterEmail: "user@example.com",
      submitterName: "Sam",
      body: "I am locked out.",
      operationId: "10000000-0000-4000-8000-000000000001",
      accessToken: "test_fixture_helpdesk_access_token_000000000001",
    };
    const { ticket, message } = await store.createTicket(createInput);
    assert.equal(ticket.subject, "Cannot log in");
    assert.equal(ticket.status, "open");
    assert.ok(ticket.accessToken);
    assert.equal(message.authorType, "submitter");
    assert.equal(message.body, "I am locked out.");
    const [storedTicket] = await db
      .select({ accessToken: schema.helpdeskTickets.accessToken })
      .from(schema.helpdeskTickets)
      .where(eq(schema.helpdeskTickets.id, ticket.id));
    assert.match(storedTicket!.accessToken, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(storedTicket!.accessToken, ticket.accessToken);
    const retriedCreate = await store.createTicket(createInput);
    assert.equal(retriedCreate.ticket.id, ticket.id);
    assert.equal(retriedCreate.message.id, message.id);
    await assert.rejects(
      () => store.createTicket({ ...createInput, subject: "Changed after retry" }),
      /operation id reused/,
    );

    // Public: fetch by token (found) + unknown token (null, indistinguishable).
    const byToken = await store.getTicketByToken(ticket.accessToken);
    assert.equal(byToken?.ticket.id, ticket.id);
    assert.equal(byToken?.messages.length, 1);
    assert.equal(await store.getTicketByToken("not-a-real-token"), null);

    // Public: submitter replies (found) + unknown token (null).
    const replyOperationId = "10000000-0000-4000-8000-000000000002";
    const reply = await store.replyByToken(ticket.accessToken, "Still broken.", replyOperationId);
    assert.equal(reply?.authorType, "submitter");
    assert.equal(
      (await store.replyByToken(ticket.accessToken, "Still broken.", replyOperationId))?.id,
      reply?.id,
    );
    await assert.rejects(
      () => store.replyByToken(ticket.accessToken, "Changed after retry.", replyOperationId),
      /operation id reused/,
    );
    assert.equal(
      await store.replyByToken(
        "not-a-real-token",
        "x",
        "10000000-0000-4000-8000-000000000003",
      ),
      null,
    );

    // Authenticated: inbox list is tenant-scoped.
    const list = await store.listTickets(ws.id, { limit: 10, offset: 0 });
    assert.equal(list.total, 1);
    assert.equal(list.items.length, 1);
    assert.equal("accessToken" in list.items[0]!, false);

    // Authenticated: getTicket (found, messages ordered) + not found.
    const got = await store.getTicket(ws.id, ticket.id);
    assert.equal(got?.messages.length, 2); // original + submitter reply
    assert.equal("accessToken" in got!.ticket, false);
    assert.equal(await store.getTicket(ws.id, MISSING_ID), null);

    // Authenticated: agent replies + sets status.
    const agentMsg = await store.replyAsAgent(ws.id, ticket.id, agent.id, "We're on it.", "pending");
    assert.equal(agentMsg?.authorType, "agent");
    const afterAgent = await store.getTicket(ws.id, ticket.id);
    assert.equal(afterAgent?.ticket.status, "pending");
    assert.equal(afterAgent?.messages.length, 3);

    // replyAsAgent on a missing ticket → null.
    assert.equal(await store.replyAsAgent(ws.id, MISSING_ID, agent.id, "x"), null);
  } finally {
    await close();
  }
});

test("helpdesk: legacy plaintext tokens migrate on first use without making hashes replayable", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_helpdesk_legacy" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);

    const ticketId = "00000000-0000-4000-8000-0000000000aa";
    const legacyToken = "legacy-plaintext-submit-token";
    await db.insert(schema.helpdeskTickets).values({
      id: ticketId,
      workspaceId: ws.id,
      subject: "Legacy ticket",
      submitterEmail: "legacy@example.com",
      accessToken: legacyToken,
    });

    const store = new DrizzleHelpdeskStore(db);
    const thread = await store.getTicketByToken(legacyToken);
    assert.equal(thread?.ticket.id, ticketId);

    const [migrated] = await db
      .select({ accessToken: schema.helpdeskTickets.accessToken })
      .from(schema.helpdeskTickets)
      .where(eq(schema.helpdeskTickets.id, ticketId));
    assert.match(migrated!.accessToken, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(migrated!.accessToken, legacyToken);
    assert.equal(await store.getTicketByToken(migrated!.accessToken), null);
    assert.equal(
      (
        await store.replyByToken(
          legacyToken,
          "Still works.",
          "10000000-0000-4000-8000-000000000004",
        )
      )?.authorType,
      "submitter",
    );
  } finally {
    await close();
  }
});
