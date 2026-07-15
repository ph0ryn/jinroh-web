import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, readJsonResponse, type ApiPlayer } from "../fixtures/apiClient";
import { requirePlayer } from "../fixtures/roomScenario";
import {
  createRoomWithStartedGame,
  finishThreePlayerGame,
  readCurrentRoom,
  requireCurrentPlayerId,
  withTimeout,
  type ApiErrorResponse,
} from "./support";

import type { RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

test("an account has one current room and can rejoin or leave it explicitly", async ({
  request,
}) => {
  const account = await createApiPlayer(request, "account", "Aster");
  const otherHost = await createApiPlayer(request, "otherHost", "Birch");
  const source = await createRoom(request, account);
  const target = await createRoom(request, otherHost);
  const originalPlayerId = requireCurrentPlayerId(source);

  await expectCurrentRoom(request, account, source.code);

  const secondCreate = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms", {
    body: { displayName: account.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: account.token,
  });
  const otherJoin = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${target.code}/join`,
    {
      body: { displayName: account.displayName },
      method: "POST",
      token: account.token,
    },
  );

  expect(secondCreate).toMatchObject({
    body: { error: { code: "current_room_exists" } },
    status: 409,
  });
  expect(otherJoin).toMatchObject({
    body: { error: { code: "current_room_exists" } },
    status: 409,
  });
  await expectCurrentRoom(request, account, source.code);

  const resumed = await apiFetch<RoomSummary>(request, `/api/rooms/${source.code}/join`, {
    body: { displayName: "Changed name" },
    method: "POST",
    token: account.token,
  });
  const resumedPlayer = resumed.players.find(({ isCurrent }) => isCurrent);

  expect(resumed.currentPlayerId).toBe(originalPlayerId);
  expect(resumedPlayer).toMatchObject({ displayName: account.displayName, id: originalPlayerId });

  await apiFetch(request, `/api/rooms/${source.code}/leave`, {
    method: "POST",
    token: account.token,
  });
  await expectCurrentRoom(request, account, null);

  const joined = await apiFetch<RoomSummary>(request, `/api/rooms/${target.code}/join`, {
    body: { displayName: account.displayName },
    method: "POST",
    token: account.token,
  });

  expect(joined.code).toBe(target.code);
  await expectCurrentRoom(request, account, target.code);
});

test("concurrent membership requests produce exactly one current room", async ({ request }) => {
  const hostA = await createApiPlayer(request, "hostA", "Cedar");
  const hostB = await createApiPlayer(request, "hostB", "Dahlia");
  const targetA = await createRoom(request, hostA);
  const targetB = await createRoom(request, hostB);

  for (const scenario of ["create-create", "create-join", "join-join"] as const) {
    const account = await createApiPlayer(request, scenario, `Player ${scenario}`);
    const responses = await withTimeout(
      Promise.all(
        makeConcurrentMembershipRequests(request, scenario, account, targetA.code, targetB.code),
      ),
      10_000,
      `Concurrent ${scenario} membership requests`,
    );
    const successes = responses.filter(({ status }) => status >= 200 && status < 300);
    const conflicts = responses.filter(({ status }) => status === 409);
    const conflict = conflicts[0];

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflict).toBeDefined();

    if (conflict !== undefined) {
      expect((conflict.body as ApiErrorResponse).error.code).toBe("current_room_exists");
    }

    const successfulRoom = successes[0]?.body as RoomSummary | undefined;

    expect(successfulRoom).toBeDefined();

    if (successfulRoom !== undefined) {
      await expectCurrentRoom(request, account, successfulRoom.code);
    }
  }
});

test("confirmed room switching is atomic across failure, success, and stale source state", async ({
  request,
}) => {
  const account = await createApiPlayer(request, "switcher", "Elm");
  const targetHost = await createApiPlayer(request, "targetHost", "Fir");
  const source = await createRoom(request, account);
  const target = await createRoom(request, targetHost);
  const failed = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms/switch", {
    body: {
      displayName: account.displayName,
      expectedCurrentRoomCode: source.code,
      kind: "join",
      targetRoomCode: "000000",
    },
    method: "POST",
    token: account.token,
  });

  expect(failed).toMatchObject({ body: { error: { code: "room_not_found" } }, status: 404 });
  await expectCurrentRoom(request, account, source.code);

  const switched = await apiFetch<RoomSummary>(request, "/api/rooms/switch", {
    body: {
      displayName: account.displayName,
      expectedCurrentRoomCode: source.code,
      kind: "join",
      targetRoomCode: target.code,
    },
    method: "POST",
    token: account.token,
  });

  expect(switched.code).toBe(target.code);
  await expectCurrentRoom(request, account, target.code);

  const stale = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms/switch", {
    body: {
      displayName: account.displayName,
      expectedCurrentRoomCode: source.code,
      kind: "create",
      targetPlayerCount: 3,
    },
    method: "POST",
    token: account.token,
  });

  expect(stale).toMatchObject({
    body: { error: { code: "current_room_changed" } },
    status: 409,
  });
  await expectCurrentRoom(request, account, target.code);
});

test("a playing member can rejoin the same room but cannot leave, switch, or admit outsiders", async ({
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Gale",
    "Harbor",
    "Iris",
  ]);
  const host = requirePlayer(players, 0);
  const outsider = await createApiPlayer(request, "outsider", "Juniper");
  const before = await readCurrentRoom(request, host);
  const originalPlayerId = requireCurrentPlayerId(before.room ?? undefined);
  const resumed = await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/join`, {
    body: { displayName: "Changed name" },
    method: "POST",
    token: host.token,
  });

  expect(resumed.status).toBe("playing");
  expect(resumed.currentPlayerId).toBe(originalPlayerId);

  const outsiderJoin = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${roomCode}/join`,
    {
      body: { displayName: outsider.displayName },
      method: "POST",
      token: outsider.token,
    },
  );
  const switched = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms/switch", {
    body: {
      displayName: host.displayName,
      expectedCurrentRoomCode: roomCode,
      kind: "create",
      targetPlayerCount: 3,
    },
    method: "POST",
    token: host.token,
  });
  const left = await readJsonResponse<ApiErrorResponse>(request, `/api/rooms/${roomCode}/leave`, {
    method: "POST",
    token: host.token,
  });

  expect(outsiderJoin).toMatchObject({
    body: { error: { code: "room_not_joinable" } },
    status: 409,
  });
  expect(switched).toMatchObject({
    body: { error: { code: "room_switch_forbidden" } },
    status: 409,
  });
  expect(left).toMatchObject({ body: { error: { code: "room_switch_forbidden" } }, status: 409 });
  await expectCurrentRoom(request, host, roomCode);
});

test("a result-lobby Room remains current until explicit leave or confirmed switch", async ({
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, ["Lark", "Maple", "Nori"]);
  const ended = await finishThreePlayerGame(request, roomCode, players);
  const host = requirePlayer(players, 0);
  const leaver = requirePlayer(players, 1);

  expect(ended.status).toBe("ended");
  await expectCurrentRoom(request, host, roomCode);

  await apiFetch(request, `/api/rooms/${roomCode}/leave`, {
    method: "POST",
    token: leaver.token,
  });
  await expectCurrentRoom(request, leaver, null);

  const directCreate = await readJsonResponse<ApiErrorResponse>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  expect(directCreate).toMatchObject({
    body: { error: { code: "current_room_exists" } },
    status: 409,
  });

  const switched = await apiFetch<RoomSummary>(request, "/api/rooms/switch", {
    body: {
      displayName: host.displayName,
      expectedCurrentRoomCode: roomCode,
      kind: "create",
      targetPlayerCount: 3,
    },
    method: "POST",
    token: host.token,
  });

  expect(switched.status).toBe("waiting");
  await expectCurrentRoom(request, host, switched.code);
});

async function createRoom(request: APIRequestContext, player: ApiPlayer): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(request, "/api/rooms", {
    body: { displayName: player.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: player.token,
  });
}

function makeConcurrentMembershipRequests(
  request: APIRequestContext,
  scenario: "create-create" | "create-join" | "join-join",
  player: ApiPlayer,
  roomCodeA: string,
  roomCodeB: string,
) {
  const create = () =>
    readJsonResponse<RoomSummary | ApiErrorResponse>(request, "/api/rooms", {
      body: { displayName: player.displayName, targetPlayerCount: 3 },
      method: "POST",
      token: player.token,
    });
  const join = (roomCode: string) =>
    readJsonResponse<RoomSummary | ApiErrorResponse>(request, `/api/rooms/${roomCode}/join`, {
      body: { displayName: player.displayName },
      method: "POST",
      token: player.token,
    });

  if (scenario === "create-create") {
    return [create(), create()];
  }

  return scenario === "create-join"
    ? [create(), join(roomCodeA)]
    : [join(roomCodeA), join(roomCodeB)];
}

async function expectCurrentRoom(
  request: APIRequestContext,
  player: ApiPlayer,
  expectedRoomCode: string | null,
): Promise<void> {
  const current = await readCurrentRoom(request, player);

  expect(current.room?.code ?? null).toBe(expectedRoomCode);
  expect(JSON.stringify(current)).not.toContain("account_id");
  expect(JSON.stringify(current)).not.toContain("current_room_id");
}
