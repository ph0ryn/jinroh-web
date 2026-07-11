import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, joinWaitingRoom } from "./support/api";

import type { RoomSummary } from "@/lib/shared/game";
import type { Page } from "playwright/test";

test("round table choreographs accepted membership changes once", async ({ page, request }) => {
  const unexpectedErrors: string[] = [];
  const host = await createApiPlayer(request, "host", "Aster");
  const firstGuest = await createApiPlayer(request, "first-guest", "Birch");
  const secondGuest = await createApiPlayer(request, "second-guest", "Cedar");
  const room = await apiFetch<{ readonly code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !(response.status() === 409 && response.url().endsWith(`/api/rooms/${room.code}/heartbeat`))
    ) {
      unexpectedErrors.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });
  page.on("pageerror", (error) => unexpectedErrors.push(error.message));

  await openRoomAsPlayer(page, host.token);

  const roundTable = page.locator("[data-live-round-table]");

  await expect(roundTable).toBeVisible();
  await expect(roundTable.locator("[data-live-seat-motion-kind]")).toHaveCount(0);
  await installSeatMotionRecorder(page);

  const firstGuestSummary = await joinWaitingRoom(request, room.code, firstGuest);
  const firstGuestId = requireCurrentPlayerId(firstGuestSummary);
  const firstGuestMotion = roundTable.locator(
    `[data-live-seat-motion][data-live-motion-player-id="${firstGuestId}"]`,
  );

  await expect(firstGuestMotion).toHaveAttribute("data-live-seat-motion-kind", /materialize/u, {
    timeout: 8_000,
  });
  await expect(firstGuestMotion).not.toHaveAttribute("data-live-seat-motion-kind", /.+/u, {
    timeout: 3_000,
  });

  const secondGuestSummary = await joinWaitingRoom(request, room.code, secondGuest);
  const secondGuestId = requireCurrentPlayerId(secondGuestSummary);
  const secondGuestMotion = roundTable.locator(
    `[data-live-seat-motion][data-live-motion-player-id="${secondGuestId}"]`,
  );

  await expect(secondGuestMotion).toHaveAttribute("data-live-seat-motion-kind", /materialize/u, {
    timeout: 8_000,
  });
  await expect(secondGuestMotion).not.toHaveAttribute("data-live-seat-motion-kind", /.+/u, {
    timeout: 3_000,
  });

  await resetSeatMotionRecorder(page);
  await apiFetch(request, `/api/rooms/${room.code}/leave`, {
    method: "POST",
    token: firstGuest.token,
  });

  const emptySeatMotion = roundTable.locator(
    '[data-live-seat-motion][data-live-motion-empty-seat="3"]',
  );

  await expect(secondGuestMotion).toHaveAttribute("data-live-seat-motion-kind", /move/u, {
    timeout: 8_000,
  });
  await expect(emptySeatMotion).toHaveAttribute("data-live-seat-motion-kind", /empty/u);
  await expect(roundTable.locator(`[data-live-player-id="${secondGuestId}"]`)).toHaveAttribute(
    "data-live-seat-number",
    "2",
  );
  await expect(roundTable.locator('[data-live-seat-state="empty"]')).toHaveAttribute(
    "data-live-seat-number",
    "3",
  );
  await expect(roundTable.locator("[data-live-seat-motion-kind]")).toHaveCount(0, {
    timeout: 3_000,
  });
  await expectMotionStylesToBeClear(secondGuestMotion);
  await expectMotionStylesToBeClear(emptySeatMotion);

  await resetSeatMotionRecorder(page);
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/rooms/current"),
    { timeout: 6_000 },
  );
  await page.waitForTimeout(800);

  expect(await readSeatMotionEvents(page)).toEqual([]);
  expect(unexpectedErrors).toEqual([]);
});

test("reduced motion settles round table membership without choreography", async ({
  page,
  request,
}) => {
  const host = await createApiPlayer(request, "host", "Dawn");
  const guest = await createApiPlayer(request, "guest", "Elm");
  const room = await apiFetch<{ readonly code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoomAsPlayer(page, host.token);
  await installSeatMotionRecorder(page);

  const guestSummary = await joinWaitingRoom(request, room.code, guest);
  const guestId = requireCurrentPlayerId(guestSummary);
  const roundTable = page.locator("[data-live-round-table]");
  const guestMotion = roundTable.locator(
    `[data-live-seat-motion][data-live-motion-player-id="${guestId}"]`,
  );

  await expect(roundTable.locator('[data-live-seat-state="occupied"]')).toHaveCount(2, {
    timeout: 8_000,
  });
  await page.waitForTimeout(700);

  expect(await readSeatMotionEvents(page)).toEqual([]);
  await expectMotionStylesToBeClear(guestMotion);
});

async function openRoomAsPlayer(page: Page, identityToken: string): Promise<void> {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", token);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { token: identityToken },
  );
  await page.goto("/live");
  await expect(page.locator("[data-live-round-table]")).toBeVisible();
}

function requireCurrentPlayerId(summary: RoomSummary): string {
  if (summary.currentPlayerId === null) {
    throw new Error("Joined player did not receive a public player ID.");
  }

  return summary.currentPlayerId;
}

async function installSeatMotionRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const table = document.querySelector("[data-live-round-table]");

    if (table === null) {
      throw new Error("Round table was not rendered before motion recording.");
    }

    const recorderWindow = window as typeof window & {
      __liveSeatMotionEvents?: string[];
      __liveSeatMotionObserver?: MutationObserver;
    };

    recorderWindow.__liveSeatMotionEvents = [];
    recorderWindow.__liveSeatMotionObserver?.disconnect();
    recorderWindow.__liveSeatMotionObserver = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        const kind = target.dataset["liveSeatMotionKind"];

        if (kind === undefined) {
          continue;
        }

        const identity =
          target.dataset["liveMotionPlayerId"] ??
          `empty-${target.dataset["liveMotionEmptySeat"] ?? "unknown"}`;

        recorderWindow.__liveSeatMotionEvents?.push(`${identity}:${kind}`);
      }
    });
    recorderWindow.__liveSeatMotionObserver.observe(table, {
      attributeFilter: ["data-live-seat-motion-kind"],
      attributes: true,
      subtree: true,
    });
  });
}

async function resetSeatMotionRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorderWindow = window as typeof window & { __liveSeatMotionEvents?: string[] };

    recorderWindow.__liveSeatMotionEvents = [];
  });
}

async function readSeatMotionEvents(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const recorderWindow = window as typeof window & { __liveSeatMotionEvents?: string[] };

    return [...(recorderWindow.__liveSeatMotionEvents ?? [])];
  });
}

async function expectMotionStylesToBeClear(locator: ReturnType<Page["locator"]>): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) => ({
        opacity: element.style.opacity,
        transform: element.style.transform,
        visibility: element.style.visibility,
        willChange: element.style.willChange,
      })),
    )
    .toEqual({ opacity: "", transform: "", visibility: "", willChange: "" });
}
