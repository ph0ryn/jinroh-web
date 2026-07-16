import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { connect, createServer, type Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { createTestSupabaseJwtSigningKey } from "./testEnvironment";

const VALID_ENVIRONMENT = {
  ACCOUNT_TOKEN_HASH_SECRET: Buffer.alloc(32, 7).toString("base64"),
  MAINTENANCE_SECRET: "maintenance-secret-that-is-at-least-32-bytes",
  RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER: "x-ingress-client-ip",
  SUPABASE_JWT_SIGNING_KEY: createTestSupabaseJwtSigningKey(),
  SUPABASE_SECRET_KEY: "sb_secret_test-key",
  SUPABASE_URL: "https://example.supabase.co",
  VERCEL: "",
} as const;

describe("server startup environment preflight", () => {
  it("accepts a complete release environment", () => {
    const result = runPreflight();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("treats pnpm start as a release even when NODE_ENV is not preset", () => {
    const result = runPreflight({
      NODE_ENV: "development",
      RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER: "",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "[startup] RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER is required outside Vercel.",
    );
  });

  it("stops before Next.js can become ready or listen when validation fails", async () => {
    const port = await findAvailablePort();
    const result = spawnSync(
      "pnpm",
      ["run", "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: createEnvironment({ SUPABASE_URL: "" }),
        timeout: 10_000,
      },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("[startup] SUPABASE_URL is required.");
    expect(output).not.toContain("Ready");
    await expect(isPortListening(port)).resolves.toBe(false);
  });

  it("stops a release build before Next.js starts when validation fails", () => {
    const result = spawnSync("pnpm", ["run", "build"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: createEnvironment({ SUPABASE_SECRET_KEY: "" }),
      timeout: 10_000,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("[startup] SUPABASE_SECRET_KEY is required.");
    expect(output).not.toContain("Creating an optimized production build");
  });
});

function runPreflight(
  overrides: Readonly<Partial<NodeJS.ProcessEnv>> = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["./scripts/validateServerEnv.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: createEnvironment(overrides),
    timeout: 10_000,
  });
}

function createEnvironment(overrides: Readonly<Partial<NodeJS.ProcessEnv>>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...VALID_ENVIRONMENT,
    ...overrides,
  };
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  if (address === null || typeof address === "string") {
    throw new Error("Failed to reserve a local test port.");
  }

  return address.port;
}

async function isPortListening(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket: Socket = connect({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
