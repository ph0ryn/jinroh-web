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

export function getLiveSeatPresentation(
  player: PublicPlayer,
  summary: RoomSummary,
  t: Localization,
): LiveSeatPresentation {
  const identityLabels = [
    ...(player.isCurrent ? [t.game.seatStatus.you] : []),
    ...(player.isHost ? [t.game.seatStatus.host] : []),
  ];

  if (player.alive === false) {
    return {
      ariaLabels: [t.game.seatStatus.out, ...identityLabels],
      state: "eliminated",
      visibleLabel: t.game.seatStatus.out,
    };
  }

  if (player.status === "disconnected") {
    return {
      ariaLabels: [t.game.seatStatus.disconnected, ...identityLabels],
      state: "disconnected",
      visibleLabel: t.game.seatStatus.disconnected,
    };
  }

  if (player.status === "left") {
    return {
      ariaLabels: [t.game.seatStatus.left, ...identityLabels],
      state: "left",
      visibleLabel: t.game.seatStatus.left,
    };
  }

  const phaseFocus = summary.game?.phaseFocus ?? null;

  if (phaseFocus?.playerId === player.id && phaseFocus.kind === "current_speaker") {
    return {
      ariaLabels: [t.game.seatStatus.speaking, ...identityLabels],
      state: "speaking",
      visibleLabel: t.game.seatStatus.speaking,
    };
  }

  if (phaseFocus?.playerId === player.id && phaseFocus.kind === "execution_candidate") {
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
    ariaLabels: [t.game.seatStatus.alive, ...identityLabels],
    state: "active",
    visibleLabel,
  };
}
