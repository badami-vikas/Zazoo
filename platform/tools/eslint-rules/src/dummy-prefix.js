/**
 * dummy-prefix — RETIRED 2026-07-06, real-data-only policy — see CLAUDE.md.
 *
 * The `dummy_` convention this rule enforced ("every mock/demo/seed value carries
 * a dummy_ prefix so it's greppable") is retired: the platform no longer treats
 * seeded/demo/placeholder product state as an ongoing pattern to be marked-safe —
 * it simply must not exist in runtime paths. Test fixtures now use the
 * `test_fixture_` naming convention instead (enforced by convention + code review,
 * not by this rule).
 *
 * This rule is kept as a no-op (rather than deleted) because `eslint.config.js`
 * is a protected file and still references `bridge/dummy-prefix` in its rule set
 * — removing the export would break config load. The `create()` below returns an
 * empty visitor so the rule never reports anything.
 */

/** @type {import('eslint').Rule.RuleModule} */
export const dummyPrefix = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Retired 2026-07-06 (real-data-only policy — see CLAUDE.md). No-op: kept only because eslint.config.js (protected) still references the rule id.",
    },
    schema: [],
    messages: {},
  },
  create() {
    return {};
  },
};

export default dummyPrefix;
