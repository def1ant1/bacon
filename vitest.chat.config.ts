import baseConfig from "./vitest.config"
import { defineConfig, mergeConfig } from "vitest/config"

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Chat-flow smoke tests should not inherit the global coverage thresholds
      // so they can run quickly in CI while the full suite enforces budgets via
      // npm run test:coverage.
      coverage: { enabled: false },
    },
  })
)
