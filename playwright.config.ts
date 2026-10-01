import { defineConfig, devices } from "@playwright/test";

// E2E drives the built library in a real browser. contenteditable behaviour
// (selection, IME, Enter/Backspace, paste) is exactly what jsdom cannot
// reproduce, so this layer is where editor regressions are actually caught.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4319", trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx --yes http-server . -p 4319 -s --silent",
    url: "http://127.0.0.1:4319/example/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
