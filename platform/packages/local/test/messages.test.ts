/**
 * Local Plane message store — bodies, search, and the identity guard.
 *
 * Storing third parties' message bodies is the largest residency change in the
 * Module's life (ADR-158, approved under AP-091), so the tests that matter most
 * here are the ones that prove a LID handle cannot become a phone identity and
 * that search actually returns rows rather than silently nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import {
  LOCAL_PLANE_PGLITE_EXTENSIONS,
  createMemoryLocalPlane,
  createPgliteLocalPlane,
  type LocalMessage,
  type LocalPlane,
} from "../src/index.js";

const ORG = "test_fixture_organization";
const SOURCE = "whatsapp";
const PHONE_CHAT = "919876543210@c.us";
const LID_CHAT = "218472398472@lid";

function message(overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    organizationId: ORG,
    source: SOURCE,
    messageId: "test_fixture_message",
    chatId: PHONE_CHAT,
    senderKey: "whatsapp:+919876543210",
    senderKind: "phone",
    direction: "inbound",
    sentAt: "2026-08-01T10:00:00.000Z",
    body: "test fixture body",
    ack: "read",
    capturedAt: "2026-08-01T10:00:01.000Z",
    ...overrides,
  };
}

async function withPglitePlane(
  run: (plane: LocalPlane) => Promise<void>,
): Promise<void> {
  const plane = await createPgliteLocalPlane();
  try {
    await run(plane);
  } finally {
    await plane.close();
  }
}

// ── The extension reality check ──────────────────────────────────────────────

test("pg_trgm ships with pglite but is NOT available unless registered", async () => {
  const bare = new PGlite();
  try {
    const available = await bare.query<{ name: string }>(
      `SELECT name FROM pg_available_extensions`,
    );
    const names = available.rows.map((r) => r.name);
    // The load-bearing fact: the claim "pglite 0.2.17 ships pg_trgm so nothing
    // more is needed" is only half true. It ships it; it does not offer it.
    assert.ok(
      !names.includes("pg_trgm"),
      "a bare PGlite unexpectedly offers pg_trgm — re-check the capability plumbing",
    );
    await assert.rejects(() => bare.exec(`CREATE EXTENSION pg_trgm`));
  } finally {
    await bare.close();
  }

  const registered = new PGlite({ extensions: LOCAL_PLANE_PGLITE_EXTENSIONS });
  try {
    await registered.exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    const probe = await registered.query<{ s: number }>(
      `SELECT similarity('bridge','bridges') AS s`,
    );
    assert.ok(Number(probe.rows[0]?.s) > 0);
  } finally {
    await registered.close();
  }
});

test("a plane we construct reports full-text AND trigram search", async () => {
  await withPglitePlane(async (plane) => {
    assert.deepEqual(await plane.graph.messageSearchCapabilities(), {
      fullText: true,
      trigram: true,
    });
  });
});

test("a caller-supplied client without the extension still gets full-text search", async () => {
  // Core Postgres FTS must never be optional. Trigram legitimately can be.
  const client = new PGlite();
  const plane = await createPgliteLocalPlane({ client });
  try {
    assert.deepEqual(await plane.graph.messageSearchCapabilities(), {
      fullText: true,
      trigram: false,
    });
    await plane.graph.putMessages([message({ body: "the quarterly invoice" })]);
    const hits = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "invoice",
    });
    assert.equal(hits.length, 1);
    // And fuzzy degrades to a substring scan rather than returning nothing.
    const fuzzy = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "quarter",
      mode: "fuzzy",
    });
    assert.equal(fuzzy.length, 1);
  } finally {
    await plane.close();
    await client.close();
  }
});

test("a trigram index without a loaded pg_trgm is reported plainly, not left to fail later", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-local-trgm-"));
  try {
    const armed = await createPgliteLocalPlane({ dataDir: dir });
    await armed.graph.putMessages([message()]);
    await armed.close();

    // Reopen with a client that did NOT register the extension. Without the
    // diagnostic this surfaces much later as `could not access file
    // "$libdir/pg_trgm"` on an unrelated query.
    const blind = new PGlite(dir);
    try {
      await assert.rejects(
        () => createPgliteLocalPlane({ client: blind }),
        /LOCAL_PLANE_PGLITE_EXTENSIONS/,
      );
    } finally {
      await blind.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(`${dir}.bridge-owner`, { force: true });
  }
});

// ── Identity: the rule that is not negotiable ────────────────────────────────

test("a Linked-ID sender key cannot be stored as a phone identity", async () => {
  await withPglitePlane(async (plane) => {
    await assert.rejects(
      () =>
        plane.graph.putMessages([
          message({ senderKey: `whatsapp-lid:${LID_CHAT}`, senderKind: "phone" }),
        ]),
      /Linked ID is an opaque handle/,
    );
  });
});

test("a phone key carrying a WhatsApp id suffix is refused — the laundering path", async () => {
  // This is the exact 2026-08-01 bug shape: LID digits with the suffix stripped
  // into a phone-shaped field. Guarding only the id would let it through.
  await withPglitePlane(async (plane) => {
    await assert.rejects(
      () =>
        plane.graph.putMessages([
          message({ senderKey: "whatsapp:+218472398472@lid", senderKind: "phone" }),
        ]),
      /id with the suffix stripped/,
    );
  });
});

test("a phone key that is not E.164-shaped is refused", async () => {
  await withPglitePlane(async (plane) => {
    await assert.rejects(
      () => plane.graph.putMessages([message({ senderKey: "whatsapp:218472398472" })]),
      /malformed phone sender key/,
    );
  });
});

test("LID and phone senders never resolve to each other", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([
      message({ messageId: "m_phone", senderKey: "whatsapp:+218472398472" }),
      message({
        messageId: "m_lid",
        chatId: LID_CHAT,
        senderKey: `whatsapp-lid:${LID_CHAT}`,
        senderKind: "lid",
        body: "test fixture body",
      }),
    ]);
    // Same digits, different spaces. A lookup in one space must not see the other.
    const byPhone = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "body",
      senderKey: "whatsapp:+218472398472",
    });
    assert.deepEqual(byPhone.map((m) => m.messageId), ["m_phone"]);
    const byLid = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "body",
      senderKey: `whatsapp-lid:${LID_CHAT}`,
    });
    assert.deepEqual(byLid.map((m) => m.messageId), ["m_lid"]);
  });
});

test("a sender kind requiring a key cannot be stored without one", async () => {
  await withPglitePlane(async (plane) => {
    const { senderKey: _dropped, ...withoutKey } = message();
    await assert.rejects(
      () => plane.graph.putMessages([withoutKey as LocalMessage]),
      /carries no sender key/,
    );
  });
});

test("an unattributed sender stays unattributed rather than being guessed", async () => {
  await withPglitePlane(async (plane) => {
    const { senderKey: _dropped, ...unattributed } = message();
    await plane.graph.putMessages([
      { ...unattributed, senderKind: "unknown" } as LocalMessage,
    ]);
    const [stored] = await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT);
    assert.equal(stored?.senderKey, undefined);
    assert.equal(stored?.senderKind, "unknown");
  });
});

test("a batch containing one bad message writes none of it", async () => {
  await withPglitePlane(async (plane) => {
    await assert.rejects(() =>
      plane.graph.putMessages([
        message({ messageId: "good" }),
        message({ messageId: "bad", senderKey: "whatsapp:+1@lid" }),
      ]),
    );
    assert.equal((await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT)).length, 0);
  });
});

// ── Storage and search ───────────────────────────────────────────────────────

test("bodies, attachments and ack round-trip", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([
      message({
        body: "here is the deck",
        attachment: {
          kind: "document",
          mimeType: "application/pdf",
          fileName: "deck.pdf",
          byteSize: 1024,
          localPath: "/Users/test/Documents/Bridge/deck.pdf",
        },
        ack: "delivered",
        direction: "outbound",
      }),
    ]);
    const [stored] = await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT);
    assert.equal(stored?.body, "here is the deck");
    assert.equal(stored?.ack, "delivered");
    assert.equal(stored?.direction, "outbound");
    assert.equal(stored?.attachment?.fileName, "deck.pdf");
    assert.equal(stored?.attachment?.byteSize, 1024);
  });
});

test("re-capturing a message advances ack without duplicating the row", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([message({ ack: "sent" })]);
    await plane.graph.putMessages([message({ ack: "read" })]);
    const stored = await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.ack, "read");
  });
});

test("full-text search matches words and ranks results", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([
      message({ messageId: "m1", body: "can we move the invoice call to Friday" }),
      message({ messageId: "m2", body: "invoice invoice invoice" }),
      message({ messageId: "m3", body: "unrelated chatter about lunch" }),
    ]);
    const hits = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "invoice",
    });
    assert.deepEqual(hits.map((h) => h.messageId).sort(), ["m1", "m2"]);
    assert.ok(hits.every((h) => h.rank > 0));
  });
});

test("full-text search is language-neutral — no English stopword loss", async () => {
  await withPglitePlane(async (plane) => {
    // 'the' is an English stopword: the `english` configuration would index
    // nothing for this body's stopwords. `simple` keeps them, which is what a
    // multilingual address book needs.
    await plane.graph.putMessages([
      message({ messageId: "m_hi", body: "नमस्ते कैसे हैं आप" }),
      message({ messageId: "m_en", body: "the the the" }),
    ]);
    const devanagari = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "नमस्ते",
    });
    assert.deepEqual(devanagari.map((h) => h.messageId), ["m_hi"]);
    const stopword = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "the",
    });
    assert.deepEqual(stopword.map((h) => h.messageId), ["m_en"]);
  });
});

test("full-text search never throws on hostile query text", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([message({ body: "hello" })]);
    for (const text of ["&&&", "'; DROP TABLE local_messages; --", "a & | ! ( )"]) {
      const hits = await plane.graph.searchMessages({ organizationId: ORG, text });
      assert.ok(Array.isArray(hits));
    }
    // The table is still there.
    assert.equal((await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT)).length, 1);
  });
});

test("fuzzy search forgives a typo when pg_trgm is loaded", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([
      message({ messageId: "m1", body: "sending the quarterly invoice now" }),
    ]);
    // Full text will not match a misspelling…
    const exact = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "invoise",
    });
    assert.equal(exact.length, 0);
    // …fuzzy does.
    const fuzzy = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "invoise",
      mode: "fuzzy",
    });
    assert.deepEqual(fuzzy.map((h) => h.messageId), ["m1"]);
    assert.ok((fuzzy[0]?.rank ?? 0) > 0);
  });
});

test("search is scoped to its organization, thread and sender", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([
      message({ messageId: "mine", body: "shared word" }),
      message({
        messageId: "theirs",
        organizationId: "other_organization",
        body: "shared word",
      }),
      message({ messageId: "other_chat", chatId: "111@c.us", body: "shared word" }),
    ]);
    const hits = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "shared",
    });
    assert.deepEqual(hits.map((h) => h.messageId).sort(), ["mine", "other_chat"]);
    const scoped = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "shared",
      chatId: PHONE_CHAT,
    });
    assert.deepEqual(scoped.map((h) => h.messageId), ["mine"]);
  });
});

test("substring fallback escapes LIKE metacharacters", async () => {
  const client = new PGlite(); // no trigram — forces the fallback path
  const plane = await createPgliteLocalPlane({ client });
  try {
    await plane.graph.putMessages([
      message({ messageId: "literal", body: "a 100% real discount" }),
      message({ messageId: "decoy", body: "totally unrelated" }),
    ]);
    const hits = await plane.graph.searchMessages({
      organizationId: ORG,
      text: "100%",
      mode: "fuzzy",
    });
    // "100%" must match literally, not act as a wildcard that matches the decoy.
    assert.deepEqual(hits.map((h) => h.messageId), ["literal"]);
  } finally {
    await plane.close();
    await client.close();
  }
});

// ── Thread activity: the consent gate's factual input ────────────────────────

test("thread activity distinguishes who wrote first", async () => {
  await withPglitePlane(async (plane) => {
    await plane.graph.putMessages([
      message({
        messageId: "in1",
        direction: "inbound",
        sentAt: "2026-07-01T09:00:00.000Z",
      }),
      message({
        messageId: "in2",
        direction: "inbound",
        sentAt: "2026-07-03T09:00:00.000Z",
      }),
      ((): LocalMessage => {
        const { senderKey: _ownMessagesHaveNoCounterparty, ...outbound } = message({
          messageId: "out1",
          direction: "outbound",
          senderKind: "self",
          sentAt: "2026-07-02T09:00:00.000Z",
        });
        return outbound as LocalMessage;
      })(),
    ]);
    const activity = await plane.graph.getThreadActivity(ORG, SOURCE, PHONE_CHAT);
    assert.equal(activity.inboundCount, 2);
    assert.equal(activity.outboundCount, 1);
    assert.equal(activity.firstInboundAt, "2026-07-01T09:00:00.000Z");
    assert.equal(activity.lastInboundAt, "2026-07-03T09:00:00.000Z");
    assert.equal(activity.lastOutboundAt, "2026-07-02T09:00:00.000Z");
  });
});

test("a thread nobody has written in reports zero, not absence", async () => {
  await withPglitePlane(async (plane) => {
    const activity = await plane.graph.getThreadActivity(ORG, SOURCE, "999@c.us");
    assert.deepEqual(activity, {
      chatId: "999@c.us",
      inboundCount: 0,
      outboundCount: 0,
    });
  });
});

// ── Migration: an already-installed database keeps its data ──────────────────

test("an installed narrow local_messages is widened without losing rows", async () => {
  const client = new PGlite({ extensions: LOCAL_PLANE_PGLITE_EXTENSIONS });
  try {
    // The shape before the additive columns existed. `CREATE TABLE IF NOT EXISTS`
    // alone would leave this narrow and every insert naming `ack` would fail.
    await client.exec(`
      CREATE TABLE local_messages (
        organization_id text NOT NULL,
        source text NOT NULL,
        message_id text NOT NULL,
        chat_id text NOT NULL,
        PRIMARY KEY (organization_id, source, message_id)
      );
      INSERT INTO local_messages VALUES ('${ORG}','${SOURCE}','legacy','${PHONE_CHAT}');
    `);
    const plane = await createPgliteLocalPlane({ client });
    const stored = await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT);
    assert.equal(stored.length, 1, "the pre-existing row survived the migration");
    assert.equal(stored[0]?.messageId, "legacy");
    assert.equal(stored[0]?.ack, "unknown");
    // And the widened table now accepts a full write.
    await plane.graph.putMessages([message({ messageId: "new" })]);
    assert.equal((await plane.graph.listMessages(ORG, SOURCE, PHONE_CHAT)).length, 2);
    await plane.close();
  } finally {
    await client.close();
  }
});

test("messages persist across a restart of the same data directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-local-messages-"));
  try {
    const first = await createPgliteLocalPlane({ dataDir: dir });
    await first.graph.putMessages([message({ body: "persisted body" })]);
    await first.close();

    const second = await createPgliteLocalPlane({ dataDir: dir });
    const hits = await second.graph.searchMessages({
      organizationId: ORG,
      text: "persisted",
    });
    assert.deepEqual(hits.map((h) => h.body), ["persisted body"]);
    await second.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(`${dir}.bridge-owner`, { force: true });
  }
});

// ── The in-memory adapter binds the same port and the same identity rule ─────

test("the in-memory adapter enforces the identity rule identically", async () => {
  const plane = createMemoryLocalPlane();
  await assert.rejects(
    () =>
      plane.graph.putMessages([
        message({ senderKey: `whatsapp-lid:${LID_CHAT}`, senderKind: "phone" }),
      ]),
    /Linked ID is an opaque handle/,
  );
  await plane.graph.putMessages([message({ body: "zero infra body" })]);
  const hits = await plane.graph.searchMessages({
    organizationId: ORG,
    text: "infra",
  });
  assert.equal(hits.length, 1);
  // It says plainly that it is not a Postgres index.
  assert.deepEqual(await plane.graph.messageSearchCapabilities(), {
    fullText: false,
    trigram: false,
  });
  const activity = await plane.graph.getThreadActivity(ORG, SOURCE, PHONE_CHAT);
  assert.equal(activity.inboundCount, 1);
});
