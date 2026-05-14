import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only run .test.ts files — skip integration tests that need a live DB
    include: ["src/**/*.test.ts"],
    // Each test file gets its own isolated module context
    isolate: true,
    // Reporters
    reporters: ["verbose"],
    // Allow env vars to be set in tests without a real .env
    env: {
      CONNECTOR_VERSION: "1.0.0-test",
      DEFAULT_FX_RATE_USD_INR: "83.5",
    },
  },
});
