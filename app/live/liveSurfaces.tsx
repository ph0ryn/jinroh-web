"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";

import {
  getLocalizedActionProgressLabel,
  getLocalizedNightConversationLabel,
  getLocalizedRole,
  type Locale,
  type Localization,
} from "@/lib/i18n/localization";
import {
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type NightConversationView,
  type PublicAction,
  type PublicPlayer,
  type RoomSummary,
  type SwitchRoomRequest,
} from "@/lib/shared/game";

import { LiveActionList } from "./liveActionList";
import {
  formatDateTime,
  formatPrivateEvent,
  formatPublicEvent,
  formatWinner,
} from "./liveEventPresentation";
import {
  canStartRoom,
  countJoinedPlayers,
  formatActionProgress,
  formatPhaseCountdown,
  getActionPanelTitle,
  getControlHint,
  getPlayerInitial,
  getPlayPhaseGuidance,
} from "./livePresentation";
import { useFollowScrollEnd } from "./useFollowScrollEnd";
import { useModalDialog } from "./useModalDialog";

import type { LiveActionFeedbackCue } from "./effects/ui/liveActionFeedbackModel";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

export type LiveToastTone = "error" | "info" | "success" | "warning";

export type LiveToast = {
  readonly message: string;
  readonly tone: LiveToastTone;
};

export type SetupPendingAction = "create" | "join" | null;

type LiveWaitingSurfaceProps = {
  readonly copiedRoomCode: string | null;
  readonly isBusy: boolean;
  readonly isSettingsOpen: boolean;
  readonly roomStatusLabel: string;
  readonly roomUrl: string | null;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onOpenSettings: () => void;
  readonly onRefreshRoom: () => void;
  readonly onRequestLeaveRoom: () => void;
  readonly onShareRoom: (roomCode: string) => void;
  readonly onStartGame: () => void;
};

type LivePlayingSurfaceProps = {
  readonly actionFeedbackCue: LiveActionFeedbackCue | null;
  readonly isBusy: boolean;
  readonly isNightConversationOpen: boolean;
  readonly isPublicLogOpen: boolean;
  readonly locale: Locale;
  readonly nightConversationDraft: string;
  readonly pendingActionKey: string | null;
  readonly selfActions: readonly PublicAction[];
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onActionFeedbackComplete: (receiptId: string) => void;
  readonly onCloseNightConversation: () => void;
  readonly onClosePublicLog: () => void;
  readonly onNightConversationDraftChange: (value: string) => void;
  readonly onOpenNightConversation: () => void;
  readonly onOpenPublicLog: () => void;
  readonly onRevealRole: () => void;
  readonly onSendNightConversation: (conversation: NightConversationView) => void;
  readonly onSubmitAction: (action: PublicAction, targetPlayerId: string | null) => void;
};

type LiveEndedSurfaceProps = {
  readonly isBusy: boolean;
  readonly isPublicLogOpen: boolean;
  readonly locale: Locale;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onClosePublicLog: () => void;
  readonly onOpenPublicLog: () => void;
  readonly onRequestLeaveRoom: () => void;
};

type LiveEntrySurfaceProps = {
  readonly displayName: string;
  readonly isBusy: boolean;
  readonly pendingAction: SetupPendingAction;
  readonly roomCodeInput: string;
  readonly t: Localization;
  readonly targetPlayerCount: number;
  readonly onCreateRoom: () => void;
  readonly onDisplayNameChange: (displayName: string) => void;
  readonly onJoinRoom: () => void;
  readonly onRoomCodeChange: (roomCode: string) => void;
  readonly onTargetPlayerCountChange: (targetPlayerCount: number) => void;
};

const PLAYER_COUNT_OPTIONS = Array.from(
  { length: MAX_ROOM_PLAYERS - MIN_ROOM_PLAYERS + 1 },
  (unusedValue, index) => {
    void unusedValue;

    return MIN_ROOM_PLAYERS + index;
  },
);

export function LiveToastRegion({
  toast,
  t,
  onDismiss,
}: {
  readonly toast: LiveToast | null;
  readonly t: Localization;
  readonly onDismiss: () => void;
}) {
  if (toast === null) {
    return null;
  }

  return (
    <div
      className="liveToastViewport"
      aria-label={t.live.aria.notifications}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
    >
      <section
        className="liveToast"
        data-tone={toast.tone}
        role={toast.tone === "error" ? "alert" : "status"}
      >
        <span className="liveToastTone">{t.live.toast.tones[toast.tone]}</span>
        <p>{toast.message}</p>
        <button
          className="secondaryButton liveIconButton liveToastClose"
          aria-label={t.live.buttons.dismissNotification}
          type="button"
          onClick={onDismiss}
        >
          <span aria-hidden="true">X</span>
        </button>
      </section>
    </div>
  );
}

function LivePopupDialog({
  children,
  id,
  meta,
  isDismissible = true,
  t,
  title,
  onClose,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly meta: string;
  readonly isDismissible?: boolean;
  readonly t: Localization;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const titleId = `${id}-title`;
  const { dialogRef, initialFocusRef } = useModalDialog(onClose, isDismissible);

  return (
    <div
      className="liveModalBackdrop"
      onMouseDown={(event) => {
        if (isDismissible && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="liveModal livePopupModal"
        id={id}
        aria-labelledby={titleId}
        aria-modal="true"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="liveModalHeader">
          <div>
            <span>{meta}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="secondaryButton liveIconButton"
            aria-label={t.live.buttons.closeDialog(title)}
            disabled={!isDismissible}
            ref={initialFocusRef}
            type="button"
            onClick={onClose}
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function LiveEntrySurface({
  displayName,
  isBusy,
  pendingAction,
  roomCodeInput,
  t,
  targetPlayerCount,
  onCreateRoom,
  onDisplayNameChange,
  onJoinRoom,
  onRoomCodeChange,
  onTargetPlayerCountChange,
}: LiveEntrySurfaceProps) {
  const roomCodeInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const roomCodeDigits = Array.from({ length: 6 }, (unusedValue, index) => {
    void unusedValue;

    return roomCodeInput[index] ?? "";
  });
  const normalizedDisplayName = displayName.trim() || t.live.setup.player;
  const isJoinDisabled = isBusy || roomCodeInput.length !== 6;

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!isBusy) {
      onCreateRoom();
    }
  }

  function handleCreateFieldKeyDown(event: KeyboardEvent<HTMLSelectElement>): void {
    if (event.key === "Enter" && !isBusy) {
      event.preventDefault();
      onCreateRoom();
    }
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!isJoinDisabled) {
      onJoinRoom();
    }
  }

  function focusRoomCodeInput(index: number): void {
    roomCodeInputsRef.current[index]?.focus();
  }

  function handleRoomCodeDigitChange(index: number, value: string): void {
    const pastedDigits = value.replace(/\D/g, "").slice(0, 6);
    const nextDigits = [...roomCodeDigits];

    if (pastedDigits.length > 1) {
      pastedDigits.split("").forEach((digit, offset) => {
        if (index + offset < nextDigits.length) {
          nextDigits[index + offset] = digit;
        }
      });
      onRoomCodeChange(nextDigits.join(""));
      focusRoomCodeInput(Math.min(index + pastedDigits.length, nextDigits.length - 1));
      return;
    }

    nextDigits[index] = pastedDigits;
    onRoomCodeChange(nextDigits.join(""));

    if (pastedDigits !== "" && index < nextDigits.length - 1) {
      focusRoomCodeInput(index + 1);
    }
  }

  function handleRoomCodeDigitKeyDown(index: number, key: string): void {
    if (key === "Backspace" && roomCodeDigits[index] === "" && index > 0) {
      focusRoomCodeInput(index - 1);
      return;
    }

    if (key === "ArrowLeft" && index > 0) {
      focusRoomCodeInput(index - 1);
      return;
    }

    if (key === "ArrowRight" && index < roomCodeDigits.length - 1) {
      focusRoomCodeInput(index + 1);
    }
  }

  function handleRoomCodePaste(index: number, clipboardText: string): void {
    const pastedDigits = clipboardText.replace(/\D/g, "").slice(0, 6);

    if (pastedDigits === "") {
      return;
    }

    const nextDigits = [...roomCodeDigits];
    pastedDigits.split("").forEach((digit, offset) => {
      if (index + offset < nextDigits.length) {
        nextDigits[index + offset] = digit;
      }
    });

    onRoomCodeChange(nextDigits.join(""));
    focusRoomCodeInput(Math.min(index + pastedDigits.length, nextDigits.length - 1));
  }

  return (
    <section className="liveEntrySurface" aria-label={t.live.aria.roomSetup}>
      <section className="liveSetupActionGrid" aria-label={t.live.aria.roomActions}>
        <article className="liveSetupPanel liveSetupProfilePanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">{t.live.setup.player}</p>
              <h3>{t.live.setup.yourSeat}</h3>
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <label className="liveSetupField">
              {t.live.setup.displayName}
              <input
                autoComplete="nickname"
                disabled={isBusy}
                maxLength={32}
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
              />
            </label>
            <div className="liveSetupProfileCard">
              <div className="liveSetupAvatar" aria-hidden="true">
                {getPlayerInitial(displayName)}
              </div>
              <div>
                <p className="liveSetupProfileName">{normalizedDisplayName}</p>
                <p className="liveSetupProfileNote">{t.live.setup.profileNote}</p>
              </div>
            </div>
            <p className="liveSetupHint">{t.live.setup.useIdentityHint}</p>
          </div>
        </article>

        <article className="liveSetupPanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">{t.live.setup.host}</p>
              <h3>{t.live.setup.createTitle}</h3>
            </div>
            <div className="liveSetupPanelIcon" aria-hidden="true">
              +
            </div>
          </div>
          <form
            className="liveSetupPanelBody"
            aria-busy={pendingAction === "create"}
            onSubmit={handleCreateSubmit}
          >
            <label className="liveSetupField">
              {t.live.setup.players}
              <select
                disabled={isBusy}
                value={targetPlayerCount}
                onChange={(event) => onTargetPlayerCountChange(Number(event.target.value))}
                onKeyDown={handleCreateFieldKeyDown}
              >
                {PLAYER_COUNT_OPTIONS.map((playerCount) => (
                  <option key={playerCount} value={playerCount}>
                    {playerCount}
                  </option>
                ))}
              </select>
            </label>
            <p className="liveSetupHint">{t.live.setup.createHint}</p>
            <div className="liveSetupButtonRow">
              <button
                className="liveSetupButton liveSetupButtonPrimary"
                type="submit"
                disabled={isBusy}
              >
                {pendingAction === "create"
                  ? t.live.buttons.creatingRoom
                  : t.live.buttons.createRoom}
              </button>
            </div>
          </form>
        </article>

        <article className="liveSetupPanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">{t.live.setup.guest}</p>
              <h3>{t.live.setup.joinTitle}</h3>
            </div>
            <div className="liveSetupPanelIcon" aria-hidden="true">
              -&gt;
            </div>
          </div>
          <form
            className="liveSetupPanelBody"
            aria-busy={pendingAction === "join"}
            onSubmit={handleJoinSubmit}
          >
            <div className="liveSetupField">
              <span id="live-room-code-label">{t.live.setup.roomCode}</span>
              <div className="liveSetupCodeGrid" aria-labelledby="live-room-code-label">
                {roomCodeDigits.map((digit, index) => (
                  <input
                    aria-label={t.live.setup.roomCodeDigit(index + 1)}
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    className="liveSetupCodeCell"
                    disabled={isBusy}
                    inputMode="numeric"
                    key={index}
                    maxLength={1}
                    pattern="[0-9]*"
                    ref={(element) => {
                      roomCodeInputsRef.current[index] = element;
                    }}
                    value={digit}
                    onChange={(event) => handleRoomCodeDigitChange(index, event.target.value)}
                    onKeyDown={(event) => handleRoomCodeDigitKeyDown(index, event.key)}
                    onPaste={(event) => {
                      event.preventDefault();
                      handleRoomCodePaste(index, event.clipboardData.getData("text"));
                    }}
                  />
                ))}
              </div>
            </div>
            <p className="liveSetupHint">{t.live.setup.joinHint}</p>
            <div className="liveSetupButtonRow">
              <button
                className="liveSetupButton liveSetupButtonSecondary"
                type="button"
                onClick={() => onRoomCodeChange("")}
                disabled={isBusy || roomCodeInput.length === 0}
              >
                {t.live.buttons.clear}
              </button>
              <button
                className="liveSetupButton liveSetupButtonPrimary"
                type="submit"
                disabled={isJoinDisabled}
              >
                {pendingAction === "join" ? t.live.buttons.joiningRoom : t.live.buttons.joinRoom}
              </button>
            </div>
          </form>
        </article>
      </section>
    </section>
  );
}

export function LeaveRoomDialog({
  isBusy,
  t,
  onClose,
  onConfirm,
}: {
  readonly isBusy: boolean;
  readonly t: Localization;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <LivePopupDialog
      id="leave-room-dialog"
      isDismissible={!isBusy}
      meta={t.live.leaveConfirmation.meta}
      t={t}
      title={t.live.leaveConfirmation.title}
      onClose={onClose}
    >
      <div className="liveConfirmationBody">
        <p>{t.live.leaveConfirmation.body}</p>
        <div className="liveConfirmationActions">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={isBusy}>
            {t.live.buttons.cancel}
          </button>
          <button className="dangerButton" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? t.live.buttons.leavingRoom : t.live.buttons.confirmLeaveRoom}
          </button>
        </div>
      </div>
    </LivePopupDialog>
  );
}

export function SwitchRoomDialog({
  isBusy,
  request,
  t,
  onClose,
  onConfirm,
}: {
  readonly isBusy: boolean;
  readonly request: SwitchRoomRequest;
  readonly t: Localization;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const body =
    request.kind === "create"
      ? t.live.switchConfirmation.createBody(request.expectedCurrentRoomCode)
      : t.live.switchConfirmation.joinBody(request.expectedCurrentRoomCode, request.targetRoomCode);

  return (
    <LivePopupDialog
      id="switch-room-dialog"
      isDismissible={!isBusy}
      meta={t.live.switchConfirmation.meta}
      t={t}
      title={t.live.switchConfirmation.title}
      onClose={onClose}
    >
      <div className="liveConfirmationBody">
        <p>{body}</p>
        <div className="liveConfirmationActions">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={isBusy}>
            {t.live.buttons.cancel}
          </button>
          <button className="dangerButton" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? t.live.buttons.switchingRoom : t.live.buttons.confirmSwitchRoom}
          </button>
        </div>
      </div>
    </LivePopupDialog>
  );
}

export function RoomInviteTools({
  copiedRoomCode,
  roomUrl,
  summary,
  t,
  onCopyRoomCode,
  onShareRoom,
}: {
  readonly copiedRoomCode: string | null;
  readonly roomUrl: string | null;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onShareRoom: (roomCode: string) => void;
}) {
  const didCopyCurrentRoom = copiedRoomCode === summary.code;

  return (
    <div className="liveInviteTools" aria-label={t.live.aria.roomInviteTools}>
      <div>
        <span>{t.live.invite.codeLabel}</span>
        <strong>{summary.code}</strong>
        {roomUrl === null ? null : (
          <div className="liveInviteQrCode" aria-hidden="true">
            <QRCodeSVG
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              marginSize={4}
              size={136}
              value={roomUrl}
            />
          </div>
        )}
      </div>
      <div>
        <button
          className={didCopyCurrentRoom ? "secondaryButton liveCopiedButton" : "secondaryButton"}
          type="button"
          onClick={() => onCopyRoomCode(summary.code)}
        >
          {didCopyCurrentRoom ? t.live.buttons.copied : t.live.buttons.copyCode}
        </button>
        <button className="secondaryButton" type="button" onClick={() => onShareRoom(summary.code)}>
          {t.live.buttons.shareInvite}
        </button>
      </div>
    </div>
  );
}

export function WaitingRequirements({
  summary,
  t,
}: {
  readonly summary: RoomSummary;
  readonly t: Localization;
}) {
  const joinedPlayerCount = countJoinedPlayers(summary);
  const requiredPlayers = Math.max(summary.targetPlayerCount - joinedPlayerCount, 0);
  const progressPercent = Math.min(
    100,
    Math.round((joinedPlayerCount / summary.targetPlayerCount) * 100),
  );

  return (
    <div className="liveWaitingRequirements">
      <div>
        <span>{t.live.invite.requirement}</span>
        <strong>
          {requiredPlayers === 0
            ? t.live.invite.allSeatsFilled
            : t.live.invite.morePlayersNeeded(requiredPlayers)}
        </strong>
      </div>
      <div
        className="liveProgressTrack"
        aria-label={t.live.invite.progressLabel(joinedPlayerCount, summary.targetPlayerCount)}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

export function LiveWaitingSurface({
  copiedRoomCode,
  isBusy,
  isSettingsOpen,
  roomStatusLabel,
  roomUrl,
  summary,
  t,
  onCopyRoomCode,
  onOpenSettings,
  onRefreshRoom,
  onRequestLeaveRoom,
  onShareRoom,
  onStartGame,
}: LiveWaitingSurfaceProps) {
  const canStartGame = !isBusy && canStartRoom(summary);
  const controlHint = getControlHint(summary, isBusy, t);

  return (
    <div className="livePlaySideStack liveWaitingSideStack">
      <section className="livePanel liveInvitePanel" aria-label={t.live.aria.invite}>
        <div className="livePanelHeading">
          <span>{t.live.aria.invite}</span>
          <div className="livePanelHeadingActions">
            <strong>{roomStatusLabel}</strong>
            <button
              className="secondaryButton liveCompactButton"
              type="button"
              onClick={onRefreshRoom}
              disabled={isBusy}
            >
              {t.live.buttons.refresh}
            </button>
          </div>
        </div>

        <RoomInviteTools
          copiedRoomCode={copiedRoomCode}
          roomUrl={roomUrl}
          summary={summary}
          t={t}
          onCopyRoomCode={onCopyRoomCode}
          onShareRoom={onShareRoom}
        />
        <WaitingRequirements summary={summary} t={t} />
      </section>

      <section className="livePanel liveControlPanel" aria-label={t.live.aria.waitingControls}>
        <div className="livePanelHeading">
          <span>
            {summary.isHost ? t.live.waiting.hostControls : t.live.waiting.playerControls}
          </span>
          <div className="livePanelHeadingActions">
            <strong>{summary.isHost ? t.live.waiting.host : t.live.waiting.player}</strong>
            {summary.isHost ? (
              <button
                className="secondaryButton liveCompactButton"
                aria-controls="start-settings-dialog"
                aria-expanded={isSettingsOpen}
                aria-haspopup="dialog"
                type="button"
                onClick={onOpenSettings}
              >
                {t.live.buttons.settings}
              </button>
            ) : null}
          </div>
        </div>

        <div className="liveWaitingPanel">
          <strong>
            {summary.isHost
              ? t.live.waiting.startWhenEveryoneSeated
              : t.live.waiting.waitingForHost}
          </strong>
          {canStartGame ? null : <p>{controlHint}</p>}
        </div>

        <div className="liveWaitingActions">
          {summary.isHost ? (
            <button
              className="primaryLiveButton"
              aria-describedby={canStartGame ? undefined : "control-hint"}
              type="button"
              onClick={onStartGame}
              disabled={!canStartGame}
            >
              {t.live.buttons.startGame}
            </button>
          ) : null}
          <button
            className="dangerButton"
            type="button"
            onClick={onRequestLeaveRoom}
            disabled={isBusy}
          >
            {t.live.buttons.leaveRoom}
          </button>
        </div>
        {canStartGame ? null : (
          <p className="srOnly" id="control-hint">
            {controlHint}
          </p>
        )}
      </section>
    </div>
  );
}

export function LivePlayingSurface({
  actionFeedbackCue,
  isBusy,
  isNightConversationOpen,
  isPublicLogOpen,
  locale,
  nightConversationDraft,
  pendingActionKey,
  selfActions,
  summary,
  t,
  onActionFeedbackComplete,
  onCloseNightConversation,
  onClosePublicLog,
  onNightConversationDraftChange,
  onOpenNightConversation,
  onOpenPublicLog,
  onRevealRole,
  onSendNightConversation,
  onSubmitAction,
}: LivePlayingSurfaceProps) {
  const hasCurrentPlayer = summary.currentPlayerId !== null;
  const actionProgress = summary.game?.actionProgress ?? null;
  const phaseEndsAt = summary.game?.phaseEndsAt ?? null;
  const phaseGuidance = getPlayPhaseGuidance(summary, isBusy, t);
  const nightConversation = hasCurrentPlayer
    ? (summary.rolePrivate?.nightConversation ?? null)
    : null;
  const publicEventCount = summary.game?.events.length ?? 0;
  const privateEvents = hasCurrentPlayer ? (summary.self?.events ?? []) : [];
  const selfRole =
    summary.self?.roleId === null || summary.self?.roleId === undefined
      ? null
      : getLocalizedRole(t, summary.self.roleId);

  return (
    <>
      <div className="livePlaySideStack">
        <section className="livePanel livePlayPhasePanel" aria-label={t.live.aria.currentPhase}>
          <div className="livePanelHeading">
            <span>{t.live.aria.currentPhase}</span>
          </div>

          <div className="livePlayPhaseCard">
            <div role="status" aria-atomic="true" aria-live="polite">
              <span className="srOnly">{phaseGuidance.label}</span>
              <strong>{phaseGuidance.message}</strong>
              {actionProgress === null ? null : (
                <em>
                  {getLocalizedActionProgressLabel(t, actionProgress.kind)}:{" "}
                  {formatActionProgress(actionProgress, t)}
                </em>
              )}
            </div>
            {phaseEndsAt === null ? null : (
              <time dateTime={phaseEndsAt}>
                <PhaseCountdown key={phaseEndsAt} phaseEndsAt={phaseEndsAt} t={t} />
              </time>
            )}
          </div>
        </section>

        {!hasCurrentPlayer || selfRole === null ? null : (
          <section className="livePanel liveSelfRolePanel" aria-label={t.live.effects.role.reveal}>
            <button
              aria-describedby="live-self-role-identity"
              className="secondaryButton liveRoleRevealButton"
              type="button"
              onClick={onRevealRole}
            >
              <span aria-hidden="true">◇</span>
              <strong>{t.live.effects.role.reveal}</strong>
            </button>
            <p className="srOnly" id="live-self-role-identity">
              {t.live.effects.role.identity(selfRole.name)}
            </p>
          </section>
        )}

        {privateEvents.length === 0 ? null : (
          <section
            className="livePanel livePrivateEventPanel"
            aria-label={t.live.privateEventLog.title}
          >
            <div className="livePanelHeading">
              <span>{t.live.privateEventLog.title}</span>
              <strong>{t.live.privateEventLog.meta(privateEvents.length)}</strong>
            </div>
            <PrivateEventList
              events={privateEvents}
              locale={locale}
              players={summary.players}
              t={t}
            />
          </section>
        )}

        {!hasCurrentPlayer || selfActions.length === 0 ? null : (
          <section
            className="livePanel liveNightActionPanel"
            aria-label={getActionPanelTitle(summary, t)}
          >
            <div className="livePanelHeading">
              <span>{getActionPanelTitle(summary, t)}</span>
            </div>

            <div className="liveNightActionStack">
              <LiveActionList
                actions={selfActions}
                feedbackCue={actionFeedbackCue}
                isBusy={isBusy}
                pendingActionKey={pendingActionKey}
                players={summary.players}
                t={t}
                onFeedbackComplete={onActionFeedbackComplete}
                onSubmitAction={onSubmitAction}
              />
            </div>
          </section>
        )}

        <div className="livePopupActions" aria-label={t.live.aria.popupPanels}>
          {nightConversation === null ? null : (
            <button className="secondaryButton" type="button" onClick={onOpenNightConversation}>
              {t.live.buttons.nightChat}
            </button>
          )}
          <button className="secondaryButton" type="button" onClick={onOpenPublicLog}>
            {t.live.buttons.publicLog}
            <em>{publicEventCount}</em>
          </button>
        </div>
      </div>

      {nightConversation !== null && isNightConversationOpen ? (
        <LivePopupDialog
          id="night-chat-dialog"
          meta={nightConversation.readOnly ? t.live.nightConversation.readOnly : t.game.phase.night}
          t={t}
          title={getLocalizedNightConversationLabel(t, nightConversation.labelKey)}
          onClose={onCloseNightConversation}
        >
          <NightConversationPanel
            conversation={nightConversation}
            draft={nightConversationDraft}
            isBusy={isBusy}
            locale={locale}
            t={t}
            onDraftChange={onNightConversationDraftChange}
            onSend={onSendNightConversation}
          />
        </LivePopupDialog>
      ) : null}

      <PublicLogDialog
        isOpen={isPublicLogOpen}
        locale={locale}
        summary={summary}
        t={t}
        onClose={onClosePublicLog}
      />
    </>
  );
}

export function LiveEndedSurface({
  isBusy,
  isPublicLogOpen,
  locale,
  summary,
  t,
  onClosePublicLog,
  onOpenPublicLog,
  onRequestLeaveRoom,
}: LiveEndedSurfaceProps) {
  const publicEventCount = summary.game?.events.length ?? 0;
  const selfResult = summary.self?.result ?? null;
  const winner = formatWinner(summary.game?.winnerTeam ?? null, t);

  return (
    <>
      <div className="livePlaySideStack">
        <section className="livePanel" aria-label={t.live.page.result}>
          <div className="livePanelHeading">
            <span>{t.live.page.result}</span>
            <strong>{t.live.effects.victory.title(winner)}</strong>
          </div>

          {selfResult === null ? null : (
            <div className="livePlayPhaseCard" aria-label={t.live.effects.victory.resultLabel}>
              <div>
                <span>{t.live.effects.victory.resultLabel}</span>
                <strong>{t.game.playerResult[selfResult]}</strong>
              </div>
            </div>
          )}
        </section>

        <div className="livePopupActions" aria-label={t.live.aria.popupPanels}>
          <button className="secondaryButton" type="button" onClick={onOpenPublicLog}>
            {t.live.buttons.publicLog}
            <em>{publicEventCount}</em>
          </button>
        </div>

        <section className="livePanel liveEndedActions" aria-label={t.live.buttons.leaveRoom}>
          <button
            className="dangerButton"
            type="button"
            onClick={onRequestLeaveRoom}
            disabled={isBusy}
          >
            {t.live.buttons.leaveRoom}
          </button>
        </section>
      </div>

      <PublicLogDialog
        isOpen={isPublicLogOpen}
        locale={locale}
        summary={summary}
        t={t}
        onClose={onClosePublicLog}
      />
    </>
  );
}

function PublicLogDialog({
  isOpen,
  locale,
  summary,
  t,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly locale: Locale;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onClose: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <LivePopupDialog
      id="public-log-dialog"
      meta={t.live.eventLog.meta(summary.game?.events.length ?? 0)}
      t={t}
      title={t.live.eventLog.title}
      onClose={onClose}
    >
      <EventLog locale={locale} summary={summary} t={t} />
    </LivePopupDialog>
  );
}

function PhaseCountdown({
  phaseEndsAt,
  t,
}: {
  readonly phaseEndsAt: string | null;
  readonly t: Localization;
}) {
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  useEffect(() => {
    if (phaseEndsAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => setCurrentTimeMs(Date.now()), 1_000);

    return () => window.clearInterval(intervalId);
  }, [phaseEndsAt]);

  return <>{formatPhaseCountdown(phaseEndsAt, currentTimeMs, t)}</>;
}

function NightConversationPanel({
  conversation,
  draft,
  isBusy,
  locale,
  t,
  onDraftChange,
  onSend,
}: {
  readonly conversation: NightConversationView;
  readonly draft: string;
  readonly isBusy: boolean;
  readonly locale: Locale;
  readonly t: Localization;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: (conversation: NightConversationView) => void;
}) {
  const trimmedDraft = draft.trim();
  const lastMessageId = conversation.messages.at(-1)?.id ?? null;
  const { containerRef, handleScroll } = useFollowScrollEnd(lastMessageId);
  const canSend =
    conversation.canSend &&
    !isBusy &&
    trimmedDraft.length >= 1 &&
    trimmedDraft.length <= conversation.maxMessageLength;

  return (
    <div className="liveNightChatPanel" aria-label={t.live.aria.nightConversation}>
      <div className="liveNightChatHeader">
        <strong>{getLocalizedNightConversationLabel(t, conversation.labelKey)}</strong>
        <em>{conversation.readOnly ? t.live.nightConversation.readOnly : t.game.phase.night}</em>
      </div>

      {conversation.messages.length === 0 ? (
        <p>{t.live.nightConversation.noMessages}</p>
      ) : (
        <ol className="liveNightChatMessages" ref={containerRef} onScroll={handleScroll}>
          {conversation.messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{message.senderName}</strong>
                <time dateTime={message.createdAt}>
                  {formatDateTime(message.createdAt, locale, t)}
                </time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}

      {conversation.canSend ? (
        <div className="liveNightChatComposer">
          <label>
            {t.live.nightConversation.message}
            <input
              maxLength={conversation.maxMessageLength}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </label>
          <button type="button" disabled={!canSend} onClick={() => onSend(conversation)}>
            {t.live.buttons.send}
          </button>
          <small>
            {t.live.nightConversation.draftCount(
              trimmedDraft.length,
              conversation.maxMessageLength,
            )}
          </small>
        </div>
      ) : null}
    </div>
  );
}

function EventLog({
  locale,
  summary,
  t,
}: {
  readonly locale: Locale;
  readonly summary: RoomSummary | null;
  readonly t: Localization;
}) {
  const events = summary?.game?.events ?? [];
  const lastEventId = events.at(-1)?.id ?? null;
  const { containerRef, handleScroll } = useFollowScrollEnd(lastEventId);

  if (events.length === 0) {
    return (
      <div className="liveEmptyState compact">
        <strong>{t.live.eventLog.emptyTitle}</strong>
        <p>{t.live.eventLog.emptyBody}</p>
      </div>
    );
  }

  return (
    <ol className="liveEventList" ref={containerRef} onScroll={handleScroll}>
      {events.map((event) => {
        const display = formatPublicEvent(event, summary?.players ?? [], t);

        return (
          <li key={event.id}>
            <time dateTime={event.createdAt}>{formatDateTime(event.createdAt, locale, t)}</time>
            <strong>{display.kindLabel}</strong>
            <p>{display.message}</p>
            {display.details.length === 0 ? null : (
              <dl className="liveEventDetails">
                {display.details.map((detail, index) => (
                  <div key={`${event.id}:${detail.label}:${index}`}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function PrivateEventList({
  events,
  locale,
  players,
  t,
}: {
  readonly events: NonNullable<RoomSummary["self"]>["events"];
  readonly locale: Locale;
  readonly players: readonly PublicPlayer[];
  readonly t: Localization;
}) {
  return (
    <ol className="liveEventList">
      {events.map((event, index) => {
        const display = formatPrivateEvent(event, players, t);

        return (
          <li key={`${event.kind}:${event.createdAt}:${index}`}>
            <time dateTime={event.createdAt}>{formatDateTime(event.createdAt, locale, t)}</time>
            <strong>{display.kindLabel}</strong>
            <p>{display.message}</p>
          </li>
        );
      })}
    </ol>
  );
}
