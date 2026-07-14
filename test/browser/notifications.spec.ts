import { createWaitingRoom, requirePlayer } from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";

test("toast announcements preserve the trigger focus contract", async ({ live, page, request }) => {
  const { players } = await createWaitingRoom(request, ["Juniper"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token, shareStub: "immediate" });

  const shareButton = page.getByRole("button", {
    name: live.t.live.buttons.shareInvite,
    exact: true,
  });

  await shareButton.click();

  const toast = page.locator('[data-live-toast][data-tone="success"]');
  const announcer = page.locator('[data-live-toast-announcer="polite"]');
  const dismissButton = toast.getByRole("button", {
    name: live.t.live.buttons.dismissNotification,
    exact: true,
  });

  await expect(toast).toBeVisible();
  await expect(announcer).toHaveAttribute("aria-atomic", "true");
  await expect(announcer).toHaveAttribute("aria-live", "polite");
  await expect(announcer).toHaveAttribute("role", "status");
  const visibleMessage = toast.locator("p[data-live-toast-content]");

  await expect.poll(async () => (await visibleMessage.textContent())?.trim()).not.toBe("");
  const message = (await visibleMessage.textContent())?.trim();

  if (message === undefined || message === "") {
    throw new Error("The visible notification did not render a message.");
  }

  await expect(announcer).toContainText(message);
  await expect(shareButton).toBeFocused();

  await dismissButton.focus();
  await dismissButton.press("Enter");
  await expect(toast).toHaveCount(0);
  await expect(shareButton).toBeFocused();
});

test("an error replacement stays singular and non-interactive behind a modal", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Kite"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token, shareStub: "immediate" });
  await page.getByRole("button", { name: live.t.live.buttons.shareInvite, exact: true }).click();
  await expect(page.locator("[data-live-toast]")).toBeVisible();

  await live.leaveButton().click();
  const dialog = live.leaveDialog();

  await page.route("**/api/rooms/*/leave", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "server_error", message: "Fixture failure" } }),
      contentType: "application/json",
      status: 500,
    });
  });
  await dialog
    .getByRole("button", { name: live.t.live.buttons.confirmLeaveRoom, exact: true })
    .click();

  const toast = page.locator("[data-live-toast]");
  const announcer = page.locator('[data-live-toast-announcer="assertive"]');
  const dismissButton = toast.getByRole("button", {
    name: live.t.live.buttons.dismissNotification,
    exact: true,
  });

  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-tone", "error");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
  await expect(announcer).toHaveAttribute("role", "alert");
  await expect(dismissButton).toBeDisabled();

  await dialog.getByRole("button", { name: live.t.live.buttons.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(dismissButton).toBeEnabled();
});

test("a room-scoped result is discarded after its room session ends", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Linden"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token, shareStub: "deferred" });
  await page.getByRole("button", { name: live.t.live.buttons.shareInvite, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "__resolveLiveShare")))
    .toBe("function");

  await live.leaveButton().click();
  await live
    .leaveDialog()
    .getByRole("button", { name: live.t.live.buttons.confirmLeaveRoom, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: live.t.live.buttons.createRoom, exact: true }),
  ).toBeVisible();

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
