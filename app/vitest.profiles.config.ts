import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["browser/*.browser.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
