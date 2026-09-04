// @ts-check
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config for the Bridge AI platform monorepo.
 *
 * AP-182 retired the local `bridge/no-crm-vocab` rule (and, earlier, the
 * dummy-prefix rule): vocabulary is a review concern, not a compiler concern.
 * The advisory vocabulary scan is `pnpm check:vocabulary`. This config keeps
 * the TypeScript parser wired so `pnpm lint` still proves every file parses.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/target/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
    },
    rules: {},
  },
);
