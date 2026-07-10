import { expect, test } from "playwright/test";

import type { Browser, BrowserContext, Page } from "playwright/test";

type BrowserPlayer = {
  readonly context: BrowserContext;
  readonly page: Page;
};

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
    const inviteCode = host.page.locator('[aria-label="Room invite tools"] strong');

    await expect(inviteCode).toHaveText(/^\d{6}$/u);
    const roomCode = (await inviteCode.textContent())?.trim();

    if (roomCode === undefined || !/^\d{6}$/u.test(roomCode)) {
      throw new Error("UI did not render a six-digit room code.");
    }

    for (const player of [player2, player3]) {
      await fillRoomCode(player.page, roomCode);
      await player.page.getByRole("button", { name: "Join room" }).click();
      await expect(player.page.locator('[aria-label="Room invite tools"] strong')).toHaveText(
        roomCode,
      );
    }

    const startButton = host.page.getByRole("button", { name: "Start game" });

    await expect(startButton).toBeEnabled();
    await startButton.click();

    for (const player of players) {
      await expect(player.page.locator('.liveShell[data-live-mood="night"]')).toBeVisible();
      await expect(player.page.getByLabel("Live game table")).toBeVisible();
      await expect(player.page.getByText("Your role", { exact: true })).toBeVisible();
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
