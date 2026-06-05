// @ts-check
import path from 'node:path'
import { nodeConfig } from '@protifer/eslint-config/node'
import { reactConfig } from '@protifer/eslint-config/react'

// Separate ignores-only entries (global) from rule entries (have files/rules keys).
// When spreading with a `files` override, an ignores-only entry would lose its
// global-ignore semantics and instead become a scoped ignore — which is wrong.
const filterRuleEntries = (c) => !('ignores' in c && !c.files)
const nodeRuleEntries = nodeConfig.filter(filterRuleEntries)
const reactRuleEntries = reactConfig.filter(filterRuleEntries)

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores — must come first and have no `files` key.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/out/**',
      '.worktrees/**',
      // Vitest config files are not part of any tsconfig project
      '**/vitest.config.*',
      '**/vitest.int.config.*',
      '**/vitest.setup.*',
      // Config files at repo root
      'prettier.config.mjs',
      'lint-staged.config.mjs',
      'eslint.config.mjs',
    ],
  },
  // Frontend app gets the React config
  ...reactRuleEntries.map((c) => ({
    ...c,
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
  })),
  // Web app rule overrides (previously in apps/web/eslint.config.js)
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Everything else (services + shared packages) gets the Node config
  ...nodeRuleEntries.map((c) => ({
    ...c,
    files: ['{services,packages}/**/*.{ts,tsx,js}'],
  })),
  // api-gateway uses a custom tsconfig.lint.json that includes src + scripts
  {
    files: ['services/api-gateway/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: path.resolve(
          import.meta.dirname,
          'services/api-gateway/tsconfig.lint.json',
        ),
      },
    },
  },
]
