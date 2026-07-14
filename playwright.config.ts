import { defineConfig } from "playwright/test";

import { readLocalTestEnvironment } from "./test/fixtures/environment";

const externalBaseUrl = readExternalBaseUrl();
const port = readPort();
const localBaseUrl = `http://127.0.0.1:${port}`;
const shouldRunDatabaseTests = process.env["E2E_RUN_DATABASE_TESTS"] === "1";
const isListCommand = process.argv.includes("--list");
const localEnvironment =
  externalBaseUrl === undefined && !isListCommand
    ? {
        ...readLocalTestEnvironment(),
        MAINTENANCE_SECRET:
          process.env["MAINTENANCE_SECRET"] ?? "jinroh-e2e-maintenance-secret-32-bytes-minimum",
        NEXT_TELEMETRY_DISABLED: "1",
      }
    : undefined;
const localServerCommand = [
  "pnpm run db:reset",
  ...(shouldRunDatabaseTests ? ["pnpm run test:db"] : []),
  "pnpm run build",
  `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
].join(" && ");

if (externalBaseUrl !== undefined && shouldRunDatabaseTests) {
  throw new Error(
    "test:all manages the local database and server. Run test:integration or test:browser explicitly for an isolated remote preview.",
  );
}

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
          command: localServerCommand,
          env: localEnvironment,
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
          reuseExistingServer: false,
          timeout: 420_000,
          url: `${localBaseUrl}/live`,
        }
      : undefined,
  workers: 1,
});

function readExternalBaseUrl(): string | undefined {
  const value = process.env["E2E_BASE_URL"]?.trim();

  if (value === undefined || value === "") {
    return undefined;
  }

  if (process.env["E2E_ALLOW_REMOTE_WRITES"] !== "1") {
    throw new Error(
      "Remote E2E writes are disabled. Set E2E_ALLOW_REMOTE_WRITES=1 only for an isolated preview environment.",
    );
  }

  const url = new URL(value);

  if (!["http:", "https:"].includes(url.protocol) || url.href !== `${url.origin}/`) {
    throw new Error("E2E_BASE_URL must be an HTTP origin without credentials or a path.");
  }

  return url.origin;
}

function readPort(): number {
  const value = Number(process.env["E2E_PORT"] ?? 3010);

  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error("E2E_PORT must be an integer between 1 and 65535.");
  }

  return value;
}
