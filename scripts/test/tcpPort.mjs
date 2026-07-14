import net from "node:net";

const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 250;
const DEFAULT_RELEASE_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_RETRY_INTERVAL_MILLISECONDS = 100;

/**
 * @param {string | undefined} rawPort
 * @param {number} [fallback]
 */
export function parseTcpPort(rawPort, fallback = 3010) {
  const port = rawPort === undefined ? fallback : Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("E2E_PORT must be an integer between 1 and 65535.");
  }

  return port;
}

/**
 * @param {{ host: string; port: number }} endpoint
 */
export async function assertTcpPortAvailable(endpoint) {
  if (await isTcpPortOpen(endpoint)) {
    throw new Error(`Test server port ${endpoint.host}:${endpoint.port} is already in use.`);
  }
}

/**
 * @param {{ host: string; port: number }} endpoint
 * @param {{ intervalMilliseconds?: number; timeoutMilliseconds?: number }} [options]
 */
export async function waitForTcpPortRelease(endpoint, options = {}) {
  const intervalMilliseconds = options.intervalMilliseconds ?? DEFAULT_RETRY_INTERVAL_MILLISECONDS;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_RELEASE_TIMEOUT_MILLISECONDS;
  const deadline = Date.now() + timeoutMilliseconds;

  while (await isTcpPortOpen(endpoint)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Test server port ${endpoint.host}:${endpoint.port} was not released within ${timeoutMilliseconds}ms.`,
      );
    }

    await wait(intervalMilliseconds);
  }
}

/**
 * @param {{ host: string; port: number }} endpoint
 * @param {number} [timeoutMilliseconds]
 */
export function isTcpPortOpen(
  endpoint,
  timeoutMilliseconds = DEFAULT_CONNECT_TIMEOUT_MILLISECONDS,
) {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    let settled = false;

    const finish = (isOpen) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(isOpen);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMilliseconds, () => finish(false));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
