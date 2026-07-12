import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer } from "./support/api";

import type { RealtimeAuthorization, RoomSummary } from "@/lib/shared/game";

test("initial realtime authorization and heartbeat use a consistent lock order", async ({
  request,
}) => {
  for (let index = 0; index < 8; index += 1) {
    const host = await createApiPlayer(request, `heartbeat-host-${String(index)}`, `Host ${index}`);
    const room = await apiFetch<{ readonly code: string }>(request, "/api/rooms", {
      body: { displayName: host.displayName, targetPlayerCount: 3 },
      method: "POST",
      token: host.token,
    });

    const [authorization, summary] = await Promise.all([
      apiFetch<RealtimeAuthorization>(request, `/api/rooms/${room.code}/realtime-token`, {
        method: "POST",
        token: host.token,
      }),
      apiFetch<RoomSummary>(request, `/api/rooms/${room.code}/heartbeat`, {
        method: "POST",
        token: host.token,
      }),
    ]);

    expect(authorization.subscriptions.length).toBeGreaterThan(0);
    expect(summary.code).toBe(room.code);
  }
});
