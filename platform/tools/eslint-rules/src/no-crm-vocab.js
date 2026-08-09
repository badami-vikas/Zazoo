/**
 * no-crm-vocab — flags CRM/sales-pipeline vocabulary in identifiers, KERNEL SCOPE ONLY.
 *
 * CLAUDE.md vocabulary rule: domain labels such as Deal are allowed as Module
 * Record types, but never become Engine primitives.
 *
 * Scope (2026-07-06 vision pivot — docs/wiki/vision.md, ADR-011 in
 * docs/raw/decisions-log.md): vocabulary is two-scoped. KERNEL scope (modules/*,
 * apps/api) keeps this ban by default. ORGANIZATION scope (compiled products under tools/*, the
 * generated-organization UI under apps/web) may use domain vocabulary — e.g.
 * modules/dealpilot's "Deal" identifiers are DealPilot's own compiled-product
 * vocabulary, not a violation. Concretely, modules/dealpilot/** (the module's OWN
 * source, relocated here from tools/dealpilot/ by TASK-013) is carved out of KERNEL
 * scope entirely — see DEALPILOT_MODULE_PATH / isKernelScope below — so DealProfile,
 * DealStage, DEAL_STAGE_OPTIONS, dealsTableSpec, etc. are unflagged there. Every OTHER
 * module under modules/* (e.g. modules/jobpilot) stays KERNEL scope by default; only
 * DealPilot's own directory gets the carve-out. Separately, a small set of
 * Module-scoped API identifiers used from apps/api's composition root (which itself
 * remains KERNEL scope) are explicitly allowlisted below so that root does not turn
 * "Deal" into a generic Engine primitive while still calling DealPilot's own Module
 * Record APIs by name. The scoping lives HERE (in the rule, via `context.filename`)
 * rather than in eslint.config.js's `files` globs, so the rule stays self-contained
 * and correct regardless of how it's wired into any given flat-config file list.
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
 * catches the actual violations found (modules/dealpilot's DealProfile, DealPipelineResult,
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
const DEALPILOT_DOMAIN_IDENTIFIERS = new Set([
  "createDeal",
  "discoverDeals",
  "existingDeals",
  "updateDeal",
  // Learning/observation bridge: the router's `learning.*` surface calls these
  // DealPilot-scoped functions from the composition root.
  "dealDecisionSignal",
  "recordDealDecision",
  "dealRecordId",
  // Wiring: demo pilot data (tracked in docs/dummy.md) and a query helper used
  // only to seed the pilot workspace — not generic Engine vocabulary.
  "DealRecord",
  "DemoDeal",
  "DEMO_DEALS",
  "dealByCompany",
  // Loop/destructuring variable in the demo-seeding map over DealRecord rows.
  "deal",
]);

function isDealPilotApiIdentifier(filename, name) {
  const normalized = filename.replace(/\\/g, "/");
  return (
    /(?:^|\/)apps\/api\/src\/(?:router|wiring)\.ts$/.test(normalized) &&
    DEALPILOT_DOMAIN_IDENTIFIERS.has(name)
  );
}

function containsBannedDeal(filename, name) {
  if (DEALPILOT_ALLOW.test(name)) return false;
  if (isDealPilotApiIdentifier(filename, name)) return false;
  // Split PascalCase/camelCase into tokens and check for an exact "deal" token.
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\s]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
  return tokens.includes("deal") || tokens.includes("deals");
}

/**
 * KERNEL scope = modules/* (any module) and apps/api/*. Matched on the
 * normalized (forward-slash) filename so it works the same on Windows/POSIX and
 * regardless of whether the caller passed an absolute or repo-relative path.
 * Everything else (tools/*, apps/web/*, docs, root-level files) is ORGANIZATION scope
 * and is not checked by this rule.
 */
const KERNEL_PATH = /(^|\/)modules\/[^/]+\/.*|(^|\/)apps\/api\/.*/;

/**
 * DealPilot's own module source (platform/modules/dealpilot/**) is ORGANIZATION
 * scope, not KERNEL scope — it is DealPilot's own compiled-product Module Record
 * vocabulary (DealProfile, DealStage, DEAL_STAGE_OPTIONS, dealsTableSpec, etc.), not
 * generic Engine vocabulary. This carve-out is intentionally narrower than "all of
 * modules/*": every other module (e.g. modules/jobpilot) is unaffected and remains
 * KERNEL scope.
 */
const DEALPILOT_MODULE_PATH = /(^|\/)modules\/dealpilot\/.*/;
// DealPilot-branded API files (e.g. dealpilot-store.ts) are DealPilot's own
// persistence layer, not generic kernel code — same carve-out rationale as
// modules/dealpilot/** above.
const DEALPILOT_API_FILE_PATH = /(^|\/)apps\/api\/src\/[^/]*dealpilot[^/]*\.(ts|tsx)$/;

function isKernelScope(filename) {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, "/");
  if (DEALPILOT_MODULE_PATH.test(normalized)) return false;
  if (DEALPILOT_API_FILE_PATH.test(normalized)) return false;
  return KERNEL_PATH.test(normalized);
}

/** @type {import('eslint').Rule.RuleModule} */
export const noCrmVocab = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep Deal out of generic Engine identifiers while allowing explicit DealPilot Module Record APIs.",
    },
    schema: [],
    messages: {
      bannedVocab:
        "'{{name}}' makes Deal look like generic Engine vocabulary. Keep Deal inside an explicit DealPilot Module Record API or use the canonical Engine vocabulary.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!isKernelScope(filename)) {
      // ORGANIZATION scope (tools/*, apps/web/*, etc.) — no vocabulary restriction.
      return {};
    }
    function check(node, name) {
      if (!name) return;
      if (containsBannedDeal(filename, name)) {
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
