import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "uax-vision-reader.spec.ts",
  outputDir: "../../test-results/uax-vision-reader",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
