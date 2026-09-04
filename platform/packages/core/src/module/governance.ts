/**
 * Per-Module governance verdicts (ADR-248).
 *
 * The Governance Section shows a Module's declared `allow`/`deny` policy. This
 * file is the half that makes the Section worth having: the engine asks
 * `governanceVerdict` before an action, and a refusal names the rule that
 * refused it.
 *
 * WHY THIS IS CODE AND NOT A PROMPT. The rule this mechanism exists to carry —
 * Avilo's "no model call without an explicit user action" — was correct for a
 * year and enforced by nothing. It lived in `docs/`, and BUG-029…BUG-045 are
 * all the assistant claiming work it had not done under it. ADR-045 records
 * prompt text failing twice on the same defect before the team stopped writing
 * prompt text. A rule a model is asked to follow is a suggestion; a rule a
 * function returns `denied` for is a boundary.
 *
 * MATCHING IS SEGMENT-PREFIX, NOT REGEX. `model` matches `model.call` and
 * `model.call.summary`, but never `models.list` — a rule must not leak across a
 * name boundary just because one name is a prefix of another string. Regex was
 * rejected outright: a security decision written in a second language is a
 * second language to get wrong, and a user editing this policy in the
 * Governance Section is not writing regex.
 *
 * DENY WINS, ALWAYS. Same precedence as the browser-capture domain policy
 * (ADR-227). A boundary that can be out-voted by adding an allow is not one.
 */
import type { ModuleGovernancePolicy, ModuleGovernanceRule } from "./types.js";

export type GovernanceVerdict =
  | { allowed: true; matched: ModuleGovernanceRule | null }
  | { allowed: false; matched: ModuleGovernanceRule; reason: string };

/**
 * The user's own governance policy for one Module, held by the engine.
 *
 * WHY AN OVERLAY AND NOT AN EDITED MANIFEST. Manifests are immutable (ADR-178)
 * — a Module version resolves to exactly one manifest for everyone who installs
 * it, which is the whole reason a promotion means anything. So a user editing
 * their policy cannot edit the manifest, and `module.governance.userEdited` has
 * been parsed by `manifest.ts` and rendered by the Governance Section since
 * ADR-248 with nothing in the repo able to set it: the flag was written for the
 * overlay that had not been built. This is it.
 *
 * KEYED BY ORGANIZATION + MODULE, held on the Local Plane. Governance is who is
 * allowed to do what in one Organization's copy of a Module; it is not a
 * property of the Module and it does not travel with it.
 *
 * THE OVERLAY REPLACES, IT DOES NOT MERGE. A merge would leave the user staring
 * at a rule they cannot delete, because the manifest's deny would keep coming
 * back after they removed it. The editor seeds itself from the declared policy,
 * the user edits the whole list, and `resolveModuleGovernance` returns what they
 * saved. `reset` (no overlay) is how the declared default comes back.
 */
export interface ModuleGovernanceOverlay {
  allow: ModuleGovernanceRule[];
  deny: ModuleGovernanceRule[];
  updatedAt: string;
}

function readRules(raw: unknown): ModuleGovernanceRule[] | null {
  // A MISSING list is not an empty one. `set` always writes both, so a row with
  // a key absent is a corrupt row — and treating it as `[]` would silently drop
  // the manifest's deny rules, which is the one failure mode this parser exists
  // to prevent.
  if (!Array.isArray(raw)) return null;
  const rules: ModuleGovernanceRule[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { action, reason } = entry as { action?: unknown; reason?: unknown };
    // Same contract the manifest parser enforces: a rule that cannot explain
    // itself is a rule the user cannot audit, and the refusal quotes it back.
    if (typeof action !== "string" || action.length === 0) return null;
    if (typeof reason !== "string" || reason.length === 0) return null;
    rules.push({ action, reason });
  }
  return rules;
}

/**
 * Parse a stored overlay row, or `null` if there isn't a usable one.
 *
 * FAILS CLOSED IN THE ONLY DIRECTION THAT MATTERS. "Empty" is the PERMISSIVE
 * state here (`governanceVerdict` above), so a corrupt row must never degrade
 * to an empty overlay — that would silently delete every deny rule the manifest
 * declared. `null` instead means "no overlay", and the declared policy stands.
 */
export function readModuleGovernanceOverlay(raw: unknown): ModuleGovernanceOverlay | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { allow, deny, updatedAt } = raw as Record<string, unknown>;
  const allowRules = readRules(allow);
  const denyRules = readRules(deny);
  if (!allowRules || !denyRules) return null;
  return {
    allow: allowRules,
    deny: denyRules,
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
  };
}

/**
 * The policy the engine actually enforces: the overlay if the user wrote one,
 * otherwise the manifest's declared default.
 *
 * `userEdited: true` is set here and only here — it is derived from the overlay
 * existing, never stored as an independent claim that could drift out of step
 * with it.
 */
export function resolveModuleGovernance(
  declared: ModuleGovernancePolicy | undefined,
  overlay: ModuleGovernanceOverlay | null,
): ModuleGovernancePolicy | undefined {
  if (!overlay) return declared;
  return { allow: overlay.allow, deny: overlay.deny, userEdited: true };
}

/**
 * Does `rule.action` cover `action`?
 *
 * `*` covers everything. Otherwise the rule must match the action exactly or be
 * a whole-segment prefix of it.
 */
export function governanceRuleMatches(ruleAction: string, action: string): boolean {
  if (ruleAction === "*") return true;
  if (ruleAction === action) return true;
  return action.startsWith(`${ruleAction}.`);
}

/**
 * The verdict for one action against one Module's declared policy.
 *
 * An absent or empty policy allows: nothing has been declared, and a Module
 * that has not yet been governed is not thereby forbidden from working. That is
 * a deliberate choice — a default-deny here would silently break every Module
 * without a policy the moment this shipped, which is the opposite of
 * present-not-absent.
 */
export function governanceVerdict(
  policy: ModuleGovernancePolicy | undefined,
  action: string,
): GovernanceVerdict {
  if (!policy) return { allowed: true, matched: null };

  // Deny is evaluated first and wins outright, so an allow can never widen past
  // a deny no matter which order the user typed them in.
  for (const rule of policy.deny) {
    if (governanceRuleMatches(rule.action, action)) {
      return { allowed: false, matched: rule, reason: rule.reason };
    }
  }

  for (const rule of policy.allow) {
    if (governanceRuleMatches(rule.action, action)) {
      return { allowed: true, matched: rule };
    }
  }

  // Declared but unmatched. Still allowed: `allow` is documentation of what the
  // Module does, not an exhaustive whitelist. Making it exhaustive would mean
  // every unlisted internal action breaks the moment anyone writes one rule —
  // which would teach users that declaring governance breaks their Module.
  return { allowed: true, matched: null };
}

/** Thrown when a governed action is refused, carrying the rule that refused it. */
export class ModuleGovernanceDenied extends Error {
  readonly moduleName: string;
  readonly action: string;
  readonly rule: ModuleGovernanceRule;

  constructor(moduleName: string, action: string, rule: ModuleGovernanceRule) {
    super(`${moduleName} is not allowed to ${action}: ${rule.reason}`);
    this.name = "ModuleGovernanceDenied";
    this.moduleName = moduleName;
    this.action = action;
    this.rule = rule;
  }
}

/**
 * Enforce a Module's policy, or throw naming the rule.
 *
 * The message quotes the user's own stated reason rather than a generic
 * "forbidden", because the user wrote that reason in the Governance Section and
 * is the person who has to understand the refusal.
 */
export function assertModuleGovernance(
  moduleName: string,
  policy: ModuleGovernancePolicy | undefined,
  action: string,
): void {
  const verdict = governanceVerdict(policy, action);
  if (!verdict.allowed) {
    throw new ModuleGovernanceDenied(moduleName, action, verdict.matched);
  }
}
