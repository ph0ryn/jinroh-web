import { spawn } from "node:child_process";

const DEFAULT_TERMINATION_TIMEOUT_MILLISECONDS = 5_000;

/**
 * @typedef {object} ProcessOutcome
 * @property {number | null} code
 * @property {Error | null} error
 * @property {string | null} signal
 */

/**
 * @param {string} command
 * @param {readonly string[]} arguments_
 * @param {import("node:child_process").SpawnOptions} [options]
 */
export function spawnManagedProcess(command, arguments_, options = {}) {
  const useProcessGroup = process.platform !== "win32";
  const child = spawn(command, arguments_, {
    ...options,
    detached: useProcessGroup,
  });
  let settled = false;
  /** @type {(outcome: ProcessOutcome) => void} */
  let resolveExit = () => {
    throw new Error("Managed process exit resolver was not initialized.");
  };
  /** @type {Promise<ProcessOutcome>} */
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const settle = (outcome) => {
    if (settled) {
      return;
    }

    settled = true;
    resolveExit(outcome);
  };

  child.once("error", (error) => settle({ code: null, error, signal: null }));
  child.once("exit", (code, signal) => settle({ code, error: null, signal }));

  return {
    child,
    exited,
    get hasExited() {
      return settled;
    },
    /**
     * @param {string} [signal]
     * @param {number} [timeoutMilliseconds]
     */
    async terminate(
      signal = "SIGTERM",
      timeoutMilliseconds = DEFAULT_TERMINATION_TIMEOUT_MILLISECONDS,
    ) {
      if (settled) {
        return exited;
      }

      sendSignal(child, signal, useProcessGroup);
      const exitedGracefully = await Promise.race([
        exited.then(() => true),
        wait(timeoutMilliseconds).then(() => false),
      ]);

      if (!exitedGracefully) {
        sendSignal(child, "SIGKILL", useProcessGroup);
      }

      return exited;
    },
  };
}

/**
 * @param {ProcessOutcome} outcome
 * @param {string} label
 */
export function assertSuccessfulProcess(outcome, label) {
  if (outcome.error !== null) {
    throw new Error(`${label} could not start: ${outcome.error.message}`, { cause: outcome.error });
  }

  if (outcome.code !== 0) {
    const detail =
      outcome.signal === null ? `exit code ${outcome.code}` : `signal ${outcome.signal}`;

    throw new Error(`${label} failed with ${detail}.`);
  }
}

function sendSignal(child, signal, useProcessGroup) {
  try {
    if (useProcessGroup && child.pid !== undefined) {
      process.kill(-child.pid, signal);
      return;
    }

    child.kill(signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
