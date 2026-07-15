import { describe, expect, it } from "vitest";

import {
  getLiveActionGuideState,
  getLiveActionIdentity,
  isLiveActionSelectionValid,
  matchesLiveActionIdentity,
  matchesLiveActionReceipt,
  type LiveActionSelection,
} from "./liveActionInteractionModel";

import type {
  ActionSubmissionReceipt,
  PublicAction,
  SinglePlayerActionPresentation,
  TargetlessActionPresentation,
} from "@/lib/shared/game";

type SinglePlayerPublicAction = Extract<PublicAction, { targetKind: "single_player" }>;
type TargetlessPublicAction = Extract<PublicAction, { targetKind: "none" }>;

const TARGETED_ACTION_PRESENTATION: SinglePlayerActionPresentation = {
  en: {
    label: "Choose a target.",
    submitLabel: "Submit",
    submittedMessage: "Action submitted.",
    targetConfirmation: {
      afterTarget: " as the target?",
      beforeTarget: "Choose ",
    },
  },
  ja: {
    label: "対象を選択してください。",
    submitLabel: "実行する",
    submittedMessage: "実行済みです。",
    targetConfirmation: {
      afterTarget: "を対象にしますか？",
      beforeTarget: "",
    },
  },
};

const TARGETLESS_ACTION_PRESENTATION: TargetlessActionPresentation = {
  en: {
    label: "Submit the action.",
    submitLabel: "Submit",
    submittedMessage: "Action submitted.",
  },
  ja: {
    label: "アクションを実行してください。",
    submitLabel: "実行する",
    submittedMessage: "実行済みです。",
  },
};

describe("live action interaction model", () => {
  it("selects the first open action without interpreting its opaque kind", () => {
    const submitted = makeAction({ key: "submitted", status: "submitted" });
    const firstOpen = makeAction({ key: "first-open", kind: "synthetic_ritual" });
    const secondOpen = makeAction({ key: "second-open", kind: "another_ritual" });

    expect(getLiveActionGuideState([submitted, firstOpen, secondOpen], [])).toEqual({
      action: firstOpen,
      kind: "active",
    });
    expect(getLiveActionGuideState([], [])).toEqual({ kind: "idle" });
  });

  it("creates and matches the complete action identity", () => {
    const action = makeAction();
    const identity = getLiveActionIdentity(action);

    expect(identity).toEqual({
      key: action.key,
      kind: action.kind,
      phaseInstanceId: action.phaseInstanceId,
    });
    expect(matchesLiveActionIdentity(action, identity)).toBe(true);
    expect(matchesLiveActionIdentity(action, { ...identity, key: "other" })).toBe(false);
    expect(matchesLiveActionIdentity(action, { ...identity, kind: "other_kind" })).toBe(false);
    expect(matchesLiveActionIdentity(action, { ...identity, phaseInstanceId: "phase-2" })).toBe(
      false,
    );
  });

  it("matches receipts by action key, opaque kind, and phase identity", () => {
    const action = makeAction();
    const receipt = makeReceipt();

    expect(matchesLiveActionReceipt(action, receipt)).toBe(true);
    expect(matchesLiveActionReceipt({ ...action, key: "other" }, receipt)).toBe(false);
    expect(matchesLiveActionReceipt({ ...action, kind: "other_kind" }, receipt)).toBe(false);
    expect(matchesLiveActionReceipt({ ...action, phaseInstanceId: "phase-2" }, receipt)).toBe(
      false,
    );
  });

  it("returns the submitted action for the newest matching private receipt", () => {
    const first = makeAction({ key: "first", status: "submitted" });
    const latest = makeAction({ key: "latest", kind: "latest_kind", status: "submitted" });
    const receipts = [
      makeReceipt({
        actionKey: latest.key,
        id: "receipt-2",
        kind: latest.kind,
        submittedAt: "2099-01-01T00:00:02.000Z",
      }),
      makeReceipt({
        actionKey: first.key,
        id: "receipt-1",
        submittedAt: "2099-01-01T00:00:01.000Z",
      }),
    ];

    expect(getLiveActionGuideState([latest, first], receipts)).toEqual({
      action: latest,
      kind: "accepted",
    });
    expect(
      getLiveActionGuideState([first], [makeReceipt({ actionKey: first.key, kind: "wrong_kind" })]),
    ).toEqual({ kind: "closed" });
    expect(getLiveActionGuideState([], [makeReceipt()])).toEqual({ kind: "idle" });
  });

  it("does not let shared action row order hide the viewer's accepted submission", () => {
    const personal = makeAction({ key: "personal", status: "submitted" });
    const shared = makeAction({ key: "shared", kind: "shared_kind", status: "submitted" });
    const receipt = makeReceipt({ actionKey: personal.key });

    expect(getLiveActionGuideState([personal, shared], [receipt])).toEqual({
      action: personal,
      kind: "accepted",
    });
    expect(getLiveActionGuideState([shared, personal], [receipt])).toEqual({
      action: personal,
      kind: "accepted",
    });
  });

  it("uses a neutral closed state when only shared submissions are visible", () => {
    const submitted = makeAction({ status: "submitted" });

    expect(getLiveActionGuideState([submitted], [])).toEqual({ kind: "closed" });
    expect(getLiveActionGuideState([submitted], [makeReceipt({ kind: "other_kind" })])).toEqual({
      kind: "closed",
    });
  });

  it("validates a selection against the current open action and eligible target", () => {
    const action = makeAction();
    const selection: LiveActionSelection = {
      actionKey: action.key,
      actionKind: action.kind,
      phaseInstanceId: action.phaseInstanceId,
      targetPlayerId: "target-a",
    };

    expect(isLiveActionSelectionValid(selection, [action])).toBe(true);
    expect(isLiveActionSelectionValid({ ...selection, actionKind: "other_kind" }, [action])).toBe(
      false,
    );
    expect(isLiveActionSelectionValid({ ...selection, phaseInstanceId: "phase-2" }, [action])).toBe(
      false,
    );
    expect(isLiveActionSelectionValid({ ...selection, targetPlayerId: "unknown" }, [action])).toBe(
      false,
    );
    expect(isLiveActionSelectionValid(selection, [makeAction({ status: "submitted" })])).toBe(
      false,
    );
    expect(isLiveActionSelectionValid(selection, [makeTargetlessAction()])).toBe(false);
  });
});

function makeAction(overrides: Partial<SinglePlayerPublicAction> = {}): SinglePlayerPublicAction {
  return {
    closesAt: "2099-01-01T00:00:00.000Z",
    eligibleTargetIds: ["target-a", "target-b"],
    key: "action-key",
    kind: "opaque_action",
    phaseInstanceId: "phase-1",
    presentation: TARGETED_ACTION_PRESENTATION,
    status: "open",
    targetKind: "single_player",
    ...overrides,
  };
}

function makeTargetlessAction(
  overrides: Partial<TargetlessPublicAction> = {},
): TargetlessPublicAction {
  return {
    closesAt: "2099-01-01T00:00:00.000Z",
    eligibleTargetIds: [],
    key: "targetless-action-key",
    kind: "opaque_targetless_action",
    phaseInstanceId: "phase-1",
    presentation: TARGETLESS_ACTION_PRESENTATION,
    status: "open",
    targetKind: "none",
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<ActionSubmissionReceipt> = {}): ActionSubmissionReceipt {
  return {
    actionKey: "action-key",
    id: "receipt-1",
    kind: "opaque_action",
    phaseInstanceId: "phase-1",
    submittedAt: "2099-01-01T00:00:01.000Z",
    ...overrides,
  };
}
