import { defineConfig } from "playwright/test";

import { resolveExternalBaseUrl } from "./scripts/test/localEnvironment.mjs";
import { parseTcpPort } from "./scripts/test/tcpPort.mjs";

const externalBaseUrl = resolveExternalBaseUrl(process.env);
const port = parseTcpPort(process.env["E2E_PORT"]);
const localBaseUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: [
    {
      name: "integration",
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
    baseURL: externalBaseUrl ?? localBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer:
    externalBaseUrl === undefined
      ? {
          command: "node scripts/test/startTestServer.mjs",
          env: {
            E2E_PORT: String(port),
            E2E_RUN_DATABASE_TESTS: process.env["E2E_RUN_DATABASE_TESTS"] ?? "0",
          },
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
          reuseExistingServer: false,
          timeout: 420_000,
          url: `${localBaseUrl}/live`,
        }
      : undefined,
  workers: 1,
});
