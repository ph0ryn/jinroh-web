import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_MANAGED_URL = `http://localhost:${process.env.E2E_PORT ?? "3010"}`;
const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ?? join(tmpdir(), `jinroh-web-e2e-${Date.now()}`);
const EXECUTION_TIMEOUT_WAIT_MS = Number(process.env.E2E_EXECUTION_TIMEOUT_WAIT_MS ?? "61500");

let cleanupManagedServer = () => {};

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
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];

  cleanupManagedServer = () => managedServer.kill();
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
    const players = [
      await createPlayer(browser, baseUrl, "host", "Sora", errors, warnings),
      await createPlayer(browser, baseUrl, "player2", "Ren", errors, warnings),
      await createPlayer(browser, baseUrl, "player3", "Mika", errors, warnings),
    ];
    const [host, player2, player3] = players;

    await clickAndWaitForMetric(host.page, "Create room", "Code");
    const roomCode = await readMetric(host.page, "Code");

    if (!/^\d{6}$/.test(roomCode ?? "")) {
      throw new Error(`Expected six-digit room code, got ${roomCode ?? "null"}.`);
    }

    for (const player of [player2, player3]) {
      await player.page.getByLabel("Room code").fill(roomCode);
      await player.page.getByRole("button", { name: "Join" }).click();
      await waitMetric(player.page, "Code", roomCode);
    }

    await refresh(host.page);
    await waitMetric(host.page, "Players", "3");

    await host.page.getByRole("button", { name: "Start game" }).click();
    await waitPhase(host.page, "night");
    await refreshAll([player2, player3]);
    await waitPhase(player2.page, "night");
    await waitPhase(player3.page, "night");

    await submitAll(players);
    await advance(host);
    await waitPhase(host.page, "day");
    await refreshAll([player2, player3]);
    await waitPhase(player2.page, "day");
    await waitPhase(player3.page, "day");

    await submitAll(players);
    await advance(host);
    await waitPhase(host.page, "voting");
    await refreshAll([player2, player3]);
    await waitPhase(player2.page, "voting");
    await waitPhase(player3.page, "voting");

    await submitAll(players);
    await advance(host);
    await waitPhase(host.page, "execution");
    await host.page.waitForTimeout(EXECUTION_TIMEOUT_WAIT_MS);
    const resolutionPath = await resolveAfterTimeout(host);
    await refreshAll([player2, player3]);
    await waitEnded(player2.page);
    await waitEnded(player3.page);

    const desktopScreenshot = join(SCREENSHOT_DIR, "live-result-desktop.png");
    await host.page.screenshot({ fullPage: false, path: desktopScreenshot });
    await host.page.setViewportSize({ height: 844, width: 390 });
    const mobileScreenshot = join(SCREENSHOT_DIR, "live-result-mobile.png");
    await host.page.screenshot({ fullPage: false, path: mobileScreenshot });

    const evidence = await readEvidence(host.page);
    const visualCheck = await readVisualCheck(host.page);

    if (!evidence.hasResult || evidence.roomStatus !== "Ended" || evidence.winner === "none") {
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
      ok: true,
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

async function clickAndWaitForMetric(page, buttonName, metricLabel) {
  let lastStatus = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: buttonName }).click();

    try {
      await page.waitForFunction(
        (label) => {
          const textOf = (element) => (element === null ? null : element.textContent.trim());

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

    for (const row of document.querySelectorAll(".liveMetrics div")) {
      const term = textOf(row.querySelector("dt"));

      if (term === metricLabel) {
        return textOf(row.querySelector("dd"));
      }
    }

    return null;
  }, label);
}

async function waitMetric(page, label, expected) {
  await page.waitForFunction(
    ({ expected, label }) => {
      const textOf = (element) => (element === null ? null : element.textContent.trim());

      for (const row of document.querySelectorAll(".liveMetrics div")) {
        const term = textOf(row.querySelector("dt"));
        const detail = textOf(row.querySelector("dd"));

        if (term === label && detail === expected) {
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

async function submitAll(players) {
  for (const player of players) {
    await submitVisibleActions(player);
  }
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

  if (await advanceButton.isEnabled()) {
    await advanceButton.click();
    await waitEnded(host.page);

    return "manual";
  }

  await waitEnded(host.page);

  return "auto-late";
}

async function isEnded(page) {
  return page.evaluate(() => {
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
  await page.waitForFunction(
    () => {
      const textOf = (element) => (element === null ? null : element.textContent.trim());
      const roomStatus = textOf(document.querySelector(".liveRoomPanel .livePanelHeading strong"));
      const winnerRow = [...document.querySelectorAll(".liveMetrics div")].find(
        (row) => textOf(row.querySelector("dt")) === "Winner",
      );
      const winner = winnerRow === undefined ? null : textOf(winnerRow.querySelector("dd"));

      return roomStatus === "Ended" && winner !== null && winner !== "none";
    },
    null,
    { timeout: 20000 },
  );
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

    return {
      hasLiveTable: bodyText.includes("Jinroh Web table"),
      hasResult:
        bodyText.includes("won. Start a new room") ||
        bodyText.includes("You won this game.") ||
        bodyText.includes("You lost this game."),
      phase: metric("Phase"),
      roomStatus: textOf(document.querySelector(".liveRoomPanel .livePanelHeading strong")),
      status: textOf(document.querySelector(".liveStatusBar strong")),
      title: document.title,
      url: location.href,
      winner: metric("Winner"),
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

try {
  await main();
} finally {
  cleanupManagedServer();
}
