const { defineConfig, devices } = require("@playwright/test");

const isCI = Boolean(process.env.CI);
// Local dev defaults to the Vite dev server on :3000; CI uses the preview server on :4173.
const baseURL =
  process.env.E2E_BASE_URL || (isCI ? "http://127.0.0.1:4173" : "http://127.0.0.1:3000");
// Keep E2E runnable in offline environments by defaulting to system Chrome locally.
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "1" || !isCI;

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/html-report", open: "never" }],
    ["json", { outputFile: "output/playwright/report.json" }],
  ],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1536, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Keep E2E runnable in offline environments (Playwright video requires ffmpeg download).
    video: "off",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  outputDir: "output/playwright/test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(useSystemChrome ? { channel: "chrome" } : {}),
      },
    },
  ],
});
