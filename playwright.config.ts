import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { validateTestDatabaseUrl } from "./src/lib/database-url-safety";

loadEnvConfig(process.cwd());
const normalDatabaseUrl = process.env.DATABASE_URL_NORMAL || process.env.DATABASE_URL;
const testDatabaseUrl = validateTestDatabaseUrl({
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  DATABASE_URL: normalDatabaseUrl,
});
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL_NORMAL = normalDatabaseUrl ?? "";

const baseURL = "http://localhost:3100";
const sharedEnvironment = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  DATABASE_URL_TEST: testDatabaseUrl,
  DATABASE_URL_NORMAL: normalDatabaseUrl ?? "",
  APP_URL: baseURL,
  AUTH_SECRET: "playwright-only-test-secret-not-for-production",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "node --import tsx scripts/e2e-server.ts",
      url: `${baseURL}/login`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        ...sharedEnvironment,
        PLAYWRIGHT_TEST: "1",
        DEEPSEEK_TEST_ENDPOINT: "http://127.0.0.1:3110/chat/completions",
        DEEPSEEK_API_KEY: "playwright-fake-key",
        CRON_SECRET: "playwright-cron-secret-with-at-least-32-characters",
      },
    },
    {
      command: "node --import tsx scripts/deepseek-mock.ts",
      url: "http://127.0.0.1:3110/health",
      timeout: 30_000,
      reuseExistingServer: false,
      env: sharedEnvironment,
    },
  ],
});
