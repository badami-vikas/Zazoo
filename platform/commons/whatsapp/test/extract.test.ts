import { strict as assert } from "node:assert";
import { test } from "node:test";
import { emptyPersonIndex, mapExtraction, personIndexFrom } from "../src/extract.js";
import type { WhatsAppContact, WhatsAppExtraction } from "../src/types.js";

const RUN = "run-1";
const AT = "2026-08-01T10:00:00.000Z";

function contact(phone: string, overrides: Partial<WhatsAppContact> = {}): WhatsAppContact {
  return {
    id: `${phone.replace(/\D/g, "")}@c.us`,
    phone,
    isMyContact: true,
    isGroup: false,
    ...overrides,
  };
}

function contactsRun(contacts: WhatsAppContact[]): WhatsAppExtraction {
  return { kind: "contacts", runId: RUN, capturedAt: AT, contacts };
}

test("unmatched contacts become new Person proposals with local-only phone", () => {
  const result = mapExtraction(
    contactsRun([contact("+919876543210", { name: "Asha" }), contact("+14155550100", { name: "Ben" })]),
    emptyPersonIndex(),
  );

  assert.equal(result.people.length, 2);
  assert.deepEqual(
    result.people.map((p) => p.displayName),
    ["Asha", "Ben"],
  );
  assert.equal(result.people[0]?.phoneE164, "+919876543210");
  assert.equal(result.people[0]?.matchedPersonId, undefined);
  assert.equal(result.people[0]?.runId, RUN);
  assert.equal(result.signals.length, 0);
});

test("a contact matching exactly one Person links instead of creating one", () => {
  const index = personIndexFrom([{ personId: "person-a", dedupeKey: "whatsapp:+919876543210" }]);

  const result = mapExtraction(contactsRun([contact("+919876543210", { name: "Asha" })]), index);

  assert.equal(result.people.length, 1);
  assert.equal(result.people[0]?.matchedPersonId, "person-a");
  assert.equal(result.signals.length, 0);
});

test("an ambiguous contact files a possible_duplicate Signal and proposes nothing", () => {
  const index = personIndexFrom([
    { personId: "person-a", dedupeKey: "whatsapp:+919876543210" },
    { personId: "person-b", dedupeKey: "whatsapp:+919876543210" },
  ]);

  const result = mapExtraction(contactsRun([contact("+919876543210", { name: "Asha" })]), index);

  assert.equal(result.people.length, 0);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0]?.kind, "possible_duplicate");
  assert.deepEqual(result.signals[0]?.candidatePersonIds, ["person-a", "person-b"]);
});

test("contacts with no derivable identity are skipped, not invented", () => {
  const result = mapExtraction(
    contactsRun([{ id: "unknown", name: "Ghost", isMyContact: true, isGroup: false }]),
    emptyPersonIndex(),
  );

  assert.equal(result.people.length, 0);
  assert.equal(result.signals.length, 0);
});

test("a group becomes a Community with participant People and membership Relations", () => {
  const extraction: WhatsAppExtraction = {
    kind: "groups",
    runId: RUN,
    capturedAt: AT,
    groups: [
      {
        id: "120363001@g.us",
        name: "Deal Team",
        participants: [contact("+919876543210", { name: "Asha" }), contact("+14155550100", { name: "Ben" })],
      },
    ],
  };

  const result = mapExtraction(extraction, emptyPersonIndex(), { defaultPolicy: "all" });

  assert.equal(result.communities.length, 1);
  assert.equal(result.communities[0]?.name, "Deal Team");
  assert.equal(result.communities[0]?.sourceGroupId, "120363001@g.us");
  assert.equal(result.people.length, 2);
  assert.equal(result.relations.length, 2);
  assert.equal(result.relations[0]?.kind, "community_member");
  assert.equal(result.relations[0]?.communityDedupeKey, result.communities[0]?.dedupeKey);
});

test("a participant in two groups yields one Person proposal and two memberships", () => {
  const shared = contact("+919876543210", { name: "Asha" });
  const extraction: WhatsAppExtraction = {
    kind: "groups",
    runId: RUN,
    capturedAt: AT,
    groups: [
      { id: "1@g.us", name: "Deal Team", participants: [shared] },
      { id: "2@g.us", name: "Book Club", participants: [shared] },
    ],
  };

  const result = mapExtraction(extraction, emptyPersonIndex(), { defaultPolicy: "all" });

  assert.equal(result.people.length, 1);
  assert.equal(result.communities.length, 2);
  assert.equal(result.relations.length, 2);
});

test("the same contact listed twice in one run is proposed once", () => {
  const result = mapExtraction(
    contactsRun([contact("+919876543210", { name: "Asha" }), contact("+91 98765 43210", { name: "Asha R" })]),
    emptyPersonIndex(),
  );

  assert.equal(result.people.length, 1);
});

test("every proposal carries the run id so an approval traces to its capture", () => {
  const extraction: WhatsAppExtraction = {
    kind: "groups",
    runId: RUN,
    capturedAt: AT,
    groups: [{ id: "1@g.us", name: "Deal Team", participants: [contact("+919876543210")] }],
  };

  const result = mapExtraction(extraction, emptyPersonIndex(), { defaultPolicy: "all" });

  for (const row of [...result.people, ...result.communities, ...result.relations]) {
    assert.equal(row.runId, RUN);
  }
});

// ── Participant policy ───────────────────────────────────────────────────────
// Measured on a live account: 817 groups, 35,298 unique participants, of whom
// 998 were in the address book. Policy is what keeps Approvals reviewable.

function group(participants: WhatsAppContact[]): WhatsAppExtraction {
  return {
    kind: "groups",
    runId: RUN,
    capturedAt: AT,
    groups: [{ id: "1@g.us", name: "Deal Team", participants }],
  };
}

const known = contact("+919876543210", { name: "Asha" });
const messaged = contact("+14155550100", { name: "Ben" });
const stranger = contact("+61255550111");

test("the default policy proposes contacts and people you have messaged", () => {
  const result = mapExtraction(group([known, messaged, stranger]), emptyPersonIndex(), {
    defaultPolicy: "contacts_and_messaged",
    contactIds: new Set([known.id]),
    messagedIds: new Set([messaged.id]),
  });

  assert.equal(result.people.length, 2);
  assert.equal(result.relations.length, 2);
  assert.ok(!result.people.some((p) => p.displayName === stranger.id));
});

test("the contacts policy excludes people you have merely messaged", () => {
  const result = mapExtraction(group([known, messaged, stranger]), emptyPersonIndex(), {
    defaultPolicy: "contacts",
    contactIds: new Set([known.id]),
    messagedIds: new Set([messaged.id]),
  });

  assert.equal(result.people.length, 1);
  assert.equal(result.people[0]?.displayName, "Asha");
});

test("a per-group override beats the default policy", () => {
  const result = mapExtraction(group([known, messaged, stranger]), emptyPersonIndex(), {
    defaultPolicy: "contacts",
    policyByGroupId: { "1@g.us": "all" },
    contactIds: new Set([known.id]),
  });

  assert.equal(result.people.length, 3);
});

test("the Community records full size alongside what the policy proposed", () => {
  const result = mapExtraction(group([known, messaged, stranger]), emptyPersonIndex(), {
    defaultPolicy: "contacts",
    contactIds: new Set([known.id]),
  });

  const community = result.communities[0]!;
  assert.equal(community.participantCount, 3);
  assert.equal(community.proposedMemberCount, 1);
  assert.equal(community.policy, "contacts");
});

test("a number-hidden contact is proposed and marked as such", () => {
  const lid: WhatsAppContact = {
    id: "209876543210@lid",
    name: "Chandra",
    isMyContact: true,
    isGroup: false,
  };
  const result = mapExtraction(contactsRun([lid]), emptyPersonIndex());

  assert.equal(result.people.length, 1);
  assert.equal(result.people[0]?.identityKind, "lid");
  assert.equal(result.people[0]?.phoneE164, undefined);
  assert.equal(result.people[0]?.displayName, "Chandra");
});

test("a phone-bearing contact is marked as a phone identity", () => {
  const result = mapExtraction(contactsRun([known]), emptyPersonIndex());
  assert.equal(result.people[0]?.identityKind, "phone");
  assert.equal(result.people[0]?.phoneE164, "+919876543210");
});
