import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: ".", testMatch: "uax-vision-crop.spec.ts", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } });
