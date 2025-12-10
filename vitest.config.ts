import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
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
