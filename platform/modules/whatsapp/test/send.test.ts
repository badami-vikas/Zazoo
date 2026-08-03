import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_BODY_LENGTH,
  bodyDigest,
  communityRecipientKey,
  decideSend,
  grantCovers,
  type RecipientApproval,
  type SendRequest,
} from "../src/send.js";

const KEY = "whatsapp:+919876543210";

function request(overrides: Partial<SendRequest> = {}): SendRequest {
  return {
    targetKind: "person",
    targetId: "919876543210@c.us",
    recipientKey: KEY,
    body: "Hello Asha, following up on the term sheet.",
    ...overrides,
  };
}

function approval(overrides: Partial<RecipientApproval> = {}): RecipientApproval {
  return {
    recipientKey: KEY,
    approvedBy: "user:vikas",
    approvedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

test("the first message to a recipient needs a human approval", () => {
  const decision = decideSend(request(), []);
  assert.equal(decision.status, "needs_approval");
});

test("a later message to an approved recipient is allowed", () => {
  const decision = decideSend(request({ body: "One more thing —" }), [approval()]);
  assert.equal(decision.status, "allowed");
});

test("approval for one recipient never covers another", () => {
  const decision = decideSend(
    request({ recipientKey: "whatsapp:+14155550100", targetId: "14155550100@c.us" }),
    [approval()],
  );
  assert.equal(decision.status, "needs_approval");
});

test("a withdrawn approval sends the recipient back to the human", () => {
  const decision = decideSend(request(), [
    approval({ revokedAt: "2026-08-02T09:00:00.000Z" }),
  ]);
  assert.equal(decision.status, "needs_approval");
  assert.match(decision.status === "needs_approval" ? decision.reason : "", /withdrawn/);
});

test("revocation beats a second live approval for the same recipient", () => {
  const decision = decideSend(request(), [
    approval(),
    approval({ revokedAt: "2026-08-02T09:00:00.000Z" }),
  ]);
  assert.equal(decision.status, "needs_approval");
});

test("an empty or oversized message is refused, not put to the human", () => {
  assert.equal(decideSend(request({ body: "   " }), [approval()]).status, "refused");
  const long = "x".repeat(MAX_BODY_LENGTH + 1);
  assert.equal(decideSend(request({ body: long }), [approval()]).status, "refused");
});

test("a malformed target is refused rather than approved", () => {
  for (const targetId of ["", "nonsense", "12345", "120363001@g.us"]) {
    const decision = decideSend(request({ targetId }), [approval()]);
    assert.equal(decision.status, "refused", `${targetId} should be refused for a person`);
  }
});

test("a group target is sendable only as a community", () => {
  const key = communityRecipientKey("120363001@g.us");
  const asCommunity = decideSend(
    request({ targetKind: "community", targetId: "120363001@g.us", recipientKey: key }),
    [approval({ recipientKey: key })],
  );
  assert.equal(asCommunity.status, "allowed");

  const personToGroup = decideSend(
    request({ targetKind: "person", targetId: "120363001@g.us" }),
    [approval()],
  );
  assert.equal(personToGroup.status, "refused");
});

test("a LID recipient can be messaged even with no phone number", () => {
  const key = "whatsapp-lid:2098@lid";
  const decision = decideSend(
    request({ targetId: "2098@lid", recipientKey: key }),
    [approval({ recipientKey: key })],
  );
  assert.equal(decision.status, "allowed");
});

test("a grant covers only the exact body it was minted for", () => {
  const decision = decideSend(request(), [approval()]);
  assert.equal(decision.status, "allowed");
  if (decision.status !== "allowed") return;

  assert.ok(grantCovers(decision.grant, decision.request));
  // Standing trust for a recipient is not a blank cheque for other text.
  assert.ok(!grantCovers(decision.grant, request({ body: "Wire the funds to account 12345." })));
  // Nor for a different recipient.
  assert.ok(
    !grantCovers(decision.grant, request({ targetId: "14155550100@c.us" })),
  );
});

test("the grant ignores surrounding whitespace, matching what is sent", () => {
  const decision = decideSend(request({ body: "  Hello  " }), [approval()]);
  if (decision.status !== "allowed") throw new Error("expected allowed");
  assert.equal(decision.request.body, "Hello");
  assert.ok(grantCovers(decision.grant, request({ body: "Hello" })));
});

test("bodyDigest separates similar messages", () => {
  assert.notEqual(bodyDigest("Pay $100"), bodyDigest("Pay $1000"));
  assert.notEqual(bodyDigest("ab"), bodyDigest("ba"));
  assert.equal(bodyDigest("same"), bodyDigest("same"));
});
