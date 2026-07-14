/* oxlint-disable typescript/no-unnecessary-condition -- Signal handlers mutate runtime state asynchronously. */

import { assertSuccessfulProcess, spawnManagedProcess } from "./managedProcess.mjs";

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
let activeProcess = undefined;
let requestedSignal = null;

if (process.env.E2E_BASE_URL !== undefined) {
  throw new Error(
    "test:all manages the local database and server. Run test:integration or test:browser explicitly for an isolated remote preview.",
  );
}

const signalHandlers = Object.fromEntries(
  Object.keys(SIGNAL_EXIT_CODES).map((signal) => [
    signal,
    () => {
      requestedSignal ??= signal;

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
  await runCommand("pnpm", ["run", "test:unit"], process.env);
  await runCommand("pnpm", ["exec", "playwright", "test"], {
    ...process.env,
    E2E_RUN_DATABASE_TESTS: "1",
  });
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

  for (const [signal, handler] of Object.entries(signalHandlers)) {
    process.off(signal, handler);
  }
}

if (requestedSignal !== null) {
  exitCode = SIGNAL_EXIT_CODES[requestedSignal];
}

process.exitCode = exitCode;

async function runCommand(command, arguments_, environment) {
  if (requestedSignal !== null) {
    throw new Error(`Test run was interrupted by ${requestedSignal}.`);
  }

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
