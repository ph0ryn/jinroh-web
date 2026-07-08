import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_MANAGED_URL = `http://localhost:${process.env.E2E_PORT ?? "3010"}`;
const IDENTITY_STORAGE_KEY = "jinrohWeb.identityToken";
const IS_ORDERED_SPEECH_E2E = process.env.E2E_RULESET === "ordered_speech";
const ROOM_CLOSED_STATUS_MESSAGE = "Room closed. Create or join a room.";
const MOOD_BACKGROUND_BY_NAME = {
  day: "jinroh-day-same-angle.jpg",
  execution: "jinroh-voting-same-angle.jpg",
  lobby: "jinroh-lobby-same-angle.jpg",
  night: "jinroh-night.jpg",
  result: "jinroh-result-same-angle.jpg",
  setup: "jinroh-lobby-same-angle.jpg",
  voting: "jinroh-voting-same-angle.jpg",
};
const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ?? join(tmpdir(), `jinroh-web-e2e-${Date.now()}`);
const EXECUTION_TIMEOUT_WAIT_MS = Number(process.env.E2E_EXECUTION_TIMEOUT_WAIT_MS ?? "61500");

let cleanupManagedServer = async () => {};

async function main() {
  const baseUrl = await resolveBaseUrl();
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const result = await runLiveSmoke(baseUrl);

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
    ["exec", "next", "start", "--hostname", "localhost", "--port", process.env.E2E_PORT ?? "3010"],
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

async function runLiveSmoke(baseUrl) {
  const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
  const errors = [];
  const warnings = [];

  try {
    const lobbyDisbandRoomCode = await assertLobbyDisbandReturnsJoinedPlayerToSetup(
      browser,
      baseUrl,
      errors,
      warnings,
    );
    const players = [
      await createPlayer(browser, baseUrl, "host", "Sora", errors, warnings),
      await createPlayer(browser, baseUrl, "player2", "Ren", errors, warnings),
      await createPlayer(browser, baseUrl, "player3", "Mika", errors, warnings),
    ];
    const [host, player2, player3] = players;

    await host.page.getByLabel("Players").selectOption("3");
    await clickAndWaitForMetric(host.page, "Create room", "Code");
    const roomCode = await readMetric(host.page, "Code");
    await waitMood(host.page, "lobby");
    await assertMoodVisual(host.page, "lobby");

    if (!/^\d{6}$/.test(roomCode ?? "")) {
      throw new Error(`Expected six-digit room code, got ${roomCode ?? "null"}.`);
    }

    await assertInviteTools(host.page, roomCode);
    await assertCopyRoomCode(host.page, roomCode);

    for (const player of [player2, player3]) {
      await fillRoomCode(player.page, roomCode);
      await player.page.getByRole("button", { name: "Join" }).click();
      await waitMetric(player.page, "Code", roomCode);
    }

    await refresh(host.page);
    await waitSeated(host.page, 3, 3);

    await startGame(host, baseUrl, roomCode);
    await waitPhase(host.page, "night");
    await waitMood(host.page, "night");
    await assertMoodVisual(host.page, "night");
    await assertPhaseTimerOpen(host.page);
    await refreshAll([player2, player3]);
    await waitPhase(player2.page, "night");
    await waitPhase(player3.page, "night");
    const nightConversationPlayer = await assertNightConversationUi(players);

    await submitAll(players);
    await advance(host);
    await waitPhase(host.page, "day");
    await waitMood(host.page, "day");
    await assertMoodVisual(host.page, "day");
    await assertPhaseTimerOpen(host.page);
    await refreshAll([player2, player3]);
    await waitPhase(player2.page, "day");
    await waitPhase(player3.page, "day");

    if (IS_ORDERED_SPEECH_E2E) {
      await resolveOrderedSpeechDay(players, host);
    } else {
      await submitAll(players);
      await advance(host);
      await waitPhase(host.page, "voting");
      await waitMood(host.page, "voting");
      await assertMoodVisual(host.page, "voting");
      await assertPhaseTimerOpen(host.page);
      await refreshAll([player2, player3]);
      await waitPhase(player2.page, "voting");
      await waitPhase(player3.page, "voting");
    }

    await submitAll(players);
    await advance(host);
    await waitPhase(host.page, "execution");
    await waitMood(host.page, "execution");
    await assertMoodVisual(host.page, "execution");
    await assertPhaseTimerOpen(host.page);
    await host.page.waitForTimeout(EXECUTION_TIMEOUT_WAIT_MS);
    const resolutionPath = await resolveAfterTimeout(host);
    await waitMood(host.page, "result");
    await assertMoodVisual(host.page, "result");
    await refreshAll([player2, player3]);
    await waitEnded(player2.page);
    await waitEnded(player3.page);

    const desktopScreenshot = join(SCREENSHOT_DIR, "live-result-desktop.png");
    await host.page.screenshot({ fullPage: false, path: desktopScreenshot });
    await host.page.setViewportSize({ height: 844, width: 390 });
    await host.page.waitForTimeout(250);
    await host.page.evaluate(() => {
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    await host.page.waitForTimeout(100);
    const mobileScreenshot = join(SCREENSHOT_DIR, "live-result-mobile.png");
    await host.page.screenshot({ fullPage: false, path: mobileScreenshot });

    const evidence = await readEvidence(host.page);
    const visualCheck = await readVisualCheck(host.page);

    if (
      !evidence.hasResult ||
      evidence.liveMood !== "result" ||
      evidence.roomStatus !== "Ended" ||
      evidence.winner === "none"
    ) {
      throw new Error(`Game did not end cleanly: ${JSON.stringify(evidence)}`);
    }

    if (visualCheck.buttonOverflow.length > 0) {
      throw new Error(`Button overflow detected: ${JSON.stringify(visualCheck.buttonOverflow)}`);
    }

    if (errors.length > 0) {
      throw new Error(`Browser console errors detected: ${errors.join("\n")}`);
    }

    return {
      evidence,
      lobbyDisbandRoomCode,
      ok: true,
      nightConversationPlayer,
      resolutionPath,
      roomCode,
      screenshots: { desktop: desktopScreenshot, mobile: mobileScreenshot },
      visualCheck,
      warnings,
    };
  } finally {
    await browser.close();
  }
}

async function createPlayer(browser, baseUrl, label, displayName, errors, warnings) {
  const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(baseUrl).origin,
  });
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
  await waitMood(page, "setup");
  await assertMoodVisual(page, "setup");
  await page.getByLabel("Display name").fill(displayName);

  return { context, label, page };
}

async function assertLobbyDisbandReturnsJoinedPlayerToSetup(browser, baseUrl, errors, warnings) {
  const host = await createPlayer(browser, baseUrl, "disband-host", "Aki", errors, warnings);
  const guest = await createPlayer(browser, baseUrl, "disband-guest", "Nagi", errors, warnings);

  try {
    await host.page.getByLabel("Players").selectOption("3");
    await clickAndWaitForMetric(host.page, "Create room", "Code");
    const roomCode = await readMetric(host.page, "Code");

    if (!/^\d{6}$/.test(roomCode ?? "")) {
      throw new Error(`Expected disband room code to be six digits, got ${roomCode ?? "null"}.`);
    }

    await fillRoomCode(guest.page, roomCode);
    await guest.page.getByRole("button", { name: "Join room" }).click();
    await waitMetric(guest.page, "Code", roomCode);

    await host.page.getByRole("button", { name: "Leave room" }).click();
    await waitMood(host.page, "setup");

    await refresh(guest.page);
    await waitMood(guest.page, "setup");
    await assertRoomClosedSetupState(guest.page);

    return roomCode;
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
}

async function assertRoomClosedSetupState(page) {
  await page.getByLabel("Room setup").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Create room" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Join room" }).waitFor({ timeout: 10000 });
  await page.getByText(ROOM_CLOSED_STATUS_MESSAGE).waitFor({ timeout: 10000 });

  const liveTableCount = await page.getByLabel("Live game table").count();

  if (liveTableCount !== 0) {
    throw new Error("Closed lobby rendered the live game table.");
  }

  const leaveButtonCount = await page.getByRole("button", { name: "Leave room" }).count();

  if (leaveButtonCount !== 0) {
    throw new Error("Closed lobby kept the Leave room button visible.");
  }
}

async function fillRoomCode(page, roomCode) {
  for (const [index, digit] of roomCode.split("").entries()) {
    await page.getByRole("textbox", { name: `Room code digit ${index + 1}` }).fill(digit);
  }
}

async function startGame(host, baseUrl, roomCode) {
  if (!IS_ORDERED_SPEECH_E2E) {
    await host.page.getByRole("button", { name: "Start game" }).click();

    return;
  }

  const token = await host.page.evaluate(
    (key) => window.localStorage.getItem(key),
    IDENTITY_STORAGE_KEY,
  );

  if (token === null) {
    throw new Error("Host identity token is missing.");
  }

  const response = await fetch(`${baseUrl}/api/rooms/${roomCode}/start`, {
    body: JSON.stringify({
      ruleSet: {
        dayMode: "ordered_speech",
        dayReadyCheckSecondsPerPlayer: 90,
        daySpeechSeconds: 90,
        executionLastWordsSeconds: 60,
        firstDaySpeechRounds: 2,
        firstNightSeconds: 30,
        guardConsecutiveTargetPolicy: "deny",
        initialInspectionPolicy: "enabled",
        nightSeconds: 180,
        normalDaySpeechRounds: 1,
        roleCounts: {
          fox: 0,
          guard: 0,
          madman: 0,
          seer: 1,
          villager: 1,
          werewolf: 1,
        },
        voteResultVisibility: "count_only",
        votingSeconds: 30,
      },
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Ordered speech start failed: ${response.status}`);
  }

  await refresh(host.page);
}

async function clickAndWaitForMetric(page, buttonName, metricLabel) {
  let lastStatus = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: buttonName }).click();

    try {
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
        { timeout: 5000 },
      );

      return;
    } catch {
      lastStatus = await page
        .locator(".liveStatusBar")
        .innerText()
        .catch(() => "no status bar");
    }
  }

  throw new Error(`${buttonName} did not produce metric ${metricLabel}; status=${lastStatus}`);
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

    if (metricLabel === "Timer") {
      return textOf(document.querySelector('[aria-label="Current phase"] time'));
    }

    for (const row of document.querySelectorAll(".liveMetrics div")) {
      const term = textOf(row.querySelector("dt"));

      if (term === metricLabel) {
        return textOf(row.querySelector("dd"));
      }
    }

    return null;
  }, label);
}

async function waitSeated(page, seated, target) {
  await page.getByText(`${seated} / ${target} seated`).first().waitFor({ timeout: 10000 });
}

async function assertInviteTools(page, roomCode) {
  const invite = page.getByLabel("Room invite tools");

  await invite.waitFor({ timeout: 10000 });

  const text = await invite.innerText();

  if (!text.includes(roomCode) || !text.includes("Copy code") || !text.includes("Share invite")) {
    throw new Error(`Room invite tools missing expected copy: ${text}`);
  }
}

async function assertCopyRoomCode(page, roomCode) {
  await page.getByRole("button", { name: "Copy code" }).click();
  await page.waitForFunction(
    (expectedRoomCode) =>
      document.body.textContent.includes(`Room code ${expectedRoomCode} copied.`),
    roomCode,
    { timeout: 5000 },
  );
  await page.getByRole("button", { name: "Copied!" }).waitFor({ timeout: 5000 });

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

  if (clipboardText !== roomCode) {
    throw new Error(`Expected clipboard room code ${roomCode}, got ${clipboardText}.`);
  }
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
        const term = textOf(row.querySelector("dt"));
        const detail = textOf(row.querySelector("dd"));

        if (
          term === label &&
          (detail === expected ||
            (label === "Phase" && detail?.toLowerCase().includes(expected.toLowerCase())))
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
  await page
    .getByText(new RegExp(`playing / ${phase}`, "i"))
    .first()
    .waitFor({ timeout: 10000 });
}

async function assertPhaseTimerOpen(page) {
  const timer = await readMetric(page, "Timer");

  if (timer === null || timer === "closed" || timer === "unknown") {
    throw new Error(`Expected active phase timer, got ${timer ?? "null"}.`);
  }
}

async function assertNightConversationUi(players) {
  for (const player of players) {
    const toggle = player.page.getByRole("button", { name: "Night chat" });

    if (
      (await toggle.count()) === 0 ||
      !(await toggle.first().isVisible()) ||
      !(await toggle.first().isEnabled())
    ) {
      continue;
    }

    await toggle.first().click();
    await player.page.getByLabel("Night conversation").waitFor({ timeout: 10000 });

    const messageBody = "LongNightSignal-abcdefghijklmnopqrstuvwxyz-0123456789-repeat-check";
    await player.page.getByLabel("Message").fill(messageBody);
    await player.page.getByRole("button", { name: "Send" }).click();
    await player.page.getByText(messageBody).waitFor({ timeout: 10000 });
    await assertNightChatVisual(player.page);
    await player.page.getByRole("button", { name: /^Close / }).click();

    return player.label;
  }

  throw new Error("No player could open night conversation UI.");
}

async function assertNightChatVisual(page) {
  const contract = await page.evaluate(() => {
    const panel = document.querySelector(".liveNightChatPanel");
    const list = document.querySelector(".liveNightChatMessages");
    const message = document.querySelector(".liveNightChatMessages p");
    const row = document.querySelector(".liveNightChatMessages li div");

    if (panel === null || list === null || message === null || row === null) {
      return null;
    }

    const listStyles = getComputedStyle(list);
    const messageStyles = getComputedStyle(message);
    const rowStyles = getComputedStyle(row);

    return {
      maxHeight: listStyles.maxHeight,
      overflowY: listStyles.overflowY,
      rowColumns: rowStyles.gridTemplateColumns,
      wordWrap: messageStyles.overflowWrap,
    };
  });

  if (contract === null) {
    throw new Error("Night chat visual contract missing message list.");
  }

  if (
    contract.maxHeight === "none" ||
    contract.overflowY !== "auto" ||
    contract.wordWrap !== "anywhere"
  ) {
    throw new Error(`Night chat visual contract is weak: ${JSON.stringify(contract)}`);
  }
}

async function waitMood(page, mood) {
  await page.waitForFunction(
    (expectedMood) =>
      document.querySelector(".liveShell")?.getAttribute("data-live-mood") === expectedMood,
    mood,
    { timeout: 10000 },
  );
}

async function assertMoodVisual(page, mood) {
  const expectedBackground = MOOD_BACKGROUND_BY_NAME[mood];
  const contract = await page.evaluate((expectedMood) => {
    const shell = document.querySelector(".liveShell");

    if (shell === null) {
      return null;
    }

    const styles = getComputedStyle(shell);

    return {
      backgroundImage: styles.backgroundImage,
      dataMood: shell.getAttribute("data-live-mood"),
      imageVariable: styles.getPropertyValue("--live-bg-image").trim(),
      mutedColor: styles.getPropertyValue("--live-muted").trim(),
      panelBackground: styles.getPropertyValue("--live-panel-bg").trim(),
      expectedMood,
    };
  }, mood);

  if (contract === null) {
    throw new Error(`Live shell missing for mood ${mood}.`);
  }

  if (contract.dataMood !== mood) {
    throw new Error(`Expected mood ${mood}, got ${contract.dataMood ?? "null"}.`);
  }

  if (!contract.imageVariable.includes(expectedBackground)) {
    throw new Error(
      `Expected mood ${mood} to use ${expectedBackground}, got ${contract.imageVariable}.`,
    );
  }

  if (!contract.backgroundImage.includes(expectedBackground)) {
    throw new Error(
      `Expected rendered mood ${mood} background to include ${expectedBackground}, got ${contract.backgroundImage}.`,
    );
  }

  if (contract.mutedColor.length === 0 || contract.panelBackground.length === 0) {
    throw new Error(`Mood ${mood} is missing visual CSS variables: ${JSON.stringify(contract)}`);
  }
}

async function refresh(page) {
  await page.reload({ waitUntil: "networkidle" });
}

async function refreshAll(players) {
  for (const player of players) {
    await refresh(player.page);
  }
}

async function submitAll(players) {
  for (const player of players) {
    await submitVisibleActions(player);
  }
}

async function resolveOrderedSpeechDay(players, host) {
  for (let slotAttempt = 0; slotAttempt <= players.length * 2 + 1; slotAttempt += 1) {
    await refreshAll(players);
    await submitAll(players);
    await advance(host);
    await refreshAll(players);

    const hostPhase = await readMetric(host.page, "Phase");

    if (hostPhase === "voting") {
      await waitMood(host.page, "voting");
      await assertMoodVisual(host.page, "voting");
      await assertPhaseTimerOpen(host.page);
      await waitPhase(players[1].page, "voting");
      await waitPhase(players[2].page, "voting");

      return;
    }

    await waitPhase(host.page, "day");
    await waitPhase(players[1].page, "day");
    await waitPhase(players[2].page, "day");
  }

  throw new Error("Ordered speech day did not reach voting.");
}

async function submitVisibleActions(player) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const before = await player.page.locator(".liveActionRow:not(.submitted) button").count();

    if (before === 0) {
      return;
    }

    await player.page.locator(".liveActionRow:not(.submitted) button").first().click();
    await player.page.waitForFunction(
      (previousCount) =>
        document.querySelectorAll(".liveActionRow:not(.submitted) button").length < previousCount,
      before,
      { timeout: 10000 },
    );
  }

  throw new Error(`${player.label} still has open actions after repeated submit attempts.`);
}

async function advance(host) {
  await host.page.getByRole("button", { name: "Advance phase" }).click();
}

async function resolveAfterTimeout(host) {
  if (await isEnded(host.page)) {
    return "auto";
  }

  const advanceButton = host.page.getByRole("button", { name: "Advance phase" });

  if ((await advanceButton.count()) > 0 && (await advanceButton.first().isEnabled())) {
    await advanceButton.first().click();
    await waitEnded(host.page);

    return "manual";
  }

  await refresh(host.page);

  if (await isEnded(host.page)) {
    return "auto";
  }

  if ((await advanceButton.count()) === 0) {
    const bodyText = await host.page
      .locator("body")
      .innerText({ timeout: 1000 })
      .catch(() => "");

    throw new Error(
      `Advance phase button was not available before the game ended.\n${bodyText.slice(0, 2000)}`,
    );
  }

  await waitEnded(host.page);

  return "auto-late";
}

async function isEnded(page) {
  return page.evaluate(() => {
    if (/\bwon\./.test(document.body.textContent)) {
      return true;
    }

    const textOf = (element) => (element === null ? null : element.textContent.trim());
    const roomStatus = textOf(document.querySelector(".liveRoomPanel .livePanelHeading strong"));
    const winnerRow = [...document.querySelectorAll(".liveMetrics div")].find(
      (row) => textOf(row.querySelector("dt")) === "Winner",
    );
    const winner = winnerRow === undefined ? null : textOf(winnerRow.querySelector("dd"));

    return roomStatus === "Ended" && winner !== null && winner !== "none";
  });
}

async function waitEnded(page) {
  await page.waitForFunction(() => /\bwon\./.test(document.body.textContent), null, {
    timeout: 20000,
  });
}

async function readEvidence(page) {
  return page.evaluate(() => {
    const textOf = (element) => (element === null ? null : element.textContent.trim());
    const metric = (label) => {
      const row = [...document.querySelectorAll(".liveMetrics div")].find(
        (candidate) => textOf(candidate.querySelector("dt")) === label,
      );

      return row === undefined ? null : textOf(row.querySelector("dd"));
    };
    const bodyText = document.body.textContent;
    const winnerMatch = /\b(?<winner>Villagers|Werewolves|Fox|Neutral) won\./.exec(bodyText);

    return {
      hasLiveTable: document.querySelector(".liveShell") !== null,
      hasResult:
        /\bwon\./.test(bodyText) ||
        bodyText.includes("You won this game.") ||
        bodyText.includes("You lost this game."),
      liveMood: document.querySelector(".liveShell")?.getAttribute("data-live-mood") ?? null,
      phase: metric("Phase"),
      roomStatus:
        textOf(document.querySelector(".liveRoomPanel .livePanelHeading strong")) ??
        (bodyText.includes("Ended") ? "Ended" : null),
      status: textOf(document.querySelector(".liveStatusBar strong")),
      title: document.title,
      url: location.href,
      winner: metric("Winner") ?? winnerMatch?.groups?.winner ?? null,
    };
  });
}

async function readVisualCheck(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();

      return {
        height: rect.height,
        overflow:
          button.scrollWidth > Math.ceil(button.clientWidth) ||
          button.scrollHeight > Math.ceil(button.clientHeight),
        text: button.textContent.trim(),
        width: rect.width,
      };
    });

    return {
      buttonOverflow: buttons.filter((button) => button.overflow),
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });
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

try {
  await main();
} finally {
  await cleanupManagedServer();
}
