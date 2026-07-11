import type { GamePhase, PlayerResult, RoleId, RoomSummary, Team } from "@/lib/shared/game";

type LiveEffectCueBase = {
  readonly eventIds: readonly string[];
  readonly id: string;
  readonly roomCode: string;
};

export type LiveRoleEffectCue = LiveEffectCueBase & {
  readonly kind: "role";
  readonly playerId: string;
  readonly roleId: RoleId;
  readonly source: "automatic" | "replay";
};

export type LivePhaseEffectCue = LiveEffectCueBase & {
  readonly dayNumber: number;
  readonly kind: "phase";
  readonly nightNumber: number;
  readonly phase: GamePhase;
};

export type LiveDeathEffectCue = LiveEffectCueBase & {
  readonly kind: "death";
  readonly playerIds: readonly string[];
};

export type LiveVoteEffectRow = {
  readonly count: number;
  readonly playerId: string;
  readonly voterPlayerIds: readonly string[] | null;
};

export type LiveVoteEffectCue = LiveEffectCueBase & {
  readonly dayNumber: number;
  readonly kind: "vote";
  readonly outcome:
    | {
        readonly kind: "candidate";
        readonly playerId: string;
        readonly voteCount: number;
      }
    | {
        readonly kind: "no_votes";
      }
    | {
        readonly kind: "tie";
        readonly playerIds: readonly string[];
        readonly voteCount: number;
      };
  readonly rows: readonly LiveVoteEffectRow[];
  readonly visibility: "count_only" | "voter_to_target";
};

export type LiveVictoryEffectCue = LiveEffectCueBase & {
  readonly kind: "victory";
  readonly playerResult: PlayerResult | null;
  readonly winnerTeam: Team | null;
};

export type LiveEffectCue =
  | LiveRoleEffectCue
  | LivePhaseEffectCue
  | LiveDeathEffectCue
  | LiveVoteEffectCue
  | LiveVictoryEffectCue;

type PublicEvent = NonNullable<RoomSummary["game"]>["events"][number];

/**
 * Projects transient effects from snapshots that have already passed the room request ordering
 * checks. The first snapshot is deliberately treated as a baseline so old public events are not
 * replayed when a player opens or returns to an in-progress game.
 */
export function projectLiveEffectCues(
  previous: RoomSummary | null,
  next: RoomSummary,
): readonly LiveEffectCue[] {
  if (!isSameEffectSession(previous, next)) {
    return projectInitialSnapshot(next);
  }

  const newEvents = getNewEvents(previous, next);
  const roleCue = projectRoleCue(previous, next, newEvents);
  const voteCues = projectVoteCues(next, newEvents);
  const deathCue = projectDeathCue(next, newEvents);
  const phaseCue = projectPhaseCue(previous, next, newEvents);
  const victoryCue = projectVictoryCue(previous, next, newEvents);

  return [roleCue, ...voteCues, deathCue, phaseCue, victoryCue].filter(
    (cue): cue is LiveEffectCue => cue !== null,
  );
}

function projectVoteCues(
  next: RoomSummary,
  newEvents: readonly PublicEvent[],
): readonly LiveVoteEffectCue[] {
  return newEvents
    .filter((event) => event.kind === "vote_resolved")
    .flatMap((event): LiveVoteEffectCue[] => {
      const cue = makeVoteCue(next, event);

      return cue === null ? [] : [cue];
    });
}

function makeVoteCue(next: RoomSummary, voteResolvedEvent: PublicEvent): LiveVoteEffectCue | null {
  const publicPlayerIds = new Set(next.players.map((player) => player.id));
  const counts = parseVoteCounts(voteResolvedEvent.payload["voteCountsByTarget"], publicPlayerIds);

  if (counts === null) {
    return null;
  }

  const acceptedVotes = parseAcceptedVotes(
    voteResolvedEvent.payload["acceptedVotes"],
    publicPlayerIds,
    counts,
  );
  const playerOrder = new Map(next.players.map((player, index) => [player.id, index]));

  const sortedCounts = [...counts.entries()].toSorted(
    ([leftPlayerId, leftCount], [rightPlayerId, rightCount]) =>
      rightCount - leftCount ||
      (playerOrder.get(leftPlayerId) ?? Number.MAX_SAFE_INTEGER) -
        (playerOrder.get(rightPlayerId) ?? Number.MAX_SAFE_INTEGER),
  );
  const topVoteCount = sortedCounts[0]?.[1] ?? 0;
  const topPlayerIds = sortedCounts
    .filter(([, count]) => count === topVoteCount)
    .map(([playerId]) => playerId);
  const candidatePlayerId = voteResolvedEvent.payload["executionCandidatePlayerId"];
  const outcome = getVoteOutcome(
    "executionCandidatePlayerId" in voteResolvedEvent.payload,
    candidatePlayerId,
    counts,
    publicPlayerIds,
    sortedCounts.length,
    topPlayerIds,
    topVoteCount,
  );

  if (outcome === null) {
    return null;
  }

  const rows = sortedCounts.map(([playerId, count]) => ({
    count,
    playerId,
    voterPlayerIds:
      acceptedVotes === null
        ? null
        : acceptedVotes
            .filter((vote) => vote.targetPlayerId === playerId)
            .map((vote) => vote.voterPlayerId),
  }));

  return {
    dayNumber:
      parsePositiveInteger(voteResolvedEvent.payload["dayNumber"]) ?? next.game?.dayNumber ?? 0,
    eventIds: [voteResolvedEvent.id],
    id: `${next.code}:vote:${voteResolvedEvent.id}`,
    kind: "vote",
    outcome,
    roomCode: next.code,
    rows,
    visibility: acceptedVotes === null ? "count_only" : "voter_to_target",
  };
}

function getVoteOutcome(
  hasCandidatePlayerId: boolean,
  candidatePlayerId: unknown,
  counts: ReadonlyMap<string, number>,
  publicPlayerIds: ReadonlySet<string>,
  rowCount: number,
  topPlayerIds: readonly string[],
  topVoteCount: number,
): LiveVoteEffectCue["outcome"] | null {
  if (hasCandidatePlayerId) {
    if (typeof candidatePlayerId !== "string" || !publicPlayerIds.has(candidatePlayerId)) {
      return null;
    }

    const voteCount = counts.get(candidatePlayerId);

    return voteCount !== undefined && voteCount === topVoteCount && topPlayerIds.length === 1
      ? { kind: "candidate", playerId: candidatePlayerId, voteCount }
      : null;
  }

  if (rowCount === 0) {
    return { kind: "no_votes" };
  }

  return topPlayerIds.length > 1
    ? { kind: "tie", playerIds: topPlayerIds, voteCount: topVoteCount }
    : null;
}

function parseVoteCounts(
  value: unknown,
  publicPlayerIds: ReadonlySet<string>,
): Map<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const [playerId, count] of Object.entries(value)) {
    if (
      !publicPlayerIds.has(playerId) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count <= 0
    ) {
      return null;
    }

    counts.set(playerId, count);
  }

  return counts;
}

function parseAcceptedVotes(
  value: unknown,
  publicPlayerIds: ReadonlySet<string>,
  counts: ReadonlyMap<string, number>,
): readonly { readonly targetPlayerId: string; readonly voterPlayerId: string }[] | null {
  if (value === undefined || !Array.isArray(value)) {
    return null;
  }

  const votes = value.flatMap((vote) => {
    if (!isRecord(vote)) {
      return [];
    }

    const targetPlayerId = vote["targetPlayerId"];
    const voterPlayerId = vote["voterPlayerId"];

    return typeof targetPlayerId === "string" &&
      typeof voterPlayerId === "string" &&
      publicPlayerIds.has(targetPlayerId) &&
      publicPlayerIds.has(voterPlayerId)
      ? [{ targetPlayerId, voterPlayerId }]
      : [];
  });

  if (votes.length !== value.length) {
    return null;
  }

  const seenVoterPlayerIds = new Set<string>();
  const acceptedCounts = new Map<string, number>();

  for (const vote of votes) {
    if (seenVoterPlayerIds.has(vote.voterPlayerId)) {
      return null;
    }

    seenVoterPlayerIds.add(vote.voterPlayerId);
    acceptedCounts.set(vote.targetPlayerId, (acceptedCounts.get(vote.targetPlayerId) ?? 0) + 1);
  }

  const matchesCounts =
    acceptedCounts.size === counts.size &&
    [...counts].every(([playerId, count]) => acceptedCounts.get(playerId) === count);

  return matchesCounts ? votes : null;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSameEffectSession(
  previous: RoomSummary | null,
  next: RoomSummary,
): previous is RoomSummary {
  return (
    previous !== null &&
    previous.code === next.code &&
    previous.currentPlayerId === next.currentPlayerId
  );
}

function projectInitialSnapshot(next: RoomSummary): readonly LiveEffectCue[] {
  if (next.status !== "playing") {
    return [];
  }

  const roleCue = makeRoleCue(next, next.game?.events ?? []);

  return roleCue === null ? [] : [roleCue];
}

function getNewEvents(previous: RoomSummary, next: RoomSummary): readonly PublicEvent[] {
  const previousEventIds = new Set(previous.game?.events.map((event) => event.id) ?? []);

  return (next.game?.events ?? []).filter((event) => !previousEventIds.has(event.id));
}

function projectRoleCue(
  previous: RoomSummary,
  next: RoomSummary,
  newEvents: readonly PublicEvent[],
): LiveRoleEffectCue | null {
  if (next.status !== "playing" || next.self?.roleId === null || next.self?.roleId === undefined) {
    return null;
  }

  const enteredPlaying = previous.status !== "playing";
  const roleBecameAvailable = previous.self?.roleId !== next.self.roleId;

  return enteredPlaying || roleBecameAvailable ? makeRoleCue(next, newEvents) : null;
}

function makeRoleCue(
  summary: RoomSummary,
  candidateEvents: readonly PublicEvent[],
): LiveRoleEffectCue | null {
  const roleId = summary.self?.roleId;
  const playerId = summary.self?.playerId ?? summary.currentPlayerId;

  if (roleId === null || roleId === undefined || playerId === null) {
    return null;
  }

  const gameStartedEvent = candidateEvents.findLast((event) => event.kind === "game_started");
  const sourceKey = gameStartedEvent?.id ?? `snapshot-${summary.snapshotRevision}`;

  return {
    eventIds: gameStartedEvent === undefined ? [] : [gameStartedEvent.id],
    id: `${summary.code}:role:${playerId}:${roleId}:${sourceKey}`,
    kind: "role",
    playerId,
    roleId,
    roomCode: summary.code,
    source: "automatic",
  };
}

function projectDeathCue(
  next: RoomSummary,
  newEvents: readonly PublicEvent[],
): LiveDeathEffectCue | null {
  const publicPlayerIds = new Set(next.players.map((player) => player.id));
  const deathEvents = newEvents.filter(
    (event) => event.kind === "player_died" || event.kind === "player_executed",
  );
  const playerIds = [
    ...new Set(
      deathEvents.flatMap((event) => {
        const playerId = event.payload["targetPlayerId"];

        return typeof playerId === "string" && publicPlayerIds.has(playerId) ? [playerId] : [];
      }),
    ),
  ];

  if (playerIds.length === 0) {
    return null;
  }

  const eventIds = deathEvents.map((event) => event.id);

  return {
    eventIds,
    id: `${next.code}:death:${eventIds.join("+")}`,
    kind: "death",
    playerIds,
    roomCode: next.code,
  };
}

function projectPhaseCue(
  previous: RoomSummary,
  next: RoomSummary,
  newEvents: readonly PublicEvent[],
): LivePhaseEffectCue | null {
  const nextGame = next.game;

  if (
    next.status !== "playing" ||
    nextGame?.phase === null ||
    nextGame?.phase === undefined ||
    previous.game?.phase === nextGame.phase
  ) {
    return null;
  }

  const phaseChangedEvent = newEvents.findLast(
    (event) => event.kind === "phase_changed" && event.payload["phase"] === nextGame.phase,
  );
  const enteredPlaying = previous.status !== "playing";
  const sourceKey =
    phaseChangedEvent?.id ??
    `${nextGame.phase}-${nextGame.dayNumber}-${nextGame.nightNumber}-${next.snapshotRevision}`;

  return {
    dayNumber: nextGame.dayNumber,
    eventIds: phaseChangedEvent === undefined ? [] : [phaseChangedEvent.id],
    id: `${next.code}:phase:${enteredPlaying ? "initial-" : ""}${sourceKey}`,
    kind: "phase",
    nightNumber: nextGame.nightNumber,
    phase: nextGame.phase,
    roomCode: next.code,
  };
}

function projectVictoryCue(
  previous: RoomSummary,
  next: RoomSummary,
  newEvents: readonly PublicEvent[],
): LiveVictoryEffectCue | null {
  const gameEndedEvent = newEvents.findLast((event) => event.kind === "game_ended");
  const enteredEnded = previous.status !== "ended" && next.status === "ended";

  if (!enteredEnded && gameEndedEvent === undefined) {
    return null;
  }

  const sourceKey = gameEndedEvent?.id ?? `snapshot-${next.snapshotRevision}`;

  return {
    eventIds: gameEndedEvent === undefined ? [] : [gameEndedEvent.id],
    id: `${next.code}:victory:${sourceKey}`,
    kind: "victory",
    playerResult: next.self?.result ?? null,
    roomCode: next.code,
    winnerTeam: next.game?.winnerTeam ?? null,
  };
}
