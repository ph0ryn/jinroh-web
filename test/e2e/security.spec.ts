import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, createStartedRoom, readJsonResponse } from "./support/api";
import { getPublicSupabaseEnvironment } from "./support/environment";

import type { RealtimeAuthorization, RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

const PLAYER_NAMES = ["Sora", "Ren", "Mika", "Yui", "Haru", "Nao", "Iro", "Kai"];

test("@security @roles private views, grants, and mutations stay scoped", async ({ request }) => {
  const { players, roomCode } = await createStartedRoom(request, PLAYER_NAMES);
  const entries = await Promise.all(
    players.map(async (player) => ({
      player,
      summary: await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}`, {
        token: player.token,
      }),
    })),
  );
  const roleOwners = new Map<string, (typeof entries)[number][]>();

  for (const entry of entries) {
    const roleId = entry.summary.self?.roleId;

    expect(roleId).not.toBeNull();
    roleOwners.set(roleId ?? "", [...(roleOwners.get(roleId ?? "") ?? []), entry]);
    expect(findForbiddenKeyPath(entry.summary)).toBeNull();
    expect(JSON.stringify(entry.summary)).not.toContain(entry.player.token);

    const publicJson = JSON.stringify({
      game: entry.summary.game,
      players: entry.summary.players,
    });

    expect(publicJson).not.toContain('"roleId"');
    expect(publicJson).not.toContain('"roleName"');

    const authorization = await apiFetch<RealtimeAuthorization>(
      request,
      `/api/rooms/${roomCode}/realtime-token`,
      { method: "POST", token: entry.player.token },
    );
    const scopes = authorization.subscriptions.map(({ scope }) => scope).toSorted();
    const claims = decodeJwtPayload(authorization.accessToken);

    expect(scopes).toEqual(["player_private", "role_private", "room"]);
    expect(authorization.subscriptions.every(({ topic }) => !topic.includes(roomCode))).toBe(true);
    expect(claims["role"]).toBe("authenticated");
    expect(claims["realtime_grant_id"]).toBe(claims["sub"]);
    expect(typeof claims["exp"]).toBe("number");
  }

  for (const requiredRole of ["guard", "madman", "seer", "werewolf"]) {
    expect(
      roleOwners.has(requiredRole),
      `default eight-player setup includes ${requiredRole}`,
    ).toBe(true);
  }

  for (const entry of entries) {
    if (entry.summary.self?.roleId === "werewolf") {
      expect(entry.summary.rolePrivate?.roleId).toBe("werewolf");
      expect(entry.summary.rolePrivate?.nightConversation?.canSend).toBe(true);
    } else {
      expect(entry.summary.rolePrivate).toBeNull();
    }
  }

  const openActionEntry = entries.find(({ summary }) =>
    summary.self?.actions.some(({ status }) => status === "open"),
  );

  expect(openActionEntry).toBeDefined();

  if (openActionEntry !== undefined) {
    const action = openActionEntry.summary.self?.actions.find(({ status }) => status === "open");
    const stale = await readJsonResponse(request, `/api/rooms/${roomCode}/action`, {
      body: {
        actionKey: action?.key,
        phaseInstanceId: action?.phaseInstanceId,
        revision: (openActionEntry.summary.game?.revision ?? 0) + 1,
        targetPlayerId: null,
      },
      method: "POST",
      token: openActionEntry.player.token,
    });

    expect(stale.status).toBe(409);
  }

  await assertNightConversationBoundary(request, roomCode, entries);
});

test("@security private Realtime rejects anon clients and delivers authorized broadcasts", async ({
  request,
}) => {
  const host = await createApiPlayer(request, "host", "Host");
  const room = await apiFetch<{ code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });
  const authorization = await apiFetch<RealtimeAuthorization>(
    request,
    `/api/rooms/${room.code}/realtime-token`,
    { method: "POST", token: host.token },
  );
  const roomTopic = authorization.subscriptions.find(({ scope }) => scope === "room")?.topic;

  expect(roomTopic).toBeDefined();

  if (roomTopic === undefined) {
    return;
  }

  const { anonKey, url } = await getPublicSupabaseEnvironment();
  const clientOptions = {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  } as const;
  const authorizedClient = createClient(url, anonKey, clientOptions);
  const anonymousClient = createClient(url, anonKey, clientOptions);

  await authorizedClient.realtime.setAuth(authorization.accessToken);

  const broadcast = new Promise<Record<string, unknown>>((resolve) => {
    authorizedClient
      .channel(roomTopic, { config: { private: true } })
      .on("broadcast", { event: "room_changed" }, ({ payload }) =>
        resolve(payload as Record<string, unknown>),
      );
  });
  const authorizedChannel = authorizedClient.getChannels()[0];

  if (authorizedChannel === undefined) {
    throw new Error("Authorized Realtime channel was not created.");
  }

  const anonymousChannel = anonymousClient.channel(roomTopic, { config: { private: true } });

  expect(await subscribeStatus(authorizedChannel)).toBe("SUBSCRIBED");
  expect(await subscribeStatus(anonymousChannel)).toBe("CHANNEL_ERROR");

  const guest = await createApiPlayer(request, "guest", "Guest");

  await apiFetch(request, `/api/rooms/${room.code}/join`, {
    body: { displayName: guest.displayName },
    method: "POST",
    token: guest.token,
  });

  await expect(broadcast).resolves.toMatchObject({
    reason: "player_joined",
    roomCode: room.code,
    scope: "room",
  });

  await Promise.all([
    authorizedClient.removeChannel(authorizedChannel),
    anonymousClient.removeChannel(anonymousChannel),
  ]);
});

test("@security maintenance cleanup requires its dedicated credential", async ({ request }) => {
  const missing = await request.post("/api/maintenance/expire-lobbies", { data: { limit: 1 } });
  const wrong = await request.post("/api/maintenance/expire-lobbies", {
    data: { limit: 1 },
    headers: { authorization: "Bearer wrong-maintenance-secret" },
  });

  expect(missing.status()).toBe(401);
  expect(wrong.status()).toBe(401);

  if (process.env["E2E_BASE_URL"] === undefined) {
    const authorized = await request.post("/api/maintenance/expire-lobbies", {
      data: { limit: 1 },
      headers: {
        authorization: "Bearer jinroh-e2e-maintenance-secret-32-bytes-minimum",
      },
    });

    expect(authorized.status()).toBe(200);
  }
});

async function assertNightConversationBoundary(
  request: APIRequestContext,
  roomCode: string,
  entries: readonly {
    readonly player: { readonly token: string };
    readonly summary: RoomSummary;
  }[],
): Promise<void> {
  const werewolf = entries.find(({ summary }) => summary.self?.roleId === "werewolf");
  const outsider = entries.find(({ summary }) => summary.self?.roleId !== "werewolf");
  const conversation = werewolf?.summary.rolePrivate?.nightConversation;

  expect(werewolf).toBeDefined();
  expect(outsider).toBeDefined();
  expect(conversation).not.toBeNull();

  if (
    werewolf === undefined ||
    outsider === undefined ||
    conversation === null ||
    conversation === undefined
  ) {
    return;
  }

  const messageBody = "private security signal";

  await apiFetch(request, `/api/rooms/${roomCode}/night-conversation`, {
    body: {
      body: messageBody,
      conversationGroupId: conversation.groupId,
      nightNumber: conversation.nightNumber,
      phaseInstanceId: werewolf.summary.game?.phaseInstanceId,
    },
    method: "POST",
    token: werewolf.player.token,
  });
  const rejected = await readJsonResponse(request, `/api/rooms/${roomCode}/night-conversation`, {
    body: {
      body: "outsider signal",
      conversationGroupId: conversation.groupId,
      nightNumber: conversation.nightNumber,
      phaseInstanceId: outsider.summary.game?.phaseInstanceId,
    },
    method: "POST",
    token: outsider.player.token,
  });

  expect(rejected.status).toBe(409);

  for (const entry of entries) {
    const refreshed = await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}`, {
      token: entry.player.token,
    });
    const visibleMessages = refreshed.rolePrivate?.nightConversation?.messages ?? [];

    if (refreshed.self?.roleId === "werewolf") {
      expect(visibleMessages.some(({ body }) => body === messageBody)).toBe(true);
    } else {
      expect(JSON.stringify(refreshed)).not.toContain(messageBody);
    }
  }
}

function subscribeStatus(channel: RealtimeChannel): Promise<string> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve("TEST_TIMEOUT"), 10_000);

    channel.subscribe((status) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        clearTimeout(timeoutId);
        resolve(status);
      }
    });
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];

  if (payload === undefined) {
    throw new Error("Realtime access token has no payload.");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function findForbiddenKeyPath(value: unknown, path: readonly string[] = []): string | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const itemPath = findForbiddenKeyPath(item, [...path, String(index)]);

      if (itemPath !== null) {
        return itemPath;
      }
    }

    return null;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (["accountId", "account_id", "token", "tokenHash", "token_hash"].includes(key)) {
      return [...path, key].join(".");
    }

    const childPath = findForbiddenKeyPath(childValue, [...path, key]);

    if (childPath !== null) {
      return childPath;
    }
  }

  return null;
}
