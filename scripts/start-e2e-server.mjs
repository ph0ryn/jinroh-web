import { execFileSync, spawn } from "node:child_process";

const port = process.env.E2E_PORT ?? "3010";

if (process.env.E2E_SKIP_DB_RESET !== "1") {
  execFileSync("pnpm", ["exec", "supabase", "db", "reset", "--local"], {
    stdio: "inherit",
  });
}

if (process.env.E2E_SKIP_BUILD !== "1") {
  execFileSync("pnpm", ["run", "build"], { stdio: "inherit" });
}

const localSupabaseEnv = parseEnvOutput(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const server = spawn("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", port], {
  env: {
    ...process.env,
    MAINTENANCE_SECRET:
      process.env.MAINTENANCE_SECRET ?? "jinroh-e2e-maintenance-secret-32-bytes-minimum",
    NEXT_TELEMETRY_DISABLED: "1",
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? localSupabaseEnv.JWT_SECRET ?? "",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 0);
});

function parseEnvOutput(output) {
  return Object.fromEntries(
    output.split("\n").flatMap((line) => {
      const separatorIndex = line.indexOf("=");

      if (separatorIndex <= 0) {
        return [];
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const value =
        rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

      return [[key, value]];
    }),
  );
}
