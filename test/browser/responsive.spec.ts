import { readDocumentOverflow, readLayoutMode } from "../fixtures/livePage";
import { createWaitingRoom, requirePlayer } from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";

import type { Page } from "playwright/test";

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
});

test("599px and 600px select their documented portrait layout modes", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Portrait host"], 6);
  const host = requirePlayer(players, 0);

  await page.setViewportSize({ height: 800, width: 599 });
  await live.open({ identityToken: host.token });
  await expect(page.locator("[data-live-room-layout]")).toBeVisible();
  await expect.poll(() => readLayoutMode(page)).toBe("phone-portrait");
  await expect(page.locator("[data-live-table-surface]")).toBeVisible();
  await expect(page.locator("[data-live-controls]")).toBeVisible();
  await expectNoDocumentOverflow(page);

  await page.setViewportSize({ height: 800, width: 600 });
  await expect.poll(() => readLayoutMode(page)).toBe("tablet-portrait");
  await expect(page.locator("[data-live-table-surface]")).toBeVisible();
  await expect(page.locator("[data-live-controls]")).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test("phone landscape keeps waiting controls and settings footer reachable", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Landscape host"], 6);
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
});

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const overflow = await readDocumentOverflow(page);

  expect(overflow.scrollX).toBe(0);
  expect(overflow.scrollY).toBe(0);
  expect(overflow.overflowX).toBeLessThanOrEqual(1);
  expect(overflow.overflowY).toBeLessThanOrEqual(1);
}
