/**
 * Capability Builder rung 4 (AI Harness K9, TASK-053) - structure synthesis.
 *
 * The north-star test TASK-053 wrote for itself is the first one here:
 * given ONLY observation data from ETA-style work, the Builder proposes a
 * Deals/Sources/Theses-shaped module without being told about DealPilot. The
 * fixture below therefore never names a Module, a Database, or DealPilot -
 * it is entities and (field, value) claims, the shape K3 actually stores.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyClaimContent,
  draftStructureFromClaims,
  STRUCTURE_MIN_ENTITIES,
  type StructureClaimInput,
  type StructureEntityInput,
} from "../src/index.js";

const isRedTier = (field: string, value: string) => classifyClaimContent(field, value).tier === "red";

let nextClaim = 0;
function claim(entityId: string, field: string, value: string): StructureClaimInput {
  nextClaim += 1;
  return { id: `claim-${nextClaim}`, entityId, field, value };
}

/** ETA-style observation data: three kinds of thing a searcher works with,
 *  each stated as claims on `topic` entities. No Module, Database or Page
 *  vocabulary appears anywhere in this fixture. */
function etaObservations(): { entities: StructureEntityInput[]; claims: StructureClaimInput[] } {
  const entities: StructureEntityInput[] = [];
  const claims: StructureClaimInput[] = [];
  // NB: no value here says "broker". `classifyClaimContent` is deliberately
  // over-broad and "broker" contains "broke" (financial_distress), so a
  // broker-sourced deal would have its origin dropped as red-tier before
  // counting. That is the safety rule behaving correctly and the fixture
  // working around it, not a bug - the cost of a false RED is one dropped
  // field, which is the trade ADR-225's classifier states outright.
  const deals = [
    ["Cascade HVAC", "diligence", "2.4m", "intermediary"],
    ["Northwind Plumbing", "loi", "1.1m", "proprietary"],
    ["Ridgeline Pest", "screening", "900k", "intermediary"],
    ["Harbor Dental", "diligence", "3.8m", "banker"],
  ];
  for (const [name, stage, ebitda, origin] of deals) {
    const id = `entity-deal-${name}`;
    entities.push({ id, kind: "topic", name: name! });
    claims.push(
      claim(id, "type", "deal"),
      claim(id, "stage", stage!),
      claim(id, "ebitda", ebitda!),
      claim(id, "origin", origin!),
    );
  }
  const sources = [
    ["Mid-Atlantic Business Intermediaries", "intermediary", "warm"],
    ["Cornerstone M&A", "banker", "cold"],
    ["Searcher Slack #deals", "network", "warm"],
  ];
  for (const [name, channel, temperature] of sources) {
    const id = `entity-source-${name}`;
    entities.push({ id, kind: "topic", name: name! });
    claims.push(
      claim(id, "type", "source"),
      claim(id, "channel", channel!),
      claim(id, "temperature", temperature!),
    );
  }
  const theses = [
    ["Route density in home services", "services", "high"],
    ["Regulated waste consolidation", "industrial", "medium"],
    ["Dental DSO roll-up", "healthcare", "low"],
  ];
  for (const [name, sector, conviction] of theses) {
    const id = `entity-thesis-${name}`;
    entities.push({ id, kind: "topic", name: name! });
    claims.push(
      claim(id, "type", "thesis"),
      claim(id, "sector", sector!),
      claim(id, "conviction", conviction!),
    );
  }
  return { entities, claims };
}

test("NORTH STAR: ETA observation data alone yields Deals/Sources/Theses-shaped Databases", () => {
  const { entities, claims } = etaObservations();

  const result = draftStructureFromClaims(entities, claims, isRedTier);

  assert.equal(result.proposed, true);
  if (!result.proposed) return;
  assert.equal(result.evidence.basis, "discriminator");
  assert.deepEqual(
    result.databases.map((database) => database.name),
    ["deal", "source", "thesis"],
    "the Databases are NAMED by a value read out of the data, never invented",
  );
  for (const database of result.databases) {
    assert.equal(database.discriminatorField, "type");
    assert.deepEqual(database.entityKinds, ["topic"]);
  }

  const deals = result.databases[0]!;
  assert.equal(deals.entityIds.length, 4);
  assert.deepEqual(
    deals.columns.map((column) => column.field),
    ["ebitda", "origin", "stage"],
    "columns are exactly the fields the four deal entities share - nothing about DealPilot's own schema leaks in",
  );
  assert.deepEqual(deals.sparseFields, [], "no ragged edge in this fixture");
  assert.equal(deals.columns[1]!.distinctValues, 3, "origin: intermediary/proprietary/banker");
  assert.equal(deals.columns.every((column) => column.support === 4), true);
  assert.equal(
    deals.columns.every((column) => column.sampleClaimIds.length === column.support),
    true,
    "every column carries the claim ids it was counted from - the evidence IS the proposal",
  );

  assert.deepEqual(
    result.databases[1]!.columns.map((column) => column.field),
    ["channel", "temperature"],
  );
  assert.deepEqual(
    result.databases[2]!.columns.map((column) => column.field),
    ["conviction", "sector"],
  );
});

test("the derivation is deterministic - the same observations propose the same structure", () => {
  const first = draftStructureFromClaims(...(() => {
    const { entities, claims } = etaObservations();
    return [entities, claims, isRedTier] as const;
  })());
  const shuffled = (() => {
    const { entities, claims } = etaObservations();
    return draftStructureFromClaims([...entities].reverse(), [...claims].reverse(), isRedTier);
  })();
  assert.deepEqual(
    JSON.parse(JSON.stringify(first, ["name", "discriminatorField", "columns", "field", "support"])),
    JSON.parse(JSON.stringify(shuffled, ["name", "discriminatorField", "columns", "field", "support"])),
    "row order must not change what the Builder proposes, or the proposal is evidence of nothing",
  );
});

test("red-tier claim content never becomes a column, and the exclusion is reported", () => {
  const { entities, claims } = etaObservations();
  const dealId = entities[0]!.id;
  const withRed = [
    ...claims,
    claim(dealId, "owner_note", "the seller is going through chemotherapy"),
    claim(entities[1]!.id, "owner_note", "the founder is bankrupt and desperate"),
  ];

  const result = draftStructureFromClaims(entities, withRed, isRedTier);

  assert.equal(result.proposed, true);
  if (!result.proposed) return;
  assert.equal(result.evidence.redTierClaimsExcluded, 2);
  for (const database of result.databases) {
    assert.equal(
      database.columns.some((column) => column.field === "owner_note"),
      false,
      "a red-tier field is dropped BEFORE counting - it cannot become a column",
    );
    assert.equal(database.sparseFields.includes("owner_note"), false);
  }
});

test("no discriminator: the shape is proposed by field signature and left UNNAMED", () => {
  // Every entity carries a distinct `title`, so nothing in the data names the
  // group. AP-247: propose the shape, refuse to invent the noun.
  const entities: StructureEntityInput[] = [];
  const claims: StructureClaimInput[] = [];
  for (const title of ["alpha", "beta", "gamma", "delta"]) {
    const id = `entity-${title}`;
    entities.push({ id, kind: "topic", name: title });
    claims.push(claim(id, "title", title), claim(id, "status", "open"), claim(id, "owner", "vikas"));
  }

  const result = draftStructureFromClaims(entities, claims, isRedTier);

  assert.equal(result.proposed, true);
  if (!result.proposed) return;
  assert.equal(result.evidence.basis, "field_signature");
  assert.equal(result.databases.length, 1);
  assert.equal(result.databases[0]!.name, null, "unknown is first-class - the human names it");
  assert.equal(result.databases[0]!.discriminatorField, null);
  assert.deepEqual(
    result.databases[0]!.columns.map((column) => column.field),
    ["owner", "status", "title"],
  );
});

test("a field only one member carries is reported as sparse, never promoted to a column", () => {
  // Six entities, two `type` values - enough repetition for `type` to be the
  // discriminator. One member of the "right" group carries a field nobody
  // else does.
  const entities: StructureEntityInput[] = [];
  const claims: StructureClaimInput[] = [];
  for (const name of ["one", "two", "three", "four", "five", "six"]) {
    const id = `entity-${name}`;
    entities.push({ id, kind: "topic", name });
    const side = ["one", "two", "three"].includes(name) ? "left" : "right";
    claims.push(claim(id, "type", side), claim(id, "shared", "yes"));
  }
  claims.push(claim("entity-four", "only_here", "once"));

  const result = draftStructureFromClaims(entities, claims, isRedTier);

  assert.equal(result.proposed, true);
  if (!result.proposed) return;
  assert.equal(result.evidence.basis, "discriminator");
  const right = result.databases.find((database) => database.name === "right")!;
  assert.deepEqual(right.columns.map((column) => column.field), ["shared"]);
  assert.deepEqual(right.sparseFields, ["only_here"]);
  const left = result.databases.find((database) => database.name === "left")!;
  assert.deepEqual(left.sparseFields, [], "the other group never sees the stray field at all");
});

test("refusals: nothing observed, nothing but red content, and nothing that recurs", () => {
  const empty = draftStructureFromClaims([], [], isRedTier);
  assert.equal(empty.proposed, false);
  if (!empty.proposed) assert.equal(empty.reason, "no_entities");

  const onlyRed = draftStructureFromClaims(
    [{ id: "e1", kind: "person", name: "A" }],
    [claim("e1", "health", "diagnosed last spring")],
    isRedTier,
  );
  assert.equal(onlyRed.proposed, false);
  if (!onlyRed.proposed) {
    assert.equal(onlyRed.reason, "no_claims");
    assert.match(onlyRed.detail, /red-tier/);
  }

  // Two entities is below STRUCTURE_MIN_ENTITIES: a pair is not a repeat.
  const tooFew = draftStructureFromClaims(
    [
      { id: "e1", kind: "topic", name: "A" },
      { id: "e2", kind: "topic", name: "B" },
    ],
    [claim("e1", "stage", "open"), claim("e2", "stage", "open")],
    isRedTier,
  );
  assert.equal(tooFew.proposed, false);
  if (!tooFew.proposed) {
    assert.equal(tooFew.reason, "no_recurring_shape");
    assert.match(tooFew.detail, new RegExp(`${STRUCTURE_MIN_ENTITIES} or more`));
  }
});

test("a claim on an entity that was not supplied is ignored, not counted", () => {
  const result = draftStructureFromClaims(
    [
      { id: "e1", kind: "topic", name: "A" },
      { id: "e2", kind: "topic", name: "B" },
      { id: "e3", kind: "topic", name: "C" },
    ],
    [
      claim("e1", "stage", "open"),
      claim("e2", "stage", "open"),
      claim("e3", "stage", "shut"),
      claim("ghost", "stage", "open"),
      claim("ghost", "phantom", "value"),
    ],
    isRedTier,
  );

  assert.equal(result.proposed, true);
  if (!result.proposed) return;
  assert.equal(result.evidence.claimCount, 3, "the two orphan claims are not counted");
  assert.equal(
    result.databases.some((database) =>
      database.columns.some((column) => column.field === "phantom") ||
      database.sparseFields.includes("phantom")),
    false,
    "a field only an unsupplied entity carried cannot reach the proposal",
  );
});
