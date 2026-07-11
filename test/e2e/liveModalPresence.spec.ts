import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, createStartedRoom, readRoomSummary } from "./support/api";

import type { APIRequestContext, Page } from "playwright/test";

test("settings and popup modals share GSAP presence and restore isolation", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const { host } = await createWaitingRoom(request);

  page.on("pageerror", (error) => errors.push(error.message));
  await openWaitingRoomAsPlayer(page, host.token);

  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await settingsButton.click();

  const settingsRoot = getModalRoot(page, "settings");
  const settingsDialog = page.getByRole("dialog", { name: "Game settings" });

  await expect(settingsRoot).toHaveAttribute("data-live-modal-motion-kind", "enter");
  await expect(settingsRoot).toHaveAttribute("data-live-modal-phase", "entered", {
    timeout: 2_000,
  });
  await expect(settingsRoot).not.toHaveAttribute("data-live-modal-motion-kind", /.+/u);
  await expect(settingsDialog.getByRole("button", { name: "Close settings" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expect
    .poll(() => readModalIsolation(page))
    .toMatchObject({
      allUnderlyingBranchesInert: true,
      inertBranchCount: expect.any(Number),
    });
  await expectModalMotionStylesToBeClear(settingsRoot);

  await page.keyboard.press("Escape");

  await expect(settingsRoot).toHaveAttribute("data-live-modal-motion-kind", "exit");
  await expect(settingsDialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expect(settingsRoot).toHaveCount(0, { timeout: 2_000 });
  await expect(settingsButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect.poll(() => readInertElementCount(page)).toBe(0);

  const leaveButton = page.getByRole("button", { exact: true, name: "Leave room" });

  await leaveButton.click();

  const popupRoot = getModalRoot(page, "popup");
  const leaveDialog = page.getByRole("dialog", { name: "Leave this room?" });

  await expect(popupRoot).toHaveAttribute("data-live-modal-motion-kind", "enter");
  await expect
    .poll(() => readModalEntryGeometry(popupRoot))
    .toMatchObject({
      minimumActionHeight: 44,
      scaleX: 1,
      scaleY: 1,
    });
  await expect(popupRoot).toHaveAttribute("data-live-modal-phase", "entered", {
    timeout: 2_000,
  });
  await expectModalMotionStylesToBeClear(popupRoot);
  await popupRoot.click({ position: { x: 4, y: 4 } });
  await expect(popupRoot).toHaveAttribute("data-live-modal-motion-kind", "exit");
  await expect(leaveDialog).toBeVisible();
  await expect(popupRoot).toHaveCount(0, { timeout: 2_000 });
  await expect(leaveButton).toBeFocused();
  await expect.poll(() => readInertElementCount(page)).toBe(0);

  expect(errors).toEqual([]);
});

test("closing during modal entry reverses cleanly", async ({ page, request }) => {
  const { host } = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token);

  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await settingsButton.click();

  const settingsRoot = getModalRoot(page, "settings");
  const closeButton = page.getByRole("button", { name: "Close settings" });

  await expect(settingsRoot).toHaveAttribute("data-live-modal-motion-kind", "enter");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settingsRoot).toHaveAttribute("data-live-modal-motion-kind", "exit");
  await expect(settingsRoot).toHaveCount(0, { timeout: 2_000 });
  await expect(settingsButton).toBeFocused();
  await expect.poll(() => readInertElementCount(page)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("reduced motion opens and closes a modal without transient styles", async ({
  page,
  request,
}) => {
  const { host } = await createWaitingRoom(request);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWaitingRoomAsPlayer(page, host.token);

  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await settingsButton.click();

  const settingsRoot = getModalRoot(page, "settings");

  await expect(settingsRoot).toHaveAttribute("data-live-modal-phase", "entered");
  await expect(settingsRoot).not.toHaveAttribute("data-live-modal-motion-kind", /.+/u);
  await expectModalMotionStylesToBeClear(settingsRoot);
  await page.keyboard.press("Escape");
  await expect(settingsRoot).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
  await expect.poll(() => readInertElementCount(page)).toBe(0);
});

test("a busy confirmation modal cannot be dismissed", async ({ page, request }) => {
  const { host } = await createWaitingRoom(request);
  const leaveRequestGate = createGate();
  const leaveRequestStarted = createGate();

  await openWaitingRoomAsPlayer(page, host.token);
  await page.route("**/api/rooms/*/leave", async (route) => {
    leaveRequestStarted.release();
    await leaveRequestGate.wait;
    await route.continue();
  });
  await page.getByRole("button", { exact: true, name: "Leave room" }).click();

  const popupRoot = getModalRoot(page, "popup");
  const leaveDialog = page.getByRole("dialog", { name: "Leave this room?" });

  await expect(popupRoot).toHaveAttribute("data-live-modal-phase", "entered", {
    timeout: 2_000,
  });
  await leaveDialog.getByRole("button", { exact: true, name: "Leave room" }).click();
  await leaveRequestStarted.wait;
  await expect(leaveDialog.getByRole("button", { name: "Close Leave this room?" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await popupRoot.click({ force: true, position: { x: 4, y: 4 } });
  await page.waitForTimeout(300);

  await expect(leaveDialog).toBeVisible();
  await expect(popupRoot).toHaveAttribute("data-live-modal-phase", "entered");
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  leaveRequestGate.release();
  await expect(page.locator('.liveShell[data-live-mood="setup"]')).toBeVisible({
    timeout: 8_000,
  });
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect.poll(() => readInertElementCount(page)).toBe(0);
});

test("playing popup routes share the modal lifecycle", async ({ page, request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Aster", "Birch", "Cedar"]);
  const summaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const werewolfIndex = summaries.findIndex((summary) => summary.self?.roleId === "werewolf");
  const werewolf = players[werewolfIndex];

  if (werewolf === undefined) {
    throw new Error("Modal presence test could not identify the werewolf.");
  }

  await openLiveAsPlayer(page, werewolf.token);
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 8_000 });

  const nightChatButton = page.getByRole("button", { exact: true, name: "Night chat" });

  await nightChatButton.click();

  const nightChatRoot = getModalRoot(page, "popup");
  const nightChatDialog = page.getByRole("dialog", { name: "Werewolf council" });

  await expect(nightChatRoot).toHaveAttribute("data-live-modal-motion-kind", "enter");
  await expect(nightChatRoot).toHaveAttribute("data-live-modal-phase", "entered", {
    timeout: 2_000,
  });
  await page.keyboard.press("Escape");
  await expect(nightChatDialog).toHaveCount(0, { timeout: 2_000 });
  await expect(nightChatButton).toBeFocused();

  const publicLogButton = page.getByRole("button", { exact: true, name: /Public log/u });

  await publicLogButton.click();

  const publicLogRoot = getModalRoot(page, "popup");
  const publicLogDialog = page.getByRole("dialog", { name: "Public log" });

  await expect(publicLogRoot).toHaveAttribute("data-live-modal-motion-kind", "enter");
  await expect(publicLogRoot).toHaveAttribute("data-live-modal-phase", "entered", {
    timeout: 2_000,
  });
  await page.keyboard.press("Escape");
  await expect(publicLogDialog).toHaveCount(0, { timeout: 2_000 });
  await expect(publicLogButton).toBeFocused();
  await expect.poll(() => readInertElementCount(page)).toBe(0);
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

async function openLiveAsPlayer(page: Page, identityToken: string): Promise<void> {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", token);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { token: identityToken },
  );
  await page.goto("/live");
}

async function openWaitingRoomAsPlayer(page: Page, identityToken: string): Promise<void> {
  await openLiveAsPlayer(page, identityToken);
  await expect(page.getByRole("button", { exact: true, name: "Settings" })).toBeVisible();
}

function getModalRoot(page: Page, variant: "popup" | "settings") {
  return page.locator(`[data-live-modal-root][data-live-modal-variant="${variant}"]`);
}

async function readModalEntryGeometry(modalRoot: ReturnType<Page["locator"]>): Promise<{
  readonly minimumActionHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
}> {
  return modalRoot.evaluate((root) => {
    const dialog = root.querySelector<HTMLElement>("[data-live-modal-dialog]");
    const actionButtons = [
      ...root.querySelectorAll<HTMLElement>(".liveConfirmationActions button"),
    ];

    if (dialog === null || actionButtons.length === 0) {
      return { minimumActionHeight: 0, scaleX: 0, scaleY: 0 };
    }

    const transform = new DOMMatrixReadOnly(window.getComputedStyle(dialog).transform);

    return {
      minimumActionHeight: Math.round(
        Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height)),
      ),
      scaleX: Math.hypot(transform.a, transform.b),
      scaleY: Math.hypot(transform.c, transform.d),
    };
  });
}

async function readModalIsolation(page: Page): Promise<{
  readonly allUnderlyingBranchesInert: boolean;
  readonly inertBranchCount: number;
}> {
  return page.evaluate(() => {
    const modalRoot = document.querySelector<HTMLElement>("[data-live-modal-root]");

    if (modalRoot === null) {
      return { allUnderlyingBranchesInert: false, inertBranchCount: 0 };
    }

    const boundary = document.body;
    const underlyingBranches: HTMLElement[] = [];
    let currentBranch = modalRoot;

    while (currentBranch.parentElement !== null) {
      const parent = currentBranch.parentElement;

      for (const sibling of parent.children) {
        if (sibling instanceof HTMLElement && sibling !== currentBranch) {
          underlyingBranches.push(sibling);
        }
      }

      if (parent === boundary) {
        break;
      }

      currentBranch = parent;
    }

    return {
      allUnderlyingBranchesInert:
        underlyingBranches.length > 0 && underlyingBranches.every((element) => element.inert),
      inertBranchCount: underlyingBranches.length,
    };
  });
}

async function readInertElementCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("[inert]")].filter((element) => element.inert)
        .length,
  );
}

async function expectModalMotionStylesToBeClear(
  modalRoot: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect
    .poll(() =>
      modalRoot.evaluate((root) => {
        const dialog = root.querySelector<HTMLElement>("[data-live-modal-dialog]");

        return [root, dialog]
          .filter((element): element is HTMLElement => element !== null)
          .every(
            (element) =>
              element.style.opacity === "" &&
              element.style.transform === "" &&
              element.style.visibility === "" &&
              element.style.willChange === "",
          );
      }),
    )
    .toBe(true);
}

function createGate(): { readonly release: () => void; readonly wait: Promise<void> } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release: () => release(), wait };
}
