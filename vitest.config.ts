import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 50,
        statements: 50,
        branches: 45,
        functions: 50,
      },
      reportsDirectory: './coverage',
    },
  },
})
