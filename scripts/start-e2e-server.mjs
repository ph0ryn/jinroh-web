import { execFileSync, spawn } from "node:child_process";

import {
  createLocalE2eEnvironment,
  readLocalSupabaseStatusEnvironment,
} from "./e2eSupabaseEnvironment.mjs";
import { waitForSupabaseRealtime } from "./e2eSupabaseReadiness.mjs";

const port = process.env.E2E_PORT ?? "3010";

if (process.env.E2E_SKIP_DB_RESET !== "1") {
  execFileSync("pnpm", ["exec", "supabase", "db", "reset", "--local"], {
    stdio: "inherit",
  });
}

const e2eEnvironment = createLocalE2eEnvironment(process.env, readLocalSupabaseStatusEnvironment());

process.stdout.write("Waiting for local Supabase Realtime WebSocket readiness...\n");
await waitForSupabaseRealtime({
  anonKey: e2eEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  apiUrl: e2eEnvironment.NEXT_PUBLIC_SUPABASE_URL,
});
process.stdout.write("Local Supabase Realtime WebSocket is ready.\n");

if (process.env.E2E_SKIP_BUILD !== "1") {
  execFileSync("pnpm", ["run", "build"], { env: e2eEnvironment, stdio: "inherit" });
}

const server = spawn("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", port], {
  env: {
    ...e2eEnvironment,
    MAINTENANCE_SECRET:
      process.env.MAINTENANCE_SECRET ?? "jinroh-e2e-maintenance-secret-32-bytes-minimum",
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 0);
});
