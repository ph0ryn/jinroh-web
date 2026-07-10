import { describe, expect, it } from "vitest";

import { projectLiveEffectCues } from "./liveEffectCues";
import {
  appendPendingLiveEffectCue,
  reconcileLiveEffectQueueForSummary,
} from "./useLiveEffectQueue";

import type { LiveEffectCue } from "./liveEffectCues";
import type {
  GamePhase,
  PlayerResult,
  PublicGameEvent,
  PublicPlayer,
  RoleId,
  RoomStatus,
  RoomSummary,
  Team,
} from "@/lib/shared/game";

const ALICE: PublicPlayer = {
  alive: true,
  displayName: "Alice",
  id: "player-alice",
  isCurrent: true,
  isHost: true,
  status: "joined",
};

const BOB: PublicPlayer = {
  alive: true,
  displayName: "Bob",
  id: "player-bob",
  isCurrent: false,
  isHost: false,
  status: "joined",
};

const CAROL: PublicPlayer = {
  alive: true,
  displayName: "Carol",
  id: "player-carol",
  isCurrent: false,
  isHost: false,
  status: "joined",
};

describe("projectLiveEffectCues", () => {
  it("reveals only the role on the first in-progress snapshot", () => {
    const summary = createSummary({
      events: [
        ...createInitialEvents(),
        createEvent("event-death", "player_died", { targetPlayerId: BOB.id }),
        createEvent("event-phase", "phase_changed", { phase: "day" }),
      ],
      phase: "day",
      roleId: "seer",
      status: "playing",
    });

    expect(projectLiveEffectCues(null, summary)).toEqual([
      expect.objectContaining({
        eventIds: ["event-start"],
        kind: "role",
        playerId: ALICE.id,
        roleId: "seer",
        source: "automatic",
      }),
    ]);
  });

  it("treats the first ended snapshot as history and projects no effects", () => {
    const summary = createSummary({
      events: [
        ...createInitialEvents(),
        createEvent("event-death", "player_died", { targetPlayerId: BOB.id }),
        createEvent("event-end", "game_ended", { winnerTeam: "villagers" }),
      ],
      phase: null,
      roleId: "seer",
      status: "ended",
      winnerTeam: "villagers",
    });

    expect(projectLiveEffectCues(null, summary)).toEqual([]);
  });

  it("orders the role before the initial phase when a lobby starts playing", () => {
    const lobby = createSummary({ status: "lobby" });
    const playing = createSummary({
      events: createInitialEvents(),
      phase: "night",
      roleId: "villager",
      snapshotRevision: 2,
      status: "playing",
    });
    const cues = projectLiveEffectCues(lobby, playing);

    expect(cues.map((cue) => cue.kind)).toEqual(["role", "phase"]);
    expect(cues[0]).toMatchObject({ eventIds: ["event-start"], roleId: "villager" });
    expect(cues[1]).toMatchObject({
      dayNumber: 0,
      eventIds: ["event-initial-phase"],
      nightNumber: 1,
      phase: "night",
    });
  });

  it("ignores a new phase instance when the semantic phase is unchanged", () => {
    const previous = createSummary({
      events: createInitialEvents(),
      phase: "night",
      phaseInstanceId: "phase-night-1",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      events: [
        ...createInitialEvents(),
        createEvent("event-phase", "phase_changed", { phase: "night" }),
      ],
      nightNumber: 2,
      phase: "night",
      phaseInstanceId: "phase-night-2",
      roleId: "villager",
      snapshotRevision: 2,
      status: "playing",
    });

    expect(projectLiveEffectCues(previous, next)).toEqual([]);
  });

  it("projects the current semantic phase once with its event ID", () => {
    const previous = createSummary({
      events: createInitialEvents(),
      phase: "night",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      dayNumber: 1,
      events: [
        ...createInitialEvents(),
        createEvent("event-phase", "phase_changed", { phase: "day" }),
      ],
      phase: "day",
      phaseInstanceId: "phase-day-1",
      roleId: "villager",
      snapshotRevision: 2,
      status: "playing",
    });

    expect(projectLiveEffectCues(previous, next)).toEqual([
      expect.objectContaining({
        dayNumber: 1,
        eventIds: ["event-phase"],
        kind: "phase",
        phase: "day",
      }),
    ]);
  });

  it("projects only the current phase after multiple transitions in one snapshot", () => {
    const previous = createSummary({
      events: createInitialEvents(),
      phase: "night",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      dayNumber: 1,
      events: [
        ...createInitialEvents(),
        createEvent("event-day", "phase_changed", { phase: "day" }),
        createEvent("event-voting", "phase_changed", { phase: "voting" }),
        createEvent("event-execution", "phase_changed", { phase: "execution" }),
      ],
      phase: "execution",
      phaseInstanceId: "phase-execution-1",
      roleId: "villager",
      snapshotRevision: 4,
      status: "playing",
    });

    expect(projectLiveEffectCues(previous, next)).toEqual([
      expect.objectContaining({
        eventIds: ["event-execution"],
        kind: "phase",
        phase: "execution",
      }),
    ]);
  });

  it("groups deaths from one snapshot and orders them before the phase", () => {
    const previous = createSummary({
      events: createInitialEvents(),
      phase: "night",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      dayNumber: 1,
      events: [
        ...createInitialEvents(),
        createEvent("event-death-bob", "player_died", { targetPlayerId: BOB.id }),
        createEvent("event-death-carol", "player_executed", { targetPlayerId: CAROL.id }),
        createEvent("event-phase", "phase_changed", { phase: "day" }),
      ],
      phase: "day",
      phaseInstanceId: "phase-day-1",
      roleId: "villager",
      snapshotRevision: 2,
      status: "playing",
    });
    const cues = projectLiveEffectCues(previous, next);

    expect(cues.map((cue) => cue.kind)).toEqual(["death", "phase"]);
    expect(cues[0]).toMatchObject({
      eventIds: ["event-death-bob", "event-death-carol"],
      playerIds: [BOB.id, CAROL.id],
    });
  });

  it("orders deaths before victory and freezes the player's result", () => {
    const previous = createSummary({
      events: createInitialEvents(),
      phase: "execution",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      events: [
        ...createInitialEvents(),
        createEvent("event-death", "player_executed", { targetPlayerId: BOB.id }),
        createEvent("event-end", "game_ended", { winnerTeam: "villagers" }),
      ],
      phase: null,
      playerResult: "win",
      roleId: "villager",
      snapshotRevision: 2,
      status: "ended",
      winnerTeam: "villagers",
    });
    const cues = projectLiveEffectCues(previous, next);

    expect(cues.map((cue) => cue.kind)).toEqual(["death", "victory"]);
    expect(cues[1]).toMatchObject({
      eventIds: ["event-end"],
      playerResult: "win",
      winnerTeam: "villagers",
    });
  });

  it("does not project the same event or cue again after accepting the next snapshot", () => {
    const previous = createSummary({
      events: createInitialEvents(),
      phase: "night",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      dayNumber: 1,
      events: [
        ...createInitialEvents(),
        createEvent("event-phase", "phase_changed", { phase: "day" }),
      ],
      phase: "day",
      phaseInstanceId: "phase-day-1",
      roleId: "villager",
      snapshotRevision: 2,
      status: "playing",
    });
    const firstProjection = projectLiveEffectCues(previous, next);

    expect(firstProjection).toHaveLength(1);
    expect(projectLiveEffectCues(next, next)).toEqual([]);
    expect(projectLiveEffectCues(previous, next)).toEqual(firstProjection);
  });

  it("resets projection history when the room changes", () => {
    const previous = createSummary({
      code: "111111",
      events: createInitialEvents(),
      phase: "night",
      roleId: "seer",
      status: "playing",
    });
    const next = createSummary({
      code: "222222",
      events: [
        ...createInitialEvents(),
        createEvent("event-old-death", "player_died", { targetPlayerId: BOB.id }),
        createEvent("event-current-phase", "phase_changed", { phase: "day" }),
      ],
      phase: "day",
      roleId: "werewolf",
      status: "playing",
    });

    expect(projectLiveEffectCues(previous, next)).toEqual([
      expect.objectContaining({ kind: "role", roleId: "werewolf", roomCode: "222222" }),
    ]);
  });

  it("ignores malformed or non-public death targets", () => {
    const previous = createSummary({
      phase: "night",
      roleId: "villager",
      status: "playing",
    });
    const next = createSummary({
      events: [
        ...createInitialEvents(),
        createEvent("event-malformed", "player_died", { targetPlayerId: 42 }),
        createEvent("event-unknown", "player_died", { targetPlayerId: "internal-id" }),
      ],
      phase: "night",
      roleId: "villager",
      snapshotRevision: 2,
      status: "playing",
    });

    expect(projectLiveEffectCues(previous, next)).toEqual([]);
  });
});

describe("appendPendingLiveEffectCue", () => {
  it("coalesces pending phases without removing role, death, or victory cues", () => {
    const roleCue = createCue("role-old", "role");
    const oldPhaseCue = createCue("phase-old", "phase");
    const deathCue = createCue("death-old", "death");
    const victoryCue = createCue("victory-old", "victory");
    const latestPhaseCue = createCue("phase-latest", "phase");

    expect(
      appendPendingLiveEffectCue([roleCue, oldPhaseCue, deathCue, victoryCue], latestPhaseCue),
    ).toEqual([roleCue, deathCue, victoryCue, latestPhaseCue]);
  });

  it("appends a non-phase cue without coalescing an existing phase", () => {
    const phaseCue = createCue("phase-old", "phase");
    const deathCue = createCue("death-new", "death");

    expect(appendPendingLiveEffectCue([phaseCue], deathCue)).toEqual([phaseCue, deathCue]);
  });

  it("coalesces role replay requests to one pending cue", () => {
    const firstReplayCue = createRoleReplayCue("role-replay-first");
    const secondReplayCue = createRoleReplayCue("role-replay-second");

    expect(appendPendingLiveEffectCue([firstReplayCue], secondReplayCue)).toEqual([firstReplayCue]);
  });

  it("discards a pending replay before appending an automatic cue", () => {
    const deathCue = createCue("death-old", "death");
    const replayCue = createRoleReplayCue("role-replay");
    const phaseCue = createPhaseCue("phase-current", "day");

    expect(appendPendingLiveEffectCue([deathCue, replayCue], phaseCue)).toEqual([
      deathCue,
      phaseCue,
    ]);
  });
});

describe("reconcileLiveEffectQueueForSummary", () => {
  it("keeps only a pending phase that exactly matches the current snapshot", () => {
    const deathCue = createCue("death", "death");
    const dayCue = createPhaseCue("phase-day", "day");
    const votingCue = createPhaseCue("phase-voting", "voting");
    const executionCue = createPhaseCue("phase-execution", "execution");
    const currentSummary = createSummary({
      dayNumber: 1,
      phase: "execution",
      phaseInstanceId: "phase-execution-1",
      roleId: "villager",
      status: "playing",
    });

    expect(
      reconcileLiveEffectQueueForSummary(
        deathCue,
        [dayCue, deathCue, votingCue, executionCue],
        currentSummary,
        false,
      ),
    ).toEqual({
      activeCue: deathCue,
      pendingCues: [deathCue, executionCue],
    });
  });

  it("discards a semantically equal pending phase from an older cycle", () => {
    const oldNightCue = createPhaseCue("phase-night-1", "night", 0, 1);
    const currentSummary = createSummary({
      dayNumber: 1,
      nightNumber: 2,
      phase: "night",
      phaseInstanceId: "phase-night-2",
      roleId: "villager",
      status: "playing",
    });

    expect(reconcileLiveEffectQueueForSummary(null, [oldNightCue], currentSummary, false)).toEqual({
      activeCue: null,
      pendingCues: [],
    });
  });

  it("supersedes an active phase that no longer matches the playing snapshot", () => {
    const activeDayCue = createPhaseCue("phase-day-active", "day");
    const currentVotingCue = createPhaseCue("phase-voting-current", "voting");
    const currentSummary = createSummary({
      dayNumber: 1,
      phase: "voting",
      phaseInstanceId: "phase-voting-1",
      roleId: "villager",
      status: "playing",
    });

    expect(
      reconcileLiveEffectQueueForSummary(activeDayCue, [currentVotingCue], currentSummary, false),
    ).toEqual({
      activeCue: null,
      pendingCues: [currentVotingCue],
    });
  });

  it("supersedes an active phase and removes all pending phases when the game ends", () => {
    const activePhaseCue = createPhaseCue("phase-active", "execution");
    const pendingPhaseCue = createPhaseCue("phase-pending", "execution");
    const deathCue = createCue("death", "death");
    const victoryCue = createCue("victory", "victory");
    const endedSummary = createSummary({
      phase: null,
      roleId: "villager",
      status: "ended",
      winnerTeam: "villagers",
    });

    expect(
      reconcileLiveEffectQueueForSummary(
        activePhaseCue,
        [pendingPhaseCue, deathCue, victoryCue],
        endedSummary,
        true,
      ),
    ).toEqual({
      activeCue: null,
      pendingCues: [deathCue, victoryCue],
    });
  });

  it("supersedes an active replay and drops pending replay when an automatic cue arrives", () => {
    const activeReplayCue = createRoleReplayCue("role-replay-active");
    const pendingReplayCue = createRoleReplayCue("role-replay-pending");
    const deathCue = createCue("death", "death");
    const currentSummary = createSummary({
      dayNumber: 1,
      phase: "day",
      roleId: "villager",
      status: "playing",
    });

    expect(
      reconcileLiveEffectQueueForSummary(
        activeReplayCue,
        [deathCue, pendingReplayCue],
        currentSummary,
        true,
      ),
    ).toEqual({
      activeCue: null,
      pendingCues: [deathCue],
    });
  });
});

type SummaryOptions = {
  readonly code?: string;
  readonly dayNumber?: number;
  readonly events?: readonly PublicGameEvent[];
  readonly nightNumber?: number;
  readonly phase?: GamePhase | null;
  readonly phaseInstanceId?: string | null;
  readonly playerResult?: PlayerResult | null;
  readonly roleId?: RoleId | null;
  readonly snapshotRevision?: number;
  readonly status: RoomStatus;
  readonly winnerTeam?: Team | null;
};

function createSummary(options: SummaryOptions): RoomSummary {
  const hasGame = options.status === "playing" || options.status === "ended";
  const roleId = options.roleId ?? null;

  return {
    code: options.code ?? "123456",
    currentPlayerId: ALICE.id,
    defaultRoleCounts: {},
    game: hasGame
      ? {
          actionProgress: null,
          dayNumber: options.dayNumber ?? 0,
          events: [...(options.events ?? createInitialEvents())],
          nightNumber: options.nightNumber ?? 1,
          phase: options.phase === undefined ? "night" : options.phase,
          phaseEndsAt: null,
          phaseFocus: null,
          phaseInstanceId: options.phaseInstanceId ?? "phase-night-1",
          revision: options.snapshotRevision ?? 1,
          status: options.status === "ended" ? "ended" : "playing",
          winnerTeam: options.winnerTeam ?? null,
        }
      : null,
    hostPlayerId: ALICE.id,
    isHost: true,
    lobbyExpiresAt: "2099-01-01T00:00:00.000Z",
    players: [ALICE, BOB, CAROL],
    roleCatalog: [],
    rolePrivate: null,
    self: {
      actions: [],
      events: [],
      playerId: ALICE.id,
      result: options.playerResult ?? null,
      roleId,
      roleName: roleId,
      submittedActions: [],
    },
    snapshotRevision: options.snapshotRevision ?? 1,
    status: options.status,
    targetPlayerCount: 3,
  };
}

function createEvent(
  id: string,
  kind: string,
  payload: Record<string, unknown> = {},
): PublicGameEvent {
  return {
    createdAt: "2099-01-01T00:00:00.000Z",
    id,
    kind,
    payload,
  };
}

function createInitialEvents(): PublicGameEvent[] {
  return [
    createEvent("event-start", "game_started"),
    createEvent("event-initial-phase", "phase_changed", { phase: "night" }),
  ];
}

function createCue(id: string, kind: LiveEffectCue["kind"]): LiveEffectCue {
  const baseCue = { eventIds: [], id, roomCode: "123456" } as const;

  switch (kind) {
    case "death":
      return { ...baseCue, kind, playerIds: [BOB.id] };
    case "phase":
      return {
        ...baseCue,
        dayNumber: 1,
        kind,
        nightNumber: 1,
        phase: "day",
      };
    case "role":
      return {
        ...baseCue,
        kind,
        playerId: ALICE.id,
        roleId: "villager",
        source: "automatic",
      };
    case "victory":
      return {
        ...baseCue,
        kind,
        playerResult: "win",
        winnerTeam: "villagers",
      };
  }
}

function createPhaseCue(
  id: string,
  phase: GamePhase,
  dayNumber = 1,
  nightNumber = 1,
): LiveEffectCue {
  return {
    dayNumber,
    eventIds: [],
    id,
    kind: "phase",
    nightNumber,
    phase,
    roomCode: "123456",
  };
}

function createRoleReplayCue(id: string): LiveEffectCue {
  return {
    eventIds: [],
    id,
    kind: "role",
    playerId: ALICE.id,
    roleId: "villager",
    roomCode: "123456",
    source: "replay",
  };
}
