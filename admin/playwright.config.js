const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const storageState = path.join(os.tmpdir(), "atelier-os-product-uat-storage.json");

module.exports = defineConfig({
  testDir: path.join(__dirname, "e2e"),
  globalSetup: path.join(__dirname, "e2e", "global-setup.js"),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"], ["json", { outputFile: path.join(__dirname, "..", "verification", "product-completeness", "browser-results.json") }]],
  use: { baseURL: process.env.UAT_BASE_URL || "http://127.0.0.1:3457", storageState, browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure", video: "off", serviceWorkers: "block" },
  projects: [
    { name: "2560", use: { ...devices["Desktop Chrome"], viewport: { width: 2560, height: 1440 } } },
    { name: "1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    { name: "1366", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "430", use: { ...devices["Pixel 5"], viewport: { width: 430, height: 932 }, isMobile: true } },
  ],
});
