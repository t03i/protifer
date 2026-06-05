// @ts-check

import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import-x'
import globals from 'globals'
import { importRules } from './base.js'

export const nodeConfig = tseslint.config(
  {
    ignores: ['dist/**', 'vitest.config.*', 'vitest.int.config.*'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: { project: true },
      globals: { ...globals.node },
    },
    rules: {
      ...importRules,
    },
  },
)
