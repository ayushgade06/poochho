import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Runs against the real Supabase project in .env.local. Never places phone calls (BOLNA_API_KEY is cleared).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    env: { ...loadEnv('', process.cwd(), ''), BOLNA_API_KEY: '', LIVE_CALLS_ENABLED: 'false' },
    testTimeout: 60_000,
    fileParallelism: false,
  },
})
