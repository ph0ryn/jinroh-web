import { randomUUID } from "node:crypto";

import { expect, test } from "playwright/test";

import { apiFetch, readJsonResponse, readRoomSummary } from "../fixtures/apiClient";
import { requireOpenAction, sendNightConversationMessage } from "../fixtures/roomScenario";
import {
  createRoomWithStartedGame,
  readRoomEntries,
  submitPhaseActions,
  type ApiErrorResponse,
  type RoomEntry,
} from "./support";

test("night conversation accepts one and one hundred characters only within its private scope", async ({
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Mallow",
    "Nettle",
    "Olive",
    "Pine",
  ]);
  const entries = await readRoomEntries(request, roomCode, players);
  const member = requireConversationMember(entries);
  const outsider = requireConversationOutsider(entries);
  const outsiderRevision = outsider.summary.snapshotRevision;
  const minimumBody = "x";
  const maximumBody = "y".repeat(100);

  await sendNightConversationMessage(request, roomCode, member.player, minimumBody);
  await sendNightConversationMessage(request, roomCode, member.player, maximumBody);

  const refreshedMember = await readRoomSummary(request, roomCode, member.player);
  const refreshedOutsider = await readRoomSummary(request, roomCode, outsider.player);
  const visibleBodies =
    refreshedMember.rolePrivate?.nightConversation?.messages.map(({ body }) => body) ?? [];

  expect(visibleBodies).toEqual(expect.arrayContaining([minimumBody, maximumBody]));
  expect(refreshedOutsider.rolePrivate).toBeNull();
  expect(refreshedOutsider.snapshotRevision).toBe(outsiderRevision);
  expect(JSON.stringify(refreshedOutsider.game)).not.toContain(minimumBody);
  expect(JSON.stringify(refreshedOutsider.game)).not.toContain(maximumBody);
});

test("night conversation rejects blank and over-limit bodies without changing stored messages", async ({
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Quartz",
    "Reed",
    "Sorrel",
    "Thyme",
  ]);
  const member = requireConversationMember(await readRoomEntries(request, roomCode, players));
  const conversation = member.summary.rolePrivate?.nightConversation;
  const phaseInstanceId = member.summary.game?.phaseInstanceId;

  if (
    conversation === null ||
    conversation === undefined ||
    phaseInstanceId === null ||
    phaseInstanceId === undefined
  ) {
    throw new Error("Night conversation state is unavailable.");
  }

  const beforeCount = conversation.messages.length;

  for (const body of ["   ", "z".repeat(101)]) {
    const response = await sendNightConversationRequest(
      request,
      roomCode,
      member,
      body,
      conversation.groupId,
      phaseInstanceId,
      conversation.nightNumber,
    );

    expect(response).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
  }

  const refreshed = await readRoomSummary(request, roomCode, member.player);

  expect(refreshed.rolePrivate?.nightConversation?.messages).toHaveLength(beforeCount);
});

test("night conversation rejects outsiders and stale state, then remains readable during day", async ({
  request,
}) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Umber",
    "Violet",
    "Willow",
    "Yarrow",
  ]);
  const entries = await readRoomEntries(request, roomCode, players);
  const member = requireConversationMember(entries);
  const outsider = requireConversationOutsider(entries);
  const conversation = member.summary.rolePrivate?.nightConversation;
  const phaseInstanceId = member.summary.game?.phaseInstanceId;
  const retainedBody = "retained-private-state";

  if (
    conversation === null ||
    conversation === undefined ||
    phaseInstanceId === null ||
    phaseInstanceId === undefined
  ) {
    throw new Error("Night conversation state is unavailable.");
  }

  await sendNightConversationMessage(request, roomCode, member.player, retainedBody);

  const outsiderResponse = await sendNightConversationRequest(
    request,
    roomCode,
    outsider,
    "x",
    conversation.groupId,
    phaseInstanceId,
    conversation.nightNumber,
  );
  const stalePhase = await sendNightConversationRequest(
    request,
    roomCode,
    member,
    "x",
    conversation.groupId,
    randomUUID(),
    conversation.nightNumber,
  );
  const staleNight = await sendNightConversationRequest(
    request,
    roomCode,
    member,
    "x",
    conversation.groupId,
    phaseInstanceId,
    conversation.nightNumber + 1,
  );

  for (const response of [outsiderResponse, stalePhase, staleNight]) {
    expect(response).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
  }

  await submitPhaseActions(request, roomCode, players, () => null);

  const daySummary = await readRoomSummary(request, roomCode, member.player);
  const dayConversation = daySummary.rolePrivate?.nightConversation;

  expect(daySummary.game?.phase).toBe("day");
  expect(dayConversation).toMatchObject({ canSend: false, readOnly: true });
  expect(dayConversation?.messages.some(({ body }) => body === retainedBody)).toBe(true);

  const dayResponse = await sendNightConversationRequest(
    request,
    roomCode,
    { player: member.player, summary: daySummary },
    "x",
    conversation.groupId,
    phaseInstanceId,
    conversation.nightNumber,
  );

  expect(dayResponse).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
});

test("a dead conversation member keeps a read-only view and cannot send", async ({ request }) => {
  const { players, roomCode } = await createRoomWithStartedGame(request, [
    "Ash",
    "Beech",
    "Clover",
    "Dogwood",
    "Elder",
    "Flax",
    "Gorse",
  ]);
  const initialEntries = await readRoomEntries(request, roomCode, players);
  const member = requireConversationMember(initialEntries);
  const memberPlayerId = member.summary.currentPlayerId;

  if (memberPlayerId === null) {
    throw new Error("Conversation member player ID is unavailable.");
  }

  await submitPhaseActions(request, roomCode, players, () => null);
  await submitPhaseActions(request, roomCode, players, () => null);
  await submitPhaseActions(
    request,
    roomCode,
    players,
    (_entry, action) =>
      action.eligibleTargetIds.includes(memberPlayerId)
        ? memberPlayerId
        : (action.eligibleTargetIds[0] ?? null),
    "vote",
  );

  const executionSummary = await readRoomSummary(request, roomCode, member.player);
  const executionAction = requireOpenAction(executionSummary);

  if (executionSummary.game === null) {
    throw new Error("Execution state is unavailable.");
  }

  await apiFetch(request, `/api/rooms/${roomCode}/action`, {
    body: {
      actionKey: executionAction.key,
      gameId: executionSummary.game.gameId,
      phaseInstanceId: executionAction.phaseInstanceId,
      revision: executionSummary.game.revision,
      targetPlayerId: null,
    },
    method: "POST",
    token: member.player.token,
  });

  const deadSummary = await readRoomSummary(request, roomCode, member.player);
  const conversation = deadSummary.rolePrivate?.nightConversation;
  const phaseInstanceId = deadSummary.game?.phaseInstanceId;

  expect(deadSummary.players.find(({ isCurrent }) => isCurrent)?.alive).toBe(false);
  expect(conversation).toMatchObject({ canSend: false, readOnly: true });

  if (
    conversation === null ||
    conversation === undefined ||
    phaseInstanceId === null ||
    phaseInstanceId === undefined
  ) {
    throw new Error("Dead member conversation state is unavailable.");
  }

  const response = await sendNightConversationRequest(
    request,
    roomCode,
    { player: member.player, summary: deadSummary },
    "x",
    conversation.groupId,
    phaseInstanceId,
    conversation.nightNumber,
  );

  expect(response).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
});

function requireConversationMember(entries: readonly RoomEntry[]): RoomEntry {
  const entry = entries.find(
    ({ summary }) =>
      summary.rolePrivate?.nightConversation !== null &&
      summary.rolePrivate?.nightConversation !== undefined,
  );

  if (entry === undefined || entry.summary.rolePrivate?.nightConversation === undefined) {
    throw new Error("No night conversation member is available.");
  }

  return entry;
}

function requireConversationOutsider(entries: readonly RoomEntry[]): RoomEntry {
  const entry = entries.find(({ summary }) => summary.rolePrivate === null);

  if (entry === undefined) {
    throw new Error("No night conversation outsider is available.");
  }

  return entry;
}

function sendNightConversationRequest(
  request: Parameters<typeof readJsonResponse>[0],
  roomCode: string,
  entry: RoomEntry,
  body: string,
  groupId: string,
  phaseInstanceId: string,
  nightNumber: number,
) {
  const gameId = entry.summary.game?.gameId;

  if (gameId === undefined) {
    throw new Error("Night conversation Game ID is unavailable.");
  }

  return readJsonResponse<ApiErrorResponse>(request, `/api/rooms/${roomCode}/night-conversation`, {
    body: {
      body,
      conversationGroupId: groupId,
      gameId,
      nightNumber,
      phaseInstanceId,
    },
    method: "POST",
    token: entry.player.token,
  });
}
