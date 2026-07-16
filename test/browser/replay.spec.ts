import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/shared/game";

import {
  apiFetch,
  createApiPlayer,
  joinWaitingRoom,
  readRoomSummary,
  setRoomReadiness,
} from "../fixtures/apiClient";
import { requirePlayer } from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";
import { createRoomWithStartedGame, finishThreePlayerGame } from "../integration/support";

test("the result surface readies the same roster and starts a fresh Game", async ({
  live,
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const room = await createRoomWithStartedGame(request, ["Aster", "Birch", "Cedar"]);
  const host = requirePlayer(room.players, 0);
  const guests = room.players.slice(1);
  const first = await readRoomSummary(request, room.roomCode, host);
  const firstGameId = first.game?.gameId;

  expect(firstGameId).toBeTruthy();

  await finishThreePlayerGame(request, room.roomCode, room.players);
  const resultSummary = await readRoomSummary(request, room.roomCode, host);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await live.open({ identityToken: host.token });

  await expect(page.locator('[data-live-mood="result"]')).toBeVisible({ timeout: 20_000 });
  await live.waitForCinematicEffects();
  await expect(page.locator("[data-live-lobby-expiration] time")).toHaveAttribute(
    "datetime",
    resultSummary.lobbyExpiresAt,
  );

  const readinessToggle = page.locator("[data-live-readiness-toggle]");
  const startButton = page.locator("[data-live-start-game]");

  await expect(readinessToggle).toHaveAttribute("aria-pressed", "false");
  await expect(startButton).toBeDisabled();

  await Promise.all(guests.map((player) => setRoomReadiness(request, room.roomCode, player)));
  await readinessToggle.click();

  await expect(readinessToggle).toHaveAttribute("aria-pressed", "true");
  await expect(startButton).toBeEnabled({ timeout: 15_000 });
  await startButton.click();

  await expect(page.locator('[data-live-mood="night"]')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await readRoomSummary(request, room.roomCode, host)).game?.gameId)
    .not.toBe(firstGameId);
});

test("result seats show complete player, role, and state labels", async ({
  live,
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const room = await createRoomWithStartedGame(request, [
    "A".repeat(DISPLAY_NAME_MAX_LENGTH),
    "B".repeat(DISPLAY_NAME_MAX_LENGTH),
    "C".repeat(DISPLAY_NAME_MAX_LENGTH),
  ]);
  const host = requirePlayer(room.players, 0);

  const result = await finishThreePlayerGame(request, room.roomCode, room.players);
  const leavingPlayerView = result.players.find((player) => !player.isCurrent && player.alive);
  const leavingPlayer = room.players.find(
    (player) => player.displayName === leavingPlayerView?.displayName,
  );

  if (leavingPlayer === undefined) {
    throw new Error("Expected a surviving guest to exercise the complete Left seat label.");
  }

  await apiFetch(request, `/api/rooms/${room.roomCode}/leave`, {
    method: "POST",
    token: leavingPlayer.token,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await live.open({ identityToken: host.token });
  await expect(page.locator('[data-live-mood="result"]')).toBeVisible({ timeout: 20_000 });
  await live.waitForCinematicEffects();

  const visibleSeatLabels = page.locator(
    "[data-live-seat-player-name], [data-live-seat-detail], [data-live-seat-state-label]",
  );
  const clippedLabels = await visibleSeatLabels.evaluateAll((elements) =>
    elements.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      const isClipped =
        element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1 ||
        styles.overflow === "hidden" ||
        styles.textOverflow === "ellipsis";

      return isClipped
        ? [
            {
              height: bounds.height,
              text: element.textContent,
              width: bounds.width,
            },
          ]
        : [];
    }),
  );

  await expect(page.locator("[data-live-seat-player-name]")).toHaveCount(3);
  await expect(page.locator("[data-live-seat-detail]")).toHaveCount(3);
  await expect(page.getByText(live.t.game.seatStatus.left, { exact: true })).toBeVisible();
  await expect(page.getByText(live.t.game.seatStatus.out, { exact: true })).toBeVisible();
  expect(clippedLabels).toEqual([]);
});

test("a new post-game member clears the visible Game session", async ({ live, page, request }) => {
  test.setTimeout(90_000);

  const room = await createRoomWithStartedGame(request, ["Dahlia", "Elm", "Fir"]);
  const host = requirePlayer(room.players, 0);
  const leaver = requirePlayer(room.players, 1);
  const outsider = await createApiPlayer(request, "newMember", "Gale");

  await finishThreePlayerGame(request, room.roomCode, room.players);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await live.open({ identityToken: host.token });

  await expect(page.locator('[data-live-mood="result"]')).toBeVisible();
  await expect(page.locator("[data-live-role-id]").first()).toBeVisible();

  await page
    .getByRole("group", { name: live.t.live.aria.popupPanels })
    .getByRole("button", { name: live.t.live.buttons.publicLog })
    .click();
  const publicLog = page.getByRole("dialog", { name: live.t.live.eventLog.title, exact: true });

  await expect(publicLog).toBeVisible();

  await apiFetch(request, `/api/rooms/${room.roomCode}/leave`, {
    method: "POST",
    token: leaver.token,
  });
  await joinWaitingRoom(request, room.roomCode, outsider);

  await expect(page.locator('[data-live-mood="waiting"]')).toBeVisible({ timeout: 15_000 });
  await expect(publicLog).toHaveCount(0);
  await expect(page.locator("[data-live-effect]")).toHaveCount(0);
  await expect(page.locator("[data-live-role-id]")).toHaveCount(0);
  await expect(page.getByText(outsider.displayName, { exact: true })).toBeVisible();
  await expect(live.currentRoomCode()).toHaveText(room.roomCode);
  await expect(page.locator("[data-live-readiness-toggle]")).toBeVisible();
});
