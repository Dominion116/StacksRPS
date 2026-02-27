import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "clarinet",
    environmentOptions: {
      clarinet: {
        manifestPath: "./Clarinet.toml",
        coverage: false,
        costs: false,
      },
    },
    singleFork: true,
  },
});