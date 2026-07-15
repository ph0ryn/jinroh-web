"use client";

import { useCallback, useEffect } from "react";

import { formatPhaseTitle, formatWinner } from "@/app/live/liveEventPresentation";
import { getLocalizedRole } from "@/lib/i18n/localization";

import { DeathSoulAshEffect } from "./DeathSoulAshEffect";
import { observeMeaningfulLiveElementResize } from "./liveResizeSettlement";
import { PhaseChapterEffect } from "./PhaseChapterEffect";
import { RoleTarotFlipEffect } from "./RoleTarotFlipEffect";
import { VictoryCrestAscendEffect } from "./VictoryCrestAscendEffect";
import { VoteVerdictLedgerEffect } from "./VoteVerdictLedgerEffect";

import type { LiveEffectCue } from "./liveEffectCues";
import type { Locale, Localization } from "@/lib/i18n/localization";
import type { GamePhase, PlayerResult, RoomSummary } from "@/lib/shared/game";
import type { RefObject, ReactNode } from "react";

type LiveGameEffectsProps = {
  readonly activeCue: LiveEffectCue | null;
  readonly locale: Locale;
  readonly onComplete: (cueId: string) => void;
  readonly onDisplayCommit: (cueId: string) => void;
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly summary: RoomSummary | null;
  readonly t: Localization;
};

export function LiveGameEffects({
  activeCue,
  locale,
  onComplete,
  onDisplayCommit,
  shellRef,
  summary,
  t,
}: LiveGameEffectsProps) {
  const currentCue = activeCue?.gameId === summary?.game?.gameId ? activeCue : null;
  const activeCueId = currentCue?.id ?? null;
  const handleComplete = useCallback(() => {
    if (activeCueId !== null) {
      onComplete(activeCueId);
    }
  }, [activeCueId, onComplete]);
  const handleDisplayCommit = useCallback(() => {
    if (activeCueId !== null) {
      onDisplayCommit(activeCueId);
    }
  }, [activeCueId, onDisplayCommit]);

  useEffect(() => {
    const shell = shellRef.current;

    if (activeCueId === null || shell === null) {
      return;
    }

    return observeMeaningfulLiveElementResize([shell], handleComplete);
  }, [activeCueId, handleComplete, shellRef]);

  const announcement =
    currentCue === null || summary === null
      ? ""
      : getEffectAnnouncement(currentCue, summary, locale, t);
  let effect: ReactNode = null;

  if (currentCue !== null && summary !== null) {
    switch (currentCue.kind) {
      case "role": {
        effect = (
          <RoleTarotFlipEffect
            cue={currentCue}
            onComplete={handleComplete}
            onDisplayCommit={handleDisplayCommit}
            role={getLocalizedRole(
              t,
              locale,
              summary.roleCatalog.find((role) => role.id === currentCue.roleId),
            )}
            t={t}
          />
        );
        break;
      }
      case "phase": {
        const phaseName = formatPhaseTitle(currentCue.phase, t);

        effect = (
          <PhaseChapterEffect
            code={getPhaseCode(currentCue.phase, currentCue.dayNumber, currentCue.nightNumber, t)}
            cue={currentCue}
            label={t.live.effects.phase.label(phaseName)}
            onComplete={handleComplete}
            onDisplayCommit={handleDisplayCommit}
            title={getPhaseEffectTitle(currentCue.phase, t)}
          />
        );
        break;
      }
      case "death": {
        effect = (
          <DeathSoulAshEffect
            cue={currentCue}
            kicker={t.live.effects.death.kicker}
            message={getDeathMessage(currentCue.playerIds, summary, t)}
            onComplete={handleComplete}
            onDisplayCommit={handleDisplayCommit}
            shellRef={shellRef}
          />
        );
        break;
      }
      case "vote": {
        effect = (
          <VoteVerdictLedgerEffect
            cue={currentCue}
            key={currentCue.id}
            onComplete={handleComplete}
            onDisplayCommit={handleDisplayCommit}
            players={summary.players}
            t={t}
          />
        );
        break;
      }
      case "victory": {
        const winner = formatWinner(currentCue.winnerTeam, summary.teamCatalog, locale, t);

        effect = (
          <VictoryCrestAscendEffect
            cue={currentCue}
            kicker={t.live.effects.victory.kicker}
            onComplete={handleComplete}
            onDisplayCommit={handleDisplayCommit}
            result={getPlayerResult(currentCue.playerResult, t)}
            subtitle={t.live.effects.victory.subtitle}
            title={t.live.effects.victory.title(winner)}
          />
        );
        break;
      }
    }
  }

  return (
    <>
      <div
        aria-atomic="true"
        aria-live="polite"
        className="srOnly"
        data-live-effect-announcement
        role="status"
      >
        {announcement}
      </div>
      {effect}
    </>
  );
}

function getEffectAnnouncement(
  cue: LiveEffectCue,
  summary: RoomSummary,
  locale: Locale,
  t: Localization,
): string {
  switch (cue.kind) {
    case "role":
      return t.live.effects.role.identity(
        getLocalizedRole(
          t,
          locale,
          summary.roleCatalog.find((role) => role.id === cue.roleId),
        ).name,
      );
    case "phase":
      return getPhaseEffectTitle(cue.phase, t);
    case "death":
      return getDeathMessage(cue.playerIds, summary, t);
    case "vote":
      return getVoteAnnouncement(cue, summary, t);
    case "victory": {
      const title = t.live.effects.victory.title(
        formatWinner(cue.winnerTeam, summary.teamCatalog, locale, t),
      );
      const playerResult = getPlayerResult(cue.playerResult, t);

      return t.live.effects.victory.announcement(title, playerResult);
    }
  }
}

function getVoteAnnouncement(
  cue: Extract<LiveEffectCue, { readonly kind: "vote" }>,
  summary: RoomSummary,
  t: Localization,
): string {
  const outcome = cue.outcome;

  switch (outcome.kind) {
    case "candidate": {
      const player = summary.players.find((candidate) => candidate.id === outcome.playerId);

      return t.live.effects.vote.announcement.candidate(
        player?.displayName ?? t.game.seatStatus.player,
        outcome.voteCount,
      );
    }
    case "no_votes":
      return t.live.effects.vote.announcement.noVotes;
    case "tie":
      return t.live.effects.vote.announcement.tie(outcome.voteCount);
  }
}

function getDeathMessage(
  playerIds: readonly string[],
  summary: RoomSummary,
  t: Localization,
): string {
  const playerNames = playerIds.map((playerId) => {
    const player = summary.players.find((candidate) => candidate.id === playerId);

    return player?.displayName ?? t.game.seatStatus.player;
  });

  return t.live.effects.death.message(playerNames);
}

function getPhaseCode(
  phase: GamePhase,
  dayNumber: number,
  nightNumber: number,
  t: Localization,
): string {
  switch (phase) {
    case "day":
      return t.live.effects.phase.code.day(dayNumber);
    case "execution":
      return t.live.effects.phase.code.execution(dayNumber);
    case "night":
      return t.live.effects.phase.code.night(nightNumber);
    case "voting":
      return t.live.effects.phase.code.voting(dayNumber);
  }
}

function getPhaseEffectTitle(phase: GamePhase, t: Localization): string {
  switch (phase) {
    case "day":
      return t.live.effects.phase.title.day;
    case "execution":
      return t.live.effects.phase.title.execution;
    case "night":
      return t.live.effects.phase.title.night;
    case "voting":
      return t.live.effects.phase.title.voting;
  }
}

function getPlayerResult(result: PlayerResult | null, t: Localization): string | null {
  if (result === null) {
    return null;
  }

  return t.game.playerResult[result];
}
