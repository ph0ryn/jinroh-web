import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * @typedef {object} ProcessLock
 * @property {string} path
 * @property {() => void} release
 */

/**
 * @param {string} name
 * @param {{ baseDirectory?: string }} [options]
 * @returns {ProcessLock}
 */
export function acquireProcessLock(name, options = {}) {
  if (!/^[a-z0-9-]+$/u.test(name)) {
    throw new Error(
      "Process lock names must contain only lowercase letters, numbers, and hyphens.",
    );
  }

  const lockPath = path.join(options.baseDirectory ?? tmpdir(), `${name}.lock`);
  const owner = {
    cwd: process.cwd(),
    id: randomUUID(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
      return {
        path: lockPath,
        release: () => releaseOwnedLock(lockPath, owner.id),
      };
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      const existingOwner = readLockOwner(lockPath);

      if (existingOwner !== null && isProcessAlive(existingOwner.pid)) {
        throw new Error(
          `Another local E2E run owns ${lockPath} (PID ${existingOwner.pid}, cwd ${existingOwner.cwd}).`,
        );
      }

      rmSync(lockPath, { force: true });
    }
  }

  throw new Error(`Could not acquire local E2E lock ${lockPath}.`);
}

function readLockOwner(lockPath) {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8"));

    if (
      typeof value === "object" &&
      value !== null &&
      typeof value.cwd === "string" &&
      typeof value.id === "string" &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 0
    ) {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function releaseOwnedLock(lockPath, ownerId) {
  const owner = readLockOwner(lockPath);

  if (owner?.id === ownerId) {
    rmSync(lockPath, { force: true });
  }
}

function isFileExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
