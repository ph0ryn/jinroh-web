import { expect, test } from "playwright/test";

import { getLocalizedRole } from "@/lib/i18n/localization";
import { enLocalization } from "@/lib/i18n/localization/en";

import {
  createStartedRoom,
  readRoomSummary,
  submitOpenAction,
  submitOpenActions,
} from "./support/api";

import type { Locator, Page } from "playwright/test";

test("role, phase, vote, death, and victory effects play once in game order", async ({
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
  const otherPlayerId = playerSummaries.find(
    (summary) => summary.self?.playerId !== werewolfPlayerId,
  )?.self?.playerId;

  if (werewolf === undefined || werewolfPlayerId === undefined || otherPlayerId === undefined) {
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

  let voteSubmissionIndex = 0;

  await submitOpenActions(request, roomCode, players, () => {
    const targetId = voteSubmissionIndex < 2 ? werewolfPlayerId : otherPlayerId;

    voteSubmissionIndex += 1;
    return targetId;
  });
  const voteEffect = page.locator('[data-live-effect="vote"]');

  await expect(voteEffect).toBeVisible({ timeout: 8_000 });
  await expect(voteEffect).toHaveAttribute("data-vote-outcome", "candidate");
  await expect(voteEffect.getByText("SEALED BALLOTS")).toHaveCount(2);
  await expect(voteEffect.locator('[data-vote-row-result="candidate"]')).toContainText("2");
  await page.waitForTimeout(1_100);
  const meterScales = await voteEffect.locator("[data-effect-vote-meter]").evaluateAll((meters) =>
    meters
      .map((meter) => {
        const trackWidth = meter.parentElement?.getBoundingClientRect().width ?? 0;

        return trackWidth === 0 ? 0 : meter.getBoundingClientRect().width / trackWidth;
      })
      .toSorted((left, right) => left - right),
  );

  expect(meterScales[0]).toBeCloseTo(0.5, 1);
  expect(meterScales[1]).toBeCloseTo(1, 1);
  await expect(voteEffect).toHaveCount(0, { timeout: 6_000 });
  await expect(page.locator('[data-live-effect="phase"][data-phase="execution"]')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('[data-live-effect="phase"]')).toHaveCount(0, { timeout: 6_000 });

  await page.setViewportSize({ height: 375, width: 667 });
  await submitOpenAction(request, roomCode, werewolf);

  const deathEffect = page.locator('[data-live-effect="death"]');

  await expect(deathEffect).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(`[data-live-player-id="${werewolfPlayerId}"]`)).toHaveClass(
    /eliminated/u,
  );

  const victoryEffect = page.locator('[data-live-effect="victory"]');

  await expect(victoryEffect).toBeVisible({ timeout: 8_000 });
  await expect(victoryEffect).toHaveAttribute("data-effect-victory-particles", "none");
  await expect(
    victoryEffect.locator(
      '[data-effect-particle], [class*="particle" i], [class*="snow" i], [data-effect-soul]',
    ),
  ).toHaveCount(0);
  const victoryGeometryProbe = await createVictoryGeometryProbe(page, victoryEffect);

  await expect(page.locator("[data-live-effect-announcement]")).toContainText(/Your result: /u);
  await page.setViewportSize({ height: 390, width: 844 });
  await expectVictoryGeometry(victoryGeometryProbe);
  await page.setViewportSize({ height: 375, width: 667 });
  await expectVictoryGeometry(victoryGeometryProbe);
  await victoryGeometryProbe.evaluate((probe) => probe.remove());
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
    await expect(seat).toContainText(
      getLocalizedRole(
        enLocalization,
        "en",
        endedSummary.roleCatalog.find((role) => role.id === player.revealedRoleId),
      ).name,
    );
  }

  await page.reload();
  await expect(page.getByLabel("Your result")).toContainText(localizedPlayerResult);
  await expect(page.locator("[data-live-round-table] [data-live-role-id]")).toHaveCount(
    endedSummary.players.length,
  );
  await expect(page.locator("[data-live-effect-announcement]")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Leave room" })).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "Japanese" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByLabel("あなたの結果")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "部屋を退出" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

async function expectVictoryGeometry(victoryEffect: Locator): Promise<void> {
  const geometry = await victoryEffect.evaluate((root) => {
    const rootBounds = root.getBoundingClientRect();
    const visibleElements = [
      ...root.querySelectorAll<HTMLElement>(
        "[data-effect-victory-emblem], [data-effect-victory-copy]",
      ),
    ].map((element) => {
      const bounds = element.getBoundingClientRect();

      return {
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
      };
    });

    return {
      contentFits: root.scrollHeight <= root.clientHeight,
      elementsFit: visibleElements.every(
        (bounds) =>
          bounds.left >= rootBounds.left - 1 &&
          bounds.right <= rootBounds.right + 1 &&
          bounds.top >= rootBounds.top - 1 &&
          bounds.bottom <= rootBounds.bottom + 1,
      ),
    };
  });

  expect(geometry).toEqual({ contentFits: true, elementsFit: true });
}

async function createVictoryGeometryProbe(page: Page, victoryEffect: Locator): Promise<Locator> {
  await victoryEffect.evaluate((root) => {
    const probe = root.cloneNode(true) as HTMLElement;

    probe.dataset["liveEffect"] = "victory-layout-probe";
    for (const element of [probe, ...probe.querySelectorAll<HTMLElement>("[style]")]) {
      element.removeAttribute("style");
    }
    document.body.append(probe);
  });

  return page.locator('[data-live-effect="victory-layout-probe"]');
}

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

test("the vote ledger reveals voter targets, ties, and a mobile reduced-motion result", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(
    request,
    ["Aster Longname", "Birch Longname", "Cedar Longname", "Dahlia Longname"],
    { voteResultVisibility: "voter_to_target" },
  );
  const host = players[0];

  if (host === undefined) {
    throw new Error("Vote ledger test host was not created.");
  }

  await submitOpenActions(request, roomCode, players);
  await submitOpenActions(request, roomCode, players);

  const votingSummaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const firstTargetId = votingSummaries[0]?.self?.playerId;
  const secondTargetId = votingSummaries[1]?.self?.playerId;

  if (firstTargetId === undefined || secondTargetId === undefined) {
    throw new Error("Vote ledger test targets were not available.");
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
  await expect(page.locator('[data-live-effect="role"]')).toHaveCount(0, { timeout: 3_000 });

  let voteIndex = 0;

  await submitOpenActions(request, roomCode, players, () => {
    const targetId = voteIndex % 2 === 0 ? firstTargetId : secondTargetId;

    voteIndex += 1;
    return targetId;
  });

  const voteEffect = page.locator('[data-live-effect="vote"]');

  await expect(voteEffect).toBeVisible({ timeout: 8_000 });
  await expect(voteEffect).toHaveAttribute("data-vote-outcome", "tie");
  await expect(voteEffect.locator('[data-vote-row-result="tied"]')).toHaveCount(2);
  const rowText = await voteEffect.locator("[data-effect-vote-row]").allTextContents();
  const metersAreHidden = await voteEffect
    .locator("[data-effect-vote-meter]")
    .evaluateAll((meters) => meters.every((meter) => meter.getClientRects().length === 0));

  expect(
    rowText.some((text) => text.includes("Aster Longname") && text.includes("Cedar Longname")),
  ).toBe(true);
  expect(
    rowText.some((text) => text.includes("Birch Longname") && text.includes("Dahlia Longname")),
  ).toBe(true);
  expect(metersAreHidden).toBe(true);

  const panelLayout = await voteEffect.locator("[data-effect-vote-panel]").evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();

    return {
      bottom: bounds.bottom,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      transform: window.getComputedStyle(panel).transform,
    };
  });

  expect(panelLayout.top).toBeGreaterThanOrEqual(0);
  expect(panelLayout.left).toBeGreaterThanOrEqual(0);
  expect(panelLayout.right).toBeLessThanOrEqual(375);
  expect(panelLayout.bottom).toBeLessThanOrEqual(812);
  expect(panelLayout.transform).toBe("none");
  await expect(voteEffect).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator('[data-live-effect="phase"][data-phase="night"]')).toBeVisible({
    timeout: 3_000,
  });
});

test("reduced motion preserves the final desktop vote meter ratios", async ({ page, request }) => {
  const { players, roomCode } = await createStartedRoom(request, [
    "Aster",
    "Birch",
    "Cedar",
    "Dahlia",
  ]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Reduced-motion vote meter host was not created.");
  }

  await submitOpenActions(request, roomCode, players);
  await submitOpenActions(request, roomCode, players);

  const votingSummaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const firstTargetId = votingSummaries[0]?.self?.playerId;
  const secondTargetId = votingSummaries[1]?.self?.playerId;

  if (firstTargetId === undefined || secondTargetId === undefined) {
    throw new Error("Reduced-motion vote meter targets were not available.");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 720, width: 1280 });
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");
  await expect(page.locator('[data-live-effect="role"]')).toHaveCount(0, { timeout: 3_000 });

  let voteIndex = 0;

  await submitOpenActions(request, roomCode, players, () => {
    const targetId = voteIndex < 3 ? firstTargetId : secondTargetId;

    voteIndex += 1;
    return targetId;
  });

  const voteEffect = page.locator('[data-live-effect="vote"]');

  await expect(voteEffect).toBeVisible({ timeout: 8_000 });
  const meterState = await voteEffect.locator("[data-effect-vote-meter]").evaluateAll((meters) =>
    meters
      .map((meter) => {
        const trackWidth = meter.parentElement?.getBoundingClientRect().width ?? 0;

        return {
          cssScale: meter.getAttribute("style")?.includes("--vote-meter-scale") ?? false,
          renderedScale: trackWidth === 0 ? 0 : meter.getBoundingClientRect().width / trackWidth,
        };
      })
      .toSorted((left, right) => left.renderedScale - right.renderedScale),
  );

  expect(meterState).toHaveLength(2);
  expect(meterState.every(({ cssScale }) => cssScale)).toBe(true);
  expect(meterState[0]?.renderedScale).toBeCloseTo(1 / 3, 1);
  expect(meterState[1]?.renderedScale).toBeCloseTo(1, 1);
});

test("the vote ledger keeps a ten-target tally visible in compact landscape layout", async ({
  page,
  request,
}) => {
  const displayNames = Array.from({ length: 10 }, (_, index) => `Player ${index + 1}`);
  const { players, roomCode } = await createStartedRoom(request, displayNames);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Ten-target vote ledger host was not created.");
  }

  await submitOpenActions(request, roomCode, players);
  await submitOpenActions(request, roomCode, players);

  const votingSummaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const targetPlayerIds = votingSummaries.flatMap((summary) =>
    summary.self?.playerId === undefined ? [] : [summary.self.playerId],
  );

  if (targetPlayerIds.length !== players.length) {
    throw new Error("Ten-target vote ledger player IDs were not available.");
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
  await expect(page.locator('[data-live-effect="role"]')).toHaveCount(0, { timeout: 3_000 });

  let voteIndex = 0;

  await submitOpenActions(request, roomCode, players, () => {
    const targetPlayerId = targetPlayerIds[voteIndex] ?? null;

    voteIndex += 1;
    return targetPlayerId;
  });

  const voteEffect = page.locator('[data-live-effect="vote"]');

  await voteEffect.waitFor({ state: "visible", timeout: 8_000 });
  const layout = await voteEffect.evaluate((root) => {
    const panel = root.querySelector<HTMLElement>("[data-effect-vote-panel]");
    const rows = root.querySelector<HTMLElement>("[data-effect-vote-rows]");
    const footer = root.querySelector<HTMLElement>("[data-effect-vote-footer]");
    const rowElements = [...root.querySelectorAll<HTMLElement>("[data-effect-vote-row]")];
    const panelBounds = panel?.getBoundingClientRect();
    const footerBounds = footer?.getBoundingClientRect();
    const lastRowBottom = Math.max(
      0,
      ...rowElements.map((row) => row.getBoundingClientRect().bottom),
    );

    return {
      compact: rows?.dataset["compact"] ?? null,
      footerTop: footerBounds?.top ?? 0,
      outcome: root.getAttribute("data-vote-outcome"),
      panelBottom: panelBounds?.bottom ?? Number.POSITIVE_INFINITY,
      panelTop: panelBounds?.top ?? Number.NEGATIVE_INFINITY,
      rowCount: rowElements.length,
      rowsClientHeight: rows?.clientHeight ?? 0,
      rowsScrollHeight: rows?.scrollHeight ?? Number.POSITIVE_INFINITY,
      lastRowBottom,
    };
  });

  expect(layout.outcome).toBe("tie");
  expect(layout.compact).toBe("true");
  expect(layout.rowCount).toBe(10);
  expect(layout.panelTop).toBeGreaterThanOrEqual(0);
  expect(layout.panelBottom).toBeLessThanOrEqual(390);
  expect(layout.rowsScrollHeight).toBeLessThanOrEqual(layout.rowsClientHeight);
  expect(layout.lastRowBottom).toBeLessThanOrEqual(layout.footerTop);
});
