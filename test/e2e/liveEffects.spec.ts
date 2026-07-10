import { expect, test } from "playwright/test";

import { getLocalizedRole } from "@/lib/i18n/localization";
import { enLocalization } from "@/lib/i18n/localization/en";

import { apiFetch, createStartedRoom, type ApiPlayer } from "./support/api";

import type { PublicAction, RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

test("role, phase, death, and victory effects play once in game order", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  const { players, roomCode } = await createStartedRoom(request, ["Aster", "Birch", "Cedar"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Effect test host was not created.");
  }

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");

  await expect(page.locator('.liveShell[data-live-mood="night"]')).toBeVisible();
  await expect(page.locator('[data-live-effect="role"]')).toBeVisible();
  await expect(page.locator("[data-live-round-table] [data-live-role-id]")).toHaveCount(0);
  const roleRevealButton = page.getByRole("button", { name: "Reveal role card" });

  await expect(roleRevealButton).toBeVisible();
  await expect(roleRevealButton).toHaveAccessibleDescription(/Your current role is .+\./u);

  const playerSummaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const werewolfIndex = playerSummaries.findIndex((summary) => summary.self?.roleId === "werewolf");
  const werewolf = players[werewolfIndex];
  const werewolfPlayerId = playerSummaries[werewolfIndex]?.self?.playerId;

  if (werewolf === undefined || werewolfPlayerId === undefined) {
    throw new Error("Effect test could not identify the werewolf.");
  }

  await submitOpenActions(request, roomCode, players);
  await expect(page.locator('[data-live-effect="phase"][data-phase="day"]')).toBeVisible({
    timeout: 12_000,
  });
  await expect(page.locator('[data-live-effect="phase"]')).toHaveCount(0, { timeout: 6_000 });

  await submitOpenActions(request, roomCode, players);
  await expect(page.locator('[data-live-effect="phase"][data-phase="voting"]')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('[data-live-effect="phase"]')).toHaveCount(0, { timeout: 6_000 });

  await submitOpenActions(request, roomCode, players, (action) =>
    action.eligibleTargetIds.includes(werewolfPlayerId)
      ? werewolfPlayerId
      : (action.eligibleTargetIds[0] ?? null),
  );
  await expect(page.locator('[data-live-effect="phase"][data-phase="execution"]')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('[data-live-effect="phase"]')).toHaveCount(0, { timeout: 6_000 });

  await submitOpenAction(request, roomCode, werewolf);

  const deathEffect = page.locator('[data-live-effect="death"]');

  await expect(deathEffect).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(`[data-live-player-id="${werewolfPlayerId}"]`)).toHaveClass(
    /eliminated/u,
  );

  const victoryEffect = page.locator('[data-live-effect="victory"]');

  await expect(victoryEffect).toBeVisible({ timeout: 8_000 });
  const endedSummaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const endedSummary = endedSummaries[0];

  if (endedSummary === undefined) {
    throw new Error("Effect test did not receive the final room summary.");
  }

  const expectedPlayerResult = endedSummary.self?.result;

  if (expectedPlayerResult === null || expectedPlayerResult === undefined) {
    throw new Error("Effect test host did not receive a final player result.");
  }

  const localizedPlayerResult = {
    draw: "Draw",
    lose: "Lose",
    special: "Special",
    win: "Win",
  }[expectedPlayerResult];

  await expect(page.locator("[data-live-effect-announcement]")).toContainText(
    `Your result: ${localizedPlayerResult}`,
  );
  await expect(page.getByLabel("Your result")).toContainText(localizedPlayerResult);
  const revealedRoles = Object.fromEntries(
    endedSummary.players.map((player) => [player.id, player.revealedRoleId]),
  );

  expect(Object.values(revealedRoles).every((roleId) => roleId !== null)).toBe(true);
  expect(
    endedSummaries.every(
      (summary) =>
        JSON.stringify(
          Object.fromEntries(summary.players.map((player) => [player.id, player.revealedRoleId])),
        ) === JSON.stringify(revealedRoles),
    ),
  ).toBe(true);

  for (const player of endedSummary.players) {
    if (player.revealedRoleId === null) {
      throw new Error(`Final role was not revealed for ${player.displayName}.`);
    }

    const seat = page.locator(`[data-live-player-id="${player.id}"]`);

    await expect(seat).toHaveAttribute("data-live-role-id", player.revealedRoleId);
    await expect(seat).toContainText(getLocalizedRole(enLocalization, player.revealedRoleId).name);
  }

  await expect(victoryEffect).toHaveAttribute("data-effect-victory-particles", "none");
  await expect(
    victoryEffect.locator(
      '[data-effect-particle], [class*="particle" i], [class*="snow" i], [data-effect-soul]',
    ),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Your result")).toContainText(localizedPlayerResult);
  await expect(page.locator("[data-live-round-table] [data-live-role-id]")).toHaveCount(
    endedSummary.players.length,
  );
  await expect(page.locator("[data-live-effect-announcement]")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Leave room" })).toBeVisible({ timeout: 8_000 });
  expect(consoleErrors).toEqual([]);
});

test("reduced motion keeps the role reveal static and short", async ({ page, request }) => {
  const { players } = await createStartedRoom(request, ["Dawn", "Elm", "Fir"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Reduced-motion effect test host was not created.");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 390, width: 844 });
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");

  const roleEffect = page.locator('[data-live-effect="role"]');
  const roleCard = page.locator("[data-effect-role-card]");

  await expect(roleEffect).toBeVisible();
  await expect(roleCard).toBeVisible();
  const layout = await roleCard.evaluate((card) => {
    const cardBounds = card.getBoundingClientRect();
    const description = card.querySelector<HTMLElement>("[data-effect-role-copy]:last-child");
    const descriptionBounds = description?.getBoundingClientRect();

    return {
      cardBottom: cardBounds.bottom,
      cardLeft: cardBounds.left,
      cardRight: cardBounds.right,
      cardTop: cardBounds.top,
      descriptionBottom: descriptionBounds?.bottom ?? Number.POSITIVE_INFINITY,
    };
  });

  expect(layout.cardTop).toBeGreaterThanOrEqual(0);
  expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
  expect(layout.cardRight).toBeLessThanOrEqual(844);
  expect(layout.cardBottom).toBeLessThanOrEqual(390);
  expect(layout.descriptionBottom).toBeLessThanOrEqual(layout.cardBottom);
  await expect
    .poll(() => roleCard.evaluate((element) => window.getComputedStyle(element).transform))
    .toBe("none");
  await expect(roleEffect).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator("[data-live-effect-announcement]")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Reveal role card" })).toBeVisible();
});

async function readRoomSummary(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}`, { token: player.token });
}

async function submitOpenActions(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
  selectTarget: (action: PublicAction) => string | null = () => null,
): Promise<void> {
  for (const player of players) {
    await submitOpenAction(request, roomCode, player, selectTarget);
  }
}

async function submitOpenAction(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
  selectTarget: (action: PublicAction) => string | null = () => null,
): Promise<void> {
  const summary = await readRoomSummary(request, roomCode, player);
  const action = summary.self?.actions.find((candidate) => candidate.status === "open");
  const revision = summary.game?.revision;

  if (action === undefined || revision === undefined) {
    throw new Error(`No open action was available for ${player.label}.`);
  }

  await apiFetch(request, `/api/rooms/${roomCode}/action`, {
    body: {
      actionKey: action.key,
      phaseInstanceId: action.phaseInstanceId,
      revision,
      targetPlayerId: selectTarget(action),
    },
    method: "POST",
    token: player.token,
  });
}
