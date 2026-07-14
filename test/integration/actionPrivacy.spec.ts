import { expect, test } from "playwright/test";

import { apiFetch, readJsonResponse } from "../fixtures/apiClient";
import { requireOpenAction } from "../fixtures/roomScenario";
import {
  advanceToNormalNight,
  advanceToVoting,
  createContractStartedRoom,
  findForbiddenKeyPath,
  readRoomEntries,
  withTimeout,
  type ApiErrorResponse,
  type RoomEntry,
} from "./support";

import type { PublicAction, RoomSummary } from "@/lib/shared/game";

const SELECTED_TARGET_KEYS = new Set([
  "selectedTargetId",
  "selectedTargetIds",
  "targetPlayerId",
  "targetPlayerIds",
]);

test("an in-progress vote exposes progress but not the submitted target to public or other self views", async ({
  request,
}) => {
  const { players, roomCode } = await createContractStartedRoom(request, [
    "Hazel",
    "Indigo",
    "Jade",
    "Kelp",
  ]);
  const beforeEntries = await advanceToVoting(request, roomCode, players);
  const voter = requireEntry(beforeEntries, 0);
  const other = requireEntry(beforeEntries, 1);
  const action = requireOpenAction(voter.summary, "vote");
  const targetPlayerId = action.eligibleTargetIds[0];

  if (targetPlayerId === undefined || voter.summary.game === null) {
    throw new Error("Vote submission state is unavailable.");
  }

  await apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}/action`, {
    body: {
      actionKey: action.key,
      phaseInstanceId: action.phaseInstanceId,
      revision: voter.summary.game.revision,
      targetPlayerId,
    },
    method: "POST",
    token: voter.player.token,
  });

  const afterEntries = await readRoomEntries(request, roomCode, players);
  const afterVoter = findEntry(afterEntries, voter.player.token);
  const afterOther = findEntry(afterEntries, other.player.token);
  const receipt = afterVoter.summary.self?.actionReceipts.find(
    ({ actionKey }) => actionKey === action.key,
  );
  const otherReceipt = afterOther.summary.self?.actionReceipts.find(
    ({ actionKey }) => actionKey === action.key,
  );

  expect(afterVoter.summary.game?.actionProgress).toMatchObject({
    kind: "votes_submitted",
    submitted: 1,
    visibility: "public",
  });
  expect(receipt).toMatchObject({ actionKey: action.key, kind: action.kind });
  expect(otherReceipt).toBeUndefined();
  expect(
    findForbiddenKeyPath(
      { game: afterVoter.summary.game, otherSelf: afterOther.summary.self, receipt },
      SELECTED_TARGET_KEYS,
    ),
  ).toBeNull();
});

test("a shared normal-night action accepts one concurrent target without leaking it", async ({
  request,
}) => {
  const { players, roomCode } = await createContractStartedRoom(request, [
    "Lupine",
    "Myrtle",
    "Nutmeg",
    "Orris",
    "Peony",
    "Quince",
    "Rose",
  ]);
  const beforeEntries = await advanceToNormalNight(request, roomCode, players);
  const shared = requireSharedAction(beforeEntries);
  const first = requireEntry(shared.entries, 0);
  const second = requireEntry(shared.entries, 1);
  const firstTarget = shared.commonTargetIds[0];
  const secondTarget = shared.commonTargetIds[1];

  if (
    firstTarget === undefined ||
    secondTarget === undefined ||
    first.summary.game === null ||
    second.summary.game === null
  ) {
    throw new Error("Shared normal-night submission state is unavailable.");
  }

  const responses = await withTimeout(
    Promise.all([
      readJsonResponse<RoomSummary | ApiErrorResponse>(request, `/api/rooms/${roomCode}/action`, {
        body: {
          actionKey: shared.action.key,
          phaseInstanceId: shared.action.phaseInstanceId,
          revision: first.summary.game.revision,
          targetPlayerId: firstTarget,
        },
        method: "POST",
        token: first.player.token,
      }),
      readJsonResponse<RoomSummary | ApiErrorResponse>(request, `/api/rooms/${roomCode}/action`, {
        body: {
          actionKey: shared.action.key,
          phaseInstanceId: shared.action.phaseInstanceId,
          revision: second.summary.game.revision,
          targetPlayerId: secondTarget,
        },
        method: "POST",
        token: second.player.token,
      }),
    ]),
    10_000,
    "Concurrent shared normal-night submissions",
  );

  expect(responses.map(({ status }) => status)).toEqual([200, 200]);

  const afterEntries = await readRoomEntries(request, roomCode, players);
  const receipts = afterEntries.flatMap(({ summary }) =>
    (summary.self?.actionReceipts ?? []).filter(({ actionKey }) => actionKey === shared.action.key),
  );

  expect(receipts).toHaveLength(1);

  for (const { summary } of afterEntries) {
    expect(summary.game).toMatchObject({
      actionProgress: { kind: "night_actions_hidden", visibility: "hidden" },
      nightNumber: 2,
      phase: "night",
    });
    expect(
      findForbiddenKeyPath(
        { game: summary.game, receipts: summary.self?.actionReceipts },
        SELECTED_TARGET_KEYS,
      ),
    ).toBeNull();
  }
});

test("initial inspection is visible only in its owner's private event stream", async ({
  request,
}) => {
  const { players, roomCode } = await createContractStartedRoom(request, [
    "Sage",
    "Tansy",
    "Ulex",
    "Verbena",
  ]);
  const entries = await readRoomEntries(request, roomCode, players);
  const owners = entries.filter(({ summary }) =>
    summary.self?.events.some(({ kind }) => kind === "initial_inspection"),
  );

  expect(owners).toHaveLength(1);

  const owner = owners[0];

  if (owner === undefined) {
    return;
  }

  for (const entry of entries) {
    expect(entry.summary.game?.events.some(({ kind }) => kind === "initial_inspection")).toBe(
      false,
    );

    if (entry.player.token !== owner.player.token) {
      expect(entry.summary.self?.events.some(({ kind }) => kind === "initial_inspection")).toBe(
        false,
      );
    }
  }
});

function requireSharedAction(entries: readonly RoomEntry[]): {
  readonly action: PublicAction;
  readonly commonTargetIds: readonly string[];
  readonly entries: readonly RoomEntry[];
} {
  const entriesByActionKey = new Map<string, RoomEntry[]>();

  for (const entry of entries) {
    for (const action of entry.summary.self?.actions ?? []) {
      if (action.status !== "open" || action.targetKind !== "single_player") {
        continue;
      }

      entriesByActionKey.set(action.key, [...(entriesByActionKey.get(action.key) ?? []), entry]);
    }
  }

  for (const actionEntries of entriesByActionKey.values()) {
    if (actionEntries.length < 2) {
      continue;
    }

    const firstEntry = actionEntries[0];
    const action = firstEntry?.summary.self?.actions.find(
      (candidate) =>
        candidate.status === "open" && entriesByActionKey.get(candidate.key) === actionEntries,
    );

    if (action === undefined) {
      continue;
    }

    const commonTargetIds = action.eligibleTargetIds.filter((targetId) =>
      actionEntries.every((entry) =>
        entry.summary.self?.actions
          .find((candidate) => candidate.key === action.key)
          ?.eligibleTargetIds.includes(targetId),
      ),
    );

    if (commonTargetIds.length >= 2) {
      return { action, commonTargetIds, entries: actionEntries };
    }
  }

  throw new Error("No shared action with two common targets is available.");
}

function requireEntry(entries: readonly RoomEntry[], index: number): RoomEntry {
  const entry = entries[index];

  if (entry === undefined) {
    throw new Error(`Room entry ${index} is unavailable.`);
  }

  return entry;
}

function findEntry(entries: readonly RoomEntry[], token: string): RoomEntry {
  const entry = entries.find(({ player }) => player.token === token);

  if (entry === undefined) {
    throw new Error("Room entry is unavailable.");
  }

  return entry;
}
