import { expect, test } from "playwright/test";

import { createStartedRoom, submitOpenActions } from "./support/api";

test("crossfades accepted phase backgrounds and clears transient layers", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Aster", "Birch", "Cedar"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Background motion test host was not created.");
  }

  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");

  const background = page.locator("[data-live-ambient-background]");
  const scenes = background.locator("[data-live-background-scene]");

  await expect(page.locator('.liveShell[data-live-mood="night"]')).toBeVisible();
  await expect(scenes).toHaveCount(1);
  await expect(scenes).toHaveAttribute("data-live-background-mood", "night");
  await expect(background).not.toHaveAttribute("data-live-background-motion", /.+/u);

  await submitOpenActions(request, roomCode, players);

  await expect(background).toHaveAttribute("data-live-background-motion", "crossfade", {
    timeout: 8_000,
  });
  await expect(scenes).toHaveCount(2);
  await expect(page.locator('.liveShell[data-live-mood="day"]')).toBeVisible();
  await expect(scenes).toHaveCount(1, { timeout: 3_000 });
  await expect(scenes).toHaveAttribute("data-live-background-mood", "day");
  await expect(background).not.toHaveAttribute("data-live-background-motion", /.+/u);
  await expect(scenes).not.toHaveAttribute("style", /(?:opacity|visibility|will-change)/u);
});

test("reduced motion settles a mobile background immediately", async ({ page, request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Dawn", "Elm", "Fir"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Reduced-motion background test host was not created.");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 812, width: 375 });
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");

  const background = page.locator("[data-live-ambient-background]");
  const scenes = background.locator("[data-live-background-scene]");

  await expect(page.locator('.liveShell[data-live-mood="night"]')).toBeVisible();
  await submitOpenActions(request, roomCode, players);
  await expect(page.locator('.liveShell[data-live-mood="day"]')).toBeVisible({ timeout: 8_000 });
  await expect(scenes).toHaveCount(1);
  await expect(scenes).toHaveAttribute("data-live-background-mood", "day");
  await expect(background).not.toHaveAttribute("data-live-background-motion", /.+/u);

  const layout = await background.evaluate((element) => {
    const bounds = element.getBoundingClientRect();

    return {
      bottom: bounds.bottom,
      height: bounds.height,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      width: bounds.width,
    };
  });

  expect(layout).toEqual({
    bottom: 812,
    height: 812,
    horizontalOverflow: 0,
    left: 0,
    right: 375,
    top: 0,
    width: 375,
  });
});
