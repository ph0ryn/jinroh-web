import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

const DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS = 5_000;
const DEFAULT_RETRY_INTERVAL_MILLISECONDS = 500;
const DEFAULT_TIMEOUT_MILLISECONDS = 300_000;

/**
 * @typedef {object} SupabaseRealtimeEnvironment
 * @property {string} anonKey
 * @property {string} apiUrl
 */

/**
 * @typedef {object} SupabaseRealtimeWaitOptions
 * @property {number} [attemptTimeoutMilliseconds]
 * @property {() => number} [now]
 * @property {(environment: SupabaseRealtimeEnvironment, timeoutMilliseconds: number) => Promise<void>} [probe]
 * @property {number} [retryIntervalMilliseconds]
 * @property {AbortSignal} [signal]
 * @property {(milliseconds: number) => Promise<void>} [sleep]
 * @property {number} [timeoutMilliseconds]
 */

/**
 * Wait until the browser-facing Supabase gateway accepts a Realtime WebSocket.
 * A database reset can restart Realtime with a new container address while the
 * long-lived gateway still caches its previous address.
 *
 * @param {SupabaseRealtimeEnvironment} environment
 * @param {SupabaseRealtimeWaitOptions} [options]
 */
export async function waitForSupabaseRealtime(environment, options = {}) {
  const attemptTimeoutMilliseconds =
    options.attemptTimeoutMilliseconds ?? DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS;
  const now = options.now ?? Date.now;
  const probe = options.probe ?? probeSupabaseRealtimeWebSocket;
  const retryIntervalMilliseconds =
    options.retryIntervalMilliseconds ?? DEFAULT_RETRY_INTERVAL_MILLISECONDS;
  const sleep = options.sleep ?? wait;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
  const deadline = now() + timeoutMilliseconds;

  for (;;) {
    options.signal?.throwIfAborted();

    try {
      await probe(environment, attemptTimeoutMilliseconds);
      return;
    } catch (error) {
      options.signal?.throwIfAborted();

      const remainingMilliseconds = deadline - now();

      if (remainingMilliseconds <= 0) {
        const detail = error instanceof Error ? ` Last attempt: ${error.message}` : "";

        throw new Error(
          `Local Supabase Realtime was not ready within ${timeoutMilliseconds}ms.${detail}`,
        );
      }

      await sleep(Math.min(retryIntervalMilliseconds, remainingMilliseconds));
    }
  }
}

/**
 * @param {SupabaseRealtimeEnvironment} environment
 * @param {number} [timeoutMilliseconds]
 */
export function probeSupabaseRealtimeWebSocket(
  environment,
  timeoutMilliseconds = DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS,
) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL("/realtime/v1/websocket", environment.apiUrl);
    endpoint.searchParams.set("apikey", environment.anonKey);
    endpoint.searchParams.set("vsn", "2.0.0");

    const transport = endpoint.protocol === "https:" ? https : http;
    const request = transport.request(endpoint, {
      headers: {
        Connection: "Upgrade",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
        Upgrade: "websocket",
      },
    });
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      request.destroy();
      reject(error);
    };

    request.once("error", fail);
    request.once("response", (response) => {
      response.resume();
      fail(new Error(`Realtime WebSocket gateway responded with HTTP ${response.statusCode}.`));
    });
    request.once("upgrade", (response, socket) => {
      socket.destroy();

      if (settled) {
        return;
      }

      settled = true;

      if (response.statusCode === 101) {
        resolve();
        return;
      }

      reject(new Error(`Realtime WebSocket gateway responded with HTTP ${response.statusCode}.`));
    });
    request.setTimeout(timeoutMilliseconds, () => {
      fail(new Error("Realtime WebSocket gateway probe timed out."));
    });
    request.end();
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
