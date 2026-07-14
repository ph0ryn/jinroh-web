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
  const response = await request.fetch(path, {
    data: options.body,
    headers: options.token === undefined ? undefined : { authorization: `Bearer ${options.token}` },
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
  const identity = await apiFetch<{ token: string }>(request, "/api/identity", { method: "POST" });

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

export async function readJsonResponse<Body>(
  request: APIRequestContext,
  path: string,
  options: ApiRequestOptions = {},
): Promise<{ readonly body: Body; readonly status: number }> {
  const response = await request.fetch(path, {
    data: options.body,
    headers: options.token === undefined ? undefined : { authorization: `Bearer ${options.token}` },
    method: options.method ?? "GET",
  });

  return { body: (await response.json()) as Body, status: response.status() };
}
