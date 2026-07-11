import { describe, expect, it } from "vitest";

import {
  createLiveActionFeedbackSnapshot,
  getLiveActionFeedbackCue,
  getLiveActionFeedbackSnapshotKey,
  hasLiveActionFeedbackTarget,
  reconcileLiveActionFeedback,
  type LiveActionFeedbackSnapshot,
} from "./liveActionFeedbackModel";

import type { ActionSubmissionReceipt, RoomSummary } from "@/lib/shared/game";

describe("live action feedback model", () => {
  it("treats the first snapshot and viewer session changes as baselines", () => {
    const receipt = makeReceipt("receipt-1");
    const current = makeSnapshot({ latestReceipt: receipt, submitted: true });
    const otherRoom = makeSnapshot({ latestReceipt: receipt, roomCode: "654321", submitted: true });
    const otherViewer = makeSnapshot({
      latestReceipt: receipt,
      submitted: true,
      viewerPlayerId: "blair",
    });

    expect(getLiveActionFeedbackCue(null, current)).toBeNull();
    expect(getLiveActionFeedbackCue(current, otherRoom)).toBeNull();
    expect(getLiveActionFeedbackCue(current, otherViewer)).toBeNull();
  });

  it("creates one cue for a new private receipt reflected by the submitted row", () => {
    const first = makeSnapshot();
    const receipt = makeReceipt("receipt-1");
    const submitted = makeSnapshot({ latestReceipt: receipt, submitted: true });
    const cue = getLiveActionFeedbackCue(first, submitted);

    expect(cue).toEqual({ receipt });
    expect(cue === null ? false : hasLiveActionFeedbackTarget(submitted, cue)).toBe(true);
    expect(getLiveActionFeedbackCue(submitted, submitted)).toBeNull();
  });

  it("does not mistake a shared action submitted by someone else for the viewer receipt", () => {
    const open = makeSnapshot();
    const submittedWithoutReceipt = makeSnapshot({ submitted: true });

    expect(getLiveActionFeedbackCue(open, submittedWithoutReceipt)).toBeNull();
  });

  it("hands a final submission off to the phase effect when its row is gone", () => {
    const open = makeSnapshot();
    const receipt = makeReceipt("receipt-1");
    const nextPhase = makeSnapshot({
      actions: [],
      latestReceipt: receipt,
    });

    expect(getLiveActionFeedbackCue(open, nextPhase)).toBeNull();
  });

  it("requires matching action and phase identities", () => {
    const open = makeSnapshot();
    const receipt = makeReceipt("receipt-1");
    const wrongAction = makeSnapshot({
      actions: [{ key: "other", phaseInstanceId: "phase-1", status: "submitted" }],
      latestReceipt: receipt,
    });
    const wrongPhase = makeSnapshot({
      actions: [{ key: "ready", phaseInstanceId: "phase-2", status: "submitted" }],
      latestReceipt: receipt,
    });

    expect(getLiveActionFeedbackCue(open, wrongAction)).toBeNull();
    expect(getLiveActionFeedbackCue(open, wrongPhase)).toBeNull();
  });

  it("settles hidden and reduced-motion updates without replaying them later", () => {
    const open = makeSnapshot();
    const submitted = makeSnapshot({
      latestReceipt: makeReceipt("receipt-1"),
      submitted: true,
    });
    const hiddenUpdate = reconcileLiveActionFeedback(open, submitted, false);

    expect(hiddenUpdate.cue).toBeNull();
    expect(reconcileLiveActionFeedback(hiddenUpdate.snapshot, submitted, true).cue).toBeNull();
  });

  it("projects only semantic action and receipt state from room summaries", () => {
    const first = makeSummary();
    const second: RoomSummary = {
      ...first,
      game: {
        ...first.game!,
        actionProgress: {
          kind: "first_night_ready",
          label: "Ready for daybreak.",
          required: 3,
          submitted: 1,
          visibility: "public",
        },
        revision: 99,
      },
      snapshotRevision: 42,
    };

    expect(getLiveActionFeedbackSnapshotKey(createLiveActionFeedbackSnapshot(second))).toBe(
      getLiveActionFeedbackSnapshotKey(createLiveActionFeedbackSnapshot(first)),
    );
  });
});

function makeSnapshot({
  actions,
  latestReceipt = null,
  roomCode = "123456",
  submitted = false,
  viewerPlayerId = "alice",
}: {
  readonly actions?: LiveActionFeedbackSnapshot["actions"];
  readonly latestReceipt?: ActionSubmissionReceipt | null;
  readonly roomCode?: string | null;
  readonly submitted?: boolean;
  readonly viewerPlayerId?: string | null;
} = {}): LiveActionFeedbackSnapshot {
  return {
    actions: actions ?? [
      {
        key: "ready",
        phaseInstanceId: "phase-1",
        status: submitted ? "submitted" : "open",
      },
    ],
    latestReceipt,
    roomCode,
    viewerPlayerId,
  };
}

function makeReceipt(id: string): ActionSubmissionReceipt {
  return {
    actionKey: "ready",
    id,
    kind: "first_night_ready",
    phaseInstanceId: "phase-1",
    submittedAt: "2099-01-01T00:00:00.000Z",
  };
}

function makeSummary(): RoomSummary {
  return {
    code: "123456",
    currentPlayerId: "alice",
    defaultRoleCounts: {},
    game: {
      actionProgress: null,
      dayNumber: 0,
      events: [],
      nightNumber: 1,
      phase: "night",
      phaseEndsAt: "2099-01-01T00:00:00.000Z",
      phaseFocus: null,
      phaseInstanceId: "phase-1",
      revision: 1,
      status: "playing",
      winnerTeam: null,
    },
    hostPlayerId: "alice",
    isHost: true,
    players: [],
    roleCatalog: [],
    rolePrivate: null,
    self: {
      actionReceipts: [],
      actions: [
        {
          closesAt: "2099-01-01T00:00:00.000Z",
          eligibleTargetIds: [],
          key: "ready",
          kind: "first_night_ready",
          label: "Ready for daybreak",
          phaseInstanceId: "phase-1",
          status: "open",
          targetKind: "none",
        },
      ],
      events: [],
      playerId: "alice",
      result: null,
      roleId: "villager",
      roleName: "Villager",
    },
    snapshotRevision: 1,
    status: "playing",
    targetPlayerCount: 3,
    waitingExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}
