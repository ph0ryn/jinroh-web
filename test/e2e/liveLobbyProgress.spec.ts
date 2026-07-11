import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, joinWaitingRoom, type ApiPlayer } from "./support/api";

import type { APIRequestContext, Page } from "playwright/test";

test("lobby progress choreographs accepted seating changes once", async ({ page, request }) => {
  const unexpectedErrors: string[] = [];
  const { guests, host, roomCode } = await createWaitingRoom(request, 3, ["Birch", "Cedar"]);
  const firstGuest = requirePlayer(guests, 0);
  const secondGuest = requirePlayer(guests, 1);

  page.on("pageerror", (error) => unexpectedErrors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !(response.status() === 409 && response.url().endsWith(`/api/rooms/${roomCode}/heartbeat`))
    ) {
      unexpectedErrors.push(
        `${String(response.status())} ${response.request().method()} ${response.url()}`,
      );
    }
  });

  await openRoomAsPlayer(page, host.token);

  const progress = page.locator("[data-live-lobby-progress]");
  const progressbar = progress.getByRole("progressbar");
  const startButton = page.getByRole("button", { exact: true, name: "Start game" });

  await expect(progress).toHaveAttribute("data-live-lobby-progress-joined", "1");
  await expect(progress).toHaveAttribute("data-live-lobby-progress-state", "waiting");
  await expect(progressbar).toHaveAttribute("aria-valuenow", "1");
  await expect(progressbar).toHaveAttribute("aria-valuetext", "1 of 3 seats filled");
  await expect(startButton).toBeDisabled();
  await expect(progress).not.toHaveAttribute("data-live-lobby-progress-motion-kind", /.+/u);
  const initialLayout = await progress.evaluate((root) => {
    const inviteTools = document.querySelector('[aria-label="Room invite tools"]');
    const progressRect = root.getBoundingClientRect();
    const inviteRect = inviteTools?.getBoundingClientRect();

    return {
      height: progressRect.height,
      isBeforeInvite: inviteRect === undefined ? false : progressRect.top < inviteRect.top,
    };
  });

  expect(initialLayout.height).toBeGreaterThanOrEqual(100);
  expect(initialLayout.isBeforeInvite).toBe(true);
  await installLobbyProgressRecorder(page);

  await joinWaitingRoom(request, roomCode, firstGuest);
  await expect(progress).toHaveAttribute("data-live-lobby-progress-motion-kind", "increase", {
    timeout: 8_000,
  });
  await expect(progress).toHaveAttribute("data-live-lobby-progress-joined", "2");
  await expect(progressbar).toHaveAttribute("aria-valuenow", "2");
  await expect(progress).not.toHaveAttribute("data-live-lobby-progress-motion-kind", /.+/u, {
    timeout: 3_000,
  });

  await joinWaitingRoom(request, roomCode, secondGuest);
  await expect(progress).toHaveAttribute("data-live-lobby-progress-motion-kind", "ready", {
    timeout: 8_000,
  });
  await expect(progress).toHaveAttribute("data-live-lobby-progress-state", "ready");
  await expect(progressbar).toHaveAttribute("aria-valuetext", "3 of 3 seats filled");
  await expect(progress.locator("[data-live-lobby-progress-completion]")).toHaveText("✓Ready");
  await expect(startButton).toBeEnabled();
  await expect(progress).not.toHaveAttribute("data-live-lobby-progress-motion-kind", /.+/u, {
    timeout: 3_000,
  });

  await apiFetch(request, `/api/rooms/${roomCode}/leave`, {
    method: "POST",
    token: firstGuest.token,
  });
  await expect(progress).toHaveAttribute("data-live-lobby-progress-motion-kind", "decrease", {
    timeout: 8_000,
  });
  await expect(progress).toHaveAttribute("data-live-lobby-progress-state", "waiting");
  await expect(progress).toHaveAttribute("data-live-lobby-progress-joined", "2");
  await expect(progress.locator("[data-live-lobby-progress-completion]")).toHaveCount(0);
  await expect(startButton).toBeDisabled();
  await expect(progress).not.toHaveAttribute("data-live-lobby-progress-motion-kind", /.+/u, {
    timeout: 3_000,
  });
  await expectLobbyProgressStylesToBeClear(progress);

  expect(await readLobbyProgressEvents(page)).toEqual(["increase", "ready", "decrease"]);

  await resetLobbyProgressRecorder(page);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && response.url().endsWith("/api/rooms/current"),
    ),
    page.getByRole("button", { exact: true, name: "Refresh" }).click(),
  ]);
  await page.waitForTimeout(800);

  expect(await readLobbyProgressEvents(page)).toEqual([]);
  expect(unexpectedErrors).toEqual([]);
});

test("rapid accepted joins converge on ready without stale lobby motion", async ({
  page,
  request,
}) => {
  const { guests, host, roomCode } = await createWaitingRoom(request, 4, ["Elm", "Fir", "Gale"]);

  await openRoomAsPlayer(page, host.token);
  await installLobbyProgressRecorder(page);
  await Promise.all(guests.map((guest) => joinWaitingRoom(request, roomCode, guest)));

  const progress = page.locator("[data-live-lobby-progress]");

  await expect(progress).toHaveAttribute("data-live-lobby-progress-state", "ready", {
    timeout: 8_000,
  });
  await expect(progress).toHaveAttribute("data-live-lobby-progress-joined", "4");
  await expect(progress).not.toHaveAttribute("data-live-lobby-progress-motion-kind", /.+/u, {
    timeout: 4_000,
  });
  await expect(page.getByRole("button", { exact: true, name: "Start game" })).toBeEnabled();
  await expectLobbyProgressStylesToBeClear(progress);

  expect(await readLobbyProgressEvents(page)).toContain("ready");
});

test("reduced motion settles lobby progress without transient choreography", async ({
  page,
  request,
}) => {
  const { guests, host, roomCode } = await createWaitingRoom(request, 3, ["Hazel"]);
  const guest = requirePlayer(guests, 0);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoomAsPlayer(page, host.token);
  await installLobbyProgressRecorder(page);
  await joinWaitingRoom(request, roomCode, guest);

  const progress = page.locator("[data-live-lobby-progress]");

  await expect(progress).toHaveAttribute("data-live-lobby-progress-joined", "2", {
    timeout: 8_000,
  });
  await page.waitForTimeout(800);

  await expect(progress).not.toHaveAttribute("data-live-lobby-progress-motion-kind", /.+/u);
  expect(await readLobbyProgressEvents(page)).toEqual([]);
  await expectLobbyProgressStylesToBeClear(progress);

  const mobileLayout = await progress.evaluate((root) => {
    const rect = root.getBoundingClientRect();

    return {
      documentWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });

  expect(mobileLayout.documentWidth).toBe(390);
  expect(mobileLayout.left).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.right).toBeLessThanOrEqual(mobileLayout.viewportWidth);
});

async function createWaitingRoom(
  request: APIRequestContext,
  targetPlayerCount: number,
  guestNames: readonly string[],
): Promise<{
  readonly guests: readonly ApiPlayer[];
  readonly host: ApiPlayer;
  readonly roomCode: string;
}> {
  const [host, ...guests] = await Promise.all(
    ["Aster", ...guestNames].map((displayName, index) =>
      createApiPlayer(request, `player${String(index + 1)}`, displayName),
    ),
  );

  if (host === undefined) {
    throw new Error("Waiting room host was not created.");
  }

  const room = await apiFetch<{ readonly code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount },
    method: "POST",
    token: host.token,
  });

  return { guests, host, roomCode: room.code };
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
  await expect(page.locator("[data-live-lobby-progress]")).toBeVisible();
}

function requirePlayer(players: readonly ApiPlayer[], index: number): ApiPlayer {
  const player = players[index];

  if (player === undefined) {
    throw new Error(`Player ${String(index)} was not created.`);
  }

  return player;
}

async function installLobbyProgressRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const progress = document.querySelector("[data-live-lobby-progress]");

    if (progress === null) {
      throw new Error("Lobby progress was not rendered before motion recording.");
    }

    const recorderWindow = window as typeof window & {
      __liveLobbyProgressEvents?: string[];
      __liveLobbyProgressObserver?: MutationObserver;
    };

    recorderWindow.__liveLobbyProgressEvents = [];
    recorderWindow.__liveLobbyProgressObserver?.disconnect();
    recorderWindow.__liveLobbyProgressObserver = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        const kind = target.dataset["liveLobbyProgressMotionKind"];

        if (kind !== undefined && recorderWindow.__liveLobbyProgressEvents?.at(-1) !== kind) {
          recorderWindow.__liveLobbyProgressEvents?.push(kind);
        }
      }
    });
    recorderWindow.__liveLobbyProgressObserver.observe(progress, {
      attributeFilter: ["data-live-lobby-progress-motion-kind"],
      attributes: true,
    });
  });
}

async function resetLobbyProgressRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorderWindow = window as typeof window & { __liveLobbyProgressEvents?: string[] };

    recorderWindow.__liveLobbyProgressEvents = [];
  });
}

async function readLobbyProgressEvents(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const recorderWindow = window as typeof window & { __liveLobbyProgressEvents?: string[] };

    return [...(recorderWindow.__liveLobbyProgressEvents ?? [])];
  });
}

async function expectLobbyProgressStylesToBeClear(
  progress: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect
    .poll(() =>
      progress.evaluate((root) =>
        [
          root.querySelector<HTMLElement>("[data-live-lobby-progress-fill]"),
          root.querySelector<HTMLElement>("[data-live-lobby-progress-count]"),
          root.querySelector<HTMLElement>("[data-live-lobby-progress-message]"),
          root.querySelector<HTMLElement>("[data-live-lobby-progress-sheen]"),
          root.querySelector<HTMLElement>("[data-live-lobby-progress-glow]"),
          root.querySelector<HTMLElement>("[data-live-lobby-progress-completion]"),
          ...root.querySelectorAll<HTMLElement>("[data-live-lobby-progress-seat]"),
        ]
          .filter((element): element is HTMLElement => element !== null)
          .every(
            (element) =>
              element.style.opacity === "" &&
              element.style.transform === "" &&
              element.style.visibility === "" &&
              element.style.willChange === "",
          ),
      ),
    )
    .toBe(true);
}
