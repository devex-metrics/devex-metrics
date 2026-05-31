// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "reports/**", "_site/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // TypeScript strict rules
      ...tseslint.configs["recommended"].rules,
      ...tseslint.configs["recommended-type-checked"].rules,

      // Allow variables and parameters prefixed with _ to be unused
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // Disallow any — use unknown + type guards instead
      "@typescript-eslint/no-explicit-any": "error",

      // Require explicit return types on exported functions
      "@typescript-eslint/explicit-module-boundary-types": "warn",

      // Prefer unknown over any for catch clause
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",

      // Disallow floating promises (catch errors early)
      "@typescript-eslint/no-floating-promises": "error",

      // Allow void operator to explicitly discard promises
      "no-void": ["error", { allowAsStatement: true }],

      // Prefer type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],

      // Warn on unsafe operations that come with recommended-type-checked
      // but are too noisy for the current codebase — downgraded to warn
      // so they surface as advisory rather than blocking CI.
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",

      // Allow template literal types (used widely in the codebase)
      "@typescript-eslint/restrict-template-expressions": "warn",
    },
  },
  // Test files — relax some rules that are overly strict for test code
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Tests use vi.fn() casts that produce untyped values; allow them
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Mock functions often return literal values without await
      "@typescript-eslint/require-await": "off",
    },
  },
  // Prettier must come last — disables formatting rules that conflict
  prettierConfig,
];
