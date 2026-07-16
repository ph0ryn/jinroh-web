import { readDocumentOverflow, readLayoutMode } from "../fixtures/livePage";
import {
  createRoomWithStartedGame,
  createWaitingRoom,
  requirePlayer,
} from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";

import type { Page } from "playwright/test";

test("short landscape landing keeps the header separate and play reachable", async ({ page }) => {
  await page.setViewportSize({ height: 375, width: 667 });
  await page.goto("/");

  const header = page.locator("header");
  const brand = header.getByRole("link", { name: "Jinroh Web home", exact: true });
  const status = header.locator(":scope > span");
  const playLink = page.getByRole("link", { name: "Play Jinroh Web", exact: true });
  const [brandBounds, statusBounds] = await Promise.all([
    brand.boundingBox(),
    status.boundingBox(),
  ]);

  expect(brandBounds).not.toBeNull();
  expect(statusBounds).not.toBeNull();
  expect(rectanglesIntersect(requireBounds(brandBounds), requireBounds(statusBounds))).toBe(false);
  await expect(playLink).toBeVisible();
  await expectNoHorizontalDocumentOverflow(page);

  await page.setViewportSize({ height: 188, width: 334 });
  await playLink.scrollIntoViewIfNeeded();
  await expect(playLink).toBeVisible();
  await expectNoHorizontalDocumentOverflow(page);
});

test("the 320px entry surface remains operable without document overflow", async ({
  live,
  page,
}) => {
  await page.setViewportSize({ height: 568, width: 320 });
  await live.open({ displayName: "Narrow player" });

  await expect(page.locator("[data-live-entry-mode]")).toBeVisible();
  await expect(live.entryModeGroup()).toBeVisible();
  await expect(live.joinModeButton()).toHaveAttribute("aria-pressed", "true");

  const languageButton = page.getByRole("button", {
    name: live.t.common.language.ariaLabel,
    exact: true,
  });

  await languageButton.click();
  const menu = page.getByRole("menu", {
    name: live.t.common.language.ariaLabel,
    exact: true,
  });
  const menuBounds = await menu.boundingBox();

  expect(menuBounds).not.toBeNull();
  expect(menuBounds?.x).toBeGreaterThanOrEqual(0);
  expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(menuBounds?.y).toBeGreaterThanOrEqual(0);
  expect((menuBounds?.y ?? 0) + (menuBounds?.height ?? 0)).toBeLessThanOrEqual(568);
  await page.keyboard.press("Escape");

  await expectNoDocumentOverflow(page);
  await expectMinimumInteractiveTargetSize(page);
});

test("599px and 600px select their documented portrait layout modes", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["PortHost"], 6);
  const host = requirePlayer(players, 0);

  await page.setViewportSize({ height: 800, width: 599 });
  await live.open({ identityToken: host.token });
  await expect(page.locator("[data-live-room-layout]")).toBeVisible();
  await expect.poll(() => readLayoutMode(page)).toBe("phone-portrait");
  await expect(page.locator("[data-live-table-surface]")).toBeVisible();
  await expect(page.locator("[data-live-controls]")).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expectMinimumInteractiveTargetSize(page);

  await page.setViewportSize({ height: 800, width: 600 });
  await expect.poll(() => readLayoutMode(page)).toBe("tablet-portrait");
  await expect(page.locator("[data-live-table-surface]")).toBeVisible();
  await expect(page.locator("[data-live-controls]")).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expectMinimumInteractiveTargetSize(page);
});

test("phone landscape keeps waiting controls and settings footer reachable", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["LandHost"], 6);
  const host = requirePlayer(players, 0);

  await page.setViewportSize({ height: 375, width: 667 });
  await live.open({ identityToken: host.token });

  await expect.poll(() => readLayoutMode(page)).toBe("phone-landscape");
  await expect(page.locator("[data-live-compact-invite]")).toBeVisible();
  await expect(page.locator("[data-live-primary-actions]")).toBeVisible();
  await expectNoDocumentOverflow(page);

  await live.settingsButton().click();
  const dialog = live.settingsDialog();

  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: live.t.live.buttons.closeSettings, exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: live.t.live.buttons.applySettings, exact: true }),
  ).toBeVisible();

  const scrollOwnership = await dialog.evaluate((root) => {
    const body = root.querySelector<HTMLElement>(".liveSettingsBody");
    const footer = root.querySelector<HTMLElement>(".liveSettingsFooter");

    return {
      bodyCanScroll: body !== null && body.scrollHeight > body.clientHeight,
      footerInsideDialog:
        footer !== null &&
        footer.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1,
      footerInsideViewport:
        footer !== null && footer.getBoundingClientRect().bottom <= window.innerHeight + 1,
    };
  });

  expect(scrollOwnership).toEqual({
    bodyCanScroll: true,
    footerInsideDialog: true,
    footerInsideViewport: true,
  });
  await expectNoDocumentOverflow(page);
  await expectMinimumInteractiveTargetSize(page);
});

test("gameplay controls do not reserve empty space between content and utilities", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createRoomWithStartedGame(request, ["Aster", "Birch", "Cedar"]);
  const host = requirePlayer(players, 0);

  await page.setViewportSize({ height: 900, width: 1920 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await live.open({ identityToken: host.token });
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 4_000 });

  const controls = page.locator('[data-live-controls][data-live-controls-surface="playing"]');
  const verticalGap = await controls.evaluate((element) => {
    const scrollRegion = element.querySelector<HTMLElement>("[data-live-scroll-region]");
    const utilities = element.querySelector<HTMLElement>("[data-live-controls-utilities]");

    if (scrollRegion === null || utilities === null) {
      return null;
    }

    return utilities.getBoundingClientRect().top - scrollRegion.getBoundingClientRect().bottom;
  });

  expect(verticalGap).not.toBeNull();
  expect(verticalGap ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(11);
  await expectNoDocumentOverflow(page);
});

async function expectMinimumInteractiveTargetSize(page: Page): Promise<void> {
  const minimumTargetSize = 44 - 0.01;
  const undersizedTargets = await page
    .locator(
      ".liveShell button:visible, .liveShell input:not([type=radio]):not([type=checkbox]):visible, .liveShell select:visible, .liveShell textarea:visible",
    )
    .evaluateAll(
      (elements, minimumSize) =>
        elements.flatMap((element) => {
          const bounds = element.getBoundingClientRect();

          if (bounds.width >= minimumSize && bounds.height >= minimumSize) {
            return [];
          }

          return [
            {
              height: bounds.height,
              label:
                element.getAttribute("aria-label") ??
                element.getAttribute("name") ??
                (element.textContent.trim() || element.tagName),
              width: bounds.width,
            },
          ];
        }),
      minimumTargetSize,
    );

  expect(undersizedTargets).toEqual([]);
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const overflow = await readDocumentOverflow(page);

  expect(overflow.scrollX).toBe(0);
  expect(overflow.scrollY).toBe(0);
  expect(overflow.overflowX).toBeLessThanOrEqual(1);
  expect(overflow.overflowY).toBeLessThanOrEqual(1);
}

async function expectNoHorizontalDocumentOverflow(page: Page): Promise<void> {
  const overflow = await readDocumentOverflow(page);

  expect(overflow.scrollX).toBe(0);
  expect(overflow.overflowX).toBeLessThanOrEqual(1);
}

type Bounds = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

function requireBounds(bounds: Bounds | null): Bounds {
  if (bounds === null) {
    throw new Error("Expected a visible element with layout bounds.");
  }

  return bounds;
}

function rectanglesIntersect(first: Bounds, second: Bounds): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}
