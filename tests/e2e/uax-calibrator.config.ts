import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "uax-calibrator.spec.ts",
  fullyParallel: true,
  use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
});
