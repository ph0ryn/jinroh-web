import { expect, test } from "playwright/test";

import { apiFetch, createStartedRoom, readRoomSummary, type ApiPlayer } from "./support/api";
import { installListMotionHistory, readListMotionHistory } from "./support/listMotionHistory";

import type { RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext, Locator } from "playwright/test";

test("an open night conversation reveals accepted incoming and sent messages", async ({
  page,
  request,
}) => {
  const displayNames = ["Aster", "Birch", "Cedar", "Dahlia", "Elm", "Fir", "Gale"];
  const { players, roomCode } = await createStartedRoom(request, displayNames);
  const werewolves = await getWerewolfPlayers(request, roomCode, players);
  const viewer = werewolves[0];
  const peer = werewolves[1];

  if (viewer === undefined || peer === undefined) {
    throw new Error("Night conversation motion test requires two werewolves.");
  }

  for (let index = 1; index <= 6; index += 1) {
    await sendNightConversationMessage(request, roomCode, peer, `Earlier howl ${index}`);
  }
  await installListMotionHistory(page);
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: viewer.token },
  );
  await page.goto("/live");
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 8_000 });

  const nightChatButton = page.getByRole("button", { exact: true, name: "Night chat" });

  await nightChatButton.click();

  const dialog = page.getByRole("dialog", { name: "Werewolf council" });
  const messageRows = dialog.locator("[data-live-night-message-id]");
  const messageList = dialog.locator("[data-live-night-message-list]");

  await expect(messageRows).toHaveCount(6);
  await expect.poll(() => getDistanceFromScrollEnd(messageList)).toBeLessThanOrEqual(1);
  expect(await readListMotionHistory(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0, { timeout: 2_000 });
  await nightChatButton.click();
  await expect(dialog).toBeVisible();
  expect(await readListMotionHistory(page)).toEqual([]);

  await sendNightConversationMessage(request, roomCode, peer, "Second howl");
  await expect(messageRows).toHaveCount(7, { timeout: 8_000 });
  await expect.poll(() => readListMotionHistory(page)).toEqual([{ count: 1, kind: "message" }]);
  await expect(dialog.locator("[data-live-list-motion-count]")).toHaveCount(0, {
    timeout: 2_000,
  });
  await expect.poll(() => getDistanceFromScrollEnd(messageList)).toBeLessThanOrEqual(1);

  const messageInput = dialog.getByLabel("Message", { exact: true });

  await messageInput.fill("Answering howl");
  await dialog.getByRole("button", { exact: true, name: "Send" }).click();
  await expect(messageRows).toHaveCount(8, { timeout: 8_000 });
  await expect
    .poll(() => readListMotionHistory(page))
    .toEqual([
      { count: 1, kind: "message" },
      { count: 1, kind: "message" },
    ]);
  await expect(messageInput).toHaveValue("");
  await expect(dialog.getByText("Answering howl", { exact: true })).toBeVisible();
  await expect.poll(() => getDistanceFromScrollEnd(messageList)).toBeLessThanOrEqual(1);

  await messageList.evaluate((list) => {
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await sendNightConversationMessage(request, roomCode, peer, "Unread while reviewing");
  await expect(messageRows).toHaveCount(9, { timeout: 8_000 });
  await expect
    .poll(() => readListMotionHistory(page))
    .toEqual([
      { count: 1, kind: "message" },
      { count: 1, kind: "message" },
      { count: 1, kind: "message" },
    ]);
  await expect.poll(() => messageList.evaluate((list) => list.scrollTop)).toBe(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0, { timeout: 2_000 });
  await nightChatButton.click();
  await expect(messageRows).toHaveCount(9);
  expect(await readListMotionHistory(page)).toEqual([
    { count: 1, kind: "message" },
    { count: 1, kind: "message" },
    { count: 1, kind: "message" },
  ]);
});

test("reduced motion settles a sent night message without transient choreography", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Dawn", "Elm", "Fir"]);
  const werewolves = await getWerewolfPlayers(request, roomCode, players);
  const viewer = werewolves[0];

  if (viewer === undefined) {
    throw new Error("Reduced-motion night conversation test requires a werewolf.");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await installListMotionHistory(page);
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: viewer.token },
  );
  await page.goto("/live");
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 4_000 });
  await page.getByRole("button", { exact: true, name: "Night chat" }).click();

  const dialog = page.getByRole("dialog", { name: "Werewolf council" });
  const messageInput = dialog.getByLabel("Message", { exact: true });

  await messageInput.fill("Quiet howl");
  await dialog.getByRole("button", { exact: true, name: "Send" }).click();
  await expect(dialog.locator("[data-live-night-message-id]")).toHaveCount(1, {
    timeout: 8_000,
  });
  expect(await readListMotionHistory(page)).toEqual([]);
  await expect(dialog.locator("[data-live-list-item-motion]")).toHaveCount(0);
});

async function getWerewolfPlayers(
  request: APIRequestContext,
  roomCode: string,
  players: readonly ApiPlayer[],
): Promise<readonly ApiPlayer[]> {
  const summaries = await Promise.all(
    players.map((player) => readRoomSummary(request, roomCode, player)),
  );

  return players.filter((player, index) => {
    void player;

    return summaries[index]?.self?.roleId === "werewolf";
  });
}

async function sendNightConversationMessage(
  request: APIRequestContext,
  roomCode: string,
  player: ApiPlayer,
  body: string,
): Promise<void> {
  const summary = await readRoomSummary(request, roomCode, player);
  const conversation = summary.rolePrivate?.nightConversation;
  const phaseInstanceId = summary.game?.phaseInstanceId;

  if (
    conversation === null ||
    conversation === undefined ||
    phaseInstanceId === null ||
    phaseInstanceId === undefined
  ) {
    throw new Error("Night conversation is not available for the test player.");
  }

  await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/night-conversation`, {
    body: {
      body,
      conversationGroupId: conversation.groupId,
      nightNumber: conversation.nightNumber,
      phaseInstanceId,
    },
    method: "POST",
    token: player.token,
  });
}

async function getDistanceFromScrollEnd(messageList: Locator): Promise<number> {
  return messageList.evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight);
}
