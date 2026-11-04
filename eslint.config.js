// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/.wrangler/",
      "**/playwright-report/",
      "**/test-results/",
      "apps/realtime/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          "packages/protocol/tsconfig.json",
          "packages/protocol/test/tsconfig.json",
          "apps/web/tsconfig.json",
          "apps/web/tsconfig.node.json",
          "apps/realtime/tsconfig.json",
          "tools/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // The shared protocol runs in the browser and the Worker, so it has no dependencies at all.
    files: ["packages/protocol/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^(?!\\./)", message: "packages/protocol has no dependencies." }] },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Inline head scripts stay ES5-compatible, so `catch (e)` keeps its binding.
    files: ["apps/web/src/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
);
