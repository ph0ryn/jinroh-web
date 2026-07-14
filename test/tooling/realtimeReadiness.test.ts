import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  probeSupabaseRealtimeWebSocket,
  waitForSupabaseRealtime,
} from "../../scripts/test/realtimeReadiness.mjs";

const TEST_ENVIRONMENT = {
  anonKey: "local-anon-key",
  apiUrl: "http://127.0.0.1:54321",
};

let server: Server | undefined = undefined;

afterEach(async () => {
  vi.restoreAllMocks();

  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    server = undefined;
  }
});

describe("Supabase Realtime readiness", () => {
  it("retries gateway failures until an actual WebSocket upgrade succeeds", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 502"))
      .mockRejectedValueOnce(new Error("HTTP 502"))
      .mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    let currentTime = 0;

    sleep.mockImplementation(async (milliseconds: number) => {
      currentTime += milliseconds;
    });

    await expect(
      waitForSupabaseRealtime(TEST_ENVIRONMENT, {
        now: () => currentTime,
        probe,
        retryIntervalMilliseconds: 25,
        sleep,
        timeoutMilliseconds: 100,
      }),
    ).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("reports the last gateway failure when readiness times out", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("HTTP 502"));
    let currentTime = 0;

    await expect(
      waitForSupabaseRealtime(TEST_ENVIRONMENT, {
        now: () => currentTime,
        probe,
        retryIntervalMilliseconds: 20,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
        timeoutMilliseconds: 50,
      }),
    ).rejects.toThrow(/not ready within 50ms.*HTTP 502/u);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("probes the public gateway with the WebSocket route used by browsers", async () => {
    let requestedUrl: string | undefined = undefined;

    server = createServer();
    server.on("upgrade", (request, socket) => {
      requestedUrl = request.url;
      socket.end(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    if (address === null || typeof address === "string") {
      throw new Error("Readiness test server did not bind to a TCP port.");
    }

    await expect(
      probeSupabaseRealtimeWebSocket(
        {
          anonKey: "local-anon-key",
          apiUrl: `http://127.0.0.1:${address.port}`,
        },
        1_000,
      ),
    ).resolves.toBeUndefined();
    expect(requestedUrl).toBe("/realtime/v1/websocket?apikey=local-anon-key&vsn=2.0.0");
  });
});
