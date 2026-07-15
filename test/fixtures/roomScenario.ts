import { DEFAULT_RULE_SET_OPTIONS } from "@/lib/shared/game";

import {
  apiFetch,
  createApiPlayer,
  joinWaitingRoom,
  readRoomSummary,
  setRoomPlayersReady,
} from "./apiClient";

import type { ApiPlayer } from "./apiClient";
import type { PublicAction, RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

export async function createWaitingRoom(
  request: APIRequestContext,
  displayNames: readonly string[],
  targetPlayerCount = displayNames.length,
): Promise<{ readonly players: readonly ApiPlayer[]; readonly roomCode: string }> {
  const players = await Promise.all(
    displayNames.map((displayName, index) =>
      createApiPlayer(request, `player${index + 1}`, displayName),
    ),
  );
  const host = requirePlayer(players, 0);
  const room = await apiFetch<{ code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount },
    method: "POST",
    token: host.token,
  });

  for (const player of players.slice(1)) {
    await joinWaitingRoom(request, room.code, player);
  }

  return { players, roomCode: room.code };
}

export async function createRoomWithStartedGame(
  request: APIRequestContext,
  displayNames: readonly string[],
  options: { readonly voteResultVisibility?: "count_only" | "voter_to_target" } = {},
): Promise<{ readonly players: readonly ApiPlayer[]; readonly roomCode: string }> {
  const waitingRoom = await createWaitingRoom(request, displayNames);
  const host = requirePlayer(waitingRoom.players, 0);
  await setRoomPlayersReady(request, waitingRoom.roomCode, waitingRoom.players);
  const waitingSummary = await readRoomSummary(request, waitingRoom.roomCode, host);
  const ruleSet =
    options.voteResultVisibility === undefined
      ? undefined
      : {
          ...DEFAULT_RULE_SET_OPTIONS,
          roleCounts: waitingSummary.defaultRoleCounts,
          voteResultVisibility: options.voteResultVisibility,
        };

  await apiFetch(request, `/api/rooms/${waitingRoom.roomCode}/start`, {
    body:
      ruleSet === undefined
        ? { expectedRosterRevision: waitingSummary.rosterRevision }
        : { expectedRosterRevision: waitingSummary.rosterRevision, ruleSet },
    method: "POST",
    token: host.token,
  });

  return waitingRoom;
}

export async function sendNightConversationMessage(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
  body: string,
): Promise<void> {
  const summary = await readRoomSummary(request, roomCode, player);
  const conversation = summary.rolePrivate?.nightConversation;
  const phaseInstanceId = summary.game?.phaseInstanceId;
  const gameId = summary.game?.gameId;

  if (
    conversation === null ||
    conversation === undefined ||
    phaseInstanceId === null ||
    phaseInstanceId === undefined ||
    gameId === undefined
  ) {
    throw new Error(`Night conversation is not available for ${player.label}.`);
  }

  await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/night-conversation`, {
    body: {
      body,
      conversationGroupId: conversation.groupId,
      gameId,
      nightNumber: conversation.nightNumber,
      phaseInstanceId,
    },
    method: "POST",
    token: player.token,
  });
}

export async function submitOpenActions(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
  selectTarget: (action: PublicAction) => string | null = () => null,
): Promise<void> {
  for (const player of players) {
    await submitOpenAction(request, roomCode, player, selectTarget);
  }
}

export async function submitOpenAction(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
  selectTarget: (action: PublicAction) => string | null = () => null,
): Promise<void> {
  const summary = await readRoomSummary(request, roomCode, player);
  const action = requireOpenAction(summary);
  const revision = summary.game?.revision;
  const gameId = summary.game?.gameId;

  if (revision === undefined || gameId === undefined) {
    throw new Error(`Game revision is not available for ${player.label}.`);
  }

  await apiFetch(request, `/api/rooms/${roomCode}/action`, {
    body: {
      actionKey: action.key,
      gameId,
      phaseInstanceId: action.phaseInstanceId,
      revision,
      targetPlayerId: selectTarget(action),
    },
    method: "POST",
    token: player.token,
  });
}

export function requireOpenAction(summary: RoomSummary, kind?: PublicAction["kind"]): PublicAction {
  const action = summary.self?.actions.find(
    (candidate) => candidate.status === "open" && (kind === undefined || candidate.kind === kind),
  );

  if (action === undefined) {
    throw new Error(`No open ${kind ?? "game"} action is available.`);
  }

  return action;
}

export function requirePlayer<Players extends readonly unknown[]>(
  players: Players,
  index: number,
): Players[number] {
  const player = players[index];

  if (player === undefined) {
    throw new Error(`Player ${index} was not created.`);
  }

  return player;
}
