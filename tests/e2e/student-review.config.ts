import { defineConfig, devices } from "@playwright/test";

// Deliberately independent from the DB-backed root configuration.
export default defineConfig({
  testDir: ".",
  testMatch: "student-review.spec.ts",
  outputDir: "../../test-results/student-review",
  fullyParallel: true,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
