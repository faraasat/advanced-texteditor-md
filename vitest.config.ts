import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // A hang must still fail, a busy machine must not: timing is asserted by scaling ratios, not
    // by wall-clock limits (test/helpers/scaling.ts).
    testTimeout: 30_000,
    include: ["test/**/*.{test,spec}.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "example/**"],
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
