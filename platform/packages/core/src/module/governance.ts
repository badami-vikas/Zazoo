/**
 * Per-Module governance verdicts (ADR-239).
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
