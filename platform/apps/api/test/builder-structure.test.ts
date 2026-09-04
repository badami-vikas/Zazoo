/**
 * Capability Builder rung 4 over the real `buildWiring()` composition root
 * (AI Harness K9, TASK-053) — the north-star test the task set itself:
 *
 *   given only observation data from ETA-style work, the Builder proposes a
 *   Deals/Sources/Theses-shaped module without being told about DealPilot.
 *
 * Nothing here names a Module, a Database, a Page or DealPilot. The fixture
 * is nine entities and their claims, each one materialized through the SAME
 * governed propose→accept path a human uses — so what the Builder reads is
 * knowledge Bridge actually holds, not a hand-built structure handed to it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

let evidenceSeq = 0;
function evidenceId(): string {
  evidenceSeq += 1;
  return `3f1c0000-0000-4000-8000-${String(evidenceSeq).padStart(12, "0")}`;
}

/** What a searcher's week looks like as claims. No value here contains a term
 *  the red-content classifier matches — "broker" would be dropped, because it
 *  contains "broke" (financial_distress), which is that classifier working. */
const OBSERVATIONS: Array<{ name: string; fields: Array<[string, string]> }> = [
  { name: "Cascade HVAC", fields: [["type", "deal"], ["stage", "diligence"], ["ebitda", "2.4m"]] },
  { name: "Northwind Plumbing", fields: [["type", "deal"], ["stage", "loi"], ["ebitda", "1.1m"]] },
  { name: "Ridgeline Pest", fields: [["type", "deal"], ["stage", "screening"], ["ebitda", "900k"]] },
  { name: "Mid-Atlantic Intermediaries", fields: [["type", "source"], ["channel", "intermediary"], ["temperature", "warm"]] },
  { name: "Cornerstone M&A", fields: [["type", "source"], ["channel", "banker"], ["temperature", "cold"]] },
  { name: "Searcher Slack", fields: [["type", "source"], ["channel", "network"], ["temperature", "warm"]] },
  { name: "Route density in home services", fields: [["type", "thesis"], ["sector", "services"], ["conviction", "high"]] },
  { name: "Regulated waste consolidation", fields: [["type", "thesis"], ["sector", "industrial"], ["conviction", "medium"]] },
  { name: "Dental roll-up", fields: [["type", "thesis"], ["sector", "healthcare"], ["conviction", "low"]] },
];

async function seedObservations(caller: ReturnType<typeof makeCaller>): Promise<void> {
  for (const observation of OBSERVATIONS) {
    for (const [field, value] of observation.fields) {
      const proposed = await caller.learning.claims.proposeClaim({
        organizationId: ORG,
        entity: { kind: "topic", name: observation.name },
        field,
        value,
        claimClass: "observed_preference",
        evidence: [{ kind: "memory", id: evidenceId() }],
      });
      assert.equal(proposed.proposed, true, `${observation.name}.${field} must be proposable`);
      const accepted = await caller.learning.claims.acceptClaim({
        organizationId: ORG,
        suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
      });
      assert.equal(accepted.materialized, true, `${observation.name}.${field} must materialize`);
    }
  }
}

test("NORTH STAR: from observations alone the Builder proposes deal/source/thesis Databases", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await seedObservations(caller);

    const result = await caller.learning.claims.proposeStructure({ organizationId: ORG });

    assert.equal(result.proposed, true);
    if (!result.proposed) return;
    assert.equal(result.evidence.entityCount, 9);
    assert.equal(result.evidence.claimCount, 27);
    assert.equal(result.evidence.basis, "discriminator");
    assert.deepEqual(
      result.databases.map((database) => database.name).sort(),
      ["deal", "source", "thesis"],
      "the names are values read out of the person's own data",
    );

    const deal = result.databases.find((database) => database.name === "deal")!;
    assert.equal(deal.discriminatorField, "type");
    assert.deepEqual(deal.columns.map((column) => column.field), ["ebitda", "stage"]);
    assert.equal(deal.columns.every((column) => column.support === 3), true);
    assert.deepEqual(deal.entityKinds, ["topic"]);
    // Every proposed column points back at the claim rows it was counted
    // from — a proposal you cannot audit is a guess with a table in it.
    const liveClaimIds = new Set(
      (await caller.learning.claims.claims({ organizationId: ORG })).claims.map((claim) => claim.id),
    );
    for (const column of deal.columns) {
      assert.equal(column.sampleClaimIds.length, 3);
      for (const claimId of column.sampleClaimIds) {
        assert.equal(liveClaimIds.has(claimId), true, "column evidence must be a live claim id");
      }
    }

    assert.deepEqual(
      result.databases.find((database) => database.name === "source")!.columns.map((c) => c.field),
      ["channel", "temperature"],
    );
    assert.deepEqual(
      result.databases.find((database) => database.name === "thesis")!.columns.map((c) => c.field),
      ["conviction", "sector"],
    );
  } finally {
    await wiring.close();
  }
});

test("an empty substrate refuses rather than inventing a structure", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const result = await makeCaller(wiring).learning.claims.proposeStructure({ organizationId: ORG });
    assert.equal(result.proposed, false);
    if (result.proposed) return;
    assert.equal(result.reason, "no_entities");
    assert.match(result.detail, /never watched work/);
  } finally {
    await wiring.close();
  }
});

test("flight OFF: structure synthesis fails closed like every other claims lane", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: false }); // claim substrate off (default is ON since AP-182)
  try {
    await assert.rejects(
      makeCaller(wiring).learning.claims.proposeStructure({ organizationId: ORG }),
      /disabled|flight/i,
    );
  } finally {
    await wiring.close();
  }
});

test("one member's observations never shape another member's structure", async () => {
  // Owner scoping is the whole privacy story of this lane: it reads
  // `ctx.identity.id`'s claims and nobody else's.
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    await seedObservations(makeCaller(wiring));
    const other = makeCaller(wiring, { type: "user", id: "00000000-0000-4000-8000-0000000000ff" });
    await assert.rejects(
      other.learning.claims.proposeStructure({ organizationId: ORG }),
      /member|not found|forbidden/i,
      "a non-member cannot reach the lane at all",
    );
  } finally {
    await wiring.close();
  }
});
