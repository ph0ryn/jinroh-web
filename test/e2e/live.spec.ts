import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, createStartedRoom, readJsonResponse } from "./support/api";

import type { Browser, BrowserContext, Page } from "playwright/test";

type BrowserPlayer = {
  readonly context: BrowserContext;
  readonly page: Page;
};

test("the language menu supports keyboard navigation and restores focus", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(() => {
    window.localStorage.setItem("jinrohWeb.locale", "en");
  });
  await page.goto("/live");

  const toggle = page.getByRole("button", { name: "Language" });

  await toggle.focus();
  await toggle.press("Enter");

  const menu = page.getByRole("menu", { name: "Language" });
  const englishOption = menu.getByRole("menuitemradio", { name: "English" });
  const japaneseOption = menu.getByRole("menuitemradio", { name: "Japanese" });

  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();

  expect(menuBounds?.y).toBeGreaterThanOrEqual(0);
  expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await expect(englishOption).toBeFocused();
  await englishOption.press("ArrowDown");
  await expect(japaneseOption).toBeFocused();
  await japaneseOption.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(toggle).toBeFocused();

  await toggle.press("Enter");
  await expect(englishOption).toBeFocused();
  await englishOption.press("ArrowDown");
  await japaneseOption.press("Enter");

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("button", { name: "言語" })).toBeFocused();
});

test("room entry defaults to joining and lists joining before creation", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(() => {
    window.localStorage.setItem("jinrohWeb.locale", "en");
  });
  await page.goto("/live");

  const entrySurface = page.locator("[data-live-entry-mode]");
  const entryModeButtons = page
    .getByRole("group", {
      name: "Choose how to enter a room",
    })
    .getByRole("button");

  await expect(entrySurface).toHaveAttribute("data-live-entry-mode", "join");
  await expect(entryModeButtons).toHaveText(["Join with code", "Create a room"]);
  await expect(entryModeButtons.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-live-entry-panel="join"]')).toBeVisible();
  await expect(page.locator('[data-live-entry-panel="create"]')).toBeHidden();
});

test("players can create, join, start, and finish first night through the UI", async ({
  browser,
}) => {
  const consoleErrors: string[] = [];
  const players = await Promise.all(
    ["Sora", "Ren", "Mika"].map((name) => createBrowserPlayer(browser, name, consoleErrors)),
  );
  const [host, player2, player3] = players;

  if (host === undefined || player2 === undefined || player3 === undefined) {
    throw new Error("UI smoke players were not created.");
  }

  try {
    await host.page.getByLabel("Players").selectOption("3");
    await host.page.getByRole("button", { name: "Create room" }).click();
    const inviteCode = host.page.locator("[data-live-room-code]:visible strong");
    const roundTable = host.page.locator("[data-live-round-table]");

    await expect(inviteCode).toHaveText(/^\d{6}$/u);
    await expect(roundTable).toBeVisible();
    await expect(host.page.locator(".languageSwitcher")).toHaveCount(0);
    await expect(roundTable.locator('[data-live-seat-state="occupied"]')).toHaveCount(1);
    await expect(roundTable.locator('[data-live-seat-state="empty"]')).toHaveCount(2);
    const roomCode = (await inviteCode.textContent())?.trim();

    if (roomCode === undefined || !/^\d{6}$/u.test(roomCode)) {
      throw new Error("UI did not render a six-digit room code.");
    }

    for (const player of [player2, player3]) {
      await fillRoomCode(player.page, roomCode);
      await player.page.getByRole("button", { name: "Join room" }).click();
      await expect(player.page.locator("[data-live-room-code]:visible strong")).toHaveText(
        roomCode,
      );
    }

    await expect(roundTable.locator('[data-live-seat-state="occupied"]')).toHaveCount(3);
    await expect(roundTable.locator('[data-live-seat-state="empty"]')).toHaveCount(0);
    await expect(roundTable.locator("[data-live-role-id]")).toHaveCount(0);
    const waitingSeatMapping = await getPlayerSeatMapping(host.page);

    for (const player of players) {
      const orientation = await readCurrentSeatOrientation(player.page);

      expect(Math.abs(orientation.currentSeatCenterX - orientation.tableCenterX)).toBeLessThan(1);
      expect(orientation.currentSeatCenterY).toBeGreaterThan(orientation.tableCenterY);
    }

    const startButton = host.page.getByRole("button", { name: "Start game" });

    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(host.page.locator('[data-live-effect="role"]')).toBeVisible();
    await expect(roundTable.locator("[data-live-role-id]")).toHaveCount(0);
    await expect.poll(() => getPlayerSeatMapping(host.page)).toEqual(waitingSeatMapping);

    for (const player of players) {
      await expect(player.page.locator('.liveShell[data-live-mood="night"]')).toBeVisible();
      await expect(player.page.getByLabel("Round table")).toBeVisible();
      await expect(player.page.getByRole("button", { name: "Reveal role card" })).toBeVisible();
      await expect(player.page.getByRole("button", { name: "Leave room" })).toHaveCount(0);
      const orientation = await readCurrentSeatOrientation(player.page);

      expect(Math.abs(orientation.currentSeatCenterX - orientation.tableCenterX)).toBeLessThan(1);
      expect(orientation.currentSeatCenterY).toBeGreaterThan(orientation.tableCenterY);
    }

    for (const [index, player] of players.entries()) {
      const readyAction = player.page.locator(".liveActionRow", { hasText: "Ready for daybreak" });

      await expect(readyAction).toHaveCount(1);
      await readyAction.getByRole("button", { name: "Ready for daybreak" }).click();

      if (index < players.length - 1) {
        await expect(readyAction).toHaveClass(/submitted/u);
      }
    }

    for (const player of players) {
      await expect(player.page.locator('.liveShell[data-live-mood="day"]')).toBeVisible({
        timeout: 15_000,
      });
    }

    expect(consoleErrors).toEqual([]);
  } finally {
    await Promise.all(players.map(({ context }) => context.close()));
  }
});

test("leaving while waiting requires confirmation and transfers host controls", async ({
  browser,
}) => {
  const consoleErrors: string[] = [];
  const players = await Promise.all(
    ["Aster", "Birch", "Cedar"].map((name) => createBrowserPlayer(browser, name, consoleErrors)),
  );
  const [host, player2, player3] = players;

  if (host === undefined || player2 === undefined || player3 === undefined) {
    throw new Error("Waiting-room leave players were not created.");
  }

  try {
    const roomCode = await createAndJoinWaitingRoom(host.page, [player2.page, player3.page]);
    const settingsButton = host.page.getByRole("button", { name: "Settings" });

    await settingsButton.click();

    const settingsDialog = host.page.getByRole("dialog", { name: "Game settings" });

    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole("button", { name: "Close settings" })).toBeFocused();
    await expect.poll(() => host.page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await host.page.keyboard.press("Shift+Tab");
    await expect(settingsDialog.getByRole("button", { name: "Apply settings" })).toBeFocused();
    await host.page.keyboard.press("Tab");
    await expect(settingsDialog.getByRole("button", { name: "Close settings" })).toBeFocused();

    await host.page.keyboard.press("Escape");

    await expect(settingsDialog).toHaveCount(0);
    await expect(settingsButton).toBeFocused();
    await expect
      .poll(() => host.page.evaluate(() => document.body.style.overflow))
      .not.toBe("hidden");

    const leaveButton = host.page.getByRole("button", { name: "Leave room" });

    await leaveButton.click();

    const leaveDialog = host.page.getByRole("dialog", { name: "Leave this room?" });

    await expect(leaveDialog).toBeVisible();
    await expect(leaveDialog.getByRole("button", { name: "Close Leave this room?" })).toBeFocused();
    await leaveDialog.getByRole("button", { name: "Cancel" }).click();

    await expect(leaveDialog).toHaveCount(0);
    await expect(host.page.locator("[data-live-room-code]:visible strong")).toHaveText(roomCode);
    await expect(leaveButton).toBeFocused();

    await leaveButton.click();
    await expect(leaveDialog).toBeVisible();
    await host.page.keyboard.press("Escape");
    await expect(leaveDialog).toHaveCount(0);
    await expect(leaveButton).toBeFocused();

    await host.page.setViewportSize({ height: 500, width: 390 });
    await host.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() =>
        host.page.evaluate(() => ({
          documentOverflowX:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          documentOverflowY:
            document.documentElement.scrollHeight - document.documentElement.clientHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        })),
      )
      .toEqual({ documentOverflowX: 0, documentOverflowY: 0, scrollX: 0, scrollY: 0 });

    await leaveButton.click();
    await leaveDialog.getByRole("button", { name: "Leave room", exact: true }).click();

    await expect(host.page.locator('.liveShell[data-live-mood="setup"]')).toBeVisible();
    await expect(host.page.getByRole("button", { name: "Create room" })).toBeVisible();
    await expect.poll(() => host.page.evaluate(() => window.scrollY)).toBe(0);
    await expect(player2.page.getByText("Host controls", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(player2.page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(player3.page.getByText("Player controls", { exact: true })).toBeVisible();
    await expect(player3.page.getByRole("button", { name: "Settings" })).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  } finally {
    await Promise.all(players.map(({ context }) => context.close()));
  }
});

test("creating with Enter exposes a scoped busy state", async ({ browser }) => {
  const consoleErrors: string[] = [];
  const host = await createBrowserPlayer(browser, "Dawn", consoleErrors);
  let releaseCreateRequest = (): void => {};
  let markCreateRequestStarted = (): void => {};
  const createRequestGate = new Promise<void>((resolve) => {
    releaseCreateRequest = resolve;
  });
  const createRequestStarted = new Promise<void>((resolve) => {
    markCreateRequestStarted = resolve;
  });

  await host.page.route("**/api/rooms", async (route) => {
    markCreateRequestStarted();
    await createRequestGate;
    await route.continue();
  });

  try {
    await host.page.getByLabel("Players").press("Enter");
    await createRequestStarted;

    const pendingButton = host.page.getByRole("button", { name: "Creating room..." });
    const pendingForm = host.page.locator('form[aria-busy="true"]').filter({
      has: pendingButton,
    });

    await expect(pendingButton).toBeDisabled();
    await expect(pendingForm).toHaveCount(1);
    await expect(host.page.getByLabel("Display name")).toBeDisabled();
    await expect(host.page.getByLabel("Players")).toBeDisabled();
    await expect(host.page.getByRole("button", { name: "Join room" })).toBeDisabled();

    releaseCreateRequest();

    await expect(host.page.locator("[data-live-room-code]:visible strong")).toHaveText(/^\d{6}$/u);
    expect(consoleErrors).toEqual([]);
  } finally {
    releaseCreateRequest();
    await host.context.close();
  }
});

test("joining with Enter exposes a scoped busy state", async ({ browser, request }) => {
  const host = await createApiPlayer(request, "host", "Elm");
  const room = await apiFetch<{ code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });
  const consoleErrors: string[] = [];
  const joiner = await createBrowserPlayer(browser, "Fir", consoleErrors);
  let releaseJoinRequest = (): void => {};
  let markJoinRequestStarted = (): void => {};
  const joinRequestGate = new Promise<void>((resolve) => {
    releaseJoinRequest = resolve;
  });
  const joinRequestStarted = new Promise<void>((resolve) => {
    markJoinRequestStarted = resolve;
  });

  await joiner.page.route(`**/api/rooms/${room.code}/join`, async (route) => {
    markJoinRequestStarted();
    await joinRequestGate;
    await route.continue();
  });

  try {
    await fillRoomCode(joiner.page, room.code);
    await joiner.page.getByRole("textbox", { name: "Room code digit 6" }).press("Enter");
    await joinRequestStarted;

    const pendingButton = joiner.page.getByRole("button", { name: "Joining room..." });
    const pendingForm = joiner.page.locator('form[aria-busy="true"]').filter({
      has: pendingButton,
    });

    await expect(pendingButton).toBeDisabled();
    await expect(pendingForm).toHaveCount(1);
    await expect(joiner.page.getByLabel("Display name")).toBeDisabled();
    await expect(joiner.page.getByRole("button", { name: "Create room" })).toBeDisabled();

    releaseJoinRequest();

    await expect(joiner.page.locator("[data-live-room-code]:visible strong")).toHaveText(room.code);
    expect(consoleErrors).toEqual([]);
  } finally {
    releaseJoinRequest();
    await joiner.context.close();
  }
});

test("the leave API rejects players while a game is in progress", async ({ request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Gale", "Harbor", "Iris"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Started room host was not created.");
  }

  const leaveResponse = await readJsonResponse<{
    readonly error: { readonly code: string; readonly message: string };
  }>(request, `/api/rooms/${roomCode}/leave`, {
    body: {},
    method: "POST",
    token: host.token,
  });

  expect(leaveResponse).toEqual({
    body: {
      error: {
        code: "room_switch_forbidden",
        message: "Players cannot leave or switch rooms while a game is in progress.",
      },
    },
    status: 409,
  });

  const summary = await apiFetch<{
    readonly currentPlayerId: string | null;
    readonly status: string;
  }>(request, `/api/rooms/${roomCode}`, { token: host.token });

  expect(summary.status).toBe("playing");
  expect(summary.currentPlayerId).not.toBeNull();
});

test("the desktop round table uses the available play area", async ({ page, request }) => {
  const { players } = await createStartedRoom(request, ["Lumen", "Morrow", "Nettle"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Round table host was not created.");
  }

  await page.setViewportSize({ height: 801, width: 1467 });
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");

  const shell = page.locator('[data-live-mood="night"]');
  const tableBoard = page.locator("[data-live-round-table]");
  const tableSurface = page.locator("[data-live-table-surface]");

  await expect(shell).toBeVisible();
  await expect(tableBoard).toBeVisible();
  await expect(tableSurface).toBeVisible();

  const geometry = await readRoundTableGeometry(page);

  expect(geometry.boardHeight).toBeGreaterThan(650);
  expect(geometry.boardBottom).toBeGreaterThan(760);
  expect(geometry.surfaceWidth).toBeGreaterThan(geometry.boardHeight * 0.8);
  expect(Math.abs(geometry.surfaceWidth - geometry.surfaceHeight)).toBeLessThan(1);
  expect(geometry.seatsOutsideBoard).toEqual([]);
  expect(geometry.overlappingSeatPairs).toEqual([]);
});

test("the ten-player round table keeps every seat readable on mobile", async ({
  page,
  request,
}) => {
  const { players } = await createStartedRoom(
    request,
    Array.from({ length: 10 }, (unusedValue, index) => {
      void unusedValue;

      return `Player ${index + 1}`;
    }),
  );
  const host = players[0];

  if (host === undefined) {
    throw new Error("Ten-player round table host was not created.");
  }

  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");
  const roundTable = page.locator('[data-live-round-table][data-seat-density="compact"]');

  await expect(roundTable).toBeVisible();
  await expect(roundTable.locator('[data-live-seat-state="occupied"]')).toHaveCount(10);

  const geometry = await readRoundTableGeometry(page);

  expect(Math.abs(geometry.surfaceWidth - geometry.surfaceHeight)).toBeLessThan(1);
  expect(geometry.seatsOutsideBoard).toEqual([]);
  expect(geometry.overlappingSeatPairs).toEqual([]);
});

async function createBrowserPlayer(
  browser: Browser,
  displayName: string,
  consoleErrors: string[],
): Promise<BrowserPlayer> {
  const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`${displayName}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`${displayName}: ${error.message}`));

  await page.goto("/live");
  await expect(page.locator('.liveShell[data-live-mood="setup"]')).toBeVisible();
  await page.getByLabel("Display name").fill(displayName);

  return { context, page };
}

async function fillRoomCode(page: Page, roomCode: string): Promise<void> {
  for (const [index, digit] of roomCode.split("").entries()) {
    await page.getByRole("textbox", { name: `Room code digit ${index + 1}` }).fill(digit);
  }
}

async function getPlayerSeatMapping(page: Page): Promise<Record<string, string>> {
  return page
    .locator("[data-live-round-table]")
    .evaluate((table) =>
      Object.fromEntries(
        [...table.querySelectorAll<HTMLElement>("[data-live-player-id]")].map((seat) => [
          seat.dataset["livePlayerId"] ?? "",
          seat.dataset["liveSeatNumber"] ?? "",
        ]),
      ),
    );
}

async function readRoundTableGeometry(page: Page): Promise<{
  readonly boardBottom: number;
  readonly boardHeight: number;
  readonly overlappingSeatPairs: readonly string[];
  readonly seatsOutsideBoard: readonly string[];
  readonly surfaceHeight: number;
  readonly surfaceWidth: number;
}> {
  return page.locator("[data-live-round-table]").evaluate((board) => {
    const surface = board.querySelector<HTMLElement>("[data-live-table-surface]");

    if (surface === null) {
      throw new Error("Round table surface was not rendered.");
    }

    const boardRect = board.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const seatRects = [...board.querySelectorAll<HTMLElement>("[data-live-seat-number]")].map(
      (seat) => ({
        id: seat.dataset["liveSeatNumber"] ?? "unknown",
        rect: seat.getBoundingClientRect(),
      }),
    );
    const seatsOutsideBoard = seatRects.flatMap(({ id, rect }) =>
      rect.left < boardRect.left - 1 ||
      rect.right > boardRect.right + 1 ||
      rect.top < boardRect.top - 1 ||
      rect.bottom > boardRect.bottom + 1
        ? [id]
        : [],
    );
    const overlappingSeatPairs = seatRects.flatMap((seat, index) =>
      seatRects.slice(index + 1).flatMap((candidate) => {
        const overlaps =
          seat.rect.left < candidate.rect.right - 1 &&
          seat.rect.right > candidate.rect.left + 1 &&
          seat.rect.top < candidate.rect.bottom - 1 &&
          seat.rect.bottom > candidate.rect.top + 1;

        return overlaps ? [`${seat.id}:${candidate.id}`] : [];
      }),
    );

    return {
      boardBottom: boardRect.bottom,
      boardHeight: boardRect.height,
      overlappingSeatPairs,
      seatsOutsideBoard,
      surfaceHeight: surfaceRect.height,
      surfaceWidth: surfaceRect.width,
    };
  });
}

async function readCurrentSeatOrientation(page: Page): Promise<{
  readonly currentSeatCenterX: number;
  readonly currentSeatCenterY: number;
  readonly tableCenterX: number;
  readonly tableCenterY: number;
}> {
  return page.locator("[data-live-round-table]").evaluate((board) => {
    const surface = board.querySelector<HTMLElement>("[data-live-table-surface]");
    const currentSeat = board.querySelector<HTMLElement>("[data-live-current-seat]");

    if (surface === null || currentSeat === null) {
      throw new Error("Current player seat orientation was not rendered.");
    }

    const surfaceRect = surface.getBoundingClientRect();
    const currentSeatRect = currentSeat.getBoundingClientRect();

    return {
      currentSeatCenterX: currentSeatRect.left + currentSeatRect.width / 2,
      currentSeatCenterY: currentSeatRect.top + currentSeatRect.height / 2,
      tableCenterX: surfaceRect.left + surfaceRect.width / 2,
      tableCenterY: surfaceRect.top + surfaceRect.height / 2,
    };
  });
}

async function createAndJoinWaitingRoom(host: Page, guests: readonly Page[]): Promise<string> {
  await host.getByLabel("Players").selectOption(String(guests.length + 1));
  await host.getByRole("button", { name: "Create room" }).click();

  const inviteCode = host.locator("[data-live-room-code]:visible strong");

  await expect(inviteCode).toHaveText(/^\d{6}$/u);

  const roomCode = (await inviteCode.textContent())?.trim();

  if (roomCode === undefined || !/^\d{6}$/u.test(roomCode)) {
    throw new Error("UI did not render a six-digit room code.");
  }

  for (const guest of guests) {
    await fillRoomCode(guest, roomCode);
    await guest.getByRole("button", { name: "Join room" }).click();
    await expect(guest.locator("[data-live-room-code]:visible strong")).toHaveText(roomCode);
  }

  return roomCode;
}
