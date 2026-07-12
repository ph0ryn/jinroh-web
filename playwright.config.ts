import { defineConfig } from "playwright/test";

const externalBaseUrl = process.env["E2E_BASE_URL"]?.replace(/\/$/u, "");
const port = process.env["E2E_PORT"] ?? "3010";
const localBaseUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: false,
  outputDir: "test-results/playwright",
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env["CI"] ? 1 : 0,
  testDir: "./test/e2e",
  timeout: 60_000,
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer:
    externalBaseUrl === undefined
      ? {
          command: "node scripts/start-e2e-server.mjs",
          env: { E2E_PORT: port },
          reuseExistingServer: false,
          timeout: 420_000,
          url: `${localBaseUrl}/live`,
        }
      : undefined,
  workers: 1,
});
