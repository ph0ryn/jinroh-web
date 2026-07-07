import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_MANAGED_URL = `http://localhost:${process.env.E2E_PORT ?? "3016"}`;
const NIGHT_MESSAGE = "security secret signal";
const PLAYER_NAMES = ["Sora", "Ren", "Mika", "Yui", "Haru", "Nao", "Iro", "Kai"];
const ROLE_IDS = ["fox", "guard", "madman", "seer", "villager", "werewolf"];

let cleanupManagedServer = async () => {};

async function main() {
  const baseUrl = await resolveBaseUrl();
  const result = await runSecurityCoverage(baseUrl);

  console.log(JSON.stringify({ ...result, baseUrl }, null, 2));
}

async function resolveBaseUrl() {
  if (process.env.E2E_BASE_URL !== undefined) {
    return trimTrailingSlash(process.env.E2E_BASE_URL);
  }

  const managedServer = spawn(
    "pnpm",
    ["exec", "next", "start", "--hostname", "localhost", "--port", process.env.E2E_PORT ?? "3016"],
    {
      detached: true,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];

  cleanupManagedServer = () => stopManagedServer(managedServer);
  managedServer.stdout?.on("data", (chunk) => output.push(String(chunk)));
  managedServer.stderr?.on("data", (chunk) => output.push(String(chunk)));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isReachable(DEFAULT_MANAGED_URL)) {
      return DEFAULT_MANAGED_URL;
    }

    if (managedServer.exitCode !== null) {
      throw new Error(`Next start server exited early.\n${output.join("")}`);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for Next start server.\n${output.join("")}`);
}

async function isReachable(baseUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${baseUrl}/live`, { signal: controller.signal });

    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

async function runSecurityCoverage(baseUrl) {
  const players = [];

  for (const [index, displayName] of PLAYER_NAMES.entries()) {
    players.push(await createPlayer(baseUrl, `player${index + 1}`, displayName));
  }

  const host = players[0];
  const roomSummary = await apiFetch(baseUrl, "/api/rooms", {
    body: { displayName: host.displayName },
    method: "POST",
    token: host.token,
  });
  const roomCode = roomSummary.code;

  if (!/^\d{6}$/.test(roomCode)) {
    throw new Error(`Expected six-digit room code, got ${roomCode}.`);
  }

  for (const player of players.slice(1)) {
    await apiFetch(baseUrl, `/api/rooms/${roomCode}/join`, {
      body: { displayName: player.displayName },
      method: "POST",
      token: player.token,
    });
  }

  await apiFetch(baseUrl, `/api/rooms/${roomCode}/start`, {
    body: {},
    method: "POST",
    token: host.token,
  });

  const firstNightEntries = await readSummaries(baseUrl, players, roomCode);
  const roleOwners = indexRoleOwners(firstNightEntries);

  assertRequiredRoles(roleOwners);
  assertNoForbiddenKeys(firstNightEntries);
  assertNoPublicSecretFields(firstNightEntries);
  assertRealtimeSubscriptions(firstNightEntries, roomCode);
  assertRolePrivateBoundary(firstNightEntries);
  await assertStaleRevisionRejected(baseUrl, roomCode, firstNightEntries);

  const messageResult = await exerciseNightConversation(baseUrl, roomCode, firstNightEntries);
  const afterMessageEntries = await readSummaries(baseUrl, players, roomCode);

  assertNightConversationMessageBoundary(afterMessageEntries, messageResult);

  return {
    checks: [
      "forbidden-keys",
      "public-secret-fields",
      "scoped-realtime-subscriptions",
      "role-private-boundary",
      "stale-action-revision",
      "night-conversation-boundary",
    ],
    ok: true,
    roleOwners: Object.fromEntries(
      [...roleOwners.entries()].map(([roleId, owners]) => [
        roleId,
        owners.map((entry) => entry.player.label),
      ]),
    ),
    roomCode,
  };
}

async function createPlayer(baseUrl, label, displayName) {
  const identity = await apiFetch(baseUrl, "/api/identity", { method: "POST" });

  if (typeof identity.token !== "string") {
    throw new Error(`${label} identity did not include a token.`);
  }

  return { displayName, label, token: identity.token };
}

async function readSummaries(baseUrl, players, roomCode) {
  return Promise.all(
    players.map(async (player) => ({
      player,
      summary: await apiFetch(baseUrl, `/api/rooms/${roomCode}`, { token: player.token }),
    })),
  );
}

function indexRoleOwners(entries) {
  const roleOwners = new Map();

  for (const entry of entries) {
    const roleId = entry.summary.self?.roleId;

    if (typeof roleId !== "string") {
      throw new Error(`${entry.player.label} has no self role.`);
    }

    const owners = roleOwners.get(roleId) ?? [];

    owners.push(entry);
    roleOwners.set(roleId, owners);
  }

  return roleOwners;
}

function assertRequiredRoles(roleOwners) {
  for (const roleId of ["fox", "guard", "madman", "seer", "werewolf"]) {
    if (!roleOwners.has(roleId)) {
      throw new Error(`Expected ${roleId} in eight-player default setup.`);
    }
  }
}

function assertNoForbiddenKeys(entries) {
  for (const { player, summary } of entries) {
    const forbiddenPath = findForbiddenKeyPath(summary);

    if (forbiddenPath !== null) {
      throw new Error(`${player.label} response exposed forbidden key ${forbiddenPath}.`);
    }

    const responseJson = JSON.stringify(summary);

    if (responseJson.includes(player.token)) {
      throw new Error(`${player.label} response echoed the raw identity token.`);
    }
  }
}

function findForbiddenKeyPath(value, path = []) {
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

function assertNoPublicSecretFields(entries) {
  for (const { player, summary } of entries) {
    const publicJson = JSON.stringify({
      game: summary.game,
      players: summary.players,
      realtime: summary.realtime,
    });

    for (const roleId of ROLE_IDS) {
      if (publicJson.includes(`"roleId":"${roleId}"`) || publicJson.includes(`"roleName"`)) {
        throw new Error(`${player.label} public view leaked role fields.`);
      }
    }
  }
}

function assertRealtimeSubscriptions(entries, roomCode) {
  for (const { player, summary } of entries) {
    const subscriptions = summary.realtime?.subscriptions ?? [];
    const scopes = subscriptions.map((subscription) => subscription.scope).sort();

    for (const scope of ["player_private", "role_private", "room"]) {
      if (!scopes.includes(scope)) {
        throw new Error(`${player.label} missing realtime ${scope} subscription.`);
      }
    }

    for (const subscription of subscriptions) {
      if (
        typeof subscription.grantId !== "string" ||
        subscription.grantId === "" ||
        typeof subscription.expiresAt !== "string" ||
        subscription.expiresAt === ""
      ) {
        throw new Error(`${player.label} realtime subscription is missing grant metadata.`);
      }

      if (subscription.topic.includes(roomCode)) {
        throw new Error(`${player.label} realtime topic leaked the public room code.`);
      }
    }
  }
}

function assertRolePrivateBoundary(entries) {
  for (const { player, summary } of entries) {
    const roleId = summary.self?.roleId;

    if (roleId === "werewolf") {
      if (summary.rolePrivate?.roleId !== "werewolf") {
        throw new Error(`${player.label} should have werewolf role private view.`);
      }

      const conversation = summary.rolePrivate.nightConversation;

      if (conversation === null || conversation.groupId !== "werewolf") {
        throw new Error(`${player.label} should have werewolf night conversation.`);
      }

      if (conversation.readOnly || !conversation.canSend) {
        throw new Error(`${player.label} night conversation should be writable during night.`);
      }

      continue;
    }

    if (summary.rolePrivate !== null) {
      throw new Error(`${player.label} leaked role private view for ${roleId}.`);
    }
  }
}

async function assertStaleRevisionRejected(baseUrl, roomCode, entries) {
  const entry = entries.find(({ summary }) =>
    (summary.self?.actions ?? []).some((action) => action.status === "open"),
  );

  if (entry === undefined) {
    throw new Error("No open action found for stale revision check.");
  }

  const action = entry.summary.self.actions.find((candidate) => candidate.status === "open");
  const staleResponse = await apiFetch(baseUrl, `/api/rooms/${roomCode}/action`, {
    body: {
      actionKey: action.key,
      phaseInstanceId: action.phaseInstanceId,
      revision: entry.summary.game.revision + 1,
      targetPlayerId: null,
    },
    expectOk: false,
    method: "POST",
    token: entry.player.token,
  });

  if (staleResponse.status !== 409) {
    throw new Error(`Expected stale action revision to return 409, got ${staleResponse.status}.`);
  }
}

async function exerciseNightConversation(baseUrl, roomCode, entries) {
  const senderEntry = entries.find(({ summary }) => summary.self?.roleId === "werewolf");

  if (senderEntry === undefined) {
    throw new Error("No werewolf found for night conversation security check.");
  }

  const conversation = senderEntry.summary.rolePrivate?.nightConversation;

  if (conversation === undefined || conversation === null) {
    throw new Error("Werewolf sender has no night conversation.");
  }

  await apiFetch(baseUrl, `/api/rooms/${roomCode}/night-conversation`, {
    body: {
      body: NIGHT_MESSAGE,
      conversationGroupId: conversation.groupId,
      nightNumber: conversation.nightNumber,
      phaseInstanceId: senderEntry.summary.game.phaseInstanceId,
    },
    method: "POST",
    token: senderEntry.player.token,
  });

  return {
    body: NIGHT_MESSAGE,
    senderPlayerId: senderEntry.summary.self.playerId,
  };
}

function assertNightConversationMessageBoundary(entries, messageResult) {
  for (const { player, summary } of entries) {
    const responseJson = JSON.stringify(summary);
    const roleId = summary.self?.roleId;

    if (roleId !== "werewolf") {
      if (responseJson.includes(messageResult.body)) {
        throw new Error(`${player.label} leaked werewolf night conversation body.`);
      }

      continue;
    }

    const messages = summary.rolePrivate?.nightConversation?.messages ?? [];
    const message = messages.find((candidate) => candidate.body === messageResult.body);

    if (message === undefined) {
      throw new Error(`${player.label} did not receive werewolf night conversation body.`);
    }

    if (
      message.senderPlayerId !== messageResult.senderPlayerId ||
      typeof message.senderName !== "string" ||
      message.senderName === "" ||
      typeof message.createdAt !== "string" ||
      message.createdAt === ""
    ) {
      throw new Error(`${player.label} night conversation message metadata is invalid.`);
    }
  }
}

async function apiFetch(baseUrl, path, options = {}) {
  const headers = new Headers();

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (options.token !== undefined) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET",
  });
  const json = await response.json().catch(() => null);

  if ((options.expectOk ?? true) && !response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }

  if (options.expectOk === false) {
    return { body: json, status: response.status };
  }

  return json;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

async function stopManagedServer(managedServer) {
  if (managedServer.pid === undefined || managedServer.exitCode !== null) {
    return;
  }

  killProcessGroup(managedServer.pid, "SIGTERM");

  await Promise.race([
    once(managedServer, "exit"),
    delay(3000).then(() => {
      if (managedServer.exitCode === null && managedServer.pid !== undefined) {
        killProcessGroup(managedServer.pid, "SIGKILL");
      }
    }),
  ]);
}

function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

try {
  await main();
} finally {
  await cleanupManagedServer();
}
