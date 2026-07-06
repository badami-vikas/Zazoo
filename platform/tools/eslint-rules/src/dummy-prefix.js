/**
 * dummy-prefix — flags obviously-placeholder string literals that are missing the
 * required `dummy_` prefix.
 *
 * CLAUDE.md rule: "Dummy data MUST be dummy_-prefixed: every mock/demo/seed value
 * (ids, names, sample fields, localStorage seeds) carries a dummy_ prefix."
 *
 * SCOPING / LIMITS (read before relying on this rule):
 * This is NOT a general "is this fake data" detector — that is not mechanically
 * checkable (a linter cannot know intent). This rule catches exactly one narrow,
 * confirmed anti-pattern: a string literal that already LOOKS like placeholder/test
 * data (matches /^(test|mock|fake|sample|demo)[-_]/i) but was written WITHOUT the
 * project's dummy_ prefix — i.e. someone wrote "mock_user" instead of "dummy_user".
 * It only runs on test files (**\/*.test.ts, **\/*.spec.ts) and files under a
 * `fixtures/` or `seed/` path, to keep it from flagging incidental substrings in
 * unrelated application code/comments.
 *
 * What it CANNOT catch: real-looking dummy data with no placeholder-ish prefix at
 * all (e.g. a literal "Jordan Rivera" used as a fake name has no lexical signal this
 * rule can key on) — enforcing the full CLAUDE.md rule in general requires human
 * review / the existing "OPEN" known-issues process, not a lint rule.
 */

const PLACEHOLDER_PATTERN = /^(test|mock|fake|sample|demo)[-_]/i;
const DUMMY_PREFIX_PATTERN = /^dummy_/;

/** @type {import('eslint').Rule.RuleModule} */
export const dummyPrefix = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn on placeholder-looking string literals (test_/mock_/fake_/sample_/demo_) that should use the project's dummy_ prefix instead, in test/fixture/seed files.",
    },
    schema: [],
    messages: {
      missingDummyPrefix:
        "String literal '{{value}}' looks like placeholder data but is not dummy_-prefixed. Per CLAUDE.md, every mock/demo/seed value must carry a dummy_ prefix (e.g. 'dummy_{{stripped}}') so it's greppable and never mistaken for real data.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const value = node.value;
        if (!PLACEHOLDER_PATTERN.test(value)) return;
        if (DUMMY_PREFIX_PATTERN.test(value)) return;
        const stripped = value.replace(PLACEHOLDER_PATTERN, "");
        context.report({
          node,
          messageId: "missingDummyPrefix",
          data: { value, stripped },
        });
      },
    };
  },
};

export default dummyPrefix;
