import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import vitest from '@vitest/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report']),
  // Node.js environment for config/test infra files
  {
    files: ['e2e/**/*.{ts,js}', 'playwright.config.ts', 'vite.config.js', 'eslint.config.js', 'postcss.config.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Industry-standard: only ignore underscore-prefixed variables (intentionally unused)
      'no-unused-vars': ['error', { 
        vars: 'all',
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // Disable React Compiler rule - not using React Compiler in this project.
      // useLayoutEffect + setState is a valid pattern per React docs (e.g., tooltip positioning).
      'react-hooks/set-state-in-effect': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
  // TypeScript-aware linting (type-checked rules for .ts/.tsx only)
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['e2e/**', 'playwright.config.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Use TS-aware version instead of base no-unused-vars
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // Catch floating promises (unhandled async errors)
      '@typescript-eslint/no-floating-promises': 'error',
      // Catch misused promises (e.g., passing async to void callbacks)
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { attributes: false }, // Allow async onClick handlers in JSX
      }],
      // Too noisy for fire-and-forget patterns, MSW handlers, .then() chains
      '@typescript-eslint/require-await': 'off',
      // Enforce import type { T } for type-only imports (better tree-shaking)
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  // Test files: relax rules that conflict with common test patterns
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', 'src/mocks/**/*.{ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      '@typescript-eslint/unbound-method': 'off',
      // Allow `expect*`-prefixed helpers to count as assertions so tests can
      // delegate to shared helpers (e.g. `expectRemountHitsCache`) without
      // the rule complaining about missing `expect(...)` in the test body.
      'vitest/expect-expect': ['error', {
        assertFunctionNames: ['expect', 'expect*'],
      }],
    },
  },
  // e2e tests: TS parser without type-checking (not in tsconfig)
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // Playwright fixtures use 'use' keyword which triggers false positives
      'react-hooks/rules-of-hooks': 'off',
    },
  },
])
