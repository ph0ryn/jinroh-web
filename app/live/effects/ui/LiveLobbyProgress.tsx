"use client";

import styles from "./liveLobbyProgress.module.css";
import {
  createLiveLobbyProgressSnapshot,
  getLiveLobbyProgressRatio,
  getLiveLobbyProgressState,
} from "./liveLobbyProgressModel";
import { useLiveLobbyProgressMotion } from "./useLiveLobbyProgressMotion";

import type { Localization } from "@/lib/i18n/localization";
import type { RoomSummary } from "@/lib/shared/game";

type LiveLobbyProgressProps = {
  readonly summary: RoomSummary;
  readonly t: Localization;
};

export function LiveLobbyProgress({ summary, t }: LiveLobbyProgressProps) {
  const snapshot = createLiveLobbyProgressSnapshot(summary);
  const progressState = getLiveLobbyProgressState(snapshot);
  const progressRatio = getLiveLobbyProgressRatio(snapshot);
  const requiredPlayerCount = Math.max(snapshot.targetPlayerCount - snapshot.joinedPlayerCount, 0);
  const progressLabel = t.live.invite.progressLabel(
    snapshot.joinedPlayerCount,
    snapshot.targetPlayerCount,
  );
  const requirementMessage = getRequirementMessage(progressState, requiredPlayerCount, t);
  const rootRef = useLiveLobbyProgressMotion(snapshot);

  return (
    <div
      className={styles["root"]}
      data-live-lobby-progress
      data-live-lobby-progress-joined={snapshot.joinedPlayerCount}
      data-live-lobby-progress-state={progressState}
      data-live-lobby-progress-target={snapshot.targetPlayerCount}
      ref={rootRef}
    >
      <span aria-hidden="true" className={styles["glow"]} data-live-lobby-progress-glow />

      <div className={styles["header"]}>
        <div className={styles["copy"]}>
          <span className={styles["eyebrow"]}>{t.live.invite.requirement}</span>
          <strong
            aria-atomic="true"
            aria-live="polite"
            className={styles["message"]}
            data-live-lobby-progress-message
          >
            {requirementMessage}
          </strong>
        </div>

        <div aria-hidden="true" className={styles["count"]}>
          <strong data-live-lobby-progress-count>{snapshot.joinedPlayerCount}</strong>
          <span>/ {snapshot.targetPlayerCount}</span>
        </div>
      </div>

      <div
        aria-label={progressLabel}
        aria-valuemax={snapshot.targetPlayerCount}
        aria-valuemin={0}
        aria-valuenow={Math.min(snapshot.joinedPlayerCount, snapshot.targetPlayerCount)}
        aria-valuetext={progressLabel}
        className={styles["track"]}
        role="progressbar"
      >
        <span
          className={styles["fill"]}
          data-live-lobby-progress-fill
          style={{ width: `${String(progressRatio * 100)}%` }}
        >
          <span className={styles["sheen"]} data-live-lobby-progress-sheen />
        </span>
      </div>

      <div className={styles["footer"]}>
        <div aria-hidden="true" className={styles["seats"]}>
          {Array.from({ length: snapshot.targetPlayerCount }, (unusedValue, index) => {
            void unusedValue;
            const seatNumber = index + 1;

            return (
              <span
                className={styles["seat"]}
                data-filled={seatNumber <= snapshot.joinedPlayerCount}
                data-live-lobby-progress-seat
                data-live-lobby-progress-seat-number={seatNumber}
                key={seatNumber}
              />
            );
          })}
        </div>

        {progressState === "ready" ? (
          <span
            aria-hidden="true"
            className={styles["completion"]}
            data-live-lobby-progress-completion
          >
            <span>✓</span>
            {t.live.invite.ready}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function getRequirementMessage(
  progressState: ReturnType<typeof getLiveLobbyProgressState>,
  requiredPlayerCount: number,
  t: Localization,
): string {
  if (progressState === "overfilled") {
    return t.live.hints.tooManyPlayers;
  }

  return progressState === "ready"
    ? t.live.invite.allSeatsFilled
    : t.live.invite.morePlayersNeeded(requiredPlayerCount);
}
