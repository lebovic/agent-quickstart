import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Disallow console.log (use logger instead)
      "no-console": "error",
      // Prefer const over let when variable is never reassigned
      "prefer-const": "error",
      // Disallow unused variables (error instead of warning)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Require consistent type imports
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
    },
  },
  // Allow console in seed script (CLI tool)
  {
    files: ["prisma/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },
])

export default eslintConfig
