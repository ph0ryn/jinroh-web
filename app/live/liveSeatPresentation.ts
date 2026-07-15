import type { Localization } from "@/lib/i18n/localization";
import type { PublicPlayer, RoomSummary } from "@/lib/shared/game";

export type LiveSeatState =
  | "active"
  | "disconnected"
  | "eliminated"
  | "execution"
  | "left"
  | "speaking";

export type LiveSeatPresentation = {
  readonly ariaLabels: readonly string[];
  readonly state: LiveSeatState;
  readonly visibleLabel: string | null;
};

export function getLiveSeatState(
  player: PublicPlayer,
  summary: Pick<RoomSummary, "game">,
): LiveSeatState {
  if (player.alive === false) {
    return "eliminated";
  }

  if (player.status === "disconnected") {
    return "disconnected";
  }

  if (player.status === "left") {
    return "left";
  }

  const phaseFocus = summary.game?.phaseFocus ?? null;

  if (phaseFocus?.playerId === player.id && phaseFocus.kind === "current_speaker") {
    return "speaking";
  }

  if (phaseFocus?.playerId === player.id && phaseFocus.kind === "execution_candidate") {
    return "execution";
  }

  return "active";
}

export function getLiveSeatPresentation(
  player: PublicPlayer,
  summary: RoomSummary,
  t: Localization,
): LiveSeatPresentation {
  const state = getLiveSeatState(player, summary);
  const identityLabels = [
    ...(player.isCurrent ? [t.game.seatStatus.you] : []),
    ...(player.isHost ? [t.game.seatStatus.host] : []),
  ];

  if (state === "eliminated") {
    return {
      ariaLabels: [t.game.seatStatus.out, ...identityLabels],
      state: "eliminated",
      visibleLabel: t.game.seatStatus.out,
    };
  }

  if (state === "disconnected") {
    return {
      ariaLabels: [t.game.seatStatus.disconnected, ...identityLabels],
      state: "disconnected",
      visibleLabel: t.game.seatStatus.disconnected,
    };
  }

  if (state === "left") {
    return {
      ariaLabels: [t.game.seatStatus.left, ...identityLabels],
      state: "left",
      visibleLabel: t.game.seatStatus.left,
    };
  }

  if (state === "speaking") {
    return {
      ariaLabels: [t.game.seatStatus.speaking, ...identityLabels],
      state: "speaking",
      visibleLabel: t.game.seatStatus.speaking,
    };
  }

  if (state === "execution") {
    return {
      ariaLabels: [t.game.phase.execution, ...identityLabels],
      state: "execution",
      visibleLabel: t.game.phase.execution,
    };
  }

  let visibleLabel: string | null = null;

  if (player.isCurrent) {
    visibleLabel = t.game.seatStatus.you;
  } else if (player.isHost) {
    visibleLabel = t.game.seatStatus.host;
  }

  return {
    ariaLabels:
      summary.status === "waiting" ? identityLabels : [t.game.seatStatus.alive, ...identityLabels],
    state: "active",
    visibleLabel,
  };
}
