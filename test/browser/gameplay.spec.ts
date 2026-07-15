import { readRoomSummary } from "../fixtures/apiClient";
import {
  createRoomWithStartedGame,
  requireOpenAction,
  requirePlayer,
  sendNightConversationMessage,
  submitOpenActions,
} from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";

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

test("an accepted action receipt remains scoped to its submitter", async ({ live, request }) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, ["Gale", "Hazel", "Iris"]);
  const submitter = requirePlayer(players, 0);
  const observer = requirePlayer(players, 1);
  const beforeSubmitter = await readRoomSummary(request, roomCode, submitter);
  const beforeObserver = await readRoomSummary(request, roomCode, observer);
  const action = requireOpenAction(beforeSubmitter, "first_night_ready");

  await live.open({ identityToken: submitter.token });
  await live.waitForCinematicEffects();

  const actionRow = live.actionRow(action);

  await actionRow.locator("[data-live-action-submit]").click();
  await expect(actionRow).toHaveAttribute("data-live-action-status", "submitted");

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
