import type { ActionSubmissionReceipt, PublicAction } from "@/lib/shared/game";

export type LiveActionIdentity = Readonly<Pick<PublicAction, "key" | "kind" | "phaseInstanceId">>;

export type LiveActionGuideState =
  | {
      readonly kind: "active";
      readonly action: PublicAction;
    }
  | {
      readonly kind: "accepted";
      readonly action: PublicAction;
    }
  | {
      readonly kind: "closed";
    }
  | {
      readonly kind: "idle";
    };

export type LiveActionSelection = {
  readonly actionKey: string;
  readonly actionKind: PublicAction["kind"];
  readonly phaseInstanceId: string;
  readonly targetPlayerId: string;
};

export function getLiveActionIdentity(action: LiveActionIdentity): LiveActionIdentity {
  return {
    key: action.key,
    kind: action.kind,
    phaseInstanceId: action.phaseInstanceId,
  };
}

export function matchesLiveActionIdentity(
  left: LiveActionIdentity,
  right: LiveActionIdentity,
): boolean {
  return (
    left.key === right.key &&
    left.kind === right.kind &&
    left.phaseInstanceId === right.phaseInstanceId
  );
}

export function matchesLiveActionReceipt(
  action: LiveActionIdentity,
  receipt: ActionSubmissionReceipt,
): boolean {
  return matchesLiveActionIdentity(action, {
    key: receipt.actionKey,
    kind: receipt.kind,
    phaseInstanceId: receipt.phaseInstanceId,
  });
}

export function getLiveActionGuideState(
  actions: readonly PublicAction[],
  receipts: readonly ActionSubmissionReceipt[],
): LiveActionGuideState {
  const activeAction = actions.find((action) => action.status === "open");

  if (activeAction !== undefined) {
    return { action: activeAction, kind: "active" };
  }

  const submittedActions = actions.filter((action) => action.status === "submitted");
  let latestAccepted: {
    readonly action: PublicAction;
    readonly receipt: ActionSubmissionReceipt;
  } | null = null;

  for (const receipt of receipts) {
    const action = submittedActions.find((candidate) =>
      matchesLiveActionReceipt(candidate, receipt),
    );

    if (
      action !== undefined &&
      (latestAccepted === null || isReceiptNewer(receipt, latestAccepted.receipt))
    ) {
      latestAccepted = { action, receipt };
    }
  }

  if (latestAccepted !== null) {
    return { action: latestAccepted.action, kind: "accepted" };
  }

  return submittedActions.length > 0 ? { kind: "closed" } : { kind: "idle" };
}

function isReceiptNewer(
  candidate: ActionSubmissionReceipt,
  current: ActionSubmissionReceipt,
): boolean {
  const candidateTime = Date.parse(candidate.submittedAt);
  const currentTime = Date.parse(current.submittedAt);

  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    if (candidateTime !== currentTime) {
      return candidateTime > currentTime;
    }

    if (candidate.submittedAt !== current.submittedAt) {
      return candidate.submittedAt > current.submittedAt;
    }
  } else if (candidate.submittedAt !== current.submittedAt) {
    return candidate.submittedAt > current.submittedAt;
  }

  return (
    candidate.id.localeCompare(current.id, undefined, {
      numeric: true,
      sensitivity: "base",
    }) > 0
  );
}

export function isLiveActionSelectionValid(
  selection: LiveActionSelection,
  actions: readonly PublicAction[],
): boolean {
  return actions.some(
    (action) =>
      action.key === selection.actionKey &&
      action.kind === selection.actionKind &&
      action.phaseInstanceId === selection.phaseInstanceId &&
      action.status === "open" &&
      action.targetKind === "single_player" &&
      action.eligibleTargetIds.includes(selection.targetPlayerId),
  );
}
