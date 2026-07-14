import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { spawnManagedProcess } from "../../scripts/test/managedProcess.mjs";
import { acquireProcessLock } from "../../scripts/test/processLock.mjs";
import {
  assertTcpPortAvailable,
  isTcpPortOpen,
  parseTcpPort,
  waitForTcpPortRelease,
} from "../../scripts/test/tcpPort.mjs";

let server: Server | undefined = undefined;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    server = undefined;
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local test runtime", () => {
  it("holds an exclusive process lock and releases only its own lock", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "jinroh-test-lock-"));

    temporaryDirectories.push(baseDirectory);
    const first = acquireProcessLock("exclusive-test", { baseDirectory });

    expect(() => acquireProcessLock("exclusive-test", { baseDirectory })).toThrow(
      /Another local E2E run owns/u,
    );
    first.release();

    const second = acquireProcessLock("exclusive-test", { baseDirectory });

    expect(second.path).toBe(first.path);
    second.release();
  });

  it("detects occupied ports and observes their release", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    if (address === null || typeof address === "string") {
      throw new Error("Port test server did not bind to a TCP port.");
    }

    const endpoint = { host: "127.0.0.1", port: address.port };

    await expect(isTcpPortOpen(endpoint)).resolves.toBe(true);
    await expect(assertTcpPortAvailable(endpoint)).rejects.toThrow(/already in use/u);
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    server = undefined;
    await expect(waitForTcpPortRelease(endpoint)).resolves.toBeUndefined();
  });

  it("validates configured ports and terminates the full managed process group", async () => {
    expect(parseTcpPort(undefined)).toBe(3010);
    expect(parseTcpPort("4310")).toBe(4310);
    expect(() => parseTcpPort("invalid")).toThrow(/E2E_PORT/u);

    const grandchildSource = `
      const net = require("node:net");
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
      setInterval(() => {}, 1_000);
    `;
    const parentSource = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", ${JSON.stringify(grandchildSource)}], { stdio: ["ignore", "inherit", "inherit"] });
      setInterval(() => {}, 1_000);
    `;
    const managedProcess = spawnManagedProcess(process.execPath, ["-e", parentSource], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    try {
      const port = await readPortLine(managedProcess.child.stdout, 5_000);
      const endpoint = { host: "127.0.0.1", port };

      await expect(isTcpPortOpen(endpoint)).resolves.toBe(true);
      const outcome = await managedProcess.terminate("SIGTERM", 1_000);

      expect(managedProcess.hasExited).toBe(true);
      expect(outcome.error).toBeNull();
      expect(outcome.signal).toBe("SIGTERM");
      await expect(
        waitForTcpPortRelease(endpoint, {
          intervalMilliseconds: 20,
          timeoutMilliseconds: 1_000,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await managedProcess.terminate("SIGTERM", 1_000);
    }
  }, 10_000);

  it.skipIf(process.platform === "win32")(
    "releases the launcher lock and its active process group after SIGTERM",
    async () => {
      const stubDirectory = mkdtempSync(path.join(tmpdir(), "jinroh-test-launcher-"));
      const lockPath = path.join(stubDirectory, "jinroh-web-local-e2e.lock");
      const pnpmPath = path.join(stubDirectory, "pnpm");

      temporaryDirectories.push(stubDirectory);
      expect(existsSync(lockPath)).toBe(false);
      writeFileSync(
        pnpmPath,
        `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const source = ${JSON.stringify(`
  const net = require("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => process.stdout.write("STUB_PORT " + server.address().port + "\\n"));
  setInterval(() => {}, 1_000);
`)};
spawn(process.execPath, ["-e", source], { stdio: ["ignore", "inherit", "inherit"] });
setInterval(() => {}, 1_000);
`,
        "utf8",
      );
      chmodSync(pnpmPath, 0o755);

      const applicationPort = await reserveReleasedPort();
      const launcher = spawn(process.execPath, [path.resolve("scripts/test/startTestServer.mjs")], {
        env: {
          ...process.env,
          E2E_INTERNAL_LOCK_DIRECTORY: stubDirectory,
          E2E_PORT: String(applicationPort),
          NODE_ENV: "test",
          PATH: `${stubDirectory}:${process.env["PATH"] ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const launcherExit = waitForChildExit(launcher, 15_000);

      try {
        const stubPort = await readPrefixedPort(launcher.stdout, "STUB_PORT ", 5_000);
        const stubEndpoint = { host: "127.0.0.1", port: stubPort };

        expect(existsSync(lockPath)).toBe(true);
        await expect(isTcpPortOpen(stubEndpoint)).resolves.toBe(true);
        launcher.kill("SIGTERM");

        await expect(launcherExit).resolves.toMatchObject({
          code: 143,
          signal: null,
        });
        expect(existsSync(lockPath)).toBe(false);
        await expect(
          waitForTcpPortRelease(stubEndpoint, {
            intervalMilliseconds: 20,
            timeoutMilliseconds: 1_000,
          }),
        ).resolves.toBeUndefined();
      } finally {
        if (launcher.exitCode === null && launcher.signalCode === null) {
          launcher.kill("SIGTERM");
        }

        await launcherExit.catch(() => undefined);
      }
    },
    20_000,
  );
});

async function reserveReleasedPort(): Promise<number> {
  const reservation = createServer();

  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();

  if (address === null || typeof address === "string") {
    throw new Error("Port reservation did not bind to a TCP port.");
  }

  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error === undefined ? resolve() : reject(error)));
  });

  return address.port;
}

function readPortLine(
  stream: NodeJS.ReadableStream | null,
  timeoutMilliseconds: number,
): Promise<number> {
  if (stream === null) {
    throw new Error("Managed process stdout was not available.");
  }

  return new Promise((resolve, reject) => {
    let output = "";
    const timeoutId = setTimeout(
      () => reject(new Error("Managed child did not report a port.")),
      timeoutMilliseconds,
    );

    stream.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();

      if (!output.includes("\n")) {
        return;
      }

      clearTimeout(timeoutId);
      const port = Number(output.trim());

      if (!Number.isSafeInteger(port)) {
        reject(new Error("Managed child reported an invalid port."));
        return;
      }

      resolve(port);
    });
  });
}

function readPrefixedPort(
  stream: NodeJS.ReadableStream | null,
  prefix: string,
  timeoutMilliseconds: number,
): Promise<number> {
  if (stream === null) {
    throw new Error("Child process stdout was not available.");
  }

  return new Promise((resolve, reject) => {
    let output = "";
    const timeoutId = setTimeout(
      () => reject(new Error(`Child process did not report ${prefix.trim()}.`)),
      timeoutMilliseconds,
    );

    stream.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));

      if (line === undefined) {
        return;
      }

      clearTimeout(timeoutId);
      const port = Number(line.slice(prefix.length));

      if (!Number.isSafeInteger(port)) {
        reject(new Error("Child process reported an invalid port."));
        return;
      }

      resolve(port);
    });
  });
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMilliseconds: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Child process did not exit within ${timeoutMilliseconds}ms.`));
    }, timeoutMilliseconds);

    child.once("exit", (code, signal) => {
      clearTimeout(timeoutId);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}
