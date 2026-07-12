import { formatPhaseTitle, formatWinner } from "./liveEventPresentation";

import type { Locale, Localization } from "@/lib/i18n/localization";
import type { PublicAction, RoomSummary } from "@/lib/shared/game";

export type LiveMood = "day" | "execution" | "night" | "result" | "setup" | "voting" | "waiting";

export type LiveGuidance = {
  readonly label: string;
  readonly message: string;
};

export function getLiveMood(summary: RoomSummary | null): LiveMood {
  if (summary === null) {
    return "setup";
  }

  if (summary.game?.status === "ended") {
    return "result";
  }

  if (summary.status === "waiting") {
    return "waiting";
  }

  return summary.game?.phase ?? "setup";
}

export function getLivePageTitle(summary: RoomSummary | null, t: Localization): string {
  if (summary === null) {
    return t.live.page.roomSetup;
  }

  if (summary.status === "waiting") {
    return t.live.page.room(summary.code);
  }

  if (summary.game?.status === "ended") {
    return t.live.page.result;
  }

  return formatPhaseTitle(summary.game?.phase ?? null, t);
}

export function getLiveTableTitle(summary: RoomSummary, t: Localization): string {
  if (summary.game?.status === "ended") {
    return t.live.page.result;
  }

  if (summary.status === "waiting") {
    return t.game.phase.waiting;
  }

  return formatPhaseTitle(summary.game?.phase ?? null, t);
}

export function getActionPanelTitle(summary: RoomSummary, t: Localization): string {
  if (summary.game?.phase === "night") {
    return t.game.actions.night;
  }

  if (summary.game?.phase === "day") {
    return t.game.actions.day;
  }

  if (summary.game?.phase === "voting") {
    return t.game.actions.vote;
  }

  if (summary.game?.phase === "execution") {
    return t.game.actions.execution;
  }

  return t.game.actions.action;
}

export function getPlayerInitial(displayName: string): string {
  return displayName.trim().slice(0, 1).toLocaleUpperCase("en") || "?";
}

export function getPlayPhaseGuidance(
  summary: RoomSummary,
  isBusy: boolean,
  locale: Locale,
  t: Localization,
): LiveGuidance {
  if (isBusy) {
    return t.live.phasePanel.syncing;
  }

  if (summary.game?.status === "ended") {
    return t.live.phasePanel.result(
      formatWinner(summary.game.winnerTeam, summary.teamCatalog, locale, t),
    );
  }

  if (summary.game?.phase === "night") {
    return t.live.phasePanel.night;
  }

  if (summary.game?.phase === "day") {
    return t.live.phasePanel.day;
  }

  if (summary.game?.phase === "voting") {
    return t.live.phasePanel.voting;
  }

  if (summary.game?.phase === "execution") {
    return t.live.phasePanel.execution;
  }

  return t.live.phasePanel.game;
}

export function getStartHint(
  summary: RoomSummary | null,
  isBusy: boolean,
  t: Localization,
): string {
  if (isBusy) {
    return t.live.hints.startAfterSync;
  }

  if (summary === null) {
    return t.live.hints.startNeedsRoom;
  }

  if (!summary.isHost) {
    return t.live.hints.hostOnlyStart;
  }

  if (summary.status !== "waiting") {
    return t.live.hints.startInWaiting;
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  if (joinedPlayerCount < summary.targetPlayerCount) {
    return t.live.hints.waitingForPlayers(summary.targetPlayerCount - joinedPlayerCount);
  }

  if (joinedPlayerCount > summary.targetPlayerCount) {
    return t.live.hints.tooManyPlayers;
  }

  return t.live.hints.startWhenSeated;
}

export function getControlHint(
  summary: RoomSummary | null,
  isBusy: boolean,
  t: Localization,
): string {
  if (summary === null) {
    return t.live.hints.controlsNeedRoom;
  }

  if (summary.status === "waiting") {
    return getStartHint(summary, isBusy, t);
  }

  return t.live.hints.reviewResult;
}

export function canStartRoom(summary: RoomSummary | null): boolean {
  if (summary === null || !summary.isHost || summary.status !== "waiting") {
    return false;
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  return joinedPlayerCount === summary.targetPlayerCount;
}

export function countJoinedPlayers(summary: Pick<RoomSummary, "players">): number {
  return summary.players.filter((player) => player.status === "joined").length;
}

export function getActionButtonLabel(
  action: PublicAction,
  isSubmitting: boolean,
  locale: Locale,
  t: Localization,
): string {
  if (action.status === "submitted") {
    return t.game.actions.button.submitted;
  }

  if (isSubmitting) {
    return t.game.actions.button.submitting;
  }

  return action.presentation[locale].submitLabel;
}

export function formatRoomStatus(summary: RoomSummary | null, t: Localization): string {
  if (summary === null) {
    return t.live.roomStatus.noRoom;
  }

  if (summary.game?.status === "ended") {
    return t.home.panel.ended;
  }

  if (summary.status === "waiting") {
    return t.live.roomStatus.status.waiting;
  }

  const status = t.live.roomStatus.status[summary.status];
  const phase =
    summary.game?.phase === null || summary.game?.phase === undefined
      ? t.game.phase.setup
      : formatPhaseTitle(summary.game.phase, t);

  return t.live.roomStatus.value(status, phase);
}

export function formatActionProgress(
  progress: NonNullable<RoomSummary["game"]>["actionProgress"],
  t: Localization,
): string {
  if (progress === null) {
    return t.game.actionProgress.none;
  }

  if (progress.visibility === "hidden") {
    return t.game.actionProgress.private;
  }

  return `${progress.submitted}/${progress.required}`;
}

export function formatPhaseCountdown(
  phaseEndsAt: string | null,
  currentTimeMs: number,
  t: Localization,
): string {
  if (phaseEndsAt === null) {
    return t.live.time.closed;
  }

  const phaseEndsAtMs = Date.parse(phaseEndsAt);

  if (!Number.isFinite(phaseEndsAtMs)) {
    return t.live.time.unknown;
  }

  const remainingSeconds = Math.max(Math.ceil((phaseEndsAtMs - currentTimeMs) / 1_000), 0);

  if (remainingSeconds <= 0) {
    return t.live.time.dueNow;
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
