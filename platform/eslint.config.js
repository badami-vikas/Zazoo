// @ts-check
import tseslint from "typescript-eslint";
import bridgeRules from "./tools/eslint-rules/src/index.js";

/**
 * Flat ESLint config for the Bridge AI platform monorepo.
 *
 * Enforces the scoped CLAUDE.md vocabulary rule mechanically:
 *  - bridge/no-crm-vocab bans generic Engine "Deal" identifiers while allowing
 *    Deal as Module Record vocabulary. The broader retired-identifier ratchet is
 *    `pnpm check:vocabulary`.
 *
 * Historical note: the retired dummy-prefix rule is no longer configured.
 * Unavoidable runtime or test fixtures are governed by docs/dummy.md, not by a
 * naming-prefix convention.
 *
 * Vocabulary rule details:
 *  1. bridge/no-crm-vocab — bans generic Engine vocabulary ("Deal") in
 *     identifiers. See tools/eslint-rules/src/no-crm-vocab.js's header for the full
 *     "Pipeline"/"Lead"/"Contact" scoping writeup and docs/raw/decisions-log.md's
 *     matching 2026-07-05 ADR entry.
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
    // The real governance Pipeline class + its direct construction sites: "Pipeline"
    // as a token is allowed here (it's not banned repo-wide — see rule header).
    files: [
      "packages/core/src/pipeline.ts",
      "packages/core/src/index.ts",
    ],
    rules: {},
  },
  {
    // Tests exercise domain APIs and are not Engine vocabulary declaration sites.
    files: ["**/*.test.ts"],
    rules: {
      "bridge/no-crm-vocab": "off",
    },
  },
);
