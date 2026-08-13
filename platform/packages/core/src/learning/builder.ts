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
