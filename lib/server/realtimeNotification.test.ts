import { describe, expect, it } from "vitest";

import { buildRealtimeNotificationPayload } from "./realtimeNotification";

describe("realtime notification payload", () => {
  it("contains invalidation metadata without secret state", () => {
    const payload = buildRealtimeNotificationPayload({
      reason: "phase_changed",
      roomCode: "428913",
      scope: "room",
      sentAt: "2026-07-07T00:00:00.000Z",
    });
    expect(payload).toEqual({
      reason: "phase_changed",
      roomCode: "428913",
      scope: "room",
      sentAt: "2026-07-07T00:00:00.000Z",
    });
    expect(Object.keys(payload).toSorted()).toEqual(["reason", "roomCode", "scope", "sentAt"]);
  });
});
