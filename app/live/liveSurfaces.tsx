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

import { LiveLobbyProgress } from "./effects/ui/LiveLobbyProgress";
import { LiveModalFrame } from "./effects/ui/LiveModalFrame";
import { useLiveListAdditionMotion } from "./effects/ui/useLiveListAdditionMotion";
import { LiveActionList } from "./liveActionList";
import {
  formatDateTime,
  formatPrivateEvent,
  formatPublicEvent,
  formatWinner,
} from "./liveEventPresentation";
import {
  canStartRoom,
  formatActionProgress,
  formatPhaseCountdown,
  getActionPanelTitle,
  getControlHint,
  getPlayerInitial,
  getPlayPhaseGuidance,
} from "./livePresentation";
import { LiveRoomControls, liveViewportStyles } from "./liveViewportLayout";
import { useFollowScrollEnd } from "./useFollowScrollEnd";

import type { LiveActionFeedbackCue } from "./effects/ui/liveActionFeedbackModel";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

export type SetupPendingAction = "create" | "join" | null;
export type LiveEntryMode = "create" | "join";

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
  readonly onRequestLeaveRoom: () => void;
  readonly onShareRoom: (roomCode: string) => void;
  readonly onStartGame: () => void;
};

type LivePlayingSurfaceProps = {
  readonly actionFeedbackCue: LiveActionFeedbackCue | null;
  readonly isBusy: boolean;
  readonly isNightConversationOpen: boolean;
  readonly isPublicLogOpen: boolean;
  readonly isCinematicObscured: boolean;
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
  readonly isCinematicObscured: boolean;
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

function LivePopupDialog({
  children,
  dialogClassName = "",
  id,
  isOpen,
  meta,
  isDismissible = true,
  t,
  title,
  onClose,
  onExitComplete,
}: {
  readonly children: ReactNode;
  readonly dialogClassName?: string;
  readonly id: string;
  readonly isOpen: boolean;
  readonly meta: string;
  readonly isDismissible?: boolean;
  readonly t: Localization;
  readonly title: string;
  readonly onClose: () => void;
  readonly onExitComplete?: () => void;
}) {
  const titleId = `${id}-title`;

  return (
    <LiveModalFrame
      ariaLabelledBy={titleId}
      dialogClassName={`livePopupModal ${dialogClassName}`.trim()}
      id={id}
      isDismissible={isDismissible}
      isOpen={isOpen}
      variant="popup"
      onExitComplete={onExitComplete}
      onRequestClose={onClose}
    >
      <div className="liveModalHeader">
        <div>
          <span>{meta}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="secondaryButton liveIconButton"
          aria-label={t.live.buttons.closeDialog(title)}
          data-live-modal-initial-focus={isDismissible ? "" : undefined}
          disabled={!isDismissible}
          type="button"
          onClick={onClose}
        >
          <span aria-hidden="true">X</span>
        </button>
      </div>
      <div className="liveModalBody" data-live-modal-body>
        {children}
      </div>
    </LiveModalFrame>
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
  const [entryMode, setEntryMode] = useState<LiveEntryMode>("create");
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
    <section
      className={`liveEntrySurface ${liveViewportStyles["entrySurface"]}`}
      aria-label={t.live.aria.roomSetup}
      data-live-setup-transition-item="entry"
      data-live-entry-mode={entryMode}
    >
      <section
        className={`liveSetupActionGrid ${liveViewportStyles["entryGrid"]}`}
        aria-label={t.live.aria.roomActions}
      >
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

        <div className={liveViewportStyles["entryModePanel"]}>
          <div
            aria-label={t.live.aria.entryMode}
            className={liveViewportStyles["entryModeSwitcher"]}
            role="group"
          >
            <button
              aria-pressed={entryMode === "create"}
              className={entryMode === "create" ? liveViewportStyles["entryModeActive"] : undefined}
              type="button"
              onClick={() => setEntryMode("create")}
            >
              {t.live.setup.createTitle}
            </button>
            <button
              aria-pressed={entryMode === "join"}
              className={entryMode === "join" ? liveViewportStyles["entryModeActive"] : undefined}
              type="button"
              onClick={() => setEntryMode("join")}
            >
              {t.live.setup.joinTitle}
            </button>
          </div>

          <article className="liveSetupPanel" data-live-entry-panel="create">
            <div className="liveSetupPanelHeader">
              <div>
                <p className="liveSetupPanelKicker">{t.live.setup.host}</p>
                <h3>{t.live.setup.createPanelTitle}</h3>
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

          <article className="liveSetupPanel" data-live-entry-panel="join">
            <div className="liveSetupPanelHeader">
              <div>
                <p className="liveSetupPanelKicker">{t.live.setup.guest}</p>
                <h3>{t.live.setup.joinPanelTitle}</h3>
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
        </div>
      </section>
    </section>
  );
}

export function LeaveRoomDialog({
  isBusy,
  isOpen,
  t,
  onClose,
  onConfirm,
}: {
  readonly isBusy: boolean;
  readonly isOpen: boolean;
  readonly t: Localization;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <LivePopupDialog
      id="leave-room-dialog"
      isDismissible={!isBusy}
      isOpen={isOpen}
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
  isOpen,
  request,
  t,
  onClose,
  onConfirm,
  onExitComplete,
}: {
  readonly isBusy: boolean;
  readonly isOpen: boolean;
  readonly request: SwitchRoomRequest;
  readonly t: Localization;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly onExitComplete: () => void;
}) {
  const body =
    request.kind === "create"
      ? t.live.switchConfirmation.createBody(request.expectedCurrentRoomCode)
      : t.live.switchConfirmation.joinBody(request.expectedCurrentRoomCode, request.targetRoomCode);

  return (
    <LivePopupDialog
      id="switch-room-dialog"
      isDismissible={!isBusy}
      isOpen={isOpen}
      meta={t.live.switchConfirmation.meta}
      t={t}
      title={t.live.switchConfirmation.title}
      onClose={onClose}
      onExitComplete={onExitComplete}
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
      <div className="liveInviteInlineContent">
        <RoomInviteContent
          didCopyCurrentRoom={didCopyCurrentRoom}
          roomUrl={roomUrl}
          summary={summary}
          t={t}
          onCopyRoomCode={onCopyRoomCode}
          onShareRoom={onShareRoom}
        />
      </div>
    </div>
  );
}

function RoomInviteContent({
  didCopyCurrentRoom,
  roomUrl,
  summary,
  t,
  onCopyRoomCode,
  onShareRoom,
}: {
  readonly didCopyCurrentRoom: boolean;
  readonly roomUrl: string | null;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onShareRoom: (roomCode: string) => void;
}) {
  return (
    <div className="liveInviteContent" data-live-invite-content>
      <RoomInviteCode summary={summary} t={t} />
      <div className="liveInviteDetails">
        <RoomInviteQr roomUrl={roomUrl} />
        <RoomInviteActions
          didCopyCurrentRoom={didCopyCurrentRoom}
          summary={summary}
          t={t}
          onCopyRoomCode={onCopyRoomCode}
          onShareRoom={onShareRoom}
        />
      </div>
    </div>
  );
}

function RoomInviteCode({
  summary,
  t,
}: {
  readonly summary: RoomSummary;
  readonly t: Localization;
}) {
  return (
    <div className="liveInviteCode">
      <span>{t.live.invite.codeLabel}</span>
      <strong>{summary.code}</strong>
    </div>
  );
}

function RoomInviteQr({ roomUrl }: { readonly roomUrl: string | null }) {
  return roomUrl === null ? null : (
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
  );
}

function RoomInviteActions({
  didCopyCurrentRoom,
  summary,
  t,
  onCopyRoomCode,
  onShareRoom,
}: {
  readonly didCopyCurrentRoom: boolean;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onShareRoom: (roomCode: string) => void;
}) {
  return (
    <div className="liveInviteActions">
      <button
        aria-label={didCopyCurrentRoom ? t.live.buttons.copied : t.live.buttons.copyCode}
        className={didCopyCurrentRoom ? "secondaryButton liveCopiedButton" : "secondaryButton"}
        type="button"
        onClick={() => onCopyRoomCode(summary.code)}
      >
        <span aria-hidden="true" className="livePortraitInviteActionIcon">
          ⧉
        </span>
        <span className="livePortraitInviteActionLabel">
          {didCopyCurrentRoom ? t.live.buttons.copied : t.live.buttons.copyCode}
        </span>
      </button>
      <button
        aria-label={t.live.buttons.shareInvite}
        className="secondaryButton"
        type="button"
        onClick={() => onShareRoom(summary.code)}
      >
        <span aria-hidden="true" className="livePortraitInviteActionIcon">
          ↗
        </span>
        <span className="livePortraitInviteActionLabel">{t.live.buttons.shareInvite}</span>
      </button>
    </div>
  );
}

function PortraitRoomInviteSummary({
  copiedRoomCode,
  isQrOpen,
  summary,
  t,
  onCopyRoomCode,
  onOpenQr,
  onShareRoom,
}: {
  readonly copiedRoomCode: string | null;
  readonly isQrOpen: boolean;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onOpenQr: () => void;
  readonly onShareRoom: (roomCode: string) => void;
}) {
  return (
    <div
      aria-label={t.live.aria.roomInviteTools}
      className="livePanel livePortraitInviteSummary"
      data-live-portrait-invite
    >
      <div className="livePortraitInviteHeader">
        <RoomInviteCode summary={summary} t={t} />
        <button
          aria-controls="room-invite-dialog"
          aria-expanded={isQrOpen}
          aria-haspopup="dialog"
          aria-label={t.live.buttons.showQrCode}
          className="secondaryButton livePortraitInviteQrButton"
          data-live-invite-expanded={isQrOpen}
          type="button"
          onClick={onOpenQr}
        >
          QR
        </button>
      </div>
      <RoomInviteActions
        didCopyCurrentRoom={copiedRoomCode === summary.code}
        summary={summary}
        t={t}
        onCopyRoomCode={onCopyRoomCode}
        onShareRoom={onShareRoom}
      />
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
  onRequestLeaveRoom,
  onShareRoom,
  onStartGame,
}: LiveWaitingSurfaceProps) {
  const canStartGame = !isBusy && canStartRoom(summary);
  const controlHint = getControlHint(summary, isBusy, t);
  const [inviteDialogMode, setInviteDialogMode] = useState<"full" | "qr" | null>(null);

  return (
    <>
      <LiveRoomControls
        primary={
          <section className="livePanel liveControlPanel" aria-label={t.live.aria.waitingControls}>
            <div className="livePanelHeading">
              <span>
                {summary.isHost ? t.live.waiting.hostControls : t.live.waiting.playerControls}
              </span>
              <div className="liveWaitingHeadingActions">
                <strong>{summary.isHost ? t.live.waiting.host : t.live.waiting.player}</strong>
                {summary.isHost ? (
                  <button
                    aria-controls="start-settings-dialog"
                    aria-label={t.live.buttons.settings}
                    aria-expanded={isSettingsOpen}
                    aria-haspopup="dialog"
                    className="secondaryButton liveSettingsUtilityButton"
                    type="button"
                    onClick={onOpenSettings}
                  >
                    <span aria-hidden="true">⚙</span>
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
        }
        scroll={
          <section className="livePanel liveInviteDetailsPanel" aria-label={t.live.aria.invite}>
            <RoomInviteTools
              copiedRoomCode={copiedRoomCode}
              roomUrl={roomUrl}
              summary={summary}
              t={t}
              onCopyRoomCode={onCopyRoomCode}
              onShareRoom={onShareRoom}
            />
          </section>
        }
        status={
          <section className="livePanel liveInvitePanel" aria-label={t.live.aria.invite}>
            <div className="livePanelHeading">
              <span>{t.live.aria.invite}</span>
              <strong>{roomStatusLabel}</strong>
            </div>
            <LiveLobbyProgress summary={summary} t={t} />
          </section>
        }
        surface="waiting"
        transitionItem="waiting"
        utilities={
          <>
            <PortraitRoomInviteSummary
              copiedRoomCode={copiedRoomCode}
              isQrOpen={inviteDialogMode === "qr"}
              summary={summary}
              t={t}
              onCopyRoomCode={onCopyRoomCode}
              onOpenQr={() => setInviteDialogMode("qr")}
              onShareRoom={onShareRoom}
            />
            <button
              aria-controls="room-invite-dialog"
              aria-expanded={inviteDialogMode === "full"}
              aria-haspopup="dialog"
              className="secondaryButton liveInviteDisclosure"
              data-live-invite-expanded={inviteDialogMode === "full"}
              type="button"
              onClick={() => setInviteDialogMode("full")}
            >
              {t.live.buttons.showInviteDetails}
            </button>
          </>
        }
      />
      <LivePopupDialog
        dialogClassName="liveInviteModal"
        id="room-invite-dialog"
        isOpen={inviteDialogMode !== null}
        meta={t.live.invite.codeLabel}
        t={t}
        title={t.live.aria.roomInviteTools}
        onClose={() => setInviteDialogMode(null)}
      >
        <div className="liveInviteFullModalContent">
          <RoomInviteContent
            didCopyCurrentRoom={copiedRoomCode === summary.code}
            roomUrl={roomUrl}
            summary={summary}
            t={t}
            onCopyRoomCode={onCopyRoomCode}
            onShareRoom={onShareRoom}
          />
        </div>
        <div className="liveInviteQrModalContent">
          <RoomInviteQr roomUrl={roomUrl} />
        </div>
      </LivePopupDialog>
    </>
  );
}

export function LivePlayingSurface({
  actionFeedbackCue,
  isBusy,
  isNightConversationOpen,
  isPublicLogOpen,
  isCinematicObscured,
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
      <LiveRoomControls
        primary={
          !hasCurrentPlayer || selfActions.length === 0 ? null : (
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
          )
        }
        scroll={
          <div className="liveControlScrollStack">
            {!hasCurrentPlayer || selfRole === null ? null : (
              <section
                className="livePanel liveSelfRolePanel"
                aria-label={t.live.effects.role.reveal}
              >
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
          </div>
        }
        status={
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
        }
        surface="playing"
        utilities={
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
        }
      />

      {nightConversation !== null ? (
        <LivePopupDialog
          id="night-chat-dialog"
          isOpen={isNightConversationOpen}
          meta={nightConversation.readOnly ? t.live.nightConversation.readOnly : t.game.phase.night}
          t={t}
          title={getLocalizedNightConversationLabel(t, nightConversation.labelKey)}
          onClose={onCloseNightConversation}
        >
          <NightConversationPanel
            conversation={nightConversation}
            draft={nightConversationDraft}
            isBusy={isBusy}
            isObscured={isCinematicObscured}
            isOpen={isNightConversationOpen}
            locale={locale}
            roomCode={summary.code}
            t={t}
            viewerPlayerId={summary.currentPlayerId}
            onDraftChange={onNightConversationDraftChange}
            onSend={onSendNightConversation}
          />
        </LivePopupDialog>
      ) : null}

      <PublicLogDialog
        isOpen={isPublicLogOpen}
        isObscured={isCinematicObscured}
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
  isCinematicObscured,
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
      <LiveRoomControls
        primary={
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
        }
        status={
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
        }
        surface="ended"
        utilities={
          <div className="livePopupActions" aria-label={t.live.aria.popupPanels}>
            <button className="secondaryButton" type="button" onClick={onOpenPublicLog}>
              {t.live.buttons.publicLog}
              <em>{publicEventCount}</em>
            </button>
          </div>
        }
      />

      <PublicLogDialog
        isOpen={isPublicLogOpen}
        isObscured={isCinematicObscured}
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
  isObscured,
  locale,
  summary,
  t,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly isObscured: boolean;
  readonly locale: Locale;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onClose: () => void;
}) {
  return (
    <LivePopupDialog
      id="public-log-dialog"
      isOpen={isOpen}
      meta={t.live.eventLog.meta(summary.game?.events.length ?? 0)}
      t={t}
      title={t.live.eventLog.title}
      onClose={onClose}
    >
      <EventLog isObscured={isObscured} isOpen={isOpen} locale={locale} summary={summary} t={t} />
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
  isObscured,
  isOpen,
  locale,
  roomCode,
  t,
  viewerPlayerId,
  onDraftChange,
  onSend,
}: {
  readonly conversation: NightConversationView;
  readonly draft: string;
  readonly isBusy: boolean;
  readonly isObscured: boolean;
  readonly isOpen: boolean;
  readonly locale: Locale;
  readonly roomCode: string;
  readonly t: Localization;
  readonly viewerPlayerId: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: (conversation: NightConversationView) => void;
}) {
  const trimmedDraft = draft.trim();
  const lastMessageId = conversation.messages.at(-1)?.id ?? null;
  const { containerRef, handleScroll } = useFollowScrollEnd(lastMessageId);
  useLiveListAdditionMotion(containerRef, {
    isObscured,
    isOpen,
    itemIds: conversation.messages.map((message) => message.id),
    motionKind: "message",
    sessionKey: JSON.stringify([
      roomCode,
      viewerPlayerId,
      conversation.groupId,
      conversation.nightNumber,
    ]),
  });
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
        <ol
          className="liveNightChatMessages"
          data-live-night-message-list
          ref={containerRef}
          onScroll={handleScroll}
        >
          {conversation.messages.map((message) => (
            <li
              data-live-list-item-id={message.id}
              data-live-night-message-id={message.id}
              key={message.id}
            >
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
  isObscured,
  isOpen,
  locale,
  summary,
  t,
}: {
  readonly isObscured: boolean;
  readonly isOpen: boolean;
  readonly locale: Locale;
  readonly summary: RoomSummary;
  readonly t: Localization;
}) {
  const events = summary.game?.events ?? [];
  const lastEventId = events.at(-1)?.id ?? null;
  const { containerRef, handleScroll } = useFollowScrollEnd(lastEventId);
  useLiveListAdditionMotion(containerRef, {
    isObscured,
    isOpen,
    itemIds: events.map((event) => event.id),
    motionKind: "event",
    sessionKey: JSON.stringify([summary.code, summary.currentPlayerId, "public-events"]),
  });

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
        const display = formatPublicEvent(event, summary.players, t);

        return (
          <li data-live-event-id={event.id} data-live-list-item-id={event.id} key={event.id}>
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
