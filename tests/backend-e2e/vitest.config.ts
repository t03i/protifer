import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname),
    globalSetup: [resolve(import.meta.dirname, 'setup.ts')],
    include: ['**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 200_000,
    fileParallelism: false,
  },
})
