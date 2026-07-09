/**
 * dummy-prefix — RETIRED 2026-07-06.
 *
 * The old `dummy_` prefix convention this rule enforced has itself been retired.
 * Per the 2026-07-06 real-data-only policy (CLAUDE.md, "NO dummy data (REVERSED
 * 2026-07-06 — was 'dummy_-prefix everything')"): the platform shows real,
 * connected data only, and synthetic test fixtures now use the `test_fixture_`
 * naming convention instead. There is no longer a "dummy_ prefix" for this rule
 * to enforce, so it is kept as a documented no-op rather than deleted outright
 * (eslint.config.js still references "bridge/dummy-prefix" and is a protected
 * file this change is not allowed to edit — see tools/eslint-rules/package.json
 * and platform/eslint.config.js's own header comment for the historical context).
 *
 * If eslint.config.js is ever revisited, this rule entry can be dropped entirely;
 * until then it is registered but reports nothing.
 */

/** @type {import('eslint').Rule.RuleModule} */
export const dummyPrefix = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Retired 2026-07-06 — no-op. The dummy_ prefix convention was replaced by the test_fixture_ convention under the real-data-only policy; see this file's header.",
    },
    schema: [],
    messages: {},
  },
  create() {
    // Intentional no-op: retired rule, kept only so eslint.config.js's existing
    // "bridge/dummy-prefix" reference continues to resolve without editing that
    // protected file.
    return {};
  },
};

export default dummyPrefix;
