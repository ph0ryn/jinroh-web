import { DEFAULT_DISPLAY_NAMES } from "@/app/live/liveDefaultDisplayName";
import { LOCALE_STORAGE_KEY, localizations } from "@/lib/i18n/localization";

import { LivePage } from "../fixtures/livePage";
import { expect, test } from "../fixtures/test";

import type { Browser, BrowserContext, Page } from "playwright/test";

test("entry mode and locale menu follow keyboard semantics", async ({ live, page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await live.open();

  const entry = page.locator("[data-live-entry-mode]");
  const joinPanel = page.locator('[data-live-entry-panel="join"]');
  const createPanel = page.locator('[data-live-entry-panel="create"]');

  await expect(entry).toHaveAttribute("data-live-entry-mode", "join");
  await expect(live.joinModeButton()).toHaveAttribute("aria-pressed", "true");
  await expect(joinPanel).toBeVisible();
  await expect(createPanel).toBeHidden();

  const languageButton = page.getByRole("button", {
    name: live.t.common.language.ariaLabel,
    exact: true,
  });

  await languageButton.focus();
  await languageButton.press("Enter");

  const languageMenu = page.getByRole("menu", {
    name: live.t.common.language.ariaLabel,
    exact: true,
  });
  const englishOption = languageMenu.getByRole("menuitemradio", {
    name: live.t.common.language.english,
    exact: true,
  });
  const japaneseOption = languageMenu.getByRole("menuitemradio", {
    name: live.t.common.language.japanese,
    exact: true,
  });

  await expect(englishOption).toBeFocused();
  await englishOption.press("ArrowDown");
  await expect(japaneseOption).toBeFocused();
  await japaneseOption.press("Escape");
  await expect(languageMenu).toHaveCount(0);
  await expect(languageButton).toBeFocused();

  await languageButton.press("Enter");
  await englishOption.press("ArrowDown");
  await japaneseOption.press("Enter");

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(
    page.getByRole("button", {
      name: localizations.ja.common.language.ariaLabel,
      exact: true,
    }),
  ).toBeFocused();
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY))
    .toBe("ja");
});

test("players complete the primary create-to-first-day journey", async ({ browser }) => {
  test.setTimeout(90_000);

  const players = await Promise.all(
    ["Sora", "Ren", "Mika"].map((displayName) => createEntryPlayer(browser, displayName)),
  );
  const host = requireBrowserPlayer(players, 0);
  const guests = players.slice(1);

  try {
    const roomCode = await host.live.createRoom(players.length);

    for (const guest of guests) {
      await guest.live.joinRoom(roomCode);
      await expect(guest.live.currentRoomCode()).toHaveText(roomCode);
    }

    const roundTable = host.page.locator("[data-live-round-table]");

    await expect(roundTable.locator('[data-live-seat-state="occupied"]')).toHaveCount(
      players.length,
    );
    await expect(roundTable.locator('[data-live-seat-state="empty"]')).toHaveCount(0);

    const startButton = host.page.getByRole("button", {
      name: host.live.t.live.buttons.startGame,
      exact: true,
    });

    await expect(startButton).toBeDisabled();

    for (const player of players) {
      await player.live.lobbyReadinessButton().click();
    }

    await expect(startButton).toBeEnabled();
    await startButton.click();

    await Promise.all(
      players.map(async (player) => {
        await expect(player.page.locator('[data-live-mood="night"]')).toBeVisible();
        await player.live.waitForCinematicEffects();
      }),
    );

    for (const player of players) {
      const actionGuide = player.page.locator(
        '[data-live-action-guide][data-live-action-kind="first_night_ready"]',
      );

      await expect(actionGuide).toHaveCount(1);
      await actionGuide.locator("[data-live-action-submit]").click();
    }

    await Promise.all(
      players.map((player) =>
        expect(player.page.locator('[data-live-mood="day"]')).toBeVisible({ timeout: 15_000 }),
      ),
    );
  } finally {
    await Promise.allSettled(players.map(({ context }) => context.close()));
  }
});

test("display names render as text instead of markup", async ({ live, page }) => {
  const displayName = "<img src=x onerror=1>";

  await live.open();
  await live.setDisplayName(displayName);
  await live.createRoom(3);

  const currentSeat = page.locator("[data-live-current-seat]");

  await expect(currentSeat).toContainText(displayName);
  await expect(currentSeat.locator("img, script")).toHaveCount(0);
  expect(await currentSeat.textContent()).toContain(displayName);
});

test("entry creates a neutral random display name and keeps a saved name", async ({
  live,
  page,
}) => {
  await live.open();

  const displayNameInput = page.getByLabel(live.t.live.setup.displayName, { exact: true });
  const generatedDisplayName = await displayNameInput.inputValue();

  expect(DEFAULT_DISPLAY_NAMES).toContain(generatedDisplayName);

  await displayNameInput.fill("Saved Player");
  await page.reload();
  await expect(displayNameInput).toHaveValue("Saved Player");
});

for (const blockedMethod of ["getItem", "setItem", "removeItem"] as const) {
  test(`entry blocks all API work when localStorage.${blockedMethod} is rejected`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-test-client-ip": nextEntryClientIpAddress() },
      viewport: { height: 720, width: 1280 },
    });
    const page = await context.newPage();
    const apiRequests: string[] = [];

    page.on("request", (request) => {
      const url = new URL(request.url());

      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname);
      }
    });
    await page.addInitScript((method) => {
      const originalMethod = Storage.prototype[method];

      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value(key: string, ...args: string[]) {
          if (key.startsWith("jinrohWeb.")) {
            throw new DOMException("Storage access was denied.", "SecurityError");
          }

          return Reflect.apply(originalMethod, this, [key, ...args]) as string | null | undefined;
        },
      });
    }, blockedMethod);

    try {
      await page.goto("/live?roomCode=123456");

      const storageAlert = page.locator("[data-live-storage-unavailable]");

      await expect(storageAlert).toBeVisible();
      await expect(storageAlert).toContainText(localizations.en.live.storageUnavailable.title);
      await page.waitForTimeout(250);

      expect(apiRequests).toEqual([]);
      expect(apiRequests.filter((path) => path === "/api/identity")).toHaveLength(0);

      if (blockedMethod === "getItem") {
        const languageButton = page.getByRole("button", {
          name: localizations.en.common.language.ariaLabel,
          exact: true,
        });

        await languageButton.click();
        await page
          .getByRole("menuitemradio", {
            name: localizations.en.common.language.japanese,
            exact: true,
          })
          .click();
        await expect(storageAlert).toContainText(localizations.ja.live.storageUnavailable.title);
      }
    } finally {
      await context.close();
    }
  });
}

type EntryBrowserPlayer = {
  readonly context: BrowserContext;
  readonly live: LivePage;
  readonly page: Page;
};

async function createEntryPlayer(
  browser: Browser,
  displayName: string,
): Promise<EntryBrowserPlayer> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-test-client-ip": nextEntryClientIpAddress() },
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  const live = new LivePage(page);

  await live.open();
  await live.setDisplayName(displayName);

  return { context, live, page };
}

let nextEntryClientAddress = 1;

function nextEntryClientIpAddress(): string {
  return `203.0.113.${nextEntryClientAddress++}`;
}

function requireBrowserPlayer(
  players: readonly EntryBrowserPlayer[],
  index: number,
): EntryBrowserPlayer {
  const player = players[index];

  if (player === undefined) {
    throw new Error(`Browser player ${index} was not created.`);
  }

  return player;
}
