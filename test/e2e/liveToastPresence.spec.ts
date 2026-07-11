import { expect, test } from "playwright/test";

import { enLocalization } from "@/lib/i18n/localization/en";

import { apiFetch, createApiPlayer, createStartedRoom } from "./support/api";

import type { APIRequestContext, Page } from "playwright/test";

test("a success toast settles, pauses safely, and auto-dismisses", async ({ page, request }) => {
  const { host } = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token, { shareStub: "immediate" });

  const shareButton = page.getByRole("button", { exact: true, name: "Share invite" });

  await shareButton.click();

  const toast = page.locator('[data-live-toast][data-tone="success"]');
  const politeAnnouncer = page.locator('[data-live-toast-announcer="polite"]');
  const closeButton = toast.getByRole("button", { name: "Dismiss notification" });

  await expect(toast).toHaveAttribute("data-live-toast-motion-kind", "enter");
  await expect(toast).toHaveAttribute("data-live-toast-phase", "entered", { timeout: 2_000 });
  await expect(toast).not.toHaveAttribute("data-live-toast-motion-kind", /.+/u);
  await expect(politeAnnouncer).toHaveAttribute("aria-atomic", "true");
  await expect(politeAnnouncer).toHaveAttribute("aria-live", "polite");
  await expect(politeAnnouncer).toHaveAttribute("role", "status");
  await expect(politeAnnouncer).toContainText(enLocalization.live.invite.shareSucceeded);
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "running");
  await expect(shareButton).toBeFocused();
  await expect(closeButton).toBeEnabled();
  await expect
    .poll(async () => Math.round((await closeButton.boundingBox())?.height ?? 0))
    .toBe(44);
  await expectToastMotionStylesToBeClear(toast);

  await toast.hover();
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "paused");
  await page.waitForTimeout(5_100);
  await expect(toast).toHaveCount(1);
  await page.mouse.move(1, 400);
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "running");
  await closeButton.focus();
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "paused");
  await shareButton.focus();
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "running");
  await expect(toast).toHaveCount(0, { timeout: 6_000 });
});

test("latest replacement stays singular and remains readable above a modal", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const { host } = await createWaitingRoom(request);

  page.on("pageerror", (error) => errors.push(error.message));
  await openWaitingRoomAsPlayer(page, host.token, { shareStub: "immediate" });
  await page.getByRole("button", { exact: true, name: "Share invite" }).click();

  const toast = page.locator("[data-live-toast]");

  await expect(toast).toHaveAttribute("data-live-toast-phase", "entered", { timeout: 2_000 });
  const leaveButton = page.getByRole("button", { exact: true, name: "Leave room" });

  await leaveButton.click();

  const leaveDialog = page.getByRole("dialog", { name: "Leave this room?" });
  const assertiveAnnouncer = page.locator('[data-live-toast-announcer="assertive"]');

  await expect(leaveDialog).toBeVisible();
  await page.route("**/api/rooms/*/leave", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "server_error", message: "Leave failed." } }),
      contentType: "application/json",
      status: 500,
    });
  });
  await leaveDialog.getByRole("button", { exact: true, name: "Leave room" }).click();

  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-tone", "error");
  await expect(toast).toContainText(enLocalization.api.errors.server_error);
  await expect(assertiveAnnouncer).toHaveAttribute("aria-live", "assertive");
  await expect(assertiveAnnouncer).toHaveAttribute("role", "alert");
  await expect(assertiveAnnouncer).toContainText(enLocalization.api.errors.server_error);
  await expect(toast).toHaveAttribute("data-live-toast-interaction", "suppressed");
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "paused");
  await expect(toast.getByRole("button", { name: "Dismiss notification" })).toBeDisabled();
  await expect
    .poll(() =>
      page
        .locator("[data-live-toast-viewport]")
        .evaluate((viewport) => (viewport instanceof HTMLElement ? viewport.inert : true)),
    )
    .toBe(false);

  await leaveDialog.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(leaveDialog).toHaveCount(0, { timeout: 2_000 });
  await expect(toast).toHaveAttribute("data-live-toast-interaction", "enabled");
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "running");
  await expect(toast.getByRole("button", { name: "Dismiss notification" })).toBeEnabled();

  await page.waitForTimeout(5_000);
  await expect(toast).toHaveCount(1);
  await toast.getByRole("button", { name: "Dismiss notification" }).focus();
  await toast.getByRole("button", { name: "Dismiss notification" }).press("Enter");
  await expect(toast).toHaveAttribute("data-live-toast-motion-kind", "exit");
  await expect(toast).toHaveCount(0, { timeout: 2_000 });
  await expect(leaveButton).toBeFocused();
  expect(errors).toEqual([]);
});

test("replacement returns keyboard focus from the outgoing toast", async ({ page, request }) => {
  const { host } = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token, { shareStub: "immediate" });

  const shareButton = page.getByRole("button", { exact: true, name: "Share invite" });
  const toast = page.locator("[data-live-toast]");

  await shareButton.click();
  await expect(toast).toHaveAttribute("data-live-toast-phase", "entered", { timeout: 2_000 });
  await toast.getByRole("button", { name: "Dismiss notification" }).focus();

  await failNextCurrentRoomRequest(page);

  await expect(toast).toHaveAttribute("data-tone", "warning", { timeout: 6_000 });
  await expect(shareButton).toBeFocused();
});

test("replacement does not restore stale focus after the toast is blurred", async ({
  page,
  request,
}) => {
  const { host } = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token, { shareStub: "immediate" });

  const shareButton = page.getByRole("button", { exact: true, name: "Share invite" });
  const toast = page.locator("[data-live-toast]");
  const closeButton = toast.getByRole("button", { name: "Dismiss notification" });

  await shareButton.click();
  await expect(toast).toHaveAttribute("data-live-toast-phase", "entered", { timeout: 2_000 });
  await closeButton.focus();
  await closeButton.evaluate((button) => button.blur());
  await expect(closeButton).not.toBeFocused();

  await failNextCurrentRoomRequest(page);

  await expect(toast).toHaveAttribute("data-tone", "warning", { timeout: 6_000 });
  await expect(shareButton).not.toBeFocused();
  await closeButton.focus();
  await closeButton.press("Enter");
  await expect(toast).toHaveCount(0, { timeout: 2_000 });
  await expect(shareButton).not.toBeFocused();
});

test("a nested playing modal suppresses toast interaction and its timer", async ({
  page,
  request,
}) => {
  const { players } = await createStartedRoom(request, ["Aster", "Birch", "Cedar"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Started room did not include a host.");
  }

  await openLiveAsPlayer(page, host.token);
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 8_000 });

  await failNextCurrentRoomRequest(page);

  const toast = page.locator('[data-live-toast][data-tone="warning"]');

  await expect(toast).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: /Public log/u }).click();

  const publicLogDialog = page.getByRole("dialog", { name: "Public log" });

  await expect(publicLogDialog).toBeVisible();
  await expect(toast).toHaveAttribute("data-live-toast-interaction", "suppressed");
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "paused");
  await expect(toast.getByRole("button", { name: "Dismiss notification" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(publicLogDialog).toHaveCount(0, { timeout: 2_000 });
  await expect(toast).toHaveAttribute("data-live-toast-interaction", "enabled");
  await expect(toast).toHaveAttribute("data-live-toast-timer-state", "running");
});

test("a stale room-scoped share result is discarded after leaving", async ({ page, request }) => {
  const { host } = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token, { shareStub: "deferred" });
  await page.getByRole("button", { exact: true, name: "Share invite" }).click();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "__resolveLiveShare")))
    .toBe("function");

  await page.getByRole("button", { exact: true, name: "Leave room" }).click();
  await page
    .getByRole("dialog", { name: "Leave this room?" })
    .getByRole("button", { exact: true, name: "Leave room" })
    .click();
  await expect(page.getByRole("button", { exact: true, name: "Create room" })).toBeVisible();

  await page.evaluate(() => {
    const resolveShare = Reflect.get(window, "__resolveLiveShare");

    if (typeof resolveShare === "function") {
      resolveShare();
    }
  });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__liveShareSettled") === true))
    .toBe(true);
  await expect(page.locator('[data-live-toast][data-tone="success"]')).toHaveCount(0);
});

test("reduced motion keeps a page warning across room-session cleanup", async ({
  page,
  request,
}) => {
  const { host } = await createWaitingRoom(request);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWaitingRoomAsPlayer(page, host.token);
  await page.getByRole("button", { exact: true, name: "Leave room" }).click();

  const leaveDialog = page.getByRole("dialog", { name: "Leave this room?" });

  await page.route("**/api/rooms/*/leave", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "unauthorized", message: "Identity expired." } }),
      contentType: "application/json",
      status: 401,
    });
  });
  await leaveDialog.getByRole("button", { exact: true, name: "Leave room" }).click();

  const toast = page.locator('[data-live-toast][data-tone="warning"]');

  await expect(page.getByRole("button", { exact: true, name: "Create room" })).toBeVisible();
  await expect(toast).toContainText(enLocalization.live.room.identityExpired);
  await expect(toast).toHaveAttribute("data-live-toast-phase", "entered");
  await expect(toast).not.toHaveAttribute("data-live-toast-motion-kind", /.+/u);
  await expectToastMotionStylesToBeClear(toast);
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(toast).toHaveCount(0);
});

async function createWaitingRoom(
  request: APIRequestContext,
): Promise<{ readonly host: Awaited<ReturnType<typeof createApiPlayer>> }> {
  const host = await createApiPlayer(request, "host", "Aster");

  await apiFetch(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  return { host };
}

async function failNextCurrentRoomRequest(page: Page): Promise<void> {
  let didFailCurrentRoom = false;

  await page.route("**/api/rooms/current", async (route) => {
    if (!didFailCurrentRoom && route.request().method() === "GET") {
      didFailCurrentRoom = true;
      await route.fulfill({
        body: JSON.stringify({ error: { code: "server_error", message: "Sync failed." } }),
        contentType: "application/json",
        status: 500,
      });
      return;
    }

    await route.continue();
  });
}

async function openWaitingRoomAsPlayer(
  page: Page,
  identityToken: string,
  options: { readonly shareStub?: "deferred" | "immediate" } = {},
): Promise<void> {
  await openLiveAsPlayer(page, identityToken, options);
  await expect(page.getByRole("button", { exact: true, name: "Settings" })).toBeVisible();
}

async function openLiveAsPlayer(
  page: Page,
  identityToken: string,
  options: { readonly shareStub?: "deferred" | "immediate" } = {},
): Promise<void> {
  await page.addInitScript(
    ({ shareStub, token }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", token);
      window.localStorage.setItem("jinrohWeb.locale", "en");

      if (shareStub === "immediate") {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async () => undefined,
        });
      } else if (shareStub === "deferred") {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: () =>
            new Promise<void>((resolve) => {
              Reflect.set(window, "__resolveLiveShare", () => {
                resolve();
                queueMicrotask(() => Reflect.set(window, "__liveShareSettled", true));
              });
            }),
        });
      }
    },
    { shareStub: options.shareStub ?? null, token: identityToken },
  );
  await page.goto("/live");
}

async function expectToastMotionStylesToBeClear(toast: ReturnType<Page["locator"]>): Promise<void> {
  await expect
    .poll(() =>
      toast.evaluate((root) => {
        const motionElements = [
          root,
          ...root.querySelectorAll<HTMLElement>(
            "[data-live-toast-content], [data-live-toast-rail], [data-live-toast-sheen]",
          ),
        ];

        return motionElements.every((element) => {
          const htmlElement = element as HTMLElement;

          return (
            htmlElement.style.opacity === "" &&
            htmlElement.style.transform === "" &&
            htmlElement.style.transformOrigin === "" &&
            htmlElement.style.willChange === ""
          );
        });
      }),
    )
    .toBe(true);
}
