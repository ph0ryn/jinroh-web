import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, createStartedRoom, readRoomSummary } from "./support/api";

import type { APIRequestContext, Page } from "playwright/test";

type ViewportCase = {
  readonly height: number;
  readonly mode:
    | "phone-landscape"
    | "phone-portrait"
    | "tablet-landscape-desktop"
    | "tablet-portrait";
  readonly width: number;
};

const VIEWPORT_CASES: readonly ViewportCase[] = [
  { height: 568, mode: "phone-portrait", width: 320 },
  { height: 844, mode: "phone-portrait", width: 390 },
  { height: 650, mode: "phone-portrait", width: 594 },
  { height: 807, mode: "phone-portrait", width: 594 },
  { height: 800, mode: "phone-portrait", width: 599 },
  { height: 800, mode: "tablet-portrait", width: 600 },
  { height: 1024, mode: "tablet-portrait", width: 768 },
  { height: 1366, mode: "tablet-portrait", width: 1024 },
  { height: 375, mode: "phone-landscape", width: 667 },
  { height: 390, mode: "phone-landscape", width: 844 },
  { height: 600, mode: "tablet-landscape-desktop", width: 900 },
  { height: 768, mode: "tablet-landscape-desktop", width: 1024 },
  { height: 390, mode: "tablet-landscape-desktop", width: 1280 },
  { height: 900, mode: "tablet-landscape-desktop", width: 1440 },
];

test("entry keeps the page fixed and combines portrait mode selection with its panel", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(() => {
    window.localStorage.setItem("jinrohWeb.displayName", "Responsive player");
    window.localStorage.setItem("jinrohWeb.locale", "en");
  });
  await page.goto("/live");

  const entry = page.locator("[data-live-entry-mode]");
  const displayNameInput = page.getByLabel("Display name");
  const modeGroup = page.getByRole("group", { name: "Choose how to enter a room" });
  const createModeButton = modeGroup.getByRole("button", { exact: true, name: "Create a room" });
  const joinModeButton = modeGroup.getByRole("button", { exact: true, name: "Join with code" });
  const createPanel = page.locator('[data-live-entry-panel="create"]');
  const joinPanel = page.locator('[data-live-entry-panel="join"]');

  await expect(entry).toHaveAttribute("data-live-entry-mode", "create");
  await expect(displayNameInput).toBeVisible();
  await expect(modeGroup).toBeVisible();
  await expect(createModeButton).toHaveAttribute("aria-pressed", "true");
  await expect(createPanel).toBeVisible();
  await expect(joinPanel).toBeHidden();
  expect(await readVerticalOrder(page)).toEqual(["display-name", "mode-switcher", "active-panel"]);
  await expectFixedDocument(page);

  await joinModeButton.click({ force: true });
  const firstRoomCodeDigit = page.getByLabel("Room code digit 1");

  await firstRoomCodeDigit.fill("7");
  await expect(entry).toHaveAttribute("data-live-entry-mode", "join");
  await expect(createPanel).toBeHidden();
  await expect(joinPanel).toBeVisible();

  await page.setViewportSize({ height: 390, width: 844 });
  await expect(modeGroup).toBeHidden();
  await expect(createPanel).toBeVisible();
  await expect(joinPanel).toBeVisible();
  await expect(firstRoomCodeDigit).toHaveValue("7");
  await expectFixedDocument(page);

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(modeGroup).toBeVisible();
  await expect(entry).toHaveAttribute("data-live-entry-mode", "join");
  await expect(firstRoomCodeDigit).toHaveValue("7");
  await expectFixedDocument(page);
});

test("waiting room satisfies the blocking responsive viewport matrix", async ({
  page,
  request,
}) => {
  const { host, roomCode } = await createWaitingRoom(request);

  await openRoomAsPlayer(page, host.token);

  for (const viewport of VIEWPORT_CASES) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    const isPortrait = viewport.mode.endsWith("portrait");
    const isPhoneLandscape = viewport.mode === "phone-landscape";
    const isCompactInvite = isPortrait || isPhoneLandscape;
    const compactInvite = page.locator("[data-live-compact-invite]");

    await expect(page.getByRole("button", { exact: true, name: "Show invite" })).toHaveCount(0);

    await expect(page.locator("[data-live-room-layout]")).toBeVisible();
    await expect(page.locator("[data-live-controls]")).toBeVisible();
    await expect(page.locator("[data-live-controls-status]")).toBeVisible();
    await expect(page.locator("[data-live-primary-actions]")).toBeVisible();
    await expect(page.locator("[data-live-table-surface]")).toBeVisible();
    if (isCompactInvite) {
      await expect(page.locator("[data-live-scroll-region]")).toBeHidden();
      await expect(
        page.locator("[data-live-scroll-region] [data-live-invite-content]"),
      ).toBeHidden();
    } else {
      await expect(page.locator("[data-live-scroll-region]")).toBeVisible();
      await expect(
        page.locator("[data-live-scroll-region] [data-live-invite-content]"),
      ).toBeVisible();
      const invitePanelFrame = await page.locator(".liveInviteDetailsPanel").evaluate((panel) => {
        const style = getComputedStyle(panel);

        return {
          borderColors: [
            style.borderTopColor,
            style.borderRightColor,
            style.borderBottomColor,
            style.borderLeftColor,
          ],
          borderWidths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          hasInsetShadow: style.boxShadow.includes("inset"),
        };
      });

      expect(new Set(invitePanelFrame.borderColors).size).toBe(1);
      expect(invitePanelFrame.borderWidths).toEqual(["1px", "1px", "1px", "1px"]);
      expect(invitePanelFrame.hasInsetShadow).toBe(false);
    }
    if (isCompactInvite) {
      await expect(compactInvite).toBeVisible();
      await expect(compactInvite.locator(".liveInviteCode strong")).toHaveText(roomCode);
    } else {
      await expect(compactInvite).toBeHidden();
    }
    await expectFixedDocument(page);

    const geometry = await readRoomGeometry(page);

    expect(geometry.mode).toBe(viewport.mode);
    expect(Math.abs(geometry.table.width - geometry.table.height)).toBeLessThanOrEqual(1);
    expect(geometry.table.width).toBeLessThanOrEqual(721);
    expect(Math.abs(geometry.table.width - geometry.maximumSquare)).toBeLessThanOrEqual(2);
    expect(geometry.tableInsideViewport).toBe(true);
    expect(geometry.controlsInsideViewport).toBe(true);
    expect(geometry.primaryInsideViewport).toBe(true);
    expect(geometry.seatsOutsideViewport).toEqual([]);
    expect(geometry.overlappingSeatPairs).toEqual([]);

    const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });
    const settingsBox = await settingsButton.boundingBox();

    await expect(settingsButton).toBeVisible();
    expect(settingsBox?.width).toBeGreaterThanOrEqual(44);
    expect(settingsBox?.height).toBeGreaterThanOrEqual(44);
    expect(
      await settingsButton.evaluate(
        (button) =>
          button.closest("[data-live-primary-actions]") !== null &&
          button.closest("[data-live-controls-utilities]") === null,
      ),
    ).toBe(true);

    if (viewport.mode === "tablet-landscape-desktop" && viewport.height >= 600) {
      const invitePanelBox = await page.locator(".liveInviteDetailsPanel").boundingBox();
      const primaryBox = await page.locator("[data-live-primary-actions]").boundingBox();
      const scrollBox = await page.locator("[data-live-scroll-region]").boundingBox();
      const scrollState = await page.locator("[data-live-scroll-region]").evaluate((region) => ({
        clientHeight: region.clientHeight,
        scrollHeight: region.scrollHeight,
      }));
      const rowGap = await page
        .locator("[data-live-controls]")
        .evaluate((controls) => Number.parseFloat(getComputedStyle(controls).rowGap));
      const precedingBottom =
        scrollState.scrollHeight > scrollState.clientHeight + 1
          ? (scrollBox?.y ?? 0) + (scrollBox?.height ?? 0)
          : (invitePanelBox?.y ?? 0) + (invitePanelBox?.height ?? 0);
      const inviteToPrimaryGap = (primaryBox?.y ?? 0) - precedingBottom;

      expect(scrollState.clientHeight).toBeGreaterThan(0);
      expect(inviteToPrimaryGap).toBeGreaterThanOrEqual(-1);
      expect(inviteToPrimaryGap).toBeLessThanOrEqual(rowGap + 1);
    }

    if (isCompactInvite) {
      const inviteSummary = compactInvite;
      const inviteBox = await page.locator("[data-live-controls-utilities]").boundingBox();
      const primaryBox = await page.locator("[data-live-primary-actions]").boundingBox();
      const statusBox = await page.locator("[data-live-controls-status]").boundingBox();

      await expect(inviteSummary).toBeVisible();
      expect(inviteBox).not.toBeNull();
      expect(primaryBox).not.toBeNull();
      expect(statusBox).not.toBeNull();
      if (isPortrait) {
        expect(Math.abs((statusBox?.width ?? 0) - (inviteBox?.width ?? 0))).toBeLessThanOrEqual(2);
        expect(Math.abs((statusBox?.y ?? 0) - (inviteBox?.y ?? 0))).toBeLessThanOrEqual(1);
        const topRowBottom = Math.max(
          (statusBox?.y ?? 0) + (statusBox?.height ?? 0),
          (inviteBox?.y ?? 0) + (inviteBox?.height ?? 0),
        );
        const primaryGap = (primaryBox?.y ?? 0) - topRowBottom;

        expect(primaryGap).toBeGreaterThanOrEqual(-1);
        expect(primaryGap).toBeLessThanOrEqual(14);
        expect(rectanglesOverlap(inviteBox, statusBox)).toBe(false);
      } else {
        const primaryBottom = (primaryBox?.y ?? 0) + (primaryBox?.height ?? 0);
        const utilitiesGap = (inviteBox?.y ?? 0) - primaryBottom;

        expect(utilitiesGap).toBeGreaterThanOrEqual(-1);
        expect(utilitiesGap).toBeLessThanOrEqual(5);
      }
      expect(rectanglesOverlap(inviteBox, primaryBox)).toBe(false);
      expect(rectanglesOverlap(inviteBox, settingsBox)).toBe(false);

      const inviteActions = [
        inviteSummary.getByRole("button", { exact: true, name: "Copy code" }),
        inviteSummary.getByRole("button", { exact: true, name: "Share invite" }),
        inviteSummary.getByRole("button", { exact: true, name: "Show QR code" }),
      ];
      const inviteActionBoxes = [];

      for (const inviteAction of inviteActions) {
        await expect(inviteAction).toBeVisible();
        const actionBox = await inviteAction.boundingBox();

        expect(actionBox?.width).toBeGreaterThanOrEqual(44);
        expect(actionBox?.height).toBeGreaterThanOrEqual(44);
        expect(
          await inviteAction.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            const hitTarget = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );

            return hitTarget === button || (hitTarget !== null && button.contains(hitTarget));
          }),
        ).toBe(true);
        inviteActionBoxes.push(actionBox);
      }

      for (const [index, actionBox] of inviteActionBoxes.entries()) {
        for (const candidateBox of inviteActionBoxes.slice(index + 1)) {
          expect(rectanglesOverlap(actionBox, candidateBox)).toBe(false);
        }
      }
    }

    if (viewport.mode.endsWith("portrait")) {
      expect(geometry.table.bottom).toBeLessThanOrEqual(geometry.controls.top + 1);
    } else {
      expect(geometry.table.right).toBeLessThanOrEqual(geometry.controls.left + 1);
    }
  }
});

test("compact invite keeps actions inline and opens only QR in a modal", async ({
  page,
  request,
}) => {
  const { host, roomCode } = await createWaitingRoom(request);

  await page.setViewportSize({ height: 844, width: 390 });
  await openRoomAsPlayer(page, host.token);

  for (const viewport of [
    { height: 568, width: 320 },
    { height: 844, width: 390 },
    { height: 1024, width: 768 },
    { height: 375, width: 667 },
    { height: 390, width: 844 },
  ] as const) {
    await page.setViewportSize(viewport);
    const inviteSummary = page.locator("[data-live-compact-invite]");
    const qrButton = inviteSummary.getByRole("button", { exact: true, name: "Show QR code" });

    await expect(inviteSummary.locator(".liveInviteCode strong")).toHaveText(roomCode);
    await expect(
      inviteSummary.getByRole("button", { exact: true, name: "Copy code" }),
    ).toBeVisible();
    await expect(
      inviteSummary.getByRole("button", { exact: true, name: "Share invite" }),
    ).toBeVisible();
    await expect(inviteSummary.locator(".liveInviteQrCode")).toHaveCount(0);
    await expect(qrButton).toHaveAttribute("aria-expanded", "false");
    await qrButton.click();
    const inviteDialog = page.getByRole("dialog", { name: "Room invite tools" });

    await expect(qrButton).toHaveAttribute("aria-expanded", "true");
    await expect(inviteDialog).toBeVisible();
    await expect(inviteDialog.locator(".liveInviteQrModalContent .liveInviteQrCode")).toBeVisible();
    await expect(inviteDialog.locator(".liveInviteCode")).toHaveCount(0);
    await expect(inviteDialog.getByRole("button", { exact: true, name: "Copy code" })).toHaveCount(
      0,
    );
    await expect(
      inviteDialog.getByRole("button", { exact: true, name: "Share invite" }),
    ).toHaveCount(0);
    await expectFixedDocument(page);
    await page.keyboard.press("Escape");
    await expect(inviteDialog).toHaveCount(0);
    await expect(qrButton).toBeFocused();
  }
});

test("confirmation dialogs fit their content instead of filling the viewport", async ({
  page,
  request,
}) => {
  const { host } = await createWaitingRoom(request);

  await page.setViewportSize({ height: 844, width: 390 });
  await openRoomAsPlayer(page, host.token);
  await page.getByRole("button", { exact: true, name: "Leave room" }).click();

  const dialog = page.getByRole("dialog", { name: "Leave this room?" });
  const dialogBox = await dialog.boundingBox();
  const bodyBox = await dialog.locator("[data-live-modal-body]").boundingBox();

  await expect(dialog).toBeVisible();
  expect(dialogBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(dialogBox?.height).toBeLessThan(420);
  expect((dialogBox?.height ?? 0) - (bodyBox?.height ?? 0)).toBeLessThan(120);
  await expectFixedDocument(page);
});

test("playing keeps phase, primary action, and utilities visible on phone layouts", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Ash", "Bramble", "Cinder"]);
  let actionPlayer = players[0];

  for (const player of players) {
    const summary = await readRoomSummary(request, roomCode, player);

    if ((summary.self?.actions.length ?? 0) > 0) {
      actionPlayer = player;
      break;
    }
  }

  if (actionPlayer === undefined) {
    throw new Error("A player with a primary action was not available.");
  }

  await openRoomAsPlayer(page, actionPlayer.token);

  for (const viewport of [
    { height: 568, width: 320 },
    { height: 844, width: 390 },
    { height: 390, width: 844 },
  ] as const) {
    await page.setViewportSize(viewport);

    const visibility = await page.locator("[data-live-controls]").evaluate((controls) => {
      const isInside = (selector: string): boolean => {
        const element = controls.querySelector<HTMLElement>(selector);

        if (element === null) {
          return false;
        }

        const rect = element.getBoundingClientRect();

        return (
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= window.innerWidth + 1 &&
          rect.bottom <= window.innerHeight + 1
        );
      };

      return {
        primary: isInside("[data-live-primary-actions]"),
        status: isInside("[data-live-controls-status]"),
        utilities: isInside("[data-live-controls-utilities]"),
      };
    });

    expect(visibility).toEqual({ primary: true, status: true, utilities: true });
    await expect(page.locator("[data-live-action-submit]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Public log" })).toBeVisible();
    await expectFixedDocument(page);
  }
});

test("safe-area tokens constrain the room and settings keeps only its body scrollable", async ({
  page,
  request,
}) => {
  const { host } = await createWaitingRoom(request);

  await page.setViewportSize({ height: 844, width: 390 });
  await openRoomAsPlayer(page, host.token);
  await page.locator("main").evaluate((shell) => {
    shell.style.setProperty("--live-safe-top", "20px");
    shell.style.setProperty("--live-safe-right", "24px");
    shell.style.setProperty("--live-safe-bottom", "34px");
    shell.style.setProperty("--live-safe-left", "18px");
  });

  const safeAreaGeometry = await page.locator("[data-live-room-layout]").evaluate((layout) => {
    const rect = layout.getBoundingClientRect();

    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    };
  });

  expect(safeAreaGeometry.top).toBeGreaterThanOrEqual(20);
  expect(safeAreaGeometry.right).toBeLessThanOrEqual(390 - 24 + 1);
  expect(safeAreaGeometry.bottom).toBeLessThanOrEqual(844 - 34 + 1);
  expect(safeAreaGeometry.left).toBeGreaterThanOrEqual(18);

  await page.getByRole("button", { exact: true, name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Game settings" });

  await expect(dialog).toBeVisible();
  await page.setViewportSize({ height: 500, width: 390 });
  await expect(dialog.getByRole("button", { name: "Apply settings" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close settings" })).toBeVisible();
  await expectFixedDocument(page);

  const scrollOwnership = await dialog.evaluate((root) => {
    const body = root.querySelector<HTMLElement>(".liveSettingsBody");
    const footer = root.querySelector<HTMLElement>(".liveSettingsFooter");

    return {
      bodyCanScroll: body === null ? false : body.scrollHeight > body.clientHeight,
      dialogOverflow: getComputedStyle(root).overflow,
      footerInsideViewport:
        footer !== null && footer.getBoundingClientRect().bottom <= window.innerHeight + 1,
    };
  });

  expect(scrollOwnership).toEqual({
    bodyCanScroll: true,
    dialogOverflow: "hidden",
    footerInsideViewport: true,
  });
});

test("waiting room visual baselines cover the four layout modes", async ({ page, request }) => {
  const { host } = await createWaitingRoom(request);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoomAsPlayer(page, host.token);

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 390, width: 844 },
    { height: 1024, width: 768 },
    { height: 900, width: 1440 },
  ] as const) {
    await page.setViewportSize(viewport);
    await expect(page.locator("[data-live-room-layout]")).toBeVisible();
    await expect(page).toHaveScreenshot(
      `live-waiting-${String(viewport.width)}x${String(viewport.height)}.png`,
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixels: 100,
        mask: [page.locator(".liveInviteCode"), page.locator(".liveInviteQrCode")],
      },
    );
  }
});

async function createWaitingRoom(request: APIRequestContext): Promise<{
  readonly host: { readonly token: string };
  readonly roomCode: string;
}> {
  const host = await createApiPlayer(request, "host", "Responsive host");
  const room = await apiFetch<{ code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 6 },
    method: "POST",
    token: host.token,
  });

  return { host, roomCode: room.code };
}

async function openRoomAsPlayer(page: Page, identityToken: string): Promise<void> {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", token);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { token: identityToken },
  );
  await page.goto("/live");
  await expect(page.locator("[data-live-room-layout]")).toBeVisible();
}

async function expectFixedDocument(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo(document.documentElement.scrollWidth, document.documentElement.scrollHeight),
  );
  const geometry = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));

  expect(geometry.scrollX).toBe(0);
  expect(geometry.scrollY).toBe(0);
  expect(geometry.overflowX).toBeLessThanOrEqual(1);
  expect(geometry.overflowY).toBeLessThanOrEqual(1);
}

function rectanglesOverlap(
  first: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  } | null,
  second: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  } | null,
): boolean {
  if (first === null || second === null) {
    return false;
  }

  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

async function readVerticalOrder(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const entries = [
      ["display-name", document.querySelector('input[autocomplete="nickname"]')],
      ["mode-switcher", document.querySelector('[role="group"]')],
      ["active-panel", document.querySelector('[data-live-entry-panel="create"]')],
    ] as const;

    return entries
      .map(([label, element]) => ({ label, top: element?.getBoundingClientRect().top ?? -1 }))
      .sort((left, right) => left.top - right.top)
      .map(({ label }) => label);
  });
}

async function readRoomGeometry(page: Page): Promise<{
  readonly controls: DOMRect;
  readonly controlsInsideViewport: boolean;
  readonly maximumSquare: number;
  readonly mode: string;
  readonly overlappingSeatPairs: readonly string[];
  readonly primaryInsideViewport: boolean;
  readonly seatsOutsideViewport: readonly string[];
  readonly table: DOMRect;
  readonly tableInsideViewport: boolean;
}> {
  return page.locator("[data-live-room-layout]").evaluate((layout) => {
    const table = layout.querySelector<HTMLElement>("[data-live-table-surface]");
    const controls = layout.querySelector<HTMLElement>("[data-live-controls]");
    const primary = layout.querySelector<HTMLElement>("[data-live-primary-actions]");

    if (table === null || controls === null || primary === null) {
      throw new Error("Responsive room regions were not rendered.");
    }

    const layoutRect = layout.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const primaryRect = primary.getBoundingClientRect();
    const mode = getComputedStyle(layout).getPropertyValue("--live-layout-mode").trim();
    const isPortrait = mode.endsWith("portrait");
    const gap = isPortrait
      ? controlsRect.top - tableRect.bottom
      : controlsRect.left - tableRect.right;
    const maximumSquare = Math.min(
      isPortrait ? layoutRect.width : layoutRect.height,
      isPortrait
        ? layoutRect.height - controlsRect.height - gap
        : layoutRect.width - controlsRect.width - gap,
      720,
    );
    const seatRects = [...layout.querySelectorAll<HTMLElement>("[data-live-seat-state]")].map(
      (seat) => ({
        id: seat.dataset["liveSeatNumber"] ?? "unknown",
        rect: seat.getBoundingClientRect(),
      }),
    );
    const seatsOutsideViewport = seatRects.flatMap(({ id, rect }) =>
      rect.left < -1 ||
      rect.top < -1 ||
      rect.right > window.innerWidth + 1 ||
      rect.bottom > window.innerHeight + 1
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
    const isInsideViewport = (rect: DOMRect): boolean =>
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= window.innerWidth + 1 &&
      rect.bottom <= window.innerHeight + 1;

    return {
      controls: controlsRect.toJSON(),
      controlsInsideViewport: isInsideViewport(controlsRect),
      maximumSquare,
      mode,
      overlappingSeatPairs,
      primaryInsideViewport: isInsideViewport(primaryRect),
      seatsOutsideViewport,
      table: tableRect.toJSON(),
      tableInsideViewport: isInsideViewport(tableRect),
    };
  });
}
