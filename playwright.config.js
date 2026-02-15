const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";

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
    video: process.env.CI ? "on" : "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  outputDir: "output/playwright/test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
