/**
 * no-crm-vocab — flags CRM/sales-pipeline vocabulary in identifiers, KERNEL SCOPE ONLY.
 *
 * CLAUDE.md vocabulary rule: "Person / Relationship / Memory / Community /
 * Initiative / Ritual / Touchpoint / Signal. NEVER Lead / Deal / Pipeline / Contact."
 *
 * Scope (2026-07-06 vision pivot — docs/wiki/vision.md, ADR-011 in
 * docs/raw/decisions-log.md): vocabulary is two-scoped. KERNEL scope (packages/*,
 * apps/api) keeps this ban. WORKSPACE scope (compiled products under tools/*, the
 * generated-workspace UI under apps/web) may use domain vocabulary — e.g.
 * tools/dealpilot's "Deal" identifiers are DealPilot's own compiled-product
 * vocabulary, not a violation. The scoping lives HERE (in the rule, via
 * `context.filename`) rather than in eslint.config.js's `files` globs, so the rule
 * stays self-contained and correct regardless of how it's wired into any given
 * flat-config file list.
 *
 * Scope decision (see docs/raw/decisions-log.md 2026-07-05 entry): "Pipeline" is
 * DELIBERATELY EXCLUDED from this rule's banned-word list. `UniversalActionPipeline`,
 * `PipelineDeps`, `pipeline.ts`, and the `pipeline` local variable in
 * packages/core/src/pipeline.ts (and every file that constructs one) are the real,
 * correct name for this repo's governance pipeline class — completely unrelated to the
 * CRM "sales pipeline / deal flow stages" sense the rule exists to ban. A word-boundary
 * regex cannot tell those senses apart (both are literally the token "Pipeline"), and an
 * allowlist of exact identifiers would need constant upkeep as new call sites are added
 * (every test file that does `const pipeline = new UniversalActionPipeline(...)` would
 * need a new entry). Dropping "Pipeline" from the banned set entirely is the only
 * zero-maintenance option that doesn't false-positive on real code — the tradeoff is the
 * rule can't catch a hypothetical future "salesPipeline"/"dealPipelineStage" identifier,
 * but grep confirmed no such usage exists today, and "Deal" alone (see below) already
 * catches the actual violations found (tools/dealpilot's DealProfile, DealPipelineResult,
 * processDealCandidate, dealsKanbanView, existingDeals, etc.).
 *
 * "Lead" and "Contact" are excluded from the identifier check too — grep-verified: every
 * occurrence of those words in this codebase is inside a comment/string quoting the
 * vocabulary rule itself (e.g. "never Leads/Contacts"), not a real identifier. Only "Deal"
 * has confirmed identifier-level violations, so the rule bans single-token "Deal" while
 * carving out "DealPilot"/"dealpilot" (the product name for the M&A brokerage tool,
 * itself an intentional, approved proper noun — not the CRM sense of "deal").
 */

/** @type {RegExp} Matches "Deal" as a whole word-ish token inside camelCase/PascalCase/snake_case identifiers, case-insensitive. */
const DEAL_TOKEN = /(?:^|[_])[Dd]eal(?:[A-Z_]|$)|(?<=[a-z])Deal(?=[A-Z]|$)|^Deal(?=[A-Z]|$)/;

/** Identifiers where "Deal" is part of the approved "DealPilot" product name, not the CRM word. */
const DEALPILOT_ALLOW = /deal ?pilot/i;

function containsBannedDeal(name) {
  if (DEALPILOT_ALLOW.test(name)) return false;
  // Split PascalCase/camelCase into tokens and check for an exact "deal" token.
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\s]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
  return tokens.includes("deal") || tokens.includes("deals");
}

/**
 * KERNEL scope = packages/* (any package) and apps/api/*. Matched on the
 * normalized (forward-slash) filename so it works the same on Windows/POSIX and
 * regardless of whether the caller passed an absolute or repo-relative path.
 * Everything else (tools/*, apps/web/*, docs, root-level files) is WORKSPACE scope
 * and is not checked by this rule.
 */
const KERNEL_PATH = /(^|\/)packages\/[^/]+\/.*|(^|\/)apps\/api\/.*/;

function isKernelScope(filename) {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, "/");
  return KERNEL_PATH.test(normalized);
}

/** @type {import('eslint').Rule.RuleModule} */
export const noCrmVocab = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow CRM/sales vocabulary (Deal) in identifiers per CLAUDE.md's vocabulary rule. See file header for the 'Pipeline'/'Lead'/'Contact' scoping tradeoff.",
    },
    schema: [],
    messages: {
      bannedVocab:
        "'{{name}}' uses banned CRM vocabulary ('Deal'). Bridge AI vocabulary is Person / Relationship / Memory / Community / Initiative / Ritual / Touchpoint / Signal — never Lead / Deal / Pipeline / Contact. Rename using the approved vocabulary (e.g. Candidate/Opportunity/Listing/Initiative), or if this is the DealPilot product name, keep 'DealPilot'/'dealpilot' verbatim (already allowlisted).",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!isKernelScope(filename)) {
      // WORKSPACE scope (tools/*, apps/web/*, etc.) — no vocabulary restriction.
      return {};
    }
    function check(node, name) {
      if (!name) return;
      if (containsBannedDeal(name)) {
        context.report({ node, messageId: "bannedVocab", data: { name } });
      }
    }
    return {
      Identifier(node) {
        // Only check declaration-site-ish identifiers to keep noise down: variable/function
        // names, parameters, class/interface/type names, property keys defined as identifiers.
        // We deliberately do NOT restrict to declarations only, because interface property
        // signatures and type alias members are also Identifier nodes we want covered.
        check(node, node.name);
      },
    };
  },
};

export default noCrmVocab;
