import { defineConfig, devices } from "@playwright/test";

// Isolated browser fixture: no Next server, environment files or database.
export default defineConfig({
  testDir: ".",
  testMatch: "student-directory.spec.ts",
  outputDir: "../../test-results/student-directory",
  fullyParallel: true,
  workers: 2,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
