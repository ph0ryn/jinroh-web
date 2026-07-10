import { getLocalizedRole } from "@/lib/i18n/localization";

import { formatWinner } from "./liveEventPresentation";
import {
  countJoinedPlayers,
  getLiveMood,
  getLiveTableTitle,
  getPlayerInitial,
} from "./livePresentation";
import { getLiveRoundTableSeats } from "./liveRoundTableModel";
import { getLiveSeatPresentation } from "./liveSeatPresentation";

import type { Localization } from "@/lib/i18n/localization";
import type { RoomSummary } from "@/lib/shared/game";
import type { CSSProperties } from "react";

type LiveRoundTableProps = {
  readonly summary: RoomSummary;
  readonly t: Localization;
};

export function LiveRoundTable({ summary, t }: LiveRoundTableProps) {
  const seats = getLiveRoundTableSeats(summary);
  const mood = getLiveMood(summary);

  return (
    <div
      className="tableBoard liveTableBoard"
      data-live-round-table
      data-seat-count={seats.length}
      data-seat-density={seats.length >= 9 ? "compact" : "comfortable"}
    >
      <div className="tableSurface liveTableSurface">
        <span className="liveTableInnerRing" aria-hidden="true" />
        <div className="tableCenter liveTableCenter">
          <span className={`liveTablePhaseIcon ${mood}`} aria-hidden="true" />
          <span className="liveTableCenterKicker">{getLiveTableMeta(summary, t)}</span>
          <strong>{getLiveTableTitle(summary, t)}</strong>
        </div>

        {seats.map(({ player, seatNumber, x, y }) => {
          const seatStyle: CSSProperties & {
            readonly "--seat-x": string;
            readonly "--seat-y": string;
          } = {
            "--seat-x": `${x}%`,
            "--seat-y": `${y}%`,
            zIndex: Math.round(y) + 10,
          };

          if (player === null) {
            return (
              <div
                aria-label={`${t.live.waiting.openSeat}, ${t.live.waiting.seat(seatNumber)}`}
                className="seat liveTableSeat liveTableEmptySeat"
                data-live-seat-number={seatNumber}
                data-live-seat-state="empty"
                key={`empty-seat-${seatNumber}`}
                style={seatStyle}
              >
                <span className="seatNumber">{seatNumber}</span>
                <span className="avatar" aria-hidden="true">
                  <span>+</span>
                </span>
                <span className="seatLabel">
                  <strong>{t.live.waiting.openSeat}</strong>
                  <small>{t.live.waiting.seat(seatNumber)}</small>
                </span>
              </div>
            );
          }

          const seatPresentation = getLiveSeatPresentation(player, summary, t);
          const revealedRole =
            summary.status === "ended" && player.revealedRoleId !== null
              ? getLocalizedRole(t, player.revealedRoleId)
              : null;

          const seatClassName = [
            "seat",
            "liveTableSeat",
            seatPresentation.state,
            player.isHost ? "host" : "",
            player.isCurrent ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              className={seatClassName}
              data-live-role-id={revealedRole === null ? undefined : player.revealedRoleId}
              data-live-player-id={player.id}
              data-live-seat-number={seatNumber}
              data-live-seat-state="occupied"
              key={player.id}
              style={seatStyle}
              aria-label={[
                player.displayName,
                ...seatPresentation.ariaLabels,
                ...(revealedRole === null ? [] : [revealedRole.name]),
              ].join(", ")}
            >
              <span className="seatNumber">{seatNumber}</span>
              <span className="avatar" aria-hidden="true" data-live-seat-avatar>
                {getPlayerInitial(player.displayName)}
              </span>
              <span className="seatLabel">
                <strong>{player.displayName}</strong>
                {revealedRole === null && seatPresentation.visibleLabel !== null ? (
                  <small>{seatPresentation.visibleLabel}</small>
                ) : null}
                {revealedRole === null ? null : (
                  <small className="liveTableRoleReveal">{revealedRole.name}</small>
                )}
              </span>
              {revealedRole !== null && seatPresentation.visibleLabel !== null ? (
                <span className="liveTableSeatState">{seatPresentation.visibleLabel}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getLiveTableMeta(summary: RoomSummary, t: Localization): string {
  if (summary.status === "waiting") {
    return t.live.waiting.seated(countJoinedPlayers(summary), summary.targetPlayerCount);
  }

  if (summary.game?.status === "ended") {
    return t.live.phasePanel.result(formatWinner(summary.game.winnerTeam, t)).message;
  }

  if (summary.game?.phase === "night") {
    return t.live.effects.phase.code.night(summary.game.nightNumber);
  }

  if (summary.game?.phase === "day") {
    return t.live.effects.phase.code.day(summary.game.dayNumber);
  }

  if (summary.game?.phase === "voting") {
    return t.live.effects.phase.code.voting(summary.game.dayNumber);
  }

  if (summary.game?.phase === "execution") {
    return t.live.effects.phase.code.execution(summary.game.dayNumber);
  }

  return t.live.table.gameStateLoading;
}
