// lint-staged.config.mjs

/**
 * Returns the workspace root (e.g. "apps/web") for a given absolute file path,
 * or null for files outside the known workspace dirs.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function workspaceOf(filePath) {
  const match = filePath.match(/\/(apps|packages|services)\/([^/]+)\//)
  return match ? `${match[1]}/${match[2]}` : null
}

export default {
  // TypeScript: lint + typecheck affected workspaces (infra has no eslint config)
  '{apps,packages,services}/**/*.{ts,tsx}': (files) => {
    const workspaces = [...new Set(files.map(workspaceOf).filter(Boolean))]
    return [
      `eslint --fix ${files.join(' ')}`,
      ...workspaces.map((ws) => `bun run --cwd ${ws} typecheck`),
    ]
  },

  // JavaScript: lint only
  '{apps,packages,services}/**/*.{js,mjs,cjs}': (files) => [
    `eslint --fix ${files.join(' ')}`,
  ],

  // All staged files: format whatever prettier knows about
  '**/*': (files) =>
    `bunx prettier --write --ignore-unknown ${files.join(' ')}`,
}
