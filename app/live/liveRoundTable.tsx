"use client";

import { getLocalizedRole } from "@/lib/i18n/localization";

import motionStyles from "./effects/ui/liveRoundTableMotion.module.css";
import { useLiveRoundTableMotion } from "./effects/ui/useLiveRoundTableMotion";
import { formatWinner } from "./liveEventPresentation";
import {
  countJoinedPlayers,
  getLiveMood,
  getLiveTableTitle,
  getPlayerInitial,
} from "./livePresentation";
import styles from "./liveRoundTable.module.css";
import { getLiveRoundTableSeats } from "./liveRoundTableModel";
import { getLiveSeatPresentation } from "./liveSeatPresentation";

import type { Localization } from "@/lib/i18n/localization";
import type { RoomSummary } from "@/lib/shared/game";
import type { CSSProperties, ReactNode } from "react";

type LiveRoundTableProps = {
  readonly summary: RoomSummary;
  readonly t: Localization;
};

export function LiveRoundTable({ summary, t }: LiveRoundTableProps) {
  const seats = getLiveRoundTableSeats(summary);
  const mood = getLiveMood(summary);
  const rootRef = useLiveRoundTableMotion(summary);

  return (
    <div
      className={styles["board"]}
      data-live-round-table
      data-seat-count={seats.length}
      data-seat-density={seats.length >= 9 ? "compact" : "comfortable"}
      ref={rootRef}
    >
      <div className={styles["surface"]} data-live-table-surface>
        <span className={styles["innerRing"]} aria-hidden="true" />
        <div className={styles["center"]}>
          <span className={`${styles["phaseIcon"]} ${styles[mood] ?? ""}`} aria-hidden="true" />
          <span className={styles["centerKicker"]}>{getLiveTableMeta(summary, t)}</span>
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
              <LiveSeatPosition
                key={`empty-seat-${seatNumber}`}
                emptySeatNumber={seatNumber}
                seatNumber={seatNumber}
                style={seatStyle}
              >
                <div
                  aria-label={`${t.live.waiting.openSeat}, ${t.live.waiting.seat(seatNumber)}`}
                  className={`${styles["seat"]} ${styles["emptySeat"]} ${motionStyles["seatVisual"]}`}
                  data-live-seat-number={seatNumber}
                  data-live-seat-state="empty"
                >
                  <span className={styles["seatNumber"]}>{seatNumber}</span>
                  <span className={styles["avatar"]} aria-hidden="true">
                    <span>+</span>
                  </span>
                  <span className={styles["seatLabel"]}>
                    <strong>{t.live.waiting.openSeat}</strong>
                    <small>{t.live.waiting.seat(seatNumber)}</small>
                  </span>
                </div>
              </LiveSeatPosition>
            );
          }

          const seatPresentation = getLiveSeatPresentation(player, summary, t);
          const revealedRole =
            summary.status === "ended" && player.revealedRoleId !== null
              ? getLocalizedRole(t, player.revealedRoleId)
              : null;

          const seatClassName = [
            styles["seat"],
            styles[seatPresentation.state],
            player.isCurrent ? styles["selected"] : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <LiveSeatPosition
              key={player.id}
              playerId={player.id}
              seatNumber={seatNumber}
              style={seatStyle}
            >
              <div
                aria-label={[
                  player.displayName,
                  ...seatPresentation.ariaLabels,
                  ...(revealedRole === null ? [] : [revealedRole.name]),
                ].join(", ")}
                className={`${seatClassName} ${motionStyles["seatVisual"]}`}
                data-live-player-id={player.id}
                data-live-current-seat={player.isCurrent ? "" : undefined}
                data-live-role-id={revealedRole === null ? undefined : player.revealedRoleId}
                data-live-seat-number={seatNumber}
                data-live-seat-presentation-state={seatPresentation.state}
                data-live-seat-state="occupied"
              >
                <span
                  aria-hidden="true"
                  className={motionStyles["attentionHalo"]}
                  data-live-seat-attention
                />
                <span className={styles["seatNumber"]}>{seatNumber}</span>
                <span className={styles["avatar"]} aria-hidden="true" data-live-seat-avatar>
                  {getPlayerInitial(player.displayName)}
                </span>
                <span className={styles["seatLabel"]}>
                  <strong>{player.displayName}</strong>
                  {revealedRole === null && seatPresentation.visibleLabel !== null ? (
                    <small>{seatPresentation.visibleLabel}</small>
                  ) : null}
                  {revealedRole === null ? null : (
                    <small className={styles["roleReveal"]}>{revealedRole.name}</small>
                  )}
                </span>
                {revealedRole !== null && seatPresentation.visibleLabel !== null ? (
                  <span className={styles["seatState"]}>{seatPresentation.visibleLabel}</span>
                ) : null}
              </div>
            </LiveSeatPosition>
          );
        })}
      </div>
    </div>
  );
}

function LiveSeatPosition({
  children,
  emptySeatNumber,
  playerId,
  seatNumber,
  style,
}: {
  readonly children: ReactNode;
  readonly emptySeatNumber?: number;
  readonly playerId?: string;
  readonly seatNumber: number;
  readonly style: CSSProperties;
}) {
  return (
    <div
      className={motionStyles["seatPosition"]}
      data-live-position-seat-number={seatNumber}
      data-live-seat-position
      style={style}
    >
      <div
        className={motionStyles["seatMotion"]}
        data-live-motion-empty-seat={emptySeatNumber}
        data-live-motion-player-id={playerId}
        data-live-seat-motion
      >
        {children}
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
