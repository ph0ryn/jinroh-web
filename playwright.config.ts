import { defineConfig } from "playwright/test";

const localBaseUrl = "http://127.0.0.1:3010";
const rateLimitsEnabled = process.env["VERCEL"] === "1";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: rateLimitsEnabled
    ? [
        {
          name: "rate-limit",
          testMatch: "integration/rateLimits.spec.ts",
        },
      ]
    : [
        {
          name: "integration",
          testIgnore: "integration/rateLimits.spec.ts",
          testMatch: "integration/**/*.spec.ts",
        },
        {
          name: "browser",
          testMatch: "browser/**/*.spec.ts",
        },
      ],
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env["CI"] ? 1 : 0,
  testDir: "./test",
  timeout: 60_000,
  use: {
    baseURL: localBaseUrl,
    extraHTTPHeaders: rateLimitsEnabled ? { "x-vercel-forwarded-for": "192.0.2.254" } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run start --hostname 127.0.0.1 --port 3010",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
    timeout: 420_000,
    url: `${localBaseUrl}/live`,
  },
  workers: 1,
});
