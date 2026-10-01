import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.{test,spec}.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", "example/**"],
    environment: "jsdom",
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
