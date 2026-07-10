import type { Locale, Localization } from "@/lib/i18n/localization";
import type { PublicPlayer, RoomSummary } from "@/lib/shared/game";

type PublicEventDetail = {
  readonly label: string;
  readonly value: string;
};

export function formatPhaseTitle(phase: string | null, t: Localization): string {
  if (phase === "night") {
    return t.game.phase.night;
  }

  if (phase === "day") {
    return t.game.phase.day;
  }

  if (phase === "voting") {
    return t.game.phase.voting;
  }

  if (phase === "execution") {
    return t.game.phase.execution;
  }

  return t.game.phase.game;
}

export function formatWinner(winnerTeam: string | null, t: Localization): string {
  if (winnerTeam === null) {
    return t.game.team.none;
  }

  if (winnerTeam === "werewolves") {
    return t.game.team.werewolves;
  }

  if (winnerTeam === "villagers") {
    return t.game.team.villagers;
  }

  return t.game.team.fox;
}

export function formatPublicEvent(
  event: NonNullable<RoomSummary["game"]>["events"][number],
  players: readonly PublicPlayer[],
  t: Localization,
): {
  readonly details: readonly PublicEventDetail[];
  readonly kindLabel: string;
  readonly message: string;
} {
  const targetName = getPayloadPublicPlayerName(event.payload["targetPlayerId"], players);
  switch (event.kind) {
    case "game_ended": {
      const winner = formatWinner(toStringOrNull(event.payload["winnerTeam"]), t);

      return {
        details: [{ label: t.events.details.winner, value: winner }],
        kindLabel: t.events.kind.game_ended,
        message: t.events.message.game_ended(winner),
      };
    }

    case "phase_changed": {
      const phase = formatPhaseTitle(toStringOrNull(event.payload["phase"]), t);

      return {
        details: [],
        kindLabel: t.events.kind.phase_changed,
        message: t.events.message.phase_changed(phase),
      };
    }

    case "player_died":
      return {
        details: targetName === null ? [] : [{ label: t.events.details.player, value: targetName }],
        kindLabel: t.events.kind.player_died,
        message: t.events.message.player_died(targetName ?? t.game.seatStatus.player),
      };

    case "player_executed":
      return {
        details: targetName === null ? [] : [{ label: t.events.details.player, value: targetName }],
        kindLabel: t.events.kind.player_executed,
        message: t.events.message.player_executed(targetName ?? t.game.seatStatus.player),
      };

    case "vote_resolved":
      return formatVoteResolvedEvent(event.payload, players, t);

    case "attack_guarded":
      return {
        details: [],
        kindLabel: t.events.kind.attack_guarded,
        message: t.events.message.attack_guarded,
      };

    case "peaceful_night":
      return {
        details: [],
        kindLabel: t.events.kind.peaceful_night,
        message: t.events.message.peaceful_night,
      };

    case "vote_submitted":
      return {
        details: [],
        kindLabel: t.events.kind.vote_submitted,
        message: t.events.message.vote_submitted,
      };

    case "game_started":
      return {
        details: [],
        kindLabel: t.events.kind.game_started,
        message: t.events.message.game_started,
      };

    default:
      return {
        details: [],
        kindLabel: formatUnknownEventKind(event.kind),
        message: t.events.message.unknown,
      };
  }
}

export function formatPrivateEvent(
  event: NonNullable<RoomSummary["self"]>["events"][number],
  players: readonly PublicPlayer[],
  t: Localization,
): { readonly kindLabel: string; readonly message: string } {
  const targetName =
    getPayloadPublicPlayerName(event.payload["targetPlayerId"], players) ??
    t.game.seatStatus.player;
  const result =
    event.payload["result"] === "werewolf"
      ? t.events.inspectionView.werewolf
      : t.events.inspectionView.human;

  switch (event.kind) {
    case "initial_inspection":
      return {
        kindLabel: t.events.kind.initial_inspection,
        message: t.events.message.initial_inspection(targetName, result),
      };
    case "inspection_result":
      return {
        kindLabel: t.events.kind.inspection_result,
        message: t.events.message.inspection_result(targetName, result),
      };
    case "spiritist_result":
      return {
        kindLabel: t.events.kind.spiritist_result,
        message: t.events.message.spiritist_result(targetName, result),
      };
    default:
      return {
        kindLabel: formatUnknownEventKind(event.kind),
        message: t.events.message.privateUnknown,
      };
  }
}

export function formatDateTime(value: string | null, locale: Locale, t: Localization): string {
  if (value === null) {
    return t.common.none;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatVoteResolvedEvent(
  payload: Record<string, unknown>,
  players: readonly PublicPlayer[],
  t: Localization,
): {
  readonly details: readonly PublicEventDetail[];
  readonly kindLabel: string;
  readonly message: string;
} {
  const details: PublicEventDetail[] = [];
  const candidateName = getPayloadPublicPlayerName(payload["executionCandidatePlayerId"], players);

  if (candidateName !== null) {
    details.push({ label: t.events.details.candidate, value: candidateName });
  }

  const voteCountsByTarget = payload["voteCountsByTarget"];

  if (isRecord(voteCountsByTarget)) {
    const voteSummary = Object.entries(voteCountsByTarget)
      .map(([playerId, count]) => ({
        count: typeof count === "number" ? count : Number(count),
        playerName: getPayloadPublicPlayerName(playerId, players) ?? playerId,
      }))
      .filter((entry) => Number.isFinite(entry.count))
      .toSorted((left, right) => right.count - left.count)
      .map((entry) => `${entry.playerName} ${entry.count}`)
      .join(", ");

    if (voteSummary !== "") {
      details.push({ label: t.events.details.votes, value: voteSummary });
    }
  }

  const acceptedVotes = payload["acceptedVotes"];

  if (Array.isArray(acceptedVotes)) {
    const acceptedVoteSummary = acceptedVotes
      .flatMap((vote): string[] => {
        if (!isRecord(vote)) {
          return [];
        }

        const voterName = getPayloadPublicPlayerName(vote["voterPlayerId"], players);
        const targetName = getPayloadPublicPlayerName(vote["targetPlayerId"], players);

        return voterName === null || targetName === null ? [] : [`${voterName} -> ${targetName}`];
      })
      .join(", ");

    if (acceptedVoteSummary !== "") {
      details.push({ label: t.events.details.acceptedVotes, value: acceptedVoteSummary });
    }
  }

  return {
    details,
    kindLabel: t.events.kind.vote_resolved,
    message:
      candidateName === null
        ? t.events.message.vote_resolved.noExecution
        : t.events.message.vote_resolved.candidate(candidateName),
  };
}

function getPayloadPublicPlayerName(
  value: unknown,
  players: readonly PublicPlayer[],
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return players.find((player) => player.id === value)?.displayName ?? null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatUnknownEventKind(kind: string): string {
  return kind
    .split("_")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}
