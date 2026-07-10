import {
  getLocalizedActionButtonLabel,
  getLocalizedActionProgressLabel,
  type Localization,
} from "@/lib/i18n/localization";

import { formatPhaseTitle, formatWinner } from "./liveEventPresentation";

import type { PublicAction, RoomSummary } from "@/lib/shared/game";

type LiveMood = "closed" | "day" | "execution" | "lobby" | "night" | "result" | "setup" | "voting";

type RoundTableSeatPosition = {
  readonly x: number;
  readonly y: number;
};

export type LiveGuidance = {
  readonly label: string;
  readonly message: string;
};

export function getLiveMood(summary: RoomSummary | null): LiveMood {
  if (summary === null) {
    return "setup";
  }

  if (summary.status === "disbanded") {
    return "closed";
  }

  if (summary.game?.status === "ended") {
    return "result";
  }

  if (summary.status === "lobby") {
    return "lobby";
  }

  return summary.game?.phase ?? "setup";
}

export function getLiveGridClassName(summary: RoomSummary | null): string {
  if (summary === null) {
    return "liveGrid liveGridSetup";
  }

  if (summary.status === "lobby") {
    return "liveGrid liveGridLobby";
  }

  return "liveGrid livePlayGrid";
}

export function getLivePageTitle(summary: RoomSummary | null, t: Localization): string {
  if (summary === null) {
    return t.live.page.roomSetup;
  }

  if (summary.status === "lobby") {
    return t.live.page.room(summary.code);
  }

  if (summary.status === "disbanded") {
    return t.live.page.roomClosed;
  }

  if (summary.game?.status === "ended") {
    return t.live.page.result;
  }

  return formatPhaseTitle(summary.game?.phase ?? null, t);
}

export function getLiveTableTitle(summary: RoomSummary, t: Localization): string {
  if (summary.status === "disbanded") {
    return t.live.table.closed;
  }

  if (summary.game?.status === "ended") {
    return t.live.page.result;
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

export function getRoundTableSeatPosition(
  index: number,
  totalPlayers: number,
): RoundTableSeatPosition {
  const safeTotalPlayers = Math.max(totalPlayers, 1);
  let radius = 42;

  if (safeTotalPlayers <= 4) {
    radius = 38;
  } else if (safeTotalPlayers <= 6) {
    radius = 40;
  }

  const angle = -Math.PI / 2 + (index / safeTotalPlayers) * Math.PI * 2;

  return {
    x: Number((50 + Math.cos(angle) * radius).toFixed(3)),
    y: Number((50 + Math.sin(angle) * radius).toFixed(3)),
  };
}

export function getPlayerInitial(displayName: string): string {
  return displayName.trim().slice(0, 1).toLocaleUpperCase("en") || "?";
}

export function getPlayPhaseGuidance(
  summary: RoomSummary,
  isBusy: boolean,
  t: Localization,
): LiveGuidance {
  if (isBusy) {
    return t.live.phasePanel.syncing;
  }

  if (summary.status === "disbanded") {
    return t.live.phasePanel.closed;
  }

  if (summary.game?.status === "ended") {
    return t.live.phasePanel.result(formatWinner(summary.game.winnerTeam, t));
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

export function getLiveGuidance(
  summary: RoomSummary | null,
  actionCount: number,
  isBusy: boolean,
  t: Localization,
): LiveGuidance {
  if (isBusy) {
    return t.live.guidance.syncing;
  }

  if (summary === null) {
    return t.live.guidance.setup;
  }

  if (summary.status === "disbanded") {
    return t.live.guidance.closed;
  }

  if (summary.game?.status === "ended") {
    return t.live.guidance.result(formatWinner(summary.game.winnerTeam, t));
  }

  if (summary.status === "lobby") {
    const joinedPlayerCount = countJoinedPlayers(summary);

    if (!summary.isHost) {
      return t.live.guidance.lobby(joinedPlayerCount, summary.targetPlayerCount);
    }

    if (joinedPlayerCount < summary.targetPlayerCount) {
      return t.live.guidance.invite(summary.targetPlayerCount - joinedPlayerCount);
    }

    if (joinedPlayerCount > summary.targetPlayerCount) {
      return t.live.guidance.full;
    }

    return t.live.guidance.ready;
  }

  if (actionCount > 0) {
    const openActionCount =
      summary.self?.actions.filter((action) => action.status === "open").length ?? 0;

    if (openActionCount > 0) {
      return t.live.guidance.yourTurn;
    }
  }

  if (summary.game?.actionProgress?.visibility === "public") {
    return t.live.guidance.progress(
      summary.game.actionProgress.submitted,
      summary.game.actionProgress.required,
      getLocalizedActionProgressLabel(t, summary.game.actionProgress.kind),
    );
  }

  if (summary.game?.actionProgress?.visibility === "hidden") {
    return t.live.guidance.privateNight(
      getLocalizedActionProgressLabel(t, summary.game.actionProgress.kind),
    );
  }

  if (summary.isHost) {
    return t.live.guidance.host;
  }

  return t.live.guidance.waiting;
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

  if (summary.status !== "lobby") {
    return t.live.hints.startInLobby;
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

  if (summary.status === "lobby") {
    return getStartHint(summary, isBusy, t);
  }

  if (summary.status === "disbanded") {
    return t.live.hints.roomClosed;
  }

  return t.live.hints.reviewResult;
}

export function canStartRoom(summary: RoomSummary | null): boolean {
  if (summary === null || !summary.isHost || summary.status !== "lobby") {
    return false;
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  return joinedPlayerCount === summary.targetPlayerCount;
}

export function countJoinedPlayers(summary: RoomSummary): number {
  return summary.players.filter((player) => player.status === "joined").length;
}

export function getActionButtonLabel(
  action: PublicAction,
  isBusy: boolean,
  t: Localization,
): string {
  if (action.status === "submitted") {
    return t.game.actions.button.submitted;
  }

  if (isBusy) {
    return t.game.actions.button.submitting;
  }

  return getLocalizedActionButtonLabel(t, action.kind);
}

export function formatRoomStatus(summary: RoomSummary | null, t: Localization): string {
  if (summary === null) {
    return t.live.roomStatus.noRoom;
  }

  if (summary.game?.status === "ended") {
    return t.home.panel.ended;
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
