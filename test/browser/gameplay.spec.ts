import { apiFetch, readRoomSummary } from "../fixtures/apiClient";
import { createGate } from "../fixtures/livePage";
import {
  createRoomWithStartedGame,
  requireOpenAction,
  requirePlayer,
  sendNightConversationMessage,
  submitOpenActions,
} from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";
import { advanceToNormalNight } from "../integration/support";

import type { ApiPlayer } from "../fixtures/apiClient";
import type { RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

async function submitAllOpenActionsForPhase(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
  phaseInstanceId: string,
): Promise<void> {
  for (;;) {
    let submittedAction = false;

    for (const player of players) {
      const summary = await readRoomSummary(request, roomCode, player);
      const action = summary.self?.actions.find(
        (candidate) => candidate.status === "open" && candidate.phaseInstanceId === phaseInstanceId,
      );

      if (action === undefined) {
        continue;
      }

      const game = summary.game;

      if (game === null) {
        throw new Error(`Game state is unavailable for ${player.label}.`);
      }

      const targetPlayerId =
        action.targetKind === "single_player" ? (action.eligibleTargetIds[0] ?? null) : null;

      if (action.targetKind === "single_player" && targetPlayerId === null) {
        throw new Error(`No eligible target is available for ${action.key}.`);
      }

      await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/action`, {
        body: {
          actionKey: action.key,
          gameId: game.gameId,
          phaseInstanceId: action.phaseInstanceId,
          revision: game.revision,
          targetPlayerId,
        },
        method: "POST",
        token: player.token,
      });
      submittedAction = true;
      break;
    }

    if (!submittedAction) {
      return;
    }
  }
}

function requirePhaseInstanceId(summary: RoomSummary): string {
  const phaseInstanceId = summary.game?.phaseInstanceId;

  if (phaseInstanceId === null || phaseInstanceId === undefined) {
    throw new Error("The current phase instance is unavailable.");
  }

  return phaseInstanceId;
}

test("cinematic cues serialize role assignment before the phase change", async ({
  live,
  page,
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Aster",
    "Birch",
    "Cedar",
  ]);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token });

  const roleEffect = page.locator('[data-live-effect="role"]');
  const dayEffect = page.locator('[data-live-effect="phase"][data-phase="day"]');

  await expect(roleEffect).toBeVisible();
  await expect(page.locator("[data-live-action-guide]")).toHaveCount(0);
  await expect(dayEffect).toHaveCount(0);
  await submitOpenActions(request, roomCode, players);
  await expect(dayEffect).toBeVisible({ timeout: 12_000 });
  await expect(roleEffect).toHaveCount(0);
  await expect(page.locator('[data-live-mood="day"]')).toBeVisible();
});

test("reduced motion settles a representative cue into readable game state", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createRoomWithStartedGame(request, ["Dahlia", "Elm", "Fir"]);
  const host = requirePlayer(players, 0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await live.open({ identityToken: host.token });

  const roleEffect = page.locator('[data-live-effect="role"]');

  await expect(roleEffect).toBeVisible();
  await expect(roleEffect).toHaveCount(0, { timeout: 4_000 });
  await expect(
    page.getByRole("button", { name: live.t.live.effects.role.reveal, exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-live-mood="night"]')).toBeVisible();
});

test("an accepted targetless action remains scoped to its submitter", async ({
  live,
  page,
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, ["Gale", "Hazel", "Iris"]);
  const submitter = requirePlayer(players, 0);
  const observer = requirePlayer(players, 1);
  const beforeSubmitter = await readRoomSummary(request, roomCode, submitter);
  const beforeObserver = await readRoomSummary(request, roomCode, observer);
  const action = requireOpenAction(beforeSubmitter, "first_night_ready");

  await live.open({ identityToken: submitter.token });
  await live.waitForCinematicEffects();

  const actionGuide = live.actionGuide(action);

  await actionGuide.locator("[data-live-action-submit]").click();
  await expect(page.locator("[data-live-action-confirmation]")).toHaveCount(0);
  await expect(actionGuide).toHaveAttribute("data-live-action-status", "submitted");

  const afterSubmitter = await readRoomSummary(request, roomCode, submitter);
  const afterObserver = await readRoomSummary(request, roomCode, observer);
  const submitterReceipts = afterSubmitter.self?.actionReceipts ?? [];

  expect(submitterReceipts).toHaveLength((beforeSubmitter.self?.actionReceipts.length ?? 0) + 1);
  expect(submitterReceipts.at(-1)).toMatchObject({
    actionKey: action.key,
    kind: action.kind,
    phaseInstanceId: action.phaseInstanceId,
  });
  expect(afterObserver.self?.actionReceipts).toHaveLength(
    beforeObserver.self?.actionReceipts.length ?? 0,
  );
});

test("a targetless action that advances the phase skips submitted feedback", async ({
  live,
  page,
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Kestrel",
    "Larch",
    "Mallow",
  ]);
  const viewer = requirePlayer(players, 2);
  const firstNightSummary = await readRoomSummary(request, roomCode, viewer);
  const action = requireOpenAction(firstNightSummary, "first_night_ready");

  await submitAllOpenActionsForPhase(
    request,
    roomCode,
    players.slice(0, -1),
    action.phaseInstanceId,
  );
  await live.open({ identityToken: viewer.token });
  await live.waitForCinematicEffects();

  const actionGuide = live.actionGuide(action);

  await expect(actionGuide).toBeVisible();
  await page.evaluate((submittedMessage) => {
    const isSubmittedGuide = (guide: Element): boolean =>
      guide.matches("[data-live-action-guide]") &&
      (guide.getAttribute("data-live-action-status") === "submitted" ||
        guide.textContent.includes(submittedMessage));
    const nodeContainsSubmittedGuide = (node: Node): boolean => {
      const element = node instanceof Element ? node : node.parentElement;

      if (element === null) {
        return false;
      }

      return (
        isSubmittedGuide(element) ||
        [...element.querySelectorAll("[data-live-action-guide]")].some(isSubmittedGuide)
      );
    };
    const markSubmittedGuide = (): void => {
      Reflect.set(window, "__liveSubmittedActionGuideSeen", true);
    };
    const observer = new MutationObserver((records) => {
      const recordedSubmittedState = records.some(
        (record) =>
          (record.type === "attributes" &&
            record.attributeName === "data-live-action-status" &&
            record.oldValue === "submitted" &&
            record.target instanceof Element &&
            record.target.matches("[data-live-action-guide]")) ||
          (record.type === "characterData" &&
            record.oldValue?.includes(submittedMessage) === true &&
            (record.target.parentElement?.closest("[data-live-action-guide]") ?? null) !== null) ||
          nodeContainsSubmittedGuide(record.target) ||
          (record.type === "childList" &&
            [...record.addedNodes, ...record.removedNodes].some(nodeContainsSubmittedGuide)),
      );

      if (recordedSubmittedState) {
        markSubmittedGuide();
      }
    });
    Reflect.set(window, "__liveSubmittedActionGuideSeen", false);
    observer.observe(document.body, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });

    if (nodeContainsSubmittedGuide(document.body)) {
      markSubmittedGuide();
    }
  }, action.presentation.en.submittedMessage);

  await actionGuide.locator("[data-live-action-submit]").click();

  const dayEffect = page.locator('[data-live-effect="phase"][data-phase="day"]');

  await expect(dayEffect).toBeVisible({ timeout: 12_000 });
  await expect(
    page.locator('[data-live-action-guide][data-live-action-status="submitted"]'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "__liveSubmittedActionGuideSeen") === true),
  ).toBe(false);
  await expect
    .poll(async () => (await readRoomSummary(request, roomCode, viewer)).game?.phase)
    .toBe("day");
});

test("a normal-night role action exposes only eligible cards with role-owned copy", async ({
  live,
  page,
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Narcissus",
    "Oak",
    "Poppy",
    "Quill",
    "Reed",
    "Sorrel",
    "Tulip",
  ]);
  const normalNightEntries = await advanceToNormalNight(request, roomCode, players);
  const viewerEntry = normalNightEntries.find(
    ({ summary }) =>
      summary.self?.roleId === "werewolf" &&
      summary.self.actions.some(
        (action) => action.status === "open" && action.targetKind === "single_player",
      ),
  );

  if (viewerEntry === undefined) {
    throw new Error("No werewolf with a targeted normal-night action is available.");
  }

  const action = viewerEntry.summary.self?.actions.find(
    (candidate) => candidate.status === "open" && candidate.targetKind === "single_player",
  );

  if (action?.targetKind !== "single_player") {
    throw new Error("The werewolf's targeted normal-night action is unavailable.");
  }

  const eligiblePlayers = viewerEntry.summary.players.filter((player) =>
    action.eligibleTargetIds.includes(player.id),
  );
  const ineligiblePlayers = viewerEntry.summary.players.filter(
    (player) => !action.eligibleTargetIds.includes(player.id),
  );
  const selectedTarget = eligiblePlayers[0];

  expect(action.kind).toBe("attack");
  expect(eligiblePlayers.length).toBeGreaterThan(0);
  expect(ineligiblePlayers.length).toBeGreaterThan(0);
  expect(
    ineligiblePlayers.some((player) => player.id === viewerEntry.summary.currentPlayerId),
  ).toBe(true);

  if (selectedTarget === undefined) {
    throw new Error("No eligible normal-night target is available.");
  }

  await live.open({ identityToken: viewerEntry.player.token });
  await live.waitForCinematicEffects();

  const actionGuide = live.actionGuide(action);
  const eligibleCards = page.locator(
    '[data-live-player-id][data-live-action-target-state="eligible"]',
  );
  const disabledCards = page.locator(
    '[data-live-player-id][data-live-action-target-state="disabled"]',
  );

  await expect(actionGuide.locator("strong")).toHaveText(action.presentation.en.label);
  await expect(eligibleCards).toHaveCount(eligiblePlayers.length);
  await expect(disabledCards).toHaveCount(ineligiblePlayers.length);

  for (const player of eligiblePlayers) {
    await expect(live.actionTarget(player.id)).toBeEnabled();
  }

  for (const player of ineligiblePlayers) {
    await expect(
      page.locator(
        `[data-live-player-id="${player.id}"][data-live-action-target-state="disabled"]`,
      ),
    ).toBeDisabled();
  }

  await live.actionTarget(selectedTarget.id).click();

  const confirmation = page.locator("[data-live-action-confirmation]");

  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator("h2")).toHaveText(
    `${action.presentation.en.targetConfirmation.beforeTarget}${selectedTarget.displayName}${action.presentation.en.targetConfirmation.afterTarget}`,
  );
  await expect(confirmation.locator("[data-live-action-confirm]")).toHaveText(
    action.presentation.en.submitLabel,
  );
});

test("round-table voting clears obscured selection and locks the pending submission", async ({
  live,
  page,
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Rowan",
    "Sage",
    "Thyme",
  ]);
  const viewer = requirePlayer(players, 0);
  const firstNightSummary = await readRoomSummary(request, roomCode, viewer);

  await live.open({ identityToken: viewer.token });
  await live.waitForCinematicEffects();
  await submitAllOpenActionsForPhase(
    request,
    roomCode,
    players,
    requirePhaseInstanceId(firstNightSummary),
  );

  await expect
    .poll(async () => (await readRoomSummary(request, roomCode, viewer)).game?.phase)
    .toBe("day");
  await expect(page.locator('[data-live-mood="day"]')).toBeVisible({ timeout: 12_000 });
  await live.waitForCinematicEffects();

  const daySummary = await readRoomSummary(request, roomCode, viewer);

  await submitAllOpenActionsForPhase(
    request,
    roomCode,
    players,
    requirePhaseInstanceId(daySummary),
  );

  const votingEffect = page.locator('[data-live-effect="phase"][data-phase="voting"]');

  await expect(votingEffect).toBeVisible({ timeout: 12_000 });
  await expect(page.locator("[data-live-action-guide]")).toHaveCount(0);
  await expect(page.locator('[data-live-action-target-state="eligible"]')).toHaveCount(0);

  const votingSummary = await readRoomSummary(request, roomCode, viewer);
  const vote = requireOpenAction(votingSummary, "vote");

  if (vote.targetKind !== "single_player") {
    throw new Error("The viewer's voting action is not targeted.");
  }

  const targetPlayerId = vote.eligibleTargetIds[0];
  const targetPlayer = votingSummary.players.find((player) => player.id === targetPlayerId);

  if (targetPlayerId === undefined || targetPlayer === undefined) {
    throw new Error("The viewer does not have an eligible voting target.");
  }

  await expect(votingEffect).toHaveCount(0, { timeout: 10_000 });

  const actionGuide = live.actionGuide(vote);
  const target = live.actionTarget(targetPlayerId);
  const confirmation = page.locator("[data-live-action-confirmation]");
  const reselectButton = confirmation.locator("[data-live-action-reselect]");
  const confirmButton = confirmation.locator("[data-live-action-confirm]");
  const actionRequestStarted = createGate();
  const releaseActionRequest = createGate();
  let actionRequestCount = 0;

  await expect(actionGuide).toBeVisible();
  await expect(actionGuide).toContainText(vote.presentation.en.label);
  await expect(target).toBeEnabled();
  await expect(
    page.locator('[data-live-player-id][data-live-action-target-state="eligible"]'),
  ).toHaveCount(vote.eligibleTargetIds.length);

  const ineligiblePlayerIds = votingSummary.players
    .map((player) => player.id)
    .filter((playerId) => !vote.eligibleTargetIds.includes(playerId));

  for (const playerId of ineligiblePlayerIds) {
    await expect(
      page.locator(`[data-live-player-id="${playerId}"][data-live-action-target-state="disabled"]`),
    ).toBeDisabled();
  }

  await page.route(`**/api/rooms/${roomCode}/action`, async (route) => {
    actionRequestCount += 1;
    actionRequestStarted.release();
    await releaseActionRequest.wait;
    await route.continue();
  });

  try {
    await target.click();
    await expect(confirmation).toBeVisible();
    expect(actionRequestCount).toBe(0);
    await expect(confirmation).toContainText(
      `${vote.presentation.en.targetConfirmation.beforeTarget}${targetPlayer.displayName}${vote.presentation.en.targetConfirmation.afterTarget}`,
    );
    await expect(confirmation.locator("[data-live-action-warning]")).toHaveText(
      live.t.live.actionGuide.irreversibleWarning,
    );

    await reselectButton.click();
    await expect(confirmation).toHaveCount(0);
    await expect(target).toBeFocused();

    await target.click();
    await expect(confirmation).toBeVisible();

    const roleEffect = page.locator('[data-live-effect="role"]');
    const replayRoleButton = page.getByRole("button", {
      name: live.t.live.effects.role.reveal,
      exact: true,
    });

    await replayRoleButton.dispatchEvent("click");
    await expect(roleEffect).toBeVisible();
    await expect(confirmation).toHaveCount(0);
    await live.waitForCinematicEffects();
    await expect(confirmation).toHaveCount(0);
    await expect(target).toHaveAttribute("aria-pressed", "false");
    await expect(target).toBeEnabled();
    await expect(actionGuide).toBeVisible();

    await target.click();
    await expect(confirmation).toBeVisible();
    await confirmButton.click();
    await actionRequestStarted.wait;

    await expect(confirmation).toBeVisible();
    await expect(reselectButton).toBeDisabled();
    await expect(confirmButton).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();

    const modalRoot = page.locator("[data-live-modal-root]").filter({ has: confirmation });

    await modalRoot.click({ position: { x: 4, y: 4 } });
    await expect(confirmation).toBeVisible();

    await reselectButton.click({ force: true });
    await confirmButton.click({ force: true });
    await expect(confirmation).toBeVisible();
    expect(actionRequestCount).toBe(1);

    releaseActionRequest.release();
    await expect(confirmation).toHaveCount(0, { timeout: 10_000 });
    await expect(actionGuide).toHaveAttribute("data-live-action-status", "submitted");
    await expect(actionGuide).toContainText(vote.presentation.en.submittedMessage);

    const acceptedSummary = await readRoomSummary(request, roomCode, viewer);

    expect(acceptedSummary.game?.phase).toBe("voting");
    expect(acceptedSummary.self?.actionReceipts).toContainEqual(
      expect.objectContaining({
        actionKey: vote.key,
        kind: vote.kind,
        phaseInstanceId: vote.phaseInstanceId,
      }),
    );
  } finally {
    releaseActionRequest.release();
    await page.unroute(`**/api/rooms/${roomCode}/action`);
  }
});

test("role-private night conversation sends and receives accepted messages", async ({
  live,
  page,
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Juniper",
    "Kite",
    "Linden",
    "Maple",
    "Nettle",
    "Olive",
    "Pine",
  ]);
  const summaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );
  const werewolves = players.filter((player, index) => {
    void player;

    return summaries[index]?.self?.roleId === "werewolf";
  });
  const viewer = requirePlayer(werewolves, 0);
  const peer = requirePlayer(werewolves, 1);
  const viewerSummary = await readRoomSummary(request, roomCode, viewer);
  const conversation = viewerSummary.rolePrivate?.nightConversation;

  if (conversation === null || conversation === undefined) {
    throw new Error("The viewer did not receive a role-private conversation.");
  }

  await live.open({ identityToken: viewer.token });
  await live.waitForCinematicEffects();
  await page.getByRole("button", { name: live.t.live.buttons.nightChat, exact: true }).click();

  const dialog = page.getByRole("dialog", { name: conversation.label.en, exact: true });
  const messageRows = dialog.locator("[data-live-night-message-id]");
  const peerMessage = "Incoming private message";
  const viewerMessage = "Outgoing private message";

  await sendNightConversationMessage(request, roomCode, peer, peerMessage);
  await expect(dialog.getByText(peerMessage, { exact: true })).toBeVisible({ timeout: 10_000 });

  const messageInput = dialog.getByLabel(live.t.live.nightConversation.message, { exact: true });
  const messageCount = await messageRows.count();

  await messageInput.fill(viewerMessage);
  await dialog.getByRole("button", { name: live.t.live.buttons.send, exact: true }).click();
  await expect(messageRows).toHaveCount(messageCount + 1);
  await expect(dialog.getByText(viewerMessage, { exact: true })).toBeVisible();
  await expect(messageInput).toHaveValue("");
});
