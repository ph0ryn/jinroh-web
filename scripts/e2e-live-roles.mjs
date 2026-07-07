import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const DEFAULT_MANAGED_URL = `http://localhost:${process.env.E2E_PORT ?? "3014"}`;
const IDENTITY_STORAGE_KEY = "jinrohWeb.identityToken";
const PLAYER_NAMES = ["Sora", "Ren", "Mika", "Yui", "Haru", "Nao", "Iro", "Kai"];
const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ?? join(tmpdir(), `jinroh-web-role-e2e-${Date.now()}`);

let cleanupManagedServer = async () => {};

async function main() {
  const baseUrl = await resolveBaseUrl();
  const supabase = await createServiceClient();
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const result = await runRoleCoverage(baseUrl, supabase);

  console.log(
    JSON.stringify(
      {
        ...result,
        baseUrl,
        screenshotDir: SCREENSHOT_DIR,
      },
      null,
      2,
    ),
  );
}

async function resolveBaseUrl() {
  if (process.env.E2E_BASE_URL !== undefined) {
    return trimTrailingSlash(process.env.E2E_BASE_URL);
  }

  const managedServer = spawn(
    "pnpm",
    ["exec", "next", "start", "--hostname", "localhost", "--port", process.env.E2E_PORT ?? "3014"],
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

async function createServiceClient() {
  const env = await loadE2EEnv();

  if (env.SUPABASE_URL === undefined || env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in process.env, .env.local, or .env for role E2E.",
    );
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function runRoleCoverage(baseUrl, supabase) {
  const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
  const errors = [];
  const warnings = [];

  try {
    const players = [];

    for (const [index, name] of PLAYER_NAMES.entries()) {
      players.push(
        await createPlayer(browser, baseUrl, `player${index + 1}`, name, errors, warnings),
      );
    }

    const host = players[0];

    await host.page.getByLabel("Players").selectOption(String(players.length));
    await clickAndWaitForMetric(host.page, "Create room", "Code");
    const roomCode = await readMetric(host.page, "Code");

    if (!/^\d{6}$/.test(roomCode ?? "")) {
      throw new Error(`Expected six-digit room code, got ${roomCode ?? "null"}.`);
    }

    for (const player of players.slice(1)) {
      await player.page.getByLabel("Room code").fill(roomCode);
      await player.page.getByRole("button", { name: "Join" }).click();
      await waitMetric(player.page, "Code", roomCode);
    }

    await refresh(host.page);
    await waitSeated(host.page, players.length, players.length);
    await host.page.getByRole("button", { name: "Start game" }).click();
    await waitPhase(host.page, "night");
    await refreshAll(players.slice(1));
    await waitAllPhases(players, "night");

    const firstNightSummaries = await readSummaries(players, baseUrl, roomCode);
    const roleOwners = indexRoleOwners(firstNightSummaries);
    const requiredRoles = ["werewolf", "seer", "guard", "fox"];

    for (const roleId of requiredRoles) {
      if (!roleOwners.has(roleId)) {
        throw new Error(`Expected role ${roleId} in eight-player default setup.`);
      }
    }

    assertRolePrivateBoundary(firstNightSummaries);
    assertNightConversationAvailable(firstNightSummaries);

    const executionTarget = findPlayerByRole(firstNightSummaries, "villager");
    const foxTarget = findPlayerByRole(firstNightSummaries, "fox");

    await submitActionsFromSummaries(firstNightSummaries, {});
    await advance(host);
    await waitPhase(host.page, "day");
    await refreshAll(players.slice(1));
    await waitAllPhases(players, "day");

    const daySummaries = await readSummaries(players, baseUrl, roomCode);
    await submitActionsFromSummaries(daySummaries, {});
    await advance(host);
    await waitPhase(host.page, "voting");
    await refreshAll(players.slice(1));
    await waitAllPhases(players, "voting");

    const votingSummaries = await readSummaries(players, baseUrl, roomCode);
    await submitActionsFromSummaries(votingSummaries, {
      vote: executionTarget.summary.self.playerId,
    });
    await advance(host);
    await waitPhase(host.page, "execution");
    await refreshAll(players.slice(1));
    await waitAllPhases(players, "execution");

    const executionSummaries = await readSummaries(players, baseUrl, roomCode);
    await submitActionsFromSummaries(executionSummaries, {});
    await advance(host);
    await waitPhase(host.page, "night");
    await refreshAll(players.slice(1));
    await waitAllPhases(players, "night");

    const normalNightSummaries = await readSummaries(players, baseUrl, roomCode);
    const normalNightKinds = new Set(
      normalNightSummaries.flatMap(
        ({ summary }) => summary.self?.actions.map((action) => action.kind) ?? [],
      ),
    );

    for (const actionKind of ["attack", "guard", "inspect"]) {
      if (!normalNightKinds.has(actionKind)) {
        throw new Error(`Expected normal night action ${actionKind}.`);
      }
    }

    const attackAction = findOpenAction(normalNightSummaries, "attack");
    const guardAction = findOpenAction(normalNightSummaries, "guard");
    const inspectAction = findOpenAction(normalNightSummaries, "inspect");
    const protectedAttackTargetId = attackAction.action.eligibleTargetIds.find((playerId) =>
      guardAction.action.eligibleTargetIds.includes(playerId),
    );

    if (protectedAttackTargetId === undefined) {
      throw new Error(
        "Expected at least one normal night target eligible for both attack and guard.",
      );
    }

    if (!inspectAction.action.eligibleTargetIds.includes(foxTarget.summary.self.playerId)) {
      throw new Error("Expected fox to be eligible for inspection on normal night.");
    }

    const nightConversationBody = await exerciseNightConversation(
      players,
      baseUrl,
      roomCode,
      normalNightSummaries,
    );

    await submitActionsFromSummaries(normalNightSummaries, {
      attack: protectedAttackTargetId,
      guard: protectedAttackTargetId,
      inspect: foxTarget.summary.self.playerId,
    });
    await fastForwardCurrentPhase(supabase, roomCode);
    await advance(host);
    await waitPhase(host.page, "day");
    await refreshAll(players.slice(1));
    await waitAllPhases(players, "day");

    const resolvedSummaries = await readSummaries(players, baseUrl, roomCode);
    assertNightConversationReadOnly(resolvedSummaries, nightConversationBody);

    const seer = roleOwners.get("seer")[0];
    const seerSummary = resolvedSummaries.find((entry) => entry.player === seer)?.summary;
    const hostSummary = resolvedSummaries.find((entry) => entry.player === host)?.summary;

    if (seerSummary === undefined || hostSummary === undefined) {
      throw new Error("Expected seer and host summaries after normal night.");
    }

    const seerPrivateKinds = seerSummary.self?.events.map((event) => event.kind) ?? [];
    const publicKinds = hostSummary.game?.events.map((event) => event.kind) ?? [];

    if (!seerPrivateKinds.includes("inspection_result")) {
      throw new Error("Expected seer private inspection result after normal night.");
    }

    if (publicKinds.includes("inspection_result")) {
      throw new Error("Public events leaked inspection_result.");
    }

    const screenshot = join(SCREENSHOT_DIR, "roles-day-after-normal-night.png");
    await host.page.screenshot({ fullPage: false, path: screenshot });

    if (errors.length > 0) {
      throw new Error(`Browser console errors detected: ${errors.join("\n")}`);
    }

    return {
      ok: true,
      publicKinds,
      roleOwners: Object.fromEntries(
        [...roleOwners.entries()].map(([roleId, owners]) => [
          roleId,
          owners.map((player) => player.label),
        ]),
      ),
      roomCode,
      screenshot,
      seerPrivateKinds,
      warnings,
    };
  } finally {
    await browser.close();
  }
}

async function createPlayer(browser, baseUrl, label, displayName, errors, warnings) {
  const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
  const page = await context.newPage();

  page.on("console", (message) => {
    const entry = `${label}: ${message.type()} ${message.text()}`;

    if (message.type() === "error") {
      errors.push(entry);
    }

    if (message.type() === "warning" || message.type() === "warn") {
      warnings.push(entry);
    }
  });
  page.on("pageerror", (error) => errors.push(`${label}: pageerror ${error.message}`));

  await page.goto(`${baseUrl}/live`, { waitUntil: "networkidle" });
  await page.getByLabel("Display name").fill(displayName);

  return { context, label, page };
}

async function readSummaries(players, baseUrl, roomCode) {
  return Promise.all(
    players.map(async (player) => {
      const token = await readIdentityToken(player);

      const response = await fetch(`${baseUrl}/api/rooms/${roomCode}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`${player.label} summary failed: ${response.status}`);
      }

      return { player, summary: await response.json() };
    }),
  );
}

function indexRoleOwners(entries) {
  const roleOwners = new Map();

  for (const { player, summary } of entries) {
    const roleId = summary.self?.roleId;

    if (typeof roleId !== "string") {
      throw new Error(`${player.label} has no self role.`);
    }

    const owners = roleOwners.get(roleId) ?? [];

    owners.push(player);
    roleOwners.set(roleId, owners);
  }

  return roleOwners;
}

function findPlayerByRole(entries, roleId) {
  const entry = entries.find(({ summary }) => summary.self?.roleId === roleId);

  if (entry === undefined) {
    throw new Error(`No player found for role ${roleId}; summaries=${entries.length}`);
  }

  return entry;
}

function findOpenAction(entries, actionKind) {
  for (const entry of entries) {
    const action = entry.summary.self?.actions.find(
      (candidate) => candidate.kind === actionKind && candidate.status === "open",
    );

    if (action !== undefined) {
      return { ...entry, action };
    }
  }

  throw new Error(`No open action found for ${actionKind}.`);
}

function findEntriesByRole(entries, roleId) {
  return entries.filter(({ summary }) => summary.self?.roleId === roleId);
}

function assertRolePrivateBoundary(entries) {
  for (const { player, summary } of entries) {
    const roleId = summary.self?.roleId;

    if (roleId === "werewolf") {
      if (summary.rolePrivate?.roleId !== "werewolf") {
        throw new Error(`${player.label} should have werewolf role private view.`);
      }

      continue;
    }

    if (summary.rolePrivate !== null) {
      throw new Error(`${player.label} leaked role private view for ${roleId}.`);
    }
  }
}

function assertNightConversationAvailable(entries) {
  const werewolfEntries = findEntriesByRole(entries, "werewolf");

  if (werewolfEntries.length === 0) {
    throw new Error("Expected at least one werewolf night conversation participant.");
  }

  for (const { player, summary } of werewolfEntries) {
    const conversation = summary.rolePrivate?.nightConversation;

    if (conversation === undefined || conversation === null) {
      throw new Error(`${player.label} should have night conversation view.`);
    }

    if (conversation.groupId !== "werewolf") {
      throw new Error(`${player.label} saw unexpected night conversation group.`);
    }

    if (conversation.readOnly || !conversation.canSend) {
      throw new Error(`${player.label} night conversation should be writable during night.`);
    }
  }

  assertNoPublicNightConversationLeak(entries);
}

async function exerciseNightConversation(players, baseUrl, roomCode, normalNightSummaries) {
  assertRolePrivateBoundary(normalNightSummaries);

  const werewolfEntries = findEntriesByRole(normalNightSummaries, "werewolf");

  if (werewolfEntries.length < 2) {
    throw new Error("Expected at least two werewolves for night conversation coverage.");
  }

  const senderEntry = werewolfEntries[0];
  const partnerEntry = werewolfEntries[1];
  const conversation = senderEntry.summary.rolePrivate?.nightConversation;

  if (conversation === undefined || conversation === null || !conversation.canSend) {
    throw new Error(`${senderEntry.player.label} should be able to send night conversation.`);
  }

  const body = "wait for guard claim";

  await sendNightConversationViaUi(senderEntry, body);
  await refreshAll(players);

  const submittedSummaries = await readSummaries(players, baseUrl, roomCode);
  const submittedSender = findSummaryForPlayer(submittedSummaries, senderEntry.player);
  const submittedPartner = findSummaryForPlayer(submittedSummaries, partnerEntry.player);

  assertNightConversationMessage(
    submittedSender.summary,
    body,
    submittedSender.summary.self?.playerId,
  );
  assertNightConversationMessage(
    submittedPartner.summary,
    body,
    submittedSender.summary.self?.playerId,
  );

  assertNoPublicNightConversationLeak(submittedSummaries);

  const madmanEntry =
    findEntriesByRole(submittedSummaries, "madman")[0] ??
    submittedSummaries.find(({ summary }) => summary.self?.roleId !== "werewolf");

  if (madmanEntry === undefined) {
    throw new Error("Expected non-werewolf player for night conversation rejection coverage.");
  }

  await expectNightConversationRejected(
    baseUrl,
    roomCode,
    madmanEntry.player,
    madmanEntry.summary,
    conversation,
    "madman should fail",
  );

  return body;
}

async function sendNightConversationViaUi(entry, body) {
  if ((await entry.player.page.locator(".liveNightChatPanel").count()) === 0) {
    await entry.player.page.getByRole("button", { name: "Show night chat" }).click();
  }

  const input = entry.player.page.locator(".liveNightChatComposer input");

  await input.fill(body);
  await entry.player.page.getByRole("button", { name: "Send" }).click();
  await entry.player.page.waitForFunction(
    (body) => document.querySelector(".liveNightChatMessages")?.textContent.includes(body),
    body,
    { timeout: 10000 },
  );
}

function findSummaryForPlayer(entries, player) {
  const entry = entries.find((candidate) => candidate.player === player);

  if (entry === undefined) {
    throw new Error(`No summary found for ${player.label}.`);
  }

  return entry;
}

function assertNightConversationMessage(summary, body, senderPlayerId) {
  const messages = summary.rolePrivate?.nightConversation?.messages ?? [];
  const message = messages.find((candidate) => candidate.body === body);

  if (message === undefined) {
    throw new Error(`Night conversation message was not visible to ${summary.self?.roleId}.`);
  }

  if (senderPlayerId !== undefined && message.senderPlayerId !== senderPlayerId) {
    throw new Error("Night conversation sender public player ID did not match.");
  }

  if (message.senderName.length === 0 || message.createdAt.length === 0) {
    throw new Error("Night conversation message did not include sender and timestamp.");
  }
}

async function expectNightConversationRejected(
  baseUrl,
  roomCode,
  player,
  summary,
  conversation,
  body,
) {
  const token = await readIdentityToken(player);
  const response = await fetch(`${baseUrl}/api/rooms/${roomCode}/night-conversation`, {
    body: JSON.stringify({
      body,
      conversationGroupId: conversation.groupId,
      nightNumber: conversation.nightNumber,
      phaseInstanceId: summary.game?.phaseInstanceId,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (response.ok) {
    throw new Error("Expected night conversation message to be rejected.");
  }
}

function assertNoPublicNightConversationLeak(entries) {
  for (const { player, summary } of entries) {
    const publicGameJson = JSON.stringify(summary.game ?? {});

    if (publicGameJson.includes("wait for guard claim")) {
      throw new Error(`${player.label} public view leaked night conversation body.`);
    }

    if (summary.self?.roleId !== "werewolf" && summary.rolePrivate !== null) {
      throw new Error(`${player.label} leaked night conversation private view.`);
    }
  }
}

function assertNightConversationReadOnly(entries, body) {
  for (const { player, summary } of entries) {
    const conversation = summary.rolePrivate?.nightConversation ?? null;

    if (summary.self?.roleId !== "werewolf") {
      if (conversation !== null) {
        throw new Error(`${player.label} leaked read-only night conversation.`);
      }

      continue;
    }

    if (conversation === null) {
      throw new Error(`${player.label} should retain night conversation after night.`);
    }

    if (!conversation.readOnly || conversation.canSend) {
      throw new Error(`${player.label} night conversation should be read-only outside night.`);
    }

    assertNightConversationMessage(summary, body, undefined);
  }
}

async function submitActionsFromSummaries(entries, targetByActionKind) {
  const submittedActionKeys = new Set();

  for (const { player, summary } of entries) {
    for (const action of summary.self?.actions ?? []) {
      if (action.status !== "open") {
        continue;
      }

      if (submittedActionKeys.has(action.key)) {
        continue;
      }

      const targetId = targetByActionKind[action.kind];
      const row = player.page.locator(".liveActionRow").filter({ hasText: action.label });

      if (action.targetKind === "single_player" && targetId !== undefined) {
        await row.locator("select").selectOption(targetId);
      }

      await row.getByRole("button").click();
      await waitSubmittedAction(player, action.label);
      submittedActionKeys.add(action.key);
    }
  }
}

async function readIdentityToken(player) {
  const token = await player.page.evaluate(
    (key) => window.localStorage.getItem(key),
    IDENTITY_STORAGE_KEY,
  );

  if (token === null) {
    throw new Error(`${player.label} has no identity token in localStorage.`);
  }

  return token;
}

async function waitSubmittedAction(player, label) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await player.page.waitForFunction(
        (label) => {
          return [...document.querySelectorAll(".liveActionRow")].some((candidate) => {
            return (
              candidate.textContent.includes(label) && candidate.classList.contains("submitted")
            );
          });
        },
        label,
        { timeout: 10000 },
      );

      return;
    } catch {
      await refresh(player.page);
    }
  }

  throw new Error(`${player.label} action did not become submitted: ${label}`);
}

async function fastForwardCurrentPhase(supabase, roomCode) {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("public_room_code", roomCode)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (roomError !== null) {
    throw new Error(roomError.message);
  }

  const { error } = await supabase
    .from("game_states")
    .update({ phase_ends_at: new Date(Date.now() - 1000).toISOString() })
    .eq("room_id", room.id);

  if (error !== null) {
    throw new Error(error.message);
  }
}

async function clickAndWaitForMetric(page, buttonName, metricLabel) {
  await page.getByRole("button", { name: buttonName }).click();
  await page.waitForFunction(
    (label) => {
      const textOf = (element) => (element === null ? null : element.textContent.trim());

      if (
        label === "Code" &&
        document.querySelector('[aria-label="Room invite tools"] strong') !== null
      ) {
        return true;
      }

      return [...document.querySelectorAll(".liveMetrics div")].some(
        (row) => textOf(row.querySelector("dt")) === label,
      );
    },
    metricLabel,
    { timeout: 10000 },
  );
}

async function readMetric(page, label) {
  return page.evaluate((metricLabel) => {
    const textOf = (element) => (element === null ? null : element.textContent.trim());

    if (metricLabel === "Code") {
      const inviteCode = textOf(document.querySelector('[aria-label="Room invite tools"] strong'));

      if (inviteCode !== null) {
        return inviteCode;
      }
    }

    for (const row of document.querySelectorAll(".liveMetrics div")) {
      if (textOf(row.querySelector("dt")) === metricLabel) {
        return textOf(row.querySelector("dd"));
      }
    }

    return null;
  }, label);
}

async function waitSeated(page, seated, target) {
  await page.getByText(`${seated} / ${target} seated`).first().waitFor({ timeout: 10000 });
}

async function waitMetric(page, label, expected) {
  await page.waitForFunction(
    ({ expected, label }) => {
      const textOf = (element) => (element === null ? null : element.textContent.trim());

      if (label === "Code") {
        return (
          textOf(document.querySelector('[aria-label="Room invite tools"] strong')) === expected
        );
      }

      for (const row of document.querySelectorAll(".liveMetrics div")) {
        if (
          textOf(row.querySelector("dt")) === label &&
          textOf(row.querySelector("dd")) === expected
        ) {
          return true;
        }
      }

      return false;
    },
    { expected, label },
    { timeout: 10000 },
  );
}

async function waitPhase(page, phase) {
  await waitMetric(page, "Phase", phase);
}

async function waitAllPhases(players, phase) {
  for (const player of players) {
    await waitPhase(player.page, phase);
  }
}

async function refresh(page) {
  await page.getByRole("button", { name: "Refresh" }).click();
  await page
    .waitForFunction(
      () => !document.body.textContent.includes("Updating the room from the server."),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
}

async function refreshAll(players) {
  for (const player of players) {
    await refresh(player.page);
  }
}

async function advance(host) {
  await host.page.getByRole("button", { name: "Advance phase" }).click();
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

async function stopManagedServer(managedServer) {
  if (managedServer.exitCode !== null) {
    return;
  }

  if (managedServer.pid === undefined) {
    managedServer.kill();

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

async function loadE2EEnv() {
  const env = { ...process.env };
  const shellEnvKeys = new Set(Object.keys(process.env));

  for (const fileName of [".env", ".env.local"]) {
    const envText = await readFile(fileName, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return "";
      }

      throw error;
    });

    for (const line of envText.split(/\n/)) {
      const trimmedLine = line.trim();

      if (trimmedLine === "" || trimmedLine.startsWith("#")) {
        continue;
      }

      const match = trimmedLine.match(/^(?:export\s+)?(?<key>[A-Z0-9_]+)=(?<value>.*)$/);

      if (match?.groups === undefined || shellEnvKeys.has(match.groups.key)) {
        continue;
      }

      env[match.groups.key] = unquoteEnvValue(match.groups.value.trim());
    }
  }

  return env;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

try {
  await main();
} finally {
  await cleanupManagedServer();
}
