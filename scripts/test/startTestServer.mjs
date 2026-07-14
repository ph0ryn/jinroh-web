/* oxlint-disable typescript/no-unnecessary-condition -- Signal handlers mutate runtime state asynchronously. */

import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createLocalE2eEnvironment,
  readLocalSupabaseStatusEnvironment,
} from "./localEnvironment.mjs";
import { assertSuccessfulProcess, spawnManagedProcess } from "./managedProcess.mjs";
import { acquireProcessLock } from "./processLock.mjs";
import { waitForSupabaseRealtime } from "./realtimeReadiness.mjs";
import { assertTcpPortAvailable, parseTcpPort, waitForTcpPortRelease } from "./tcpPort.mjs";

const HOST = "127.0.0.1";
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const port = parseTcpPort(process.env.E2E_PORT);
const endpoint = { host: HOST, port };
const nextCliPath = fileURLToPath(
  new URL("../../node_modules/next/dist/bin/next", import.meta.url),
);
let activeProcess = undefined;
let lock = undefined;
let requestedSignal = null;
let serverStarted = false;
const shutdownController = new AbortController();

const signalHandlers = Object.fromEntries(
  Object.keys(SIGNAL_EXIT_CODES).map((signal) => [
    signal,
    () => {
      requestedSignal ??= signal;
      shutdownController.abort(new Error(`Test server startup was interrupted by ${signal}.`));

      if (activeProcess !== undefined) {
        void activeProcess.terminate(signal);
      }
    },
  ]),
);

for (const [signal, handler] of Object.entries(signalHandlers)) {
  process.on(signal, handler);
}

let exitCode = 0;

try {
  accessSync(nextCliPath, constants.R_OK);
  lock = acquireProcessLock("jinroh-web-local-e2e", resolveLockOptions(process.env));
  await assertTcpPortAvailable(endpoint);
  await runCommand("pnpm", ["exec", "supabase", "db", "reset", "--local"], process.env);
  throwIfStopping();

  const e2eEnvironment = createLocalE2eEnvironment(
    process.env,
    readLocalSupabaseStatusEnvironment(),
  );
  const testEnvironment = {
    ...e2eEnvironment,
    MAINTENANCE_SECRET:
      process.env.MAINTENANCE_SECRET ?? "jinroh-e2e-maintenance-secret-32-bytes-minimum",
    NEXT_TELEMETRY_DISABLED: "1",
  };

  process.stdout.write("Waiting for local Supabase Realtime WebSocket readiness...\n");
  await waitForSupabaseRealtime(
    {
      anonKey: testEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      apiUrl: testEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    },
    { signal: shutdownController.signal },
  );
  process.stdout.write("Local Supabase Realtime WebSocket is ready.\n");

  if (process.env.E2E_RUN_DATABASE_TESTS === "1") {
    await runCommand("pnpm", ["run", "test:db"], testEnvironment);
  }

  await runCommand("pnpm", ["run", "build"], testEnvironment);
  throwIfStopping();

  activeProcess = spawnManagedProcess(
    process.execPath,
    [nextCliPath, "start", "--hostname", HOST, "--port", String(port)],
    { env: testEnvironment, stdio: "inherit" },
  );
  serverStarted = true;

  const serverOutcome = await activeProcess.exited;

  activeProcess = undefined;

  if (requestedSignal === null) {
    assertSuccessfulProcess(serverOutcome, "Next.js test server");
  }
} catch (error) {
  if (requestedSignal === null) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);

    process.stderr.write(`${detail}\n`);
    exitCode = 1;
  }
} finally {
  if (activeProcess !== undefined) {
    await activeProcess.terminate(requestedSignal ?? "SIGTERM");
    activeProcess = undefined;
  }

  if (serverStarted) {
    try {
      await waitForTcpPortRelease(endpoint, { timeoutMilliseconds: 4_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      process.stderr.write(`${detail}\n`);
      exitCode = 1;
    }
  }

  lock?.release();

  for (const [signal, handler] of Object.entries(signalHandlers)) {
    process.off(signal, handler);
  }
}

if (requestedSignal !== null) {
  exitCode = SIGNAL_EXIT_CODES[requestedSignal];
}

process.exitCode = exitCode;

async function runCommand(command, arguments_, environment) {
  throwIfStopping();
  const managedProcess = spawnManagedProcess(command, arguments_, {
    env: environment,
    stdio: "inherit",
  });

  activeProcess = managedProcess;

  const outcome = await managedProcess.exited;

  if (activeProcess === managedProcess) {
    activeProcess = undefined;
  }

  if (requestedSignal === null) {
    assertSuccessfulProcess(outcome, `${command} ${arguments_.join(" ")}`);
  }
}

function throwIfStopping() {
  if (requestedSignal !== null) {
    throw new Error(`Test server startup was interrupted by ${requestedSignal}.`);
  }
}

function resolveLockOptions(environment) {
  const internalLockDirectory = environment.E2E_INTERNAL_LOCK_DIRECTORY;

  if (internalLockDirectory === undefined) {
    return undefined;
  }

  if (environment.NODE_ENV !== "test") {
    throw new Error("E2E_INTERNAL_LOCK_DIRECTORY is reserved for test-runner self-tests.");
  }

  return { baseDirectory: internalLockDirectory };
}
