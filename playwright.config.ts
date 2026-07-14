import { execFileSync } from "node:child_process";

import { defineConfig } from "playwright/test";

const localBaseUrl = "http://127.0.0.1:3010";
const localSupabaseEnvironment = readLocalSupabaseEnvironment();
const localServerCommand = [
  "pnpm run db:reset",
  "pnpm run build",
  "pnpm exec next start --hostname 127.0.0.1 --port 3010",
].join(" && ");

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
    baseURL: localBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: localServerCommand,
    env: {
      ...localSupabaseEnvironment,
      MAINTENANCE_SECRET:
        process.env["MAINTENANCE_SECRET"] ?? "jinroh-e2e-maintenance-secret-32-bytes-minimum",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
    timeout: 420_000,
    url: `${localBaseUrl}/live`,
  },
  workers: 1,
});

function readLocalSupabaseEnvironment() {
  const status = JSON.parse(
    execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ) as Record<string, unknown>;
  const apiUrl = readStatusValue(status, "API_URL");

  return {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: readStatusValue(status, "ANON_KEY"),
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_JWT_SECRET: readStatusValue(status, "JWT_SECRET"),
    SUPABASE_SERVICE_ROLE_KEY: readStatusValue(status, "SERVICE_ROLE_KEY"),
    SUPABASE_URL: apiUrl,
  };
}

function readStatusValue(status: Record<string, unknown>, key: string): string {
  const value = status[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Local Supabase status did not provide ${key}.`);
  }

  return value;
}
