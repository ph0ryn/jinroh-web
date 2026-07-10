import {
  getLiveMood,
  getLiveTableTitle,
  getPlayerInitial,
  getRoundTableSeatPosition,
} from "./livePresentation";
import { getLiveSeatPresentation } from "./liveSeatPresentation";

import type { Localization } from "@/lib/i18n/localization";
import type { RoomSummary } from "@/lib/shared/game";
import type { CSSProperties } from "react";

type LiveRoundTableProps = {
  readonly summary: RoomSummary;
  readonly t: Localization;
};

export function LiveRoundTable({ summary, t }: LiveRoundTableProps) {
  const playerCount = summary.players.length;

  return (
    <div className="tableBoard liveTableBoard">
      <div className="tableSurface liveTableSurface">
        <div className="tableCenter liveTableCenter">
          <span className={`liveTablePhaseIcon ${getLiveMood(summary)}`} aria-hidden="true" />
          <strong>{getLiveTableTitle(summary, t)}</strong>
        </div>

        {summary.players.map((player, index) => {
          const position = getRoundTableSeatPosition(index, playerCount);
          const seatPresentation = getLiveSeatPresentation(player, summary, t);
          const seatStyle: CSSProperties & {
            readonly "--seat-x": string;
            readonly "--seat-y": string;
          } = {
            "--seat-x": `${position.x}%`,
            "--seat-y": `${position.y}%`,
          };

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
              data-live-player-id={player.id}
              key={player.id}
              style={seatStyle}
              aria-label={[player.displayName, ...seatPresentation.ariaLabels].join(", ")}
            >
              <span className="seatNumber">{index + 1}</span>
              <span className="avatar" aria-hidden="true" data-live-seat-avatar>
                {getPlayerInitial(player.displayName)}
              </span>
              <span className="seatLabel">
                <strong>{player.displayName}</strong>
                {seatPresentation.visibleLabel === null ? null : (
                  <small>{seatPresentation.visibleLabel}</small>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
