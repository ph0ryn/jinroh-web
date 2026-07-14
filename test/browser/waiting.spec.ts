import { readRoomSummary } from "../fixtures/apiClient";
import {
  createBrowserPlayer,
  createGate,
  readInertElementCount,
  readModalIsolation,
} from "../fixtures/livePage";
import { createWaitingRoom, requirePlayer } from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";

test("leaving transfers host authority and restores focus after cancellation", async ({
  browser,
  request,
}) => {
  const { players, roomCode } = await createWaitingRoom(request, ["Aster", "Birch", "Cedar"]);
  const hostPlayer = requirePlayer(players, 0);
  const successorPlayer = requirePlayer(players, 1);
  const remainingPlayer = requirePlayer(players, 2);
  const host = await createBrowserPlayer(browser, hostPlayer);
  const successor = await createBrowserPlayer(browser, successorPlayer);

  try {
    await expect(host.live.settingsButton()).toBeVisible();
    await expect(successor.live.settingsButton()).toHaveCount(0);

    await host.live.leaveButton().click();
    const leaveDialog = host.live.leaveDialog();

    await expect(leaveDialog).toBeVisible();
    await leaveDialog
      .getByRole("button", { name: host.live.t.live.buttons.cancel, exact: true })
      .click();
    await expect(leaveDialog).toHaveCount(0);
    await expect(host.live.leaveButton()).toBeFocused();
    await expect(host.live.currentRoomCode()).toHaveText(roomCode);

    await host.live.leaveButton().click();
    await leaveDialog
      .getByRole("button", { name: host.live.t.live.buttons.confirmLeaveRoom, exact: true })
      .click();

    await expect(
      host.page.getByRole("button", {
        name: host.live.t.live.buttons.createRoom,
        exact: true,
      }),
    ).toBeVisible();
    await expect(successor.live.settingsButton()).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => {
        const [successorSummary, remainingSummary] = await Promise.all([
          readRoomSummary(request, roomCode, successorPlayer),
          readRoomSummary(request, roomCode, remainingPlayer),
        ]);

        return [successorSummary.isHost, remainingSummary.isHost];
      })
      .toEqual([true, false]);
  } finally {
    await Promise.all([host.context.close(), successor.context.close()]);
  }
});

test("settings keyboard navigation keeps drafts local until apply", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Dahlia"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token });
  await live.settingsButton().click();

  let dialog = live.settingsDialog();
  const generalTab = dialog.locator('[data-live-settings-tab="general"]');
  const timersTab = dialog.locator('[data-live-settings-tab="timers"]');
  const rolesTab = dialog.locator('[data-live-settings-tab="roles"]');

  await generalTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(timersTab).toBeFocused();
  await expect(timersTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(rolesTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(generalTab).toBeFocused();

  const orderedDayMode = dialog.locator('input[name="dayMode"][value="ordered_speech"]');

  await orderedDayMode.focus();
  await orderedDayMode.press("Space");
  await expect(orderedDayMode).toBeChecked();
  await dialog.getByRole("button", { name: live.t.live.buttons.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await live.settingsButton().click();
  dialog = live.settingsDialog();
  await expect(dialog.locator('input[name="dayMode"][value="ready_check"]')).toBeChecked();
  const appliedOrderedDayMode = dialog.locator('input[name="dayMode"][value="ordered_speech"]');

  await appliedOrderedDayMode.focus();
  await appliedOrderedDayMode.press("Space");
  await expect(appliedOrderedDayMode).toBeChecked();
  await dialog
    .getByRole("button", { name: live.t.live.buttons.applySettings, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);

  await live.settingsButton().click();
  await expect(
    live.settingsDialog().locator('input[name="dayMode"][value="ordered_speech"]'),
  ).toBeChecked();
});

test("applied settings survive a reload only for the same waiting room session", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Scoped settings host"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token });
  await live.settingsButton().click();

  let dialog = live.settingsDialog();
  const orderedDayMode = dialog.locator('input[name="dayMode"][value="ordered_speech"]');

  await orderedDayMode.focus();
  await orderedDayMode.press("Space");
  await expect(orderedDayMode).toBeChecked();
  await dialog
    .getByRole("button", { name: live.t.live.buttons.applySettings, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await live.settingsButton().click();
  dialog = live.settingsDialog();
  await expect(dialog.locator('input[name="dayMode"][value="ordered_speech"]')).toBeChecked();
  await dialog.getByRole("button", { name: live.t.live.buttons.cancel, exact: true }).click();

  await live.leaveButton().click();
  await live
    .leaveDialog()
    .getByRole("button", { name: live.t.live.buttons.confirmLeaveRoom, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: live.t.live.buttons.createRoom, exact: true }),
  ).toBeVisible();

  await live.createRoom(3);
  await live.settingsButton().click();
  await expect(
    live.settingsDialog().locator('input[name="dayMode"][value="ready_check"]'),
  ).toBeChecked();
});

test("settings modal owns focus, background isolation, and scrolling", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Elm"], 3);
  const host = requirePlayer(players, 0);

  await page.setViewportSize({ height: 500, width: 390 });
  await live.open({ identityToken: host.token });
  await live.settingsButton().click();

  const dialog = live.settingsDialog();
  const closeButton = dialog.getByRole("button", {
    name: live.t.live.buttons.closeSettings,
    exact: true,
  });
  const applyButton = dialog.getByRole("button", {
    name: live.t.live.buttons.applySettings,
    exact: true,
  });

  await expect(closeButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expect
    .poll(() => readModalIsolation(page))
    .toMatchObject({
      allUnderlyingBranchesInert: true,
      inertBranchCount: expect.any(Number),
    });

  await page.keyboard.press("Shift+Tab");
  await expect(applyButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  const scrollOwnership = await dialog.evaluate((root) => {
    const body = root.querySelector<HTMLElement>(".liveSettingsBody");
    const footer = root.querySelector<HTMLElement>(".liveSettingsFooter");

    return {
      bodyCanScroll: body !== null && body.scrollHeight > body.clientHeight,
      dialogOverflow: getComputedStyle(root).overflow,
      footerIsVisible:
        footer !== null && footer.getBoundingClientRect().bottom <= window.innerHeight + 1,
    };
  });

  expect(scrollOwnership).toEqual({
    bodyCanScroll: true,
    dialogOverflow: "hidden",
    footerIsVisible: true,
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(live.settingsButton()).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect.poll(() => readInertElementCount(page)).toBe(0);
});

test("a pending destructive request makes its modal non-dismissible", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Fir"], 3);
  const host = requirePlayer(players, 0);
  const leaveRequest = createGate();
  const requestStarted = createGate();

  await live.open({ identityToken: host.token });
  await page.route("**/api/rooms/*/leave", async (route) => {
    requestStarted.release();
    await leaveRequest.wait;
    await route.continue();
  });

  try {
    await live.leaveButton().click();
    const dialog = live.leaveDialog();

    await dialog
      .getByRole("button", { name: live.t.live.buttons.confirmLeaveRoom, exact: true })
      .click();
    await requestStarted.wait;

    const closeButton = dialog.getByRole("button", {
      name: live.t.live.buttons.closeDialog(live.t.live.leaveConfirmation.title),
      exact: true,
    });

    await expect(closeButton).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    leaveRequest.release();
    await expect(
      page.getByRole("button", { name: live.t.live.buttons.createRoom, exact: true }),
    ).toBeVisible();
  } finally {
    leaveRequest.release();
    await page.unroute("**/api/rooms/*/leave");
  }
});
