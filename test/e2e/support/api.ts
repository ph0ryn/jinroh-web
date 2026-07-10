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

export async function createStartedRoom(
  request: APIRequestContext,
  displayNames: readonly string[],
): Promise<{ readonly players: readonly ApiPlayer[]; readonly roomCode: string }> {
  const players = await Promise.all(
    displayNames.map((displayName, index) =>
      createApiPlayer(request, `player${index + 1}`, displayName),
    ),
  );
  const host = players[0];

  if (host === undefined) {
    throw new Error("At least one player is required.");
  }

  const room = await apiFetch<{ code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: players.length },
    method: "POST",
    token: host.token,
  });

  for (const player of players.slice(1)) {
    await apiFetch(request, `/api/rooms/${room.code}/join`, {
      body: { displayName: player.displayName },
      method: "POST",
      token: player.token,
    });
  }

  await apiFetch(request, `/api/rooms/${room.code}/start`, {
    body: {},
    method: "POST",
    token: host.token,
  });

  return { players, roomCode: room.code };
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
