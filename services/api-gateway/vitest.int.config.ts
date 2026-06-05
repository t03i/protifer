import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts', 'scripts/**/*.int.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    },
  },
})
