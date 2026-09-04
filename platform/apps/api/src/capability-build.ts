/**
 * Walking the governed capability-build chain (ADR-181) — the impure half of
 * @bridge/core's `capability/build-chain.ts`.
 *
 * `build-chain.ts` owns the rules and holds no store, clock, or model. This
 * file owns everything that touches the world: provisioning a Goal/Task per
 * junction, calling the model, making each junction a real `pipeline.propose`
 * under its OWN Agent's identity, and — only if Governance clears it —
 * registering the manifest as a `draft` capability row for a Human to approve.
 *
 * ONE ENTRY POINT, ON PURPOSE. There are no separate `recommend`/`draft`/
 * `review` exports. Three endpoints would mean a caller could POST straight to
 * `draft` and skip the reason, or skip `review` and go to a human with no risk
 * band — the exact bypass the chain exists to prevent. `runCapabilityBuildChain`
 * is the only door, and it always walks all three junctions in order.
 *
 * This is not a peer handoff (roadmap.md's star topology): no agent calls
 * another. The Engine calls three agents in sequence, each attributed
 * separately in the ledger, the same way a workflow calls three Skills.
 *
 * The Builder's model output is BOUNDED, not trusted: it is asked for a JSON
 * manifest, and whatever comes back is re-validated against a strict schema and
 * then handed to Governance anyway. If parsing fails — or no model is
 * configured — the deterministic skeleton is used and LABELLED
 * `offline_skeleton`, because "a model wrote this" and "the Engine filled in a
 * safe shape" are different things to ask a person to approve.
 */
import {
  type BuildChainState,
  type BuildOrigin,
  type CapabilityManifest,
  type CapabilityType,
  type ModelProvider,
  type ResolveDependency,
  type RunCtx,
  buildAgentSystemPrompt,
  describeChain,
  draftCapability,
  readyForHumanApproval,
  recommendBuild,
  reviewDraft,
} from "@bridge/core";

import {
  CAPABILITY_BUILDER_AGENT,
  CAPABILITY_BUILD_GOAL_TYPE,
  DRAFT_CAPABILITY_SKILL_ID,
  DRAFT_CAPABILITY_TASK_TYPE,
  GOVERNANCE_AGENT,
  INTERNAL_STRATEGIST_AGENT,
  RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
  RECOMMEND_CAPABILITY_BUILD_TASK_TYPE,
  REVIEW_CAPABILITY_DRAFT_SKILL_ID,
  REVIEW_CAPABILITY_DRAFT_TASK_TYPE,
  type Wiring,
} from "./wiring.js";

export interface CapabilityBuildIntent {
  origin: BuildOrigin;
  capabilityType: CapabilityType;
  title: string;
  rationale: string;
  evidence: readonly string[];
}

export interface CapabilityBuildDeps {
  wiring: Wiring;
  run: RunCtx;
  organizationId: string;
  actingUserId: string;
  /** Already wrapped by the caller's governed model provider, or absent offline. */
  model?: ModelProvider;
  /** Provisions one bounded Task per junction under the chain's durable Goal. */
  provisionTask: (taskType: string, agentId: string) => Promise<{ goalId: string; taskId: string }>;
}

export interface CapabilityBuildResult {
  state: BuildChainState;
  /** Who did what, reconstructed from the state — the Approvals card's summary. */
  trail: string;
  /** One per junction, in order. Each is attributed to a different Agent. */
  proposalIds: string[];
  /**
   * The `capability_manifests` row id, present ONLY when Governance cleared the
   * draft. `null` on a blocked chain is the honest answer: nothing was written,
   * because writing a row a human would then be asked to approve is precisely
   * what a blocker means must not happen.
   */
  manifestId: string | null;
  /** Non-empty exactly when `manifestId` is null. */
  blockers: readonly string[];
}

/** The safest manifest that can answer a recommendation: declarative (runs no
 * code), private, one advisory permission, no connectors, no dependencies. Used
 * offline, and as the floor a model's draft is compared against. */
function skeletonManifest(id: string, intent: CapabilityBuildIntent): CapabilityManifest {
  return {
    id,
    name: intent.title,
    version: "1.0.0",
    capabilityType: intent.capabilityType,
    origin: "ai_generated",
    audience: "private",
    permissions: [{ resourceType: "signal", action: "write", dataScope: "private", egress: false }],
    connectors: [],
    dependencies: [],
  };
}

const PERMISSION_ACTIONS = new Set(["read", "write", "send"]);
const PERMISSION_SCOPES = new Set(["public", "private", "all"]);

/**
 * Parse a model's reply into a manifest. Returns undefined on ANY doubt — a
 * partially-understood manifest is worse than the skeleton, because the parts
 * that silently dropped are the parts nobody reviews. Notably this never reads
 * `origin`, `id`, or `version` from the model: provenance and identity are the
 * Engine's to assign, and a model that could name its own origin could claim
 * `built_in` (which junction 3 blocks, but which should never get that far).
 */
function parseDraftedManifest(text: string, id: string, intent: CapabilityBuildIntent): CapabilityManifest | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  if (!body.startsWith("{")) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const raw = parsed as Record<string, unknown>;

  const permissionsRaw = raw.permissions;
  if (!Array.isArray(permissionsRaw)) return undefined;
  const permissions: CapabilityManifest["permissions"] = [];
  for (const entry of permissionsRaw) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const p = entry as Record<string, unknown>;
    if (typeof p.resourceType !== "string" || p.resourceType.length === 0) return undefined;
    if (typeof p.action !== "string" || !PERMISSION_ACTIONS.has(p.action)) return undefined;
    if (typeof p.dataScope !== "string" || !PERMISSION_SCOPES.has(p.dataScope)) return undefined;
    if (typeof p.egress !== "boolean") return undefined;
    permissions.push({
      resourceType: p.resourceType,
      action: p.action as "read" | "write" | "send",
      dataScope: p.dataScope as "public" | "private" | "all",
      egress: p.egress,
    });
  }
  if (permissions.length === 0) return undefined;

  const connectorsRaw = Array.isArray(raw.connectors) ? raw.connectors : [];
  const connectors: CapabilityManifest["connectors"] = [];
  for (const entry of connectorsRaw) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const c = entry as Record<string, unknown>;
    if (typeof c.id !== "string" || c.id.length === 0) return undefined;
    connectors.push({ id: c.id, externalSend: c.externalSend === true });
  }

  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : intent.title,
    version: "1.0.0",
    // The model does not get to name its own type or provenance. Type comes
    // from the recommendation (and junction 3 re-checks the match anyway);
    // origin is what it actually is.
    capabilityType: intent.capabilityType,
    origin: "ai_generated",
    audience: raw.audience === "team" || raw.audience === "external_visible" ? raw.audience : "private",
    permissions,
    connectors,
    dependencies: [],
  };
}

function builderPrompt(intent: CapabilityBuildIntent): string {
  return [
    `Draft a Bridge Capability Manifest for this recommendation from the Internal Strategist.`,
    ``,
    `Type: ${intent.capabilityType}`,
    `Title: ${intent.title}`,
    `Why: ${intent.rationale}`,
    intent.evidence.length > 0 ? `Evidence: ${intent.evidence.join("; ")}` : `Evidence: none cited`,
    ``,
    `Reply with ONE fenced JSON object and nothing else:`,
    `{"name": string, "audience": "private"|"team"|"external_visible",`,
    ` "permissions": [{"resourceType": string, "action": "read"|"write"|"send",`,
    `                  "dataScope": "public"|"private"|"all", "egress": boolean}],`,
    ` "connectors": [{"id": string, "externalSend": boolean}]}`,
    ``,
    `Declare the LEAST permission that does the job. Every permission you declare`,
    `raises the computed risk band and the approval a person must give.`,
  ].join("\n");
}

/**
 * Walk all three junctions. Each becomes its own governed proposal under its own
 * Agent, so the ledger shows three attributable acts rather than one opaque
 * "the system built something".
 */
export async function runCapabilityBuildChain(
  deps: CapabilityBuildDeps,
  intent: CapabilityBuildIntent,
): Promise<CapabilityBuildResult> {
  const { wiring, run, organizationId } = deps;
  const proposalIds: string[] = [];

  const propose = async (
    agentId: string,
    skill: string,
    taskType: string,
    inputs: Record<string, unknown>,
  ): Promise<void> => {
    const goalTaskRef = await deps.provisionTask(taskType, agentId);
    const proposal = await wiring.pipeline.propose(
      {
        organizationId,
        actor: { type: "agent", id: agentId, plane: "local" },
        onBehalfOf: { type: "user", id: deps.actingUserId },
        action: "write",
        resourceType: "signal",
        inputs,
        skill,
        goalTaskRef,
      },
      run,
    );
    proposalIds.push(proposal.id);
  };

  // ---- Junction 1: Internal Strategist decides something should exist -------
  const recommendationId = run.ids.next();
  const recommended = recommendBuild({
    actor: "internal_strategist",
    id: recommendationId,
    origin: intent.origin,
    capabilityType: intent.capabilityType,
    title: intent.title,
    rationale: intent.rationale,
    evidence: intent.evidence,
  });
  await propose(
    INTERNAL_STRATEGIST_AGENT,
    RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
    RECOMMEND_CAPABILITY_BUILD_TASK_TYPE,
    { kind: "capability_build_recommendation", ...recommended.recommendation },
  );

  // ---- Junction 2: Capability Builder drafts a manifest ---------------------
  const manifestId = run.ids.next();
  let manifest = skeletonManifest(manifestId, intent);
  let source: "model" | "offline_skeleton" = "offline_skeleton";
  let notes = "No model configured — the Engine supplied its least-privilege skeleton rather than inventing a manifest.";

  if (deps.model) {
    const completion = await deps.model.complete({
      system: buildAgentSystemPrompt("capability_builder"),
      prompt: builderPrompt(intent),
      maxTokens: 700,
      tier: "reasoning",
      cache: { strategy: "stable_system_prefix", ttl: "5m" },
    });
    const parsed = parseDraftedManifest(completion.text, manifestId, intent);
    if (parsed) {
      manifest = parsed;
      source = "model";
      notes = "Drafted by Capability Builder; identity, version, type and provenance assigned by the Engine.";
    } else {
      notes =
        "Capability Builder's reply was not a manifest this Engine could parse — fell back to the least-privilege skeleton rather than guessing at the intent.";
    }
  }

  const draftState = draftCapability({
    actor: "capability_builder",
    state: recommended,
    manifest,
    notes,
    source,
  });
  await propose(CAPABILITY_BUILDER_AGENT, DRAFT_CAPABILITY_SKILL_ID, DRAFT_CAPABILITY_TASK_TYPE, {
    kind: "capability_draft",
    recommendationId,
    manifestId,
    manifest,
    source,
    notes,
  });

  // ---- Junction 3: Governance computes the verdict --------------------------
  // Dependencies are pre-fetched so `computeRisk`'s resolver stays synchronous
  // (risk.ts is pure by contract). An unresolvable dependency is NOT skipped —
  // risk.ts treats it as at least `operational`.
  const depManifests = new Map<string, CapabilityManifest>();
  for (const dep of manifest.dependencies) {
    const row = await wiring.capabilityStore.getManifest(dep.manifestId);
    if (!row) continue;
    const stored = (row.manifest ?? {}) as {
      permissions?: CapabilityManifest["permissions"];
      connectors?: CapabilityManifest["connectors"];
    };
    depManifests.set(dep.manifestId, {
      id: row.id,
      name: row.name,
      version: row.version,
      capabilityType: row.capabilityType,
      origin: row.origin,
      audience: row.audience,
      permissions: stored.permissions ?? [],
      connectors: stored.connectors ?? [],
      dependencies: [],
    });
  }
  const resolveDependency: ResolveDependency = (id) => depManifests.get(id);

  const reviewed = reviewDraft({ actor: "governance", state: draftState, resolveDependency });
  await propose(GOVERNANCE_AGENT, REVIEW_CAPABILITY_DRAFT_SKILL_ID, REVIEW_CAPABILITY_DRAFT_TASK_TYPE, {
    kind: "capability_draft_review",
    ...reviewed.verdict,
  });

  const trail = describeChain(reviewed);

  if (!readyForHumanApproval(reviewed)) {
    // Nothing is registered. A blocked chain leaves no capability row to
    // approve by accident, and the reasons travel back so the next attempt can
    // answer a named list instead of regenerating blind.
    return { state: reviewed, trail, proposalIds, manifestId: null, blockers: reviewed.verdict.blockers };
  }

  // Cleared. The manifest lands in the SAME `draft` state and the SAME table
  // `capability.register` writes — "generation only ever creates draft" — so
  // activation stays on the pre-existing Human-only approval path and this
  // chain adds no route to Active.
  await wiring.capabilityStore.createManifest({
    id: manifestId,
    organizationId,
    capabilityType: manifest.capabilityType,
    name: manifest.name,
    version: manifest.version,
    origin: manifest.origin,
    audience: manifest.audience,
    manifest: { permissions: manifest.permissions, connectors: manifest.connectors },
    computedRisk: reviewed.verdict.effectiveRisk,
    dependencies: manifest.dependencies,
  });
  await wiring.capabilityStore.upsertState({
    manifestId,
    organizationId,
    state: "draft",
    suspended: false,
    evidence: {},
  });

  return { state: reviewed, trail, proposalIds, manifestId, blockers: [] };
}

export const CAPABILITY_BUILD_GOAL_TITLE = "Agent-proposed capability builds";
export { CAPABILITY_BUILD_GOAL_TYPE };
