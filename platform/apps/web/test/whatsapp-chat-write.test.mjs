/**
 * The Chats surface's WRITE path and its annotation scoping (TASK-030,
 * ADR-160).
 *
 * Two kinds of assertion, deliberately mixed:
 *
 *  - **Behavioural**, over the pure module the surface actually calls. Send
 *    refusals and annotation subject keys are decided there, so they can be
 *    exercised for real rather than pattern-matched.
 *  - **Source-level**, for the properties that live in what the code is ABLE to
 *    express — one transport, no renderer-supplied JavaScript, no forked
 *    annotation store. A runtime test over a stubbed shell cannot observe those.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  annotationSubjectFor,
  decideManualSend,
  describeSendFailure,
  describeSendOutcome,
  manualSendRequest,
  recipientKeyForChat,
  subjectKeyOf,
} from "../src/app/pages/whatsapp/compose.ts";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ENGINE = read("../src/app/pages/whatsapp/engine.ts");
const COMPOSE = read("../src/app/pages/whatsapp/compose.ts");
const COMPOSER = read("../src/app/pages/whatsapp/ThreadComposer.tsx");
const ANNOTATIONS = read("../src/app/pages/whatsapp/ChatAnnotations.tsx");
const CHATS_SURFACE = read("../src/app/pages/whatsapp/ChatsSurface.tsx");

// ── Refusals are values, and every one of them is rendered ───────────────────

test("a refusal from the shell ceiling renders its reason, never a bare failure", () => {
  const notice = describeSendOutcome({
    status: "refused",
    reason: "Automated sending is halted (WhatsApp warned this account).",
    code: "WHATSAPP_SEND_HALTED",
  });
  assert.equal(notice.tone, "refused");
  assert.match(notice.text, /halted/);
  assert.match(notice.text, /WhatsApp warned this account/);
});

test("a cap refusal says when it clears, so 'try later' is an actual time", () => {
  const earliestAtMs = Date.UTC(2026, 7, 4, 9, 30);
  const notice = describeSendOutcome({
    status: "deferred",
    reason: "30 messages were sent in the last 24 hours; the cap is 30.",
    code: "WHATSAPP_SEND_DAILY_CAP",
    earliestAtMs,
  });
  assert.equal(notice.tone, "deferred");
  assert.match(notice.text, /the cap is 30/);
  assert.ok(
    notice.text.includes(new Date(earliestAtMs).toLocaleString()),
    "a deferral must name the instant it clears",
  );
});

test("a deferral with no clearing time still renders its reason", () => {
  const notice = describeSendOutcome({
    status: "deferred",
    reason: "This recipient already had a message in the last 7 days.",
    code: "WHATSAPP_SEND_COOLDOWN",
  });
  assert.equal(notice.tone, "deferred");
  assert.match(notice.text, /last 7 days/);
});

test("'we don't know' is its own state — a post-ceiling failure is never called 'not sent'", () => {
  // The ceiling counts a send BEFORE the script runs, so anything that fails
  // afterwards may still have reached WhatsApp. Reporting that as a refusal is
  // how a user sends the same message twice.
  const notice = describeSendOutcome({
    status: "refused",
    reason: "the operation timed out",
    code: "WHATSAPP_SEND_FAILED",
  });
  assert.equal(notice.tone, "unknown");
  assert.match(notice.text, /could not confirm/i);
  assert.ok(!/^Not sent/.test(notice.text), "an unknown outcome must not claim nothing was sent");
});

test("every outcome shape produces a non-empty sentence — a silent no-op is impossible", () => {
  const outcomes = [
    { status: "sent", request: {}, delaySeconds: 0 },
    { status: "refused", reason: "The message is empty." },
    { status: "refused", reason: "boom", code: "WHATSAPP_SEND_FAILED" },
    { status: "deferred", reason: "later", code: "WHATSAPP_SEND_COOLDOWN", earliestAtMs: 1 },
    { status: "needs_approval", request: {}, reason: "needs a human" },
    { status: "something-new-nobody-wrote-yet" },
  ];
  for (const outcome of outcomes) {
    const notice = describeSendOutcome(outcome);
    assert.ok(notice.text.trim().length > 0, `${outcome.status} produced no sentence`);
    assert.ok(["sent", "refused", "deferred", "unknown"].includes(notice.tone));
  }
  assert.equal(describeSendFailure(new Error("IPC died")).tone, "unknown");
  assert.match(describeSendFailure(new Error("IPC died")).text, /IPC died/);
  // A shell refusal arrives as a raw struct, not an Error.
  assert.match(describeSendFailure({ message: "shell said no" }).text, /shell said no/);
});

test("a successful send is the only outcome that reads as sent", () => {
  const sent = describeSendOutcome({ status: "sent", request: {}, delaySeconds: 0 });
  assert.equal(sent.tone, "sent");
  assert.match(sent.text, /Sent/);
});

// ── The manual gate keeps validation and drops the automation advice ─────────

test("the manual gate refuses what no approval and no waiting could fix", () => {
  const base = {
    targetKind: "person",
    targetId: "919876543210@c.us",
    recipientKey: "whatsapp:+919876543210",
  };
  assert.equal(decideManualSend({ ...base, body: "   " }).status, "refused");
  assert.equal(decideManualSend({ ...base, body: "x".repeat(4097) }).status, "refused");
  assert.equal(
    decideManualSend({ ...base, targetId: "not-an-address", body: "hi" }).status,
    "refused",
  );
  assert.equal(
    decideManualSend({ ...base, recipientKey: "", body: "hi" }).status,
    "refused",
  );
  // A group id offered as a person, and vice versa, are both malformed.
  assert.equal(
    decideManualSend({ ...base, targetId: "1234-5678@g.us", body: "hi" }).status,
    "refused",
  );
  assert.equal(
    decideManualSend({ ...base, targetKind: "community", body: "hi" }).status,
    "refused",
  );
});

test("a human's ordinary reply is allowed, and the grant is bound to the exact body", () => {
  const request = {
    targetKind: "person",
    targetId: "919876543210@c.us",
    recipientKey: "whatsapp:+919876543210",
    body: "  see you at 4  ",
  };
  const decision = decideManualSend(request);
  assert.equal(decision.status, "allowed");
  assert.equal(decision.request.body, "see you at 4", "the body is trimmed before it is granted");
  const edited = decideManualSend({ ...request, body: "see you at 5" });
  assert.notEqual(
    decision.grant.bodyDigest,
    edited.grant.bodyDigest,
    "an edited draft must not be able to ride the earlier grant",
  );
});

test("the manual gate does NOT apply the automation rules a person is not doing", () => {
  // The consent gate, business hours, the near-identical-body limit and the
  // jitter are anti-bulk-outreach protection. Applied to a person typing a
  // reply they would refuse an ordinary conversation.
  const decision = decideManualSend({
    targetKind: "person",
    targetId: "919876543210@c.us",
    recipientKey: "whatsapp:+919876543210",
    body: "first message I have ever sent this person, at 3am",
  });
  assert.equal(decision.status, "allowed");
  // Against the CODE, not the prose about it — the doc comment above
  // `decideManualSend` names every rule it is deliberately not applying.
  const code = COMPOSE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const rule of [
    "consent_gate",
    "business_hours",
    "jitterDraw",
    "bodySimilarity",
    "evaluateSendPolicy",
    "performAutomatedSend",
  ]) {
    assert.ok(!code.includes(rule), `the manual gate must not re-implement ${rule}`);
  }
});

test("a recipient key comes from the shared identity spaces, and a LID never becomes a number", () => {
  assert.equal(recipientKeyForChat({ chatId: "919876543210@c.us" }), "whatsapp:+919876543210");
  assert.equal(
    recipientKeyForChat({ chatId: "1234-5678@g.us" }),
    "whatsapp-group:1234-5678@g.us",
  );
  const lid = recipientKeyForChat({ chatId: "182736451827364@lid" });
  assert.equal(lid, "whatsapp-lid:182736451827364@lid");
  assert.ok(!lid.startsWith("whatsapp:+"), "a LID must never be laundered into a phone identity");
  assert.equal(recipientKeyForChat({ chatId: "" }), undefined);
});

test("a chat Bridge cannot key is refused with a reason, not sent blind", () => {
  const built = manualSendRequest({ chatId: "status@broadcast" }, "hello");
  assert.ok("refusal" in built, "an unkeyable chat must not produce a send request");
  assert.match(built.refusal, /nothing was sent/);
});

test("a group thread is addressed as a Community, a direct chat as a Person", () => {
  const group = manualSendRequest({ chatId: "1234-5678@g.us", isGroup: true }, "hi");
  assert.equal(group.request.targetKind, "community");
  const direct = manualSendRequest({ chatId: "919876543210@c.us" }, "hi");
  assert.equal(direct.request.targetKind, "person");
});

// ── One transport, and no renderer-supplied code ────────────────────────────

test("the manual path shares the ONE transport with the automated path", () => {
  const code = ENGINE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Still exactly two: the import and the single call inside `sendPort`. A
  // manual send that reached `sendMessage` on its own would be a second write
  // path, which the architecture forbids.
  assert.equal(
    (code.match(/\bsendMessage\b/g) ?? []).length,
    2,
    "the raw send transport must remain reachable only from sendPort",
  );
  assert.match(code, /sendManualMessage\(request: SendRequest\)/);
  assert.match(code, /await this\.sendPort\(decision\.request, decision\.grant\)/);
});

test("every manual outcome goes through the audit seam", () => {
  const manual = ENGINE.slice(ENGINE.indexOf("async sendManualMessage("));
  const body = manual.slice(0, manual.indexOf("sendCeiling()"));
  const records = body.match(/recordOutcomeInAudit\(/g) ?? [];
  assert.ok(
    records.length >= 2,
    "both the early refusal and the shell's answer must be recorded, not just the send",
  );
});

test("the composer names an operation and passes data — it can never supply JavaScript", () => {
  for (const [name, source] of [
    ["compose.ts", COMPOSE],
    ["ThreadComposer.tsx", COMPOSER],
  ]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "window.WPP",
      "WPP.",
      "eval(",
      "new Function",
      "tauriInvoke",
      "querySelector",
      "whatsapp-shell",
    ]) {
      assert.ok(!code.includes(forbidden), `${name} must not contain "${forbidden}"`);
    }
  }
  assert.ok(COMPOSER.includes('from "./engine"'), "the composer consumes the engine adapter");
});

test("the renderer never sends a count, a cap or a limit to the shell", () => {
  const code = `${COMPOSE}\n${COMPOSER}`.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["dailyCap:", "sentLast24h:", "cap:", "limits:"]) {
    assert.ok(!code.includes(forbidden), `the composer must not pass "${forbidden}" to the shell`);
  }
});

test("the composer keeps the draft on a refusal and clears it only on a confirmed send", () => {
  const send = COMPOSER.slice(COMPOSER.indexOf("async function send()"));
  const guarded = send.indexOf('described.tone === "sent"');
  const cleared = send.indexOf('setBody("")');
  assert.ok(guarded > 0 && cleared > guarded, "the draft may only be cleared inside the sent branch");
});

test("an unknown link state does not disable the composer", () => {
  // A failed status probe means the probe failed. Treating it as "not linked"
  // is the mistake that once made a live session announce it was unlinked.
  assert.match(COMPOSER, /const notLinked = linked === false;/);
});

// ── Annotations: scoped to the selected chat, on the existing data model ─────

test("the annotation subject is derived from the selected thread, with no picker", () => {
  const direct = annotationSubjectFor({ chatId: "919876543210@c.us", name: "Asha" });
  assert.deepEqual(direct, { kind: "chat", id: "919876543210@c.us", label: "Asha" });
  assert.equal(subjectKeyOf(direct), "chat:919876543210@c.us");

  const group = annotationSubjectFor({ chatId: "1234-5678@g.us", name: "Fund LPs", isGroup: true });
  assert.equal(group.kind, "community", "a group thread annotates its Community");
  assert.equal(subjectKeyOf(group), "community:1234-5678@g.us");

  // A group id whose `isGroup` flag never arrived is still a group.
  assert.equal(annotationSubjectFor({ chatId: "1234-5678@g.us" }).kind, "community");
  // No thread, no subject — never a default or sample subject.
  assert.equal(annotationSubjectFor(null), null);
  assert.equal(annotationSubjectFor({ chatId: "" }), null);
});

test("an unnamed thread falls back to its id rather than to an empty label", () => {
  assert.equal(annotationSubjectFor({ chatId: "919876543210@c.us" }).label, "919876543210@c.us");
  assert.equal(
    annotationSubjectFor({ chatId: "919876543210@c.us", name: "   " }).label,
    "919876543210@c.us",
  );
});

test("the header control reuses the existing procedures and forks no data model", () => {
  for (const procedure of [
    "trpc.whatsapp.annotations.query",
    "trpc.whatsapp.addTags.mutate",
    "trpc.whatsapp.addNote.mutate",
    "trpc.whatsapp.removeTag.mutate",
    "trpc.whatsapp.removeNote.mutate",
  ]) {
    assert.ok(ANNOTATIONS.includes(procedure), `ChatAnnotations must use ${procedure}`);
  }
  // Same subject derivation as the Tools-Page panel, so one chat is one key.
  assert.match(ANNOTATIONS, /annotationSubjectFor/);
  assert.ok(
    !/kind:\s*["'](chat|community)["']/.test(
      ANNOTATIONS.replace(/\/\*[\s\S]*?\*\//g, ""),
    ),
    "the kind must come from the shared derivation, never be hard-coded per call site",
  );
});

test("annotations declare no WhatsApp permission and make no engine call", () => {
  // Bridge's own Local-Plane data. It must keep working with no session at all.
  assert.ok(!ANNOTATIONS.includes("whatsAppEngine"), "annotations must not touch the session");
  assert.ok(!ANNOTATIONS.includes('from "./engine"'));
  assert.match(ANNOTATIONS, /never sent to WhatsApp/);
});

test("Tags & notes sits in the header row next to Sync messages", () => {
  const header = CHATS_SURFACE.slice(
    CHATS_SURFACE.indexOf('<div className="ml-auto flex items-center gap-2">'),
  );
  const row = header.slice(0, header.indexOf("</div>"));
  assert.ok(row.includes("<ChatAnnotations"), "the annotations control belongs in the header row");
  assert.ok(row.includes("Sync messages"), "…next to Sync messages");
  assert.match(CHATS_SURFACE, /<ChatAnnotations thread=\{selectedThread\}/);
});

// ── Thread ordering ─────────────────────────────────────────────────────────

test("a thread still renders oldest-first — the surface never reverses the store", () => {
  // `local_messages` is read `ORDER BY sent_at, message_id` and the tRPC
  // procedure documents "oldest first", which is already WhatsApp's order.
  const code = CHATS_SURFACE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [".reverse()", "flex-col-reverse", "b.sentAt", "sort((a, b)"]) {
    assert.ok(!code.includes(forbidden), `the message list must not re-order the store (${forbidden})`);
  }
  assert.ok(code.includes("const rows = messages ?? []"), "rows are the store's order, unchanged");
});

test("opening a conversation lands on the NEWEST message, not the oldest", () => {
  // A virtualised list opens at scroll zero, which is the oldest message in the
  // archive — that is what made the surface look like it had the order wrong.
  assert.match(
    CHATS_SURFACE,
    /virtualizer\.scrollToIndex\(rows\.length - 1, \{ align: "end" \}\)/,
  );
  // Pinned once per thread, so scrolling back through history is not yanked.
  assert.match(CHATS_SURFACE, /if \(pinnedThread\.current === selected\) return;/);
  // …and a sent message puts the view back at the bottom.
  const reload = CHATS_SURFACE.slice(CHATS_SURFACE.indexOf("const reloadThread"));
  assert.ok(
    reload.slice(0, reload.indexOf("}, [selected])")).includes("pinnedThread.current = null"),
    "re-reading after a send must re-pin to the newest message",
  );
});

test("the inert placeholder composer is gone", () => {
  assert.ok(
    !CHATS_SURFACE.includes("Sending from Bridge needs the approved send path"),
    "the disabled placeholder must be replaced, not left beside the real composer",
  );
  assert.match(CHATS_SURFACE, /<ThreadComposer/);
});
