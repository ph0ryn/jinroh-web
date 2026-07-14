import { expect, test } from "playwright/test";

import {
  apiFetch,
  createApiPlayer,
  readJsonResponse,
  readRoomSummary,
} from "../fixtures/apiClient";
import { createWaitingRoom, requireOpenAction, requirePlayer } from "../fixtures/roomScenario";
import {
  createContractStartedRoom,
  decodeJwtPayload,
  findForbiddenKeyPath,
  readRoomEntries,
  startWaitingRoom,
  withTimeout,
  type ApiErrorResponse,
} from "./support";

import type { RealtimeAuthorization, RoomSummary } from "@/lib/shared/game";

test("heartbeat and initial Realtime authorization complete concurrently", async ({ request }) => {
  for (let index = 0; index < 4; index += 1) {
    const host = await createApiPlayer(request, `heartbeatHost${index}`, `Host ${index}`);
    const room = await apiFetch<RoomSummary>(request, "/api/rooms", {
      body: { displayName: host.displayName, targetPlayerCount: 3 },
      method: "POST",
      token: host.token,
    });
    const [authorization, summary] = await withTimeout(
      Promise.all([
        apiFetch<RealtimeAuthorization>(request, `/api/rooms/${room.code}/realtime-token`, {
          method: "POST",
          token: host.token,
        }),
        apiFetch<RoomSummary>(request, `/api/rooms/${room.code}/heartbeat`, {
          method: "POST",
          token: host.token,
        }),
      ]),
      10_000,
      "Concurrent heartbeat and Realtime authorization",
    );

    expect(authorization.subscriptions.length).toBeGreaterThan(0);
    expect(summary.code).toBe(room.code);
  }
});

test("authenticated endpoints reject missing and invalid bearer tokens", async ({ request }) => {
  const missing = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms/current");
  const invalid = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms/current", {
    token: "invalid-token",
  });

  expect(missing).toMatchObject({ body: { error: { code: "unauthorized" } }, status: 401 });
  expect(invalid).toMatchObject({ body: { error: { code: "unauthorized" } }, status: 401 });
});

test("maintenance cleanup rejects missing and invalid credentials", async ({ request }) => {
  const path = "/api/maintenance/expire-waiting-rooms";
  const missing = await readJsonResponse<ApiErrorResponse>(request, path, {
    body: { limit: 1 },
    method: "POST",
  });
  const wrong = await readJsonResponse<ApiErrorResponse>(request, path, {
    body: { limit: 1 },
    method: "POST",
    token: "wrong-maintenance-secret",
  });

  expect(missing).toMatchObject({ body: { error: { code: "unauthorized" } }, status: 401 });
  expect(wrong).toMatchObject({ body: { error: { code: "unauthorized" } }, status: 401 });
});

test("room mutations enforce membership, host ownership, and the accepted game revision", async ({
  request,
}) => {
  const waitingRoom = await createWaitingRoom(request, ["Alder", "Birch", "Cedar"]);
  const host = requirePlayer(waitingRoom.players, 0);
  const nonHost = requirePlayer(waitingRoom.players, 1);
  const otherRoom = await createWaitingRoom(request, ["Dahlia", "Elm", "Fir"]);
  const wrongRoomPlayer = requirePlayer(otherRoom.players, 0);
  const wrongRoom = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${waitingRoom.roomCode}/heartbeat`,
    { method: "POST", token: wrongRoomPlayer.token },
  );
  const nonHostStart = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${waitingRoom.roomCode}/start`,
    { body: {}, method: "POST", token: nonHost.token },
  );

  expect(wrongRoom).toMatchObject({
    body: { error: { code: "current_room_changed" } },
    status: 409,
  });
  expect(nonHostStart).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });

  await startWaitingRoom(request, waitingRoom);
  const summary = await readRoomSummary(request, waitingRoom.roomCode, host);
  const action = requireOpenAction(summary);
  const staleRevision = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${waitingRoom.roomCode}/action`,
    {
      body: {
        actionKey: action.key,
        phaseInstanceId: action.phaseInstanceId,
        revision: (summary.game?.revision ?? 0) + 1,
        targetPlayerId: null,
      },
      method: "POST",
      token: host.token,
    },
  );

  expect(staleRevision).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
});

test("HTTP private views and Realtime grants expose only the viewer's authorized scopes", async ({
  request,
}) => {
  const { players, roomCode } = await createContractStartedRoom(request, [
    "Grove",
    "Heath",
    "Ivy",
    "Juniper",
  ]);
  const entries = await readRoomEntries(request, roomCode, players);
  const forbiddenKeys = new Set(["accountId", "account_id", "token", "tokenHash", "token_hash"]);

  for (const { player, summary } of entries) {
    expect(findForbiddenKeyPath(summary, forbiddenKeys)).toBeNull();
    expect(JSON.stringify(summary)).not.toContain(player.token);
    expect(summary.self?.roleId).not.toBeNull();
    expect(summary.players.every(({ revealedRoleId }) => revealedRoleId === null)).toBe(true);

    const authorization = await apiFetch<RealtimeAuthorization>(
      request,
      `/api/rooms/${roomCode}/realtime-token`,
      { method: "POST", token: player.token },
    );
    const scopes = authorization.subscriptions.map(({ scope }) => scope).toSorted();
    const claims = decodeJwtPayload(authorization.accessToken);

    expect(scopes).toEqual(["player_private", "role_private", "room"]);
    expect(authorization.subscriptions.every(({ topic }) => !topic.includes(roomCode))).toBe(true);
    expect(claims["role"]).toBe("authenticated");
    expect(claims["realtime_grant_id"]).toBe(claims["sub"]);
    expect(typeof claims["exp"]).toBe("number");
  }
});
