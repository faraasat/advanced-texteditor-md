import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke, behaviour and accessibility tests for the built demo and docs site (site/out, a Next.js static export),
 * served under its GitHub Pages base path (/advanced-texteditor-md/) so a broken asset URL fails here and not after a deploy.
 *   npm run build && npm run site:install && npm run site:build && npm run test:site
 */
const PORT = 4320;
export default defineConfig({
  testDir: "./e2e",
  testMatch: /site\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node scripts/serve-site.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/advanced-texteditor-md/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
