// @ts-check
import tseslint from "typescript-eslint";
import bridgeRules from "./tools/eslint-rules/src/index.js";

/**
 * Flat ESLint config for the Bridge AI platform monorepo.
 *
 * Enforces two CLAUDE.md conventions mechanically:
 *  1. Vocabulary rule (bridge/no-crm-vocab) — bans CRM/sales vocabulary ("Deal") in
 *     identifiers. See tools/eslint-rules/src/no-crm-vocab.js's header for the full
 *     "Pipeline"/"Lead"/"Contact" scoping writeup and docs/raw/decisions-log.md's
 *     matching 2026-07-05 ADR entry.
 *  2. dummy_ prefix rule (bridge/dummy-prefix) — warns when a test/fixture/seed file
 *     uses a placeholder-looking string (test_/mock_/fake_/sample_/demo_) without the
 *     required dummy_ prefix. See tools/eslint-rules/src/dummy-prefix.js's header for
 *     what this can and cannot catch.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      bridge: bridgeRules,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
    },
    rules: {
      "bridge/no-crm-vocab": "error",
    },
  },
  {
    // dummy_-prefix check: scoped to test files and anything under a fixtures/ or
    // seed/ path, per the rule's documented narrow-MVP scope (see header comment).
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/test/**/*.ts",
      "**/fixtures/**/*.ts",
      "**/seed/**/*.ts",
    ],
    plugins: {
      bridge: bridgeRules,
    },
    rules: {
      "bridge/dummy-prefix": "warn",
    },
  },
  {
    // The real governance Pipeline class + its direct construction sites: "Pipeline"
    // as a token is allowed here (it's not banned repo-wide — see rule header — this
    // override exists only for documentation/clarity, no rule currently bans "Pipeline").
    files: [
      "packages/core/src/pipeline.ts",
      "packages/core/src/index.ts",
      "**/*.test.ts",
    ],
    rules: {},
  },
);
