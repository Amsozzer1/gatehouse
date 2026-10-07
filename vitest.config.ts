import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Tests create and drop their own databases, so run files one at a time.
    fileParallelism: false,
  },
});
