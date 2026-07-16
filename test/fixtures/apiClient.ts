import type { RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

export type ApiPlayer = {
  readonly displayName: string;
  readonly label: string;
  readonly token: string;
};

type ApiRequestOptions = {
  readonly body?: unknown;
  readonly method?: "GET" | "POST";
  readonly token?: string;
};

export async function apiFetch<Body>(
  request: APIRequestContext,
  path: string,
  options: ApiRequestOptions = {},
): Promise<Body> {
  const headers: Record<string, string> =
    options.token === undefined ? {} : { authorization: `Bearer ${options.token}` };
  const response = await request.fetch(path, {
    data: options.body,
    headers,
    method: options.method ?? "GET",
  });

  if (!response.ok()) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status()}): ${await response.text()}`,
    );
  }

  return (await response.json()) as Body;
}

export async function createApiPlayer(
  request: APIRequestContext,
  label: string,
  displayName: string,
): Promise<ApiPlayer> {
  const response = await request.post("/api/identity");

  if (!response.ok()) {
    throw new Error(`POST /api/identity failed (${response.status()}): ${await response.text()}`);
  }

  const identity = (await response.json()) as { token: string };

  return { displayName, label, token: identity.token };
}

export async function joinWaitingRoom(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/join`, {
    body: { displayName: player.displayName },
    method: "POST",
    token: player.token,
  });
}

export async function readRoomSummary(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}`, { token: player.token });
}

export async function setRoomReadiness(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
  isReady = true,
): Promise<RoomSummary> {
  const summary = await readRoomSummary(request, roomCode, player);

  return apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/readiness`, {
    body: {
      expectedRosterRevision: summary.rosterRevision,
      isReady,
    },
    method: "POST",
    token: player.token,
  });
}

export async function setRoomPlayersReady(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
): Promise<void> {
  await Promise.all(players.map((player) => setRoomReadiness(request, roomCode, player)));
}

export async function readJsonResponse<Body>(
  request: APIRequestContext,
  path: string,
  options: ApiRequestOptions = {},
): Promise<{ readonly body: Body; readonly status: number }> {
  const headers: Record<string, string> =
    options.token === undefined ? {} : { authorization: `Bearer ${options.token}` };
  const response = await request.fetch(path, {
    data: options.body,
    headers,
    method: options.method ?? "GET",
  });

  return { body: (await response.json()) as Body, status: response.status() };
}
