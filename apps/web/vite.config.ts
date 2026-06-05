import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const devProxy = {
  '/api': 'http://localhost:9090',
  '/v1': 'http://localhost:9090',
  '/docs': 'http://localhost:9090',
  '/openapi.json': 'http://localhost:9090',
  '/health': 'http://localhost:9090',
  '/admin': 'http://localhost:9090',
} as const

export default defineConfig(async () => {
  const e2ePlugins = process.env.PLAYWRIGHT
    ? [(await import('./e2e/support/vite-mock-plugin')).e2eMockPlugin()]
    : []

  return {
    server: {
      proxy: process.env.PLAYWRIGHT ? undefined : devProxy,
    },
    plugins: [
      ...e2ePlugins,
      devtools(),
      tailwindcss(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '\\.test\\.(ts|tsx)$',
      }),
      viteReact(),
    ],
  }
})
