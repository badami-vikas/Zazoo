/**
 * Capability Builder, rung 3 (AI Harness K9, TASK-053): draft automation
 * STEPS from a promotion pattern plus its ledger episodes.
 *
 * CONSTRAINED GENERATION, NOT CODEGEN — and in this rung not even a model
 * call: the step is DERIVED from what the human demonstrably did. The
 * promotion machinery (promotion.ts) already proved the human repeated one
 * decision ≥6 times; the ledger episodes behind that pattern carry the
 * governed shape of each repetition (skill, action, resourceType,
 * dataScope). The Builder's whole job is to read that shape back out and
 * refuse loudly when it can't:
 *
 *  - the pattern must NAME a skill (`attributeKey === "skill"` — the shape
 *    ledger-mined signals produce). A behavior pattern with no skill
 *    attribution (a K7 app-focus rhythm, a K8 browsing rhythm) is not
 *    automatable — there is no capability to bind a step to;
 *  - the skill must be REGISTERED right now. Evidence about a skill that
 *    has since been removed proposes nothing (the prototype test's
 *    out-of-registry refusal);
 *  - there must BE episodes. Zero matching ledger rows means the evidence
 *    window has moved on — a step fabricated from the pattern text alone
 *    would be a lie, exactly what promotion.ts's empty-steps draft exists
 *    to prevent;
 *  - the episodes' MODAL governed shape becomes ONE step. Repeated behavior
 *    is one governed action by construction (that is what the pattern
 *    counted); multi-step chains are rung-5 territory, behind the K10 gate.
 *
 * The result is a DRAFT-shaped step list: the caller writes it onto the
 * draft AutomationDefinition (status "draft" — the executor still cannot
 * see it) and every activation gate downstream is unchanged.
 */
import type { Action, LedgerEntry } from "../types.js";
import type { AutomationDefinition } from "../ports.js";
import type { DetectedPattern } from "./observation.js";

const ACTIONS: readonly Action[] = ["read", "write", "execute", "share", "archive", "approve"];

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

/** Human decisions that count as evidence FOR automating (a veto is
 * evidence about the skill, but evidence AGAINST wanting it repeated). */
const AFFIRMING_DECISIONS = new Set(["approve", "edit"]);

/** The content-free slice of one ledger episode the Builder may see —
 * mirrors the miner's LedgerDecisionEnvelope posture: `inputs`,
 * `proposedOutput`, and `diff` have no field here, so payload content is
 * unrepresentable in the drafting path, not merely unread. */
export interface BuilderEpisode {
  ledgerId: string;
  skill: string;
  /** Typed by the ledger row itself; `isAction` still re-checks at runtime
   * because rows predate enum changes. */
  action: LedgerEntry["action"];
  resourceType: LedgerEntry["resourceType"];
  dataScope?: LedgerEntry["dataScope"];
}

/** Extract the episodes behind a pattern from a ledger-history window:
 * affirming HUMAN decision rows attributed to the pattern's skill. Takes
 * full LedgerEntry rows at the boundary and immediately narrows. */
export function episodesForSkill(
  rows: readonly LedgerEntry[],
  skill: string,
): BuilderEpisode[] {
  const episodes: BuilderEpisode[] = [];
  for (const row of rows) {
    if (row.skill !== skill) continue;
    if (typeof row.userDecision !== "string" || !AFFIRMING_DECISIONS.has(row.userDecision)) continue;
    if (!row.refLedgerId) continue; // decision rows only, same rule as the miner
    episodes.push({
      ledgerId: row.id,
      skill: row.skill,
      action: row.action,
      resourceType: row.resourceType,
      ...(row.dataScope ? { dataScope: row.dataScope } : {}),
    });
  }
  return episodes;
}

export type BuilderRefusalReason =
  | "pattern_not_skill_shaped"
  | "skill_not_registered"
  | "no_episodes"
  | "action_unrecognized";

export type BuilderStepsResult =
  | {
      proposed: true;
      steps: AutomationDefinition["steps"];
      evidence: {
        episodeCount: number;
        /** How many distinct governed shapes the episodes carried — 1 means
         * the evidence is uniform; >1 means the modal shape won and the
         * human should look twice at the draft. */
        distinctShapes: number;
        /** Ledger ids of the episodes matching the drafted shape. */
        episodeLedgerIds: string[];
      };
    }
  | { proposed: false; reason: BuilderRefusalReason; detail: string };

/**
 * Derive draft steps for one accepted promotion pattern. Pure — the caller
 * supplies the registry membership test and the episode window.
 */
export function draftStepsFromEpisodes(
  pattern: Pick<DetectedPattern, "action" | "attributeKey" | "attributeValue">,
  episodes: readonly BuilderEpisode[],
  isRegisteredSkill: (skillId: string) => boolean,
): BuilderStepsResult {
  if (pattern.attributeKey !== "skill") {
    return {
      proposed: false,
      reason: "pattern_not_skill_shaped",
      detail:
        `this pattern repeats "${pattern.action}" over ${pattern.attributeKey}=` +
        `"${pattern.attributeValue}" — a behavior rhythm, not a governed skill decision; ` +
        `there is no capability to bind a step to`,
    };
  }
  const skill = pattern.attributeValue;
  if (!isRegisteredSkill(skill)) {
    return {
      proposed: false,
      reason: "skill_not_registered",
      detail: `"${skill}" is not in the skill registry — a step referencing it could never execute`,
    };
  }
  const matching = episodes.filter((episode) => episode.skill === skill);
  if (matching.length === 0) {
    return {
      proposed: false,
      reason: "no_episodes",
      detail:
        `no affirming ledger episodes for "${skill}" remain in the evidence window — ` +
        `a step fabricated without evidence would be a lie`,
    };
  }

  // Modal governed shape across the episodes. Space-joined key is safe:
  // none of the three enum families can contain a space.
  const shapes = new Map<string, { count: number; sample: BuilderEpisode; ids: string[] }>();
  for (const episode of matching) {
    const key = `${episode.action} ${episode.resourceType} ${episode.dataScope ?? ""}`;
    const bucket = shapes.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.ids.push(episode.ledgerId);
    } else {
      shapes.set(key, { count: 1, sample: episode, ids: [episode.ledgerId] });
    }
  }
  const modal = [...shapes.values()].sort((a, b) => b.count - a.count)[0]!;
  if (!isAction(modal.sample.action)) {
    return {
      proposed: false,
      reason: "action_unrecognized",
      detail: `episodes carry action "${modal.sample.action}", which is not a canonical governed Action`,
    };
  }

  return {
    proposed: true,
    steps: [
      {
        skill,
        action: modal.sample.action,
        resourceType: modal.sample.resourceType,
        ...(modal.sample.dataScope ? { dataScope: modal.sample.dataScope } : {}),
      },
    ],
    evidence: {
      episodeCount: matching.length,
      distinctShapes: shapes.size,
      episodeLedgerIds: modal.ids,
    },
  };
}

// =====================================================================
// RUNG 4 - STRUCTURE SYNTHESIS (AI Harness K9, TASK-053)
//
// Rung 3 read a governed shape back out of the ledger. Rung 4 reads a
// DATA shape back out of K3's entities and claims: given only what Bridge
// observed, which Databases does this person's work already have?
//
// Still derivation, still not a model call, and for the same reason rung 3
// wasn't one. The north-star test is "given only observation data from
// ETA-style work, propose a Deals/Sources/Theses-shaped module WITHOUT
// being told about DealPilot" - a test a model could pass by recognizing
// the domain rather than by reading the data. A deterministic derivation
// cannot cheat that way: every column it proposes is a field it counted,
// and every name it gives is a value it read.
//
// THE DERIVATION, in one paragraph. Entities carry claims; claims are
// (field, value). A field whose values REPEAT across many entities is a
// type discriminator - `type=deal` on nineteen entities is the data saying
// "these nineteen are one kind of thing". Group by the discriminator's
// value and each group with enough members is a Database; the fields its
// members share are its columns. No discriminator? Fall back to grouping
// by the exact field signature, and propose the shape WITHOUT a name -
// "unknown" is first-class (ADR-247), and inventing "Deals" from columns
// that merely look deal-shaped is precisely the fabrication that rule bans.
//
// WHAT IT DELIBERATELY DOES NOT EMIT. Views and Pages. ADR-180 settled
// that a Page is DERIVED from a Database and every landing section already
// offers the standard views - so a Database proposal that also listed its
// Page and its table View would be proposing things that follow by
// construction, and inviting them to drift. Blueprints are rung 5.
//
// SAFETY. Red-tier claim content never reaches a proposal (K3's
// never-propose invariant): claims are classified and dropped BEFORE
// counting, so a red claim cannot become a column, cannot become a
// discriminator, and cannot even influence a support count. The count of
// what was dropped is reported, because a silently smaller proposal is a
// worse answer than a smaller one that says why.
// =====================================================================

/** A Database needs at least this many entities before it is a shape rather
 *  than a coincidence. Three is the smallest number that can show a repeat
 *  (two entities sharing a field is one pair, which any two rows do). */
export const STRUCTURE_MIN_ENTITIES = 3;

/** A field must appear on at least this many of a group's entities to be a
 *  column. A field on exactly one entity is that entity's detail, not the
 *  group's shape - it is reported as sparse rather than promoted. */
export const STRUCTURE_MIN_FIELD_SUPPORT = 2;

export interface StructureEntityInput {
  id: string;
  kind: string;
  name: string;
}

export interface StructureClaimInput {
  id: string;
  entityId: string;
  field: string;
  value: string;
}

export interface ProposedColumn {
  field: string;
  /** How many of the group's entities carry this field. */
  support: number;
  /** Distinct values observed - 1 means every member agrees, which is a hint
   *  the field is a constant rather than a column. */
  distinctValues: number;
  sampleClaimIds: string[];
}

export interface ProposedDatabase {
  /** The value the discriminator carried, verbatim. `null` when the shape was
   *  found by field signature and nothing in the data names it - the human
   *  names it, and the proposal says so rather than guessing. */
  name: string | null;
  /** The field whose value named this Database, when one did. */
  discriminatorField: string | null;
  entityKinds: string[];
  entityIds: string[];
  columns: ProposedColumn[];
  /** Fields carried by exactly one member - the shape's ragged edge, shown
   *  rather than dropped so the human can see what was left out. */
  sparseFields: string[];
}

export type BuilderStructureRefusalReason =
  | "no_entities"
  | "no_claims"
  | "no_recurring_shape";

export type BuilderStructureResult =
  | {
      proposed: true;
      databases: ProposedDatabase[];
      evidence: {
        entityCount: number;
        claimCount: number;
        /** How the grouping was found - the human should read a
         *  `field_signature` proposal more sceptically than a
         *  `discriminator` one, and the word says which they have. */
        basis: "discriminator" | "field_signature";
        redTierClaimsExcluded: number;
      };
    }
  | { proposed: false; reason: BuilderStructureRefusalReason; detail: string };

/** Deterministic tie-breaks everywhere: this runs over Maps whose insertion
 *  order follows the caller's row order, and two runs over the same data must
 *  propose the same structure or the proposal is not evidence of anything. */
function byCountThenName(
  a: { count: number; key: string },
  b: { count: number; key: string },
): number {
  return b.count - a.count || a.key.localeCompare(b.key);
}

/**
 * Propose Databases from observed entities and their live claims. Pure; the
 * caller supplies the red-tier classifier so the safety rule is testable in
 * isolation and cannot be quietly swapped for a permissive one at the seam.
 */
export function draftStructureFromClaims(
  entities: readonly StructureEntityInput[],
  claims: readonly StructureClaimInput[],
  isRedTierContent: (field: string, value: string) => boolean,
): BuilderStructureResult {
  if (entities.length === 0) {
    return {
      proposed: false,
      reason: "no_entities",
      detail:
        "nothing has been observed yet - a structure proposed from no entities would be a guess " +
        "about a person Bridge has never watched work",
    };
  }
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const safeClaims: StructureClaimInput[] = [];
  let redTierClaimsExcluded = 0;
  for (const claim of claims) {
    if (!entityById.has(claim.entityId)) continue;
    if (isRedTierContent(claim.field, claim.value)) {
      redTierClaimsExcluded += 1;
      continue;
    }
    safeClaims.push(claim);
  }
  if (safeClaims.length === 0) {
    return {
      proposed: false,
      reason: "no_claims",
      detail:
        redTierClaimsExcluded > 0
          ? `every observed claim is red-tier content, which is never proposed - ` +
            `${redTierClaimsExcluded} excluded, nothing left to shape a Database from`
          : "the observed entities carry no claims - there are no fields to make columns out of",
    };
  }

  // field -> entityId -> values, the one index everything below reads.
  const byField = new Map<string, Map<string, Set<string>>>();
  const claimIdsByFieldEntity = new Map<string, string[]>();
  for (const claim of safeClaims) {
    let perEntity = byField.get(claim.field);
    if (!perEntity) byField.set(claim.field, (perEntity = new Map()));
    let values = perEntity.get(claim.entityId);
    if (!values) perEntity.set(claim.entityId, (values = new Set()));
    values.add(claim.value);
    const key = `${claim.field} ${claim.entityId}`;
    const ids = claimIdsByFieldEntity.get(key);
    if (ids) ids.push(claim.id);
    else claimIdsByFieldEntity.set(key, [claim.id]);
  }

  // A discriminator is a field carried by enough entities whose values repeat:
  // at most half as many distinct values as entities carrying it. `type=deal`
  // on 19 entities discriminates; `thesis=<free text>` on 19 does not.
  const discriminators = [...byField.entries()]
    .map(([field, perEntity]) => {
      const values = new Set<string>();
      for (const entityValues of perEntity.values()) {
        // A field one entity states twice with different values cannot name a
        // group - count every value, so ambiguity costs the field its status.
        for (const value of entityValues) values.add(value);
      }
      return { key: field, count: perEntity.size, distinct: values.size };
    })
    .filter((candidate) =>
      candidate.count >= STRUCTURE_MIN_ENTITIES &&
      candidate.distinct >= 2 &&
      candidate.distinct * 2 <= candidate.count)
    .sort((a, b) => byCountThenName(a, b) || a.distinct - b.distinct);

  const groups = new Map<
    string,
    { name: string | null; discriminatorField: string | null; entityIds: string[] }
  >();
  let basis: "discriminator" | "field_signature" = "discriminator";
  const discriminator = discriminators[0];
  if (discriminator) {
    for (const [entityId, values] of byField.get(discriminator.key)!) {
      if (values.size !== 1) continue; // ambiguous membership is not membership
      const value = [...values][0]!;
      const group = groups.get(value);
      if (group) group.entityIds.push(entityId);
      else groups.set(value, { name: value, discriminatorField: discriminator.key, entityIds: [entityId] });
    }
  } else {
    basis = "field_signature";
    const signatureOf = new Map<string, string[]>();
    for (const entity of entities) {
      const fields = [...byField.entries()]
        .filter(([, perEntity]) => perEntity.has(entity.id))
        .map(([field]) => field)
        .sort();
      if (fields.length === 0) continue;
      const signature = fields.join(" ");
      const ids = signatureOf.get(signature);
      if (ids) ids.push(entity.id);
      else signatureOf.set(signature, [entity.id]);
    }
    for (const [signature, entityIds] of signatureOf) {
      groups.set(signature, { name: null, discriminatorField: null, entityIds });
    }
  }

  const databases: ProposedDatabase[] = [];
  for (const group of groups.values()) {
    if (group.entityIds.length < STRUCTURE_MIN_ENTITIES) continue;
    const columns: ProposedColumn[] = [];
    const sparseFields: string[] = [];
    for (const [field, perEntity] of byField) {
      if (field === group.discriminatorField) continue; // the table's identity, not one of its columns
      const sampleClaimIds: string[] = [];
      const values = new Set<string>();
      let support = 0;
      for (const entityId of group.entityIds) {
        const entityValues = perEntity.get(entityId);
        if (!entityValues) continue;
        support += 1;
        for (const value of entityValues) values.add(value);
        sampleClaimIds.push(...(claimIdsByFieldEntity.get(`${field} ${entityId}`) ?? []));
      }
      if (support === 0) continue;
      if (support < STRUCTURE_MIN_FIELD_SUPPORT) {
        sparseFields.push(field);
        continue;
      }
      columns.push({ field, support, distinctValues: values.size, sampleClaimIds });
    }
    if (columns.length === 0) continue; // a Database with no columns is not a proposal
    columns.sort((a, b) =>
      byCountThenName({ count: a.support, key: a.field }, { count: b.support, key: b.field }));
    sparseFields.sort();
    const entityKinds = [...new Set(group.entityIds.map((id) => entityById.get(id)!.kind))].sort();
    databases.push({
      name: group.name,
      discriminatorField: group.discriminatorField,
      entityKinds,
      entityIds: [...group.entityIds],
      columns,
      sparseFields,
    });
  }

  if (databases.length === 0) {
    return {
      proposed: false,
      reason: "no_recurring_shape",
      detail:
        `no group of ${STRUCTURE_MIN_ENTITIES} or more entities shares a field - ` +
        `${entities.length} entities and ${safeClaims.length} claims, but nothing repeats often ` +
        `enough to be a Database rather than a coincidence`,
    };
  }
  databases.sort((a, b) =>
    b.entityIds.length - a.entityIds.length || (a.name ?? "").localeCompare(b.name ?? ""));

  return {
    proposed: true,
    databases,
    evidence: {
      entityCount: entities.length,
      claimCount: safeClaims.length,
      basis,
      redTierClaimsExcluded,
    },
  };
}
