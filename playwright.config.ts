import { defineConfig, devices } from "@playwright/test";

// ATM_E2E_PORT lets two checkouts run their suites side by side (each serves its own dist/).
const PORT = Number(process.env.ATM_E2E_PORT) || 4319;

// E2E drives the built library in a real browser. contenteditable behaviour
// (selection, IME, Enter/Backspace, paste) is exactly what jsdom cannot
// reproduce, so this layer is where editor regressions are actually caught.
export default defineConfig({
  testDir: "./e2e",
  // The demo site has its own config (playwright.site.config.ts): it needs a different server and base path.
  testIgnore: /site\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // Gecko and WebKit: contenteditable, selection and clipboard differ most across engines.
    // Needs the browsers once: `npx playwright install firefox webkit`. Run one engine with
    // `npx playwright test --project=firefox`.
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `npx --yes http-server . -p ${PORT} -s --silent`,
    url: `http://127.0.0.1:${PORT}/example/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
