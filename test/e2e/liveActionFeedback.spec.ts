import { expect, test } from "playwright/test";

import { getLocalizedActionLabel } from "@/lib/i18n/localization";
import { enLocalization } from "@/lib/i18n/localization/en";

import {
  apiFetch,
  createStartedRoom,
  readRoomSummary,
  submitOpenAction,
  submitOpenActions,
} from "./support/api";

import type { PublicAction, RoomSummary } from "@/lib/shared/game";
import type { Page } from "playwright/test";

test("an accepted action confirms once and leaves a private receipt", async ({ page, request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Aster", "Birch", "Cedar"]);
  const host = requirePlayer(players, 0);
  const otherPlayer = requirePlayer(players, 1);

  await submitOpenActions(request, roomCode, players);
  await submitOpenActions(request, roomCode, players);

  const beforeHost = await readRoomSummary(request, roomCode, host);
  const beforeOther = await readRoomSummary(request, roomCode, otherPlayer);
  const action = requireOpenAction(beforeHost, "vote");
  const revision = requireGameRevision(beforeHost);
  const selectedTarget = action.eligibleTargetIds.at(-1);

  if (selectedTarget === undefined) {
    throw new Error("Vote action did not expose an eligible target.");
  }

  await openRoomAsPlayer(page, host.token);
  await installActionFeedbackRecorder(page);

  const actionRow = getActionRow(page, action);
  const actionLabel = getLocalizedActionLabel(enLocalization, action.kind);
  const targetSelect = page.getByLabel(enLocalization.live.aria.actionTarget(actionLabel), {
    exact: true,
  });
  const submitButton = actionRow.locator("[data-live-action-submit]");
  const actionRequestGate = createGate();
  const actionResponseGate = createGate();
  const serverAcceptedGate = createGate();

  await targetSelect.selectOption(selectedTarget);
  await page.route("**/api/rooms/*/action", async (route) => {
    await actionRequestGate.wait;
    const response = await route.fetch();

    serverAcceptedGate.release();
    await actionResponseGate.wait;
    await route.fulfill({ response });
  });
  await submitButton.click();

  await expect(actionRow).toHaveAttribute("data-live-action-feedback-state", "pending");
  await expect(submitButton).toHaveAttribute("aria-busy", "true");
  await expect(targetSelect).toBeDisabled();
  await expect(targetSelect).toHaveValue(selectedTarget);

  const actionResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/action"),
  );

  actionRequestGate.release();
  await serverAcceptedGate.wait;
  await expect(actionRow).toHaveAttribute("data-live-action-status", "submitted", {
    timeout: 8_000,
  });
  await expect(actionRow).toHaveAttribute("data-live-action-feedback-state", "pending");

  actionResponseGate.release();
  await actionResponse;
  await page.unroute("**/api/rooms/*/action");

  await expect(actionRow).toHaveAttribute("data-live-action-status", "submitted", {
    timeout: 8_000,
  });
  await expect(actionRow).toHaveAttribute("data-live-action-feedback-state", "confirmed");
  await expect(actionRow).toHaveAttribute("data-live-action-feedback-motion-kind", "confirm");
  await expect(actionRow).toHaveAttribute("data-live-action-feedback-state", "idle", {
    timeout: 3_000,
  });
  await expect(actionRow).not.toHaveAttribute("data-live-action-feedback-motion-kind", /.+/u);
  await expectActionFeedbackStylesToBeClear(actionRow);

  const afterHost = await readRoomSummary(request, roomCode, host);
  const afterOther = await readRoomSummary(request, roomCode, otherPlayer);
  const hostReceipts = afterHost.self?.actionReceipts ?? [];

  expect(hostReceipts).toHaveLength((beforeHost.self?.actionReceipts.length ?? 0) + 1);
  expect(afterOther.self?.actionReceipts).toHaveLength(
    beforeOther.self?.actionReceipts.length ?? 0,
  );
  expect(hostReceipts.at(-1)).toMatchObject({
    actionKey: action.key,
    kind: action.kind,
    phaseInstanceId: action.phaseInstanceId,
  });

  await apiFetch(request, `/api/rooms/${roomCode}/action`, {
    body: {
      actionKey: action.key,
      phaseInstanceId: action.phaseInstanceId,
      revision,
      targetPlayerId: selectedTarget,
    },
    method: "POST",
    token: host.token,
  });
  const afterDuplicate = await readRoomSummary(request, roomCode, host);

  expect(afterDuplicate.self?.actionReceipts).toHaveLength(hostReceipts.length);
  expect(await readActionFeedbackEvents(page)).toEqual([
    `${action.key}:pending`,
    `${action.key}:confirm`,
  ]);

  await page.reload();
  await waitForCinematicEffects(page);
  await expect(getActionRow(page, action)).toHaveAttribute(
    "data-live-action-feedback-state",
    "idle",
  );
  await expect(page.locator("[data-live-action-feedback-motion-kind]")).toHaveCount(0);
});

test("a rejected action never plays confirmation feedback", async ({ page, request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Dawn", "Elm", "Fir"]);
  const host = requirePlayer(players, 0);
  const summary = await readRoomSummary(request, roomCode, host);
  const action = requireOpenAction(summary);

  await openRoomAsPlayer(page, host.token);
  await installActionFeedbackRecorder(page);
  await page.route("**/api/rooms/*/action", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "conflict", message: "Submit failed." } }),
      contentType: "application/json",
      status: 409,
    });
  });

  const actionRow = getActionRow(page, action);
  const submitButton = actionRow.getByRole("button", {
    name: getLocalizedActionLabel(enLocalization, action.kind),
  });

  await submitButton.click();
  await expect(page.locator('[role="alert"][data-tone="error"]')).toBeVisible();
  await expect(actionRow).toHaveAttribute("data-live-action-status", "open");
  await expect(actionRow).toHaveAttribute("data-live-action-feedback-state", "idle");
  await expect(submitButton).toBeEnabled();
  expect(await readActionFeedbackEvents(page)).not.toContain(`${action.key}:confirm`);
});

test("the phase chapter supersedes final-submission feedback without queueing", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Gale", "Hazel", "Iris"]);
  const host = requirePlayer(players, 0);

  for (const player of players.slice(1)) {
    await submitOpenAction(request, roomCode, player);
  }

  const hostSummary = await readRoomSummary(request, roomCode, host);
  const action = requireOpenAction(hostSummary, "first_night_ready");

  await openRoomAsPlayer(page, host.token);
  await installActionFeedbackRecorder(page);
  await getActionRow(page, action)
    .getByRole("button", {
      name: enLocalization.game.catalog.actionButtons.first_night_ready,
      exact: true,
    })
    .click();

  await expect(page.locator('[data-live-effect="phase"][data-phase="day"]')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator(`[data-live-action-key="${action.key}"]`)).toHaveCount(0);

  const afterHost = await readRoomSummary(request, roomCode, host);

  expect(afterHost.self?.actionReceipts.at(-1)).toMatchObject({ actionKey: action.key });
});

test("reduced motion settles an accepted action without transient choreography", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Juniper", "Kite", "Linden"]);
  const host = requirePlayer(players, 0);
  const summary = await readRoomSummary(request, roomCode, host);
  const action = requireOpenAction(summary, "first_night_ready");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoomAsPlayer(page, host.token);
  await installActionFeedbackRecorder(page);

  const actionRow = getActionRow(page, action);

  await actionRow
    .getByRole("button", {
      name: enLocalization.game.catalog.actionButtons.first_night_ready,
      exact: true,
    })
    .click();
  await expect(actionRow).toHaveAttribute("data-live-action-status", "submitted", {
    timeout: 8_000,
  });
  await expect(actionRow).toHaveAttribute("data-live-action-feedback-state", "idle");

  expect(await readActionFeedbackEvents(page)).toEqual([]);
  await expectActionFeedbackStylesToBeClear(actionRow);
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
  await waitForCinematicEffects(page);
}

async function waitForCinematicEffects(page: Page): Promise<void> {
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 8_000 });
}

function requirePlayer<Players extends readonly unknown[]>(
  players: Players,
  index: number,
): Players[number] {
  const player = players[index];

  if (player === undefined) {
    throw new Error(`Player ${index} was not created.`);
  }

  return player;
}

function requireOpenAction(summary: RoomSummary, kind?: PublicAction["kind"]): PublicAction {
  const action = summary.self?.actions.find(
    (candidate) => candidate.status === "open" && (kind === undefined || candidate.kind === kind),
  );

  if (action === undefined) {
    throw new Error(`No open ${kind ?? "game"} action was available.`);
  }

  return action;
}

function requireGameRevision(summary: RoomSummary): number {
  const revision = summary.game?.revision;

  if (revision === undefined) {
    throw new Error("The game revision was unavailable.");
  }

  return revision;
}

function createGate(): { readonly release: () => void; readonly wait: Promise<void> } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release: () => release(), wait };
}

function getActionRow(page: Page, action: PublicAction) {
  return page.locator(
    `[data-live-action-key="${action.key}"][data-live-action-kind="${action.kind}"]`,
  );
}

async function installActionFeedbackRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorderWindow = window as typeof window & {
      __liveActionFeedbackEvents?: string[];
      __liveActionFeedbackObserver?: MutationObserver;
    };

    recorderWindow.__liveActionFeedbackEvents = [];
    recorderWindow.__liveActionFeedbackObserver?.disconnect();
    recorderWindow.__liveActionFeedbackObserver = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        const kind = target.dataset["liveActionFeedbackMotionKind"];
        const actionKey = target.dataset["liveActionKey"];

        if (kind !== undefined && actionKey !== undefined) {
          const event = `${actionKey}:${kind}`;

          if (recorderWindow.__liveActionFeedbackEvents?.at(-1) !== event) {
            recorderWindow.__liveActionFeedbackEvents?.push(event);
          }
        }
      }
    });
    recorderWindow.__liveActionFeedbackObserver.observe(document.documentElement, {
      attributeFilter: ["data-live-action-feedback-motion-kind"],
      attributes: true,
      subtree: true,
    });
  });
}

async function readActionFeedbackEvents(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const recorderWindow = window as typeof window & { __liveActionFeedbackEvents?: string[] };

    return [...(recorderWindow.__liveActionFeedbackEvents ?? [])];
  });
}

async function expectActionFeedbackStylesToBeClear(
  actionRow: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect
    .poll(() =>
      actionRow.evaluate((row) =>
        [
          row.querySelector<HTMLElement>("[data-live-action-submit-motion]"),
          row.querySelector<HTMLElement>("[data-live-action-feedback-progress]"),
          row.querySelector<HTMLElement>("[data-live-action-feedback-sweep]"),
          row.querySelector<HTMLElement>("[data-live-action-feedback-confirmation]"),
          row.querySelector<HTMLElement>("[data-live-action-feedback-seal]"),
        ].map((element) => ({
          opacity: element?.style.opacity ?? "",
          transform: element?.style.transform ?? "",
          visibility: element?.style.visibility ?? "",
          willChange: element?.style.willChange ?? "",
        })),
      ),
    )
    .toEqual(
      Array.from({ length: 5 }, () => ({
        opacity: "",
        transform: "",
        visibility: "",
        willChange: "",
      })),
    );
}
