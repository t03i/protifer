// @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import { importRules } from './base.js'

export const reactConfig = [
  ...tanstackConfig,
  {
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...importRules,
    },
  },
]
