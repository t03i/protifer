// @ts-check

export const importRules = {
  'import/order': [
    'error',
    {
      groups: [
        'builtin',
        'external',
        'internal',
        ['parent', 'sibling', 'index'],
      ],
      pathGroups: [{ pattern: '#/*', group: 'internal', position: 'before' }],
      pathGroupsExcludedImportTypes: ['builtin'],
      alphabetize: { order: 'asc', caseInsensitive: true },
      'newlines-between': 'always',
    },
  ],
  'import/no-cycle': 'error',
  'import/no-duplicates': 'error',
  'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
}
