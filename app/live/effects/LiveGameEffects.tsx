"use client";

import { useCallback } from "react";

import { formatPhaseTitle, formatWinner } from "@/app/live/liveEventPresentation";
import { getLocalizedRole } from "@/lib/i18n/localization";

import { DeathSoulAshEffect } from "./DeathSoulAshEffect";
import { PhaseChapterEffect } from "./PhaseChapterEffect";
import { RoleTarotFlipEffect } from "./RoleTarotFlipEffect";
import { VictoryCrestAscendEffect } from "./VictoryCrestAscendEffect";

import type { LiveEffectCue } from "./liveEffectCues";
import type { Localization } from "@/lib/i18n/localization";
import type { GamePhase, PlayerResult, RoomSummary } from "@/lib/shared/game";
import type { RefObject, ReactNode } from "react";

type LiveGameEffectsProps = {
  readonly activeCue: LiveEffectCue | null;
  readonly onComplete: (cueId: string) => void;
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly summary: RoomSummary | null;
  readonly t: Localization;
};

export function LiveGameEffects({
  activeCue,
  onComplete,
  shellRef,
  summary,
  t,
}: LiveGameEffectsProps) {
  const activeCueId = activeCue?.id ?? null;
  const handleComplete = useCallback(() => {
    if (activeCueId !== null) {
      onComplete(activeCueId);
    }
  }, [activeCueId, onComplete]);

  const announcement =
    activeCue === null || summary === null ? "" : getEffectAnnouncement(activeCue, summary, t);
  let effect: ReactNode = null;

  if (activeCue !== null && summary !== null) {
    switch (activeCue.kind) {
      case "role": {
        effect = (
          <RoleTarotFlipEffect
            cue={activeCue}
            onComplete={handleComplete}
            role={getLocalizedRole(t, activeCue.roleId)}
            t={t}
          />
        );
        break;
      }
      case "phase": {
        const phaseName = formatPhaseTitle(activeCue.phase, t);

        effect = (
          <PhaseChapterEffect
            code={getPhaseCode(activeCue.phase, activeCue.dayNumber, activeCue.nightNumber, t)}
            cue={activeCue}
            label={t.live.effects.phase.label(phaseName)}
            onComplete={handleComplete}
            title={getPhaseEffectTitle(activeCue.phase, t)}
          />
        );
        break;
      }
      case "death": {
        effect = (
          <DeathSoulAshEffect
            cue={activeCue}
            kicker={t.live.effects.death.kicker}
            message={getDeathMessage(activeCue.playerIds, summary, t)}
            onComplete={handleComplete}
            shellRef={shellRef}
          />
        );
        break;
      }
      case "victory": {
        const winner = formatWinner(activeCue.winnerTeam, t);

        effect = (
          <VictoryCrestAscendEffect
            cue={activeCue}
            kicker={t.live.effects.victory.kicker}
            onComplete={handleComplete}
            result={getPlayerResult(activeCue.playerResult, t)}
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

function getEffectAnnouncement(cue: LiveEffectCue, summary: RoomSummary, t: Localization): string {
  switch (cue.kind) {
    case "role":
      return t.live.effects.role.identity(getLocalizedRole(t, cue.roleId).name);
    case "phase":
      return getPhaseEffectTitle(cue.phase, t);
    case "death":
      return getDeathMessage(cue.playerIds, summary, t);
    case "victory": {
      const title = t.live.effects.victory.title(formatWinner(cue.winnerTeam, t));
      const playerResult = getPlayerResult(cue.playerResult, t);

      return t.live.effects.victory.announcement(title, playerResult);
    }
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
