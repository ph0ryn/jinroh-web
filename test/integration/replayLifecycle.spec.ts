import { expect, test } from "playwright/test";

import {
  apiFetch,
  createApiPlayer,
  joinWaitingRoom,
  readJsonResponse,
  readRoomSummary,
  setRoomPlayersReady,
  setRoomReadiness,
} from "../fixtures/apiClient";
import { createWaitingRoom, requireOpenAction, requirePlayer } from "../fixtures/roomScenario";
import { createRoomWithStartedGame, finishThreePlayerGame, type ApiErrorResponse } from "./support";

import type { RoomSummary } from "@/lib/shared/game";

test("a game cannot start until every joined player is ready for the current roster", async ({
  request,
}) => {
  const room = await createWaitingRoom(request, ["Aster", "Birch", "Cedar"]);
  const host = requirePlayer(room.players, 0);
  const lastPlayer = requirePlayer(room.players, 2);
  const initial = await readRoomSummary(request, room.roomCode, host);

  const unreadyStart = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${room.roomCode}/start`,
    {
      body: { expectedRosterRevision: initial.rosterRevision },
      method: "POST",
      token: host.token,
    },
  );

  expect(unreadyStart).toMatchObject({
    body: { error: { code: "players_not_ready" } },
    status: 409,
  });

  await setRoomPlayersReady(request, room.roomCode, room.players);
  await setRoomReadiness(request, room.roomCode, lastPlayer, false);

  const partiallyReady = await readRoomSummary(request, room.roomCode, host);
  const lastPublicPlayer = partiallyReady.players.find(
    ({ displayName }) => displayName === lastPlayer.displayName,
  );

  expect(lastPublicPlayer?.isLobbyReady).toBe(false);

  const revokedStart = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${room.roomCode}/start`,
    {
      body: { expectedRosterRevision: partiallyReady.rosterRevision },
      method: "POST",
      token: host.token,
    },
  );

  expect(revokedStart).toMatchObject({
    body: { error: { code: "players_not_ready" } },
    status: 409,
  });

  await setRoomReadiness(request, room.roomCode, lastPlayer);

  const ready = await readRoomSummary(request, room.roomCode, host);
  const started = await apiFetch<RoomSummary>(request, `/api/rooms/${room.roomCode}/start`, {
    body: { expectedRosterRevision: ready.rosterRevision },
    method: "POST",
    token: host.token,
  });

  expect(started.status).toBe("playing");
  expect(started.game?.gameId).toBeTruthy();
});

test("a membership change invalidates readiness and rejects a stale readiness click", async ({
  request,
}) => {
  const room = await createWaitingRoom(request, ["Nori", "Olive", "Pine"], 4);
  const host = requirePlayer(room.players, 0);
  const newPlayer = await createApiPlayer(request, "newPlayer", "Quince");

  await setRoomPlayersReady(request, room.roomCode, room.players);

  const ready = await readRoomSummary(request, room.roomCode, host);

  expect(
    ready.players
      .filter(({ status }) => status !== "left")
      .every(({ isLobbyReady }) => isLobbyReady),
  ).toBe(true);

  await joinWaitingRoom(request, room.roomCode, newPlayer);

  const changed = await readRoomSummary(request, room.roomCode, host);

  expect(changed.rosterRevision).toBeGreaterThan(ready.rosterRevision);
  expect(
    changed.players
      .filter(({ status }) => status !== "left")
      .every(({ isLobbyReady }) => !isLobbyReady),
  ).toBe(true);

  const staleReadiness = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${room.roomCode}/readiness`,
    {
      body: { expectedRosterRevision: ready.rosterRevision, isReady: true },
      method: "POST",
      token: host.token,
    },
  );

  expect(staleReadiness).toMatchObject({
    body: { error: { code: "roster_changed" } },
    status: 409,
  });
});

test("the same room can start a second game without exposing artifacts from the first", async ({
  request,
}) => {
  const room = await createRoomWithStartedGame(request, ["Dahlia", "Elm", "Fir"]);
  const host = requirePlayer(room.players, 0);
  const first = await readRoomSummary(request, room.roomCode, host);
  const firstGame = first.game;
  const firstAction = requireOpenAction(first);

  expect(firstGame).not.toBeNull();

  if (firstGame === null) {
    throw new Error("The first Game was not created.");
  }

  const ended = await finishThreePlayerGame(request, room.roomCode, room.players);

  expect(ended.status).toBe("ended");
  expect(ended.game?.gameId).toBe(firstGame.gameId);
  expect(ended.players.filter(({ status }) => status !== "left")).toHaveLength(3);
  expect(
    ended.players
      .filter(({ status }) => status !== "left")
      .every(({ isLobbyReady }) => !isLobbyReady),
  ).toBe(true);

  await setRoomPlayersReady(request, room.roomCode, room.players);

  const ready = await readRoomSummary(request, room.roomCode, host);
  const replay = await apiFetch<RoomSummary>(request, `/api/rooms/${room.roomCode}/start`, {
    body: { expectedRosterRevision: ready.rosterRevision },
    method: "POST",
    token: host.token,
  });

  expect(replay.code).toBe(room.roomCode);
  expect(replay.status).toBe("playing");
  expect(replay.game?.gameId).toBeTruthy();
  expect(replay.game?.gameId).not.toBe(firstGame.gameId);
  expect(replay.self?.result).toBeNull();
  expect(replay.game?.winnerTeam).toBeNull();
  expect(replay.players.every(({ revealedRoleId }) => revealedRoleId === null)).toBe(true);

  const staleAction = await readJsonResponse<ApiErrorResponse>(
    request,
    `/api/rooms/${room.roomCode}/action`,
    {
      body: {
        actionKey: firstAction.key,
        gameId: firstGame.gameId,
        phaseInstanceId: firstAction.phaseInstanceId,
        revision: firstGame.revision,
        targetPlayerId: null,
      },
      method: "POST",
      token: host.token,
    },
  );

  expect(staleAction).toMatchObject({
    body: { error: { code: "game_changed" } },
    status: 409,
  });
});

test("a new post-game member returns the room to a clean lobby for every viewer", async ({
  request,
}) => {
  const room = await createRoomWithStartedGame(request, ["Gale", "Harbor", "Iris"]);
  const host = requirePlayer(room.players, 0);
  const leaver = requirePlayer(room.players, 1);
  const outsider = await createApiPlayer(request, "outsider", "Juniper");
  const ended = await finishThreePlayerGame(request, room.roomCode, room.players);

  expect(ended.game?.status).toBe("ended");
  expect(ended.self?.roleId).not.toBeNull();

  const outsiderPreview = await readRoomSummary(request, room.roomCode, outsider);

  expectCleanLobbyArtifacts(outsiderPreview, false);

  await apiFetch(request, `/api/rooms/${room.roomCode}/leave`, {
    method: "POST",
    token: leaver.token,
  });

  const joined = await joinWaitingRoom(request, room.roomCode, outsider);
  const refreshedHost = await readRoomSummary(request, room.roomCode, host);

  expect(joined.status).toBe("waiting");
  expect(joined.code).toBe(room.roomCode);
  expectCleanLobbyArtifacts(joined, true);
  expectCleanLobbyArtifacts(refreshedHost, true);
  expect(
    joined.players.filter(({ status }) => status !== "left").map(({ displayName }) => displayName),
  ).toEqual(["Gale", "Iris", "Juniper"]);
  expect(
    joined.players
      .filter(({ status }) => status !== "left")
      .every(({ isLobbyReady }) => !isLobbyReady),
  ).toBe(true);
});

test("a completed-Game participant can leave and rejoin without detaching their result", async ({
  request,
}) => {
  const room = await createRoomWithStartedGame(request, ["Kite", "Linden", "Maple"]);
  const returningPlayer = requirePlayer(room.players, 1);
  const ended = await finishThreePlayerGame(request, room.roomCode, room.players);
  const completedGameId = ended.game?.gameId;

  expect(completedGameId).toBeTruthy();

  await apiFetch(request, `/api/rooms/${room.roomCode}/leave`, {
    method: "POST",
    token: returningPlayer.token,
  });

  const rejoined = await joinWaitingRoom(request, room.roomCode, returningPlayer);

  expect(rejoined.status).toBe("ended");
  expect(rejoined.game?.gameId).toBe(completedGameId);
  expect(rejoined.self?.roleId).not.toBeNull();
  expect(rejoined.self?.result).not.toBeNull();
  expect(
    rejoined.players
      .filter(({ status }) => status !== "left")
      .every(({ isLobbyReady }) => !isLobbyReady),
  ).toBe(true);
});

function expectCleanLobbyArtifacts(summary: RoomSummary, isMember: boolean): void {
  expect(summary.game).toBeNull();
  expect(summary.rolePrivate).toBeNull();
  expect(summary.players.every(({ alive }) => alive === null)).toBe(true);
  expect(summary.players.every(({ revealedRoleId }) => revealedRoleId === null)).toBe(true);

  if (!isMember) {
    expect(summary.self).toBeNull();
    return;
  }

  expect(summary.self).toMatchObject({
    actionReceipts: [],
    actions: [],
    events: [],
    result: null,
    roleId: null,
  });
}
