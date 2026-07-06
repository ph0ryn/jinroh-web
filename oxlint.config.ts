import { defineConfig } from "oxlint";

interface ImportMeta {
  resolve: (specifier: string) => string;
}

export default defineConfig({
  categories: {
    correctness: "error",
    nursery: "warn",
    pedantic: "off",
    restriction: "off",
    style: "error",
    suspicious: "off",
  },
  env: {
    browser: true,
    node: true,
  },
  ignorePatterns: ["dist/**", "eslint.config.mjs", "node_modules/**", ".next/**"],
  jsPlugins: [
    {
      name: "@stylistic",
      specifier: (import.meta as ImportMeta).resolve("@stylistic/eslint-plugin"),
    },
  ],
  plugins: ["typescript", "react", "nextjs"],
  rules: {
    "capitalized-comments": "off",
    "func-style": "off",
    "id-length": "off",
    "max-statements": "off",
    "max-params": "off",
    "no-continue": "off",
    "no-duplicate-imports": "off",
    "no-ternary": "off",
    "no-inferrable-types": "off",
    "no-magic-numbers": "off",
    "prefer-destructuring": "off",
    "sort-keys": "off",
    "sort-imports": "off",
    "arrow-body-style": "off",
    "react/jsx-max-depth": "off",
    "typescript/consistent-type-definitions": "off",

    "@stylistic/no-multiple-empty-lines": [
      "error",
      {
        max: 1,
        maxEOF: 0,
      },
    ],
    "@stylistic/padding-line-between-statements": [
      "off",
      {
        blankLine: "always",
        prev: "*",
        next: ["return", "multiline-expression", "block-like", "try", "throw"],
      },
      {
        blankLine: "always",
        prev: ["multiline-expression", "block-like", "const", "let"],
        next: "*",
      },
      {
        blankLine: "any",
        prev: ["const", "let"],
        next: ["const", "let"],
      },
    ],
  },
  overrides: [
    {
      files: ["oxlint.config.ts"],
      rules: {
        "sort-keys": "off",
      },
    },
  ],
});
