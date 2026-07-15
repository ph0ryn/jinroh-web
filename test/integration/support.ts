import { DEFAULT_RULE_SET_OPTIONS } from "@/lib/shared/game";

import {
  apiFetch,
  readRoomSummary,
  setRoomPlayersReady,
  type ApiPlayer,
} from "../fixtures/apiClient";
import { createWaitingRoom, requireOpenAction, requirePlayer } from "../fixtures/roomScenario";

import type {
  CurrentRoomResponse,
  GamePhase,
  PublicAction,
  RoomSummary,
  RuleSetInput,
} from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

export type ApiErrorResponse = {
  readonly error: {
    readonly code: string;
  };
};

export type RoomEntry = {
  readonly player: ApiPlayer;
  readonly summary: RoomSummary;
};

export async function createRoomWithStartedGame(
  request: APIRequestContext,
  displayNames: readonly string[],
  overrides: Partial<RuleSetInput> = {},
): Promise<{ readonly players: readonly ApiPlayer[]; readonly roomCode: string }> {
  const waitingRoom = await createWaitingRoom(request, displayNames);

  await startGameInWaitingRoom(request, waitingRoom, overrides);

  return waitingRoom;
}

export async function startGameInWaitingRoom(
  request: APIRequestContext,
  room: { readonly players: readonly ApiPlayer[]; readonly roomCode: string },
  overrides: Partial<RuleSetInput> = {},
): Promise<RoomSummary> {
  const host = requirePlayer(room.players, 0);
  await setRoomPlayersReady(request, room.roomCode, room.players);
  const summary = await readRoomSummary(request, room.roomCode, host);
  const roleOptions = Object.fromEntries(
    summary.roleCatalog.flatMap((role) =>
      role.specificOptions.length === 0
        ? []
        : [
            [
              role.id,
              Object.fromEntries(
                role.specificOptions.map((option) => [option.key, option.defaultValue]),
              ),
            ],
          ],
    ),
  ) as RuleSetInput["roleOptions"];
  const ruleSet: RuleSetInput = {
    ...DEFAULT_RULE_SET_OPTIONS,
    dayReadyCheckSecondsPerPlayer: 30,
    executionLastWordsSeconds: 30,
    firstNightSeconds: 30,
    nightSeconds: 30,
    roleCounts: summary.defaultRoleCounts,
    roleOptions,
    votingSeconds: 30,
    ...overrides,
  };

  return apiFetch<RoomSummary>(request, `/api/rooms/${room.roomCode}/start`, {
    body: { expectedRosterRevision: summary.rosterRevision, ruleSet },
    method: "POST",
    token: host.token,
  });
}

export async function readRoomEntries(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
): Promise<readonly RoomEntry[]> {
  return Promise.all(
    players.map(async (player) => ({
      player,
      summary: await readRoomSummary(request, roomCode, player),
    })),
  );
}

export async function submitPhaseActions(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
  selectTarget: (entry: RoomEntry, action: PublicAction, index: number) => string | null,
  kind?: PublicAction["kind"],
): Promise<void> {
  for (const [index, player] of players.entries()) {
    const summary = await readRoomSummary(request, roomCode, player);
    const entry = { player, summary };
    const action = requireOpenAction(summary, kind);
    const revision = summary.game?.revision;
    const gameId = summary.game?.gameId;

    if (revision === undefined || gameId === undefined) {
      throw new Error(`Game revision is unavailable for player ${index}.`);
    }

    await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/action`, {
      body: {
        actionKey: action.key,
        gameId,
        phaseInstanceId: action.phaseInstanceId,
        revision,
        targetPlayerId: selectTarget(entry, action, index),
      },
      method: "POST",
      token: player.token,
    });
  }
}

export async function advanceToVoting(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
): Promise<readonly RoomEntry[]> {
  assertPhase(await readRoomSummary(request, roomCode, requirePlayer(players, 0)), "night", 1);
  await submitPhaseActions(request, roomCode, players, () => null);
  assertPhase(await readRoomSummary(request, roomCode, requirePlayer(players, 0)), "day", 1);
  await submitPhaseActions(request, roomCode, players, () => null);
  assertPhase(await readRoomSummary(request, roomCode, requirePlayer(players, 0)), "voting", 1);

  return readRoomEntries(request, roomCode, players);
}

export async function advanceToNormalNight(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
): Promise<readonly RoomEntry[]> {
  const votingEntries = await advanceToVoting(request, roomCode, players);
  const playerIds = votingEntries.map(({ summary }) => requireCurrentPlayerId(summary));

  await submitPhaseActions(
    request,
    roomCode,
    players,
    (_entry, action, index) => {
      const targetPlayerId = playerIds[(index + 1) % playerIds.length];

      if (targetPlayerId === undefined || !action.eligibleTargetIds.includes(targetPlayerId)) {
        throw new Error(`A cyclic vote target is unavailable for player ${index}.`);
      }

      return targetPlayerId;
    },
    "vote",
  );
  assertPhase(await readRoomSummary(request, roomCode, requirePlayer(players, 0)), "night", 2);

  return readRoomEntries(request, roomCode, players);
}

export async function finishThreePlayerGame(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
): Promise<RoomSummary> {
  const votingEntries = await advanceToVoting(request, roomCode, players);
  const candidateId = requireCurrentPlayerId(votingEntries[0]?.summary);

  await submitPhaseActions(
    request,
    roomCode,
    players,
    (_entry, action) =>
      action.eligibleTargetIds.includes(candidateId)
        ? candidateId
        : (action.eligibleTargetIds[0] ?? null),
    "vote",
  );

  for (const player of players) {
    const summary = await readRoomSummary(request, roomCode, player);
    const action = summary.self?.actions.find((candidate) => candidate.status === "open");

    if (action === undefined || summary.game === null) {
      continue;
    }

    await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/action`, {
      body: {
        actionKey: action.key,
        gameId: summary.game.gameId,
        phaseInstanceId: action.phaseInstanceId,
        revision: summary.game.revision,
        targetPlayerId: null,
      },
      method: "POST",
      token: player.token,
    });
    break;
  }

  return readRoomSummary(request, roomCode, requirePlayer(players, 0));
}

export async function readCurrentRoom(
  request: APIRequestContext,
  player: Pick<ApiPlayer, "token">,
): Promise<CurrentRoomResponse> {
  return apiFetch<CurrentRoomResponse>(request, "/api/rooms/current", { token: player.token });
}

export function requireCurrentPlayerId(summary: RoomSummary | undefined): string {
  if (summary?.currentPlayerId === null || summary?.currentPlayerId === undefined) {
    throw new Error("The current player ID is unavailable.");
  }

  return summary.currentPlayerId;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];

  if (payload === undefined) {
    throw new Error("The access token has no JWT payload.");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

export function findForbiddenKeyPath(
  value: unknown,
  forbiddenKeys: ReadonlySet<string>,
  path: readonly string[] = [],
): string | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const itemPath = findForbiddenKeyPath(item, forbiddenKeys, [...path, String(index)]);

      if (itemPath !== null) {
        return itemPath;
      }
    }

    return null;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      return [...path, key].join(".");
    }

    const childPath = findForbiddenKeyPath(childValue, forbiddenKeys, [...path, key]);

    if (childPath !== null) {
      return childPath;
    }
  }

  return null;
}

export async function withTimeout<Result>(
  promise: Promise<Result>,
  timeoutMilliseconds: number,
  operation: string,
): Promise<Result> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operation} exceeded ${timeoutMilliseconds}ms.`)),
      timeoutMilliseconds,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function assertPhase(summary: RoomSummary, phase: GamePhase, nightNumber: number): void {
  if (summary.game?.phase !== phase || summary.game.nightNumber !== nightNumber) {
    throw new Error(`Expected ${phase} in night ${nightNumber}.`);
  }
}
