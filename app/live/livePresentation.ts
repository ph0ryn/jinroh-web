import { formatPhaseTitle, formatWinner } from "./liveEventPresentation";

import type { Locale, Localization } from "@/lib/i18n/localization";
import type { RoomSummary } from "@/lib/shared/game";

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
    return t.live.page.roomEntry;
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

  if (!isLobbyStatus(summary.status)) {
    return t.live.hints.startOutsideLobby;
  }

  return getLobbyReadinessHint(summary, t);
}

export function getLobbyReadinessHint(summary: RoomSummary, t: Localization): string {
  const lobbyPlayers = getLobbyPlayers(summary);

  if (lobbyPlayers.length < summary.targetPlayerCount) {
    return t.live.hints.waitingForPlayers(summary.targetPlayerCount - lobbyPlayers.length);
  }

  if (lobbyPlayers.length > summary.targetPlayerCount) {
    return t.live.hints.tooManyPlayers;
  }

  const disconnectedPlayerCount = lobbyPlayers.filter(
    (player) => player.status === "disconnected",
  ).length;

  if (disconnectedPlayerCount > 0) {
    return t.live.hints.waitingForConnections(disconnectedPlayerCount);
  }

  const unreadyPlayerCount = lobbyPlayers.filter((player) => !player.isLobbyReady).length;

  if (unreadyPlayerCount > 0) {
    return t.live.hints.waitingForReadiness(unreadyPlayerCount);
  }

  return summary.isHost ? t.live.hints.readyToStart : t.live.hints.waitingForHostStart;
}

export function getControlHint(
  summary: RoomSummary | null,
  isBusy: boolean,
  t: Localization,
): string {
  if (summary === null) {
    return t.live.hints.controlsNeedRoom;
  }

  if (isLobbyStatus(summary.status)) {
    return isBusy ? t.live.hints.startAfterSync : getLobbyReadinessHint(summary, t);
  }

  return t.live.hints.reviewResult;
}

export function canStartRoom(summary: RoomSummary | null): boolean {
  if (summary === null || !summary.isHost || !isLobbyStatus(summary.status)) {
    return false;
  }

  const lobbyPlayers = getLobbyPlayers(summary);

  return (
    lobbyPlayers.length === summary.targetPlayerCount &&
    lobbyPlayers.every((player) => player.status === "joined" && player.isLobbyReady)
  );
}

export function countJoinedPlayers(summary: Pick<RoomSummary, "players">): number {
  return summary.players.filter((player) => player.status === "joined").length;
}

export function countLobbyReadyPlayers(summary: Pick<RoomSummary, "players">): number {
  return getLobbyPlayers(summary).filter((player) => player.isLobbyReady).length;
}

export function getLobbyPlayers(summary: Pick<RoomSummary, "players">): RoomSummary["players"] {
  return summary.players.filter(
    (player) => player.status === "joined" || player.status === "disconnected",
  );
}

function isLobbyStatus(status: RoomSummary["status"]): boolean {
  return status === "waiting" || status === "ended";
}

export function formatRoomStatus(summary: RoomSummary, t: Localization): string {
  if (summary.game?.status === "ended") {
    return t.live.roomStatus.status.ended;
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
