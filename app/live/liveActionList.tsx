"use client";

import { useState } from "react";

import { getLocalizedActionLabel, type Localization } from "@/lib/i18n/localization";

import {
  LiveActionFeedbackFrame,
  type LiveActionFeedbackState,
} from "./effects/ui/LiveActionFeedbackFrame";
import { getActionButtonLabel } from "./livePresentation";

import type { LiveActionFeedbackCue } from "./effects/ui/liveActionFeedbackModel";
import type { PublicAction, PublicPlayer } from "@/lib/shared/game";

type LiveActionListProps = {
  readonly actions: readonly PublicAction[];
  readonly feedbackCue: LiveActionFeedbackCue | null;
  readonly isBusy: boolean;
  readonly pendingActionKey: string | null;
  readonly players: readonly PublicPlayer[];
  readonly t: Localization;
  readonly onFeedbackComplete: (receiptId: string) => void;
  readonly onSubmitAction: (action: PublicAction, targetPlayerId: string | null) => void;
};

export function LiveActionList({
  actions,
  feedbackCue,
  isBusy,
  pendingActionKey,
  players,
  t,
  onFeedbackComplete,
  onSubmitAction,
}: LiveActionListProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="liveActionList">
      {actions.map((action) => (
        <LiveActionRow
          action={action}
          feedbackCue={feedbackCue}
          isBusy={isBusy}
          key={`${action.phaseInstanceId}:${action.key}`}
          pendingActionKey={pendingActionKey}
          players={players}
          t={t}
          onFeedbackComplete={onFeedbackComplete}
          onSubmitAction={onSubmitAction}
        />
      ))}
    </div>
  );
}

function LiveActionRow({
  action,
  feedbackCue,
  isBusy,
  pendingActionKey,
  players,
  t,
  onFeedbackComplete,
  onSubmitAction,
}: Omit<LiveActionListProps, "actions"> & { readonly action: PublicAction }) {
  const [selectedTargetState, setSelectedTargetState] = useState(action.eligibleTargetIds[0] ?? "");
  const actionLabel = getLocalizedActionLabel(t, action.kind);
  const selectedTarget = action.eligibleTargetIds.includes(selectedTargetState)
    ? selectedTargetState
    : (action.eligibleTargetIds[0] ?? "");
  const targetPlayers = players.filter((player) => action.eligibleTargetIds.includes(player.id));
  const isPending = pendingActionKey === action.key;
  const confirmedReceipt =
    feedbackCue?.receipt.actionKey === action.key &&
    feedbackCue.receipt.phaseInstanceId === action.phaseInstanceId
      ? feedbackCue.receipt
      : null;
  let feedbackState: LiveActionFeedbackState = "idle";

  if (isPending) {
    feedbackState = "pending";
  } else if (confirmedReceipt !== null) {
    feedbackState = "confirmed";
  }

  const hasRequiredTarget = action.targetKind === "none" || selectedTarget !== "";

  return (
    <LiveActionFeedbackFrame
      actionKey={action.key}
      actionKind={action.kind}
      actionStatus={action.status}
      announcement={t.live.effects.action.announcement(actionLabel)}
      className={action.status === "submitted" ? "liveActionRow submitted" : "liveActionRow"}
      confirmationLabel={t.live.effects.action.confirmed}
      feedbackId={confirmedReceipt?.id ?? null}
      state={feedbackState}
      onConfirmationComplete={onFeedbackComplete}
    >
      <div>
        <strong>{actionLabel}</strong>
        {action.status === "submitted" ? <span>{t.game.actionStatus.submitted}</span> : null}
      </div>

      {action.targetKind === "single_player" && action.status === "open" ? (
        <select
          aria-label={t.live.aria.actionTarget(actionLabel)}
          disabled={isBusy}
          value={selectedTarget}
          onChange={(event) => setSelectedTargetState(event.target.value)}
        >
          {targetPlayers.map((player) => (
            <option key={player.id} value={player.id}>
              {player.displayName}
            </option>
          ))}
        </select>
      ) : (
        <span className="liveActionState">
          {action.status === "submitted"
            ? t.game.actionStatus.locked
            : t.game.actionStatus.noTarget}
        </span>
      )}

      <button
        aria-busy={isPending}
        data-live-action-submit
        type="button"
        onClick={() =>
          onSubmitAction(action, action.targetKind === "single_player" ? selectedTarget : null)
        }
        disabled={isBusy || action.status === "submitted" || !hasRequiredTarget}
      >
        <span data-live-action-submit-motion>{getActionButtonLabel(action, isPending, t)}</span>
      </button>
    </LiveActionFeedbackFrame>
  );
}
