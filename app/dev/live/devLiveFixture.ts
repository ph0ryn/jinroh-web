import { ROLE_DEFINITIONS, ROLE_IDS, makeDefaultRuleSetForPlayers } from "@/lib/shared/game";

import type {
  ActionKind,
  GamePhase,
  PublicAction,
  PublicActionProgress,
  PublicGameEvent,
  PublicPlayer,
  RoleSpecificOptionItem,
  RoomSummary,
  SelfPrivateView,
} from "@/lib/shared/game";

export type DevLiveFixtureId = "day" | "execution" | "night" | "result" | "voting";

export type DevLiveFixture = {
  readonly id: DevLiveFixtureId;
  readonly label: string;
  readonly summary: RoomSummary;
};

const ROOM_CODE = "424242";
const CURRENT_PLAYER_ID = "player-sora";
const PHASE_DURATION_SECONDS = 540;

function getRoleSpecificOptions(
  roleId: (typeof ROLE_IDS)[number],
): readonly RoleSpecificOptionItem[] {
  switch (roleId) {
    case "guard":
      return [{ key: "guardConsecutiveTargetPolicy", label: "Consecutive target", roleId }];
    case "seer":
      return [{ key: "initialInspectionPolicy", label: "Initial inspection", roleId }];
    default:
      return [];
  }
}

const players: readonly PublicPlayer[] = [
  {
    alive: true,
    displayName: "Sora",
    id: CURRENT_PLAYER_ID,
    isCurrent: true,
    isHost: true,
    status: "joined",
  },
  {
    alive: true,
    displayName: "Mina",
    id: "player-mina",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
  {
    alive: true,
    displayName: "Kenji",
    id: "player-kenji",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
  {
    alive: true,
    displayName: "Aiko",
    id: "player-aiko",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
  {
    alive: true,
    displayName: "Riku",
    id: "player-riku",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
  {
    alive: true,
    displayName: "Taro",
    id: "player-taro",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
  {
    alive: true,
    displayName: "Yuki",
    id: "player-yuki",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
  {
    alive: false,
    displayName: "Hiro",
    id: "player-hiro",
    isCurrent: false,
    isHost: false,
    status: "joined",
  },
];

export function createDevLiveFixtures(): readonly DevLiveFixture[] {
  const now = Date.now();
  const fixtures = [
    createFixture({
      actionProgress: {
        label: "Night actions are hidden",
        visibility: "hidden",
      },
      actions: [
        createAction({
          eligibleTargetIds: ["player-mina", "player-aiko", "player-riku", "player-taro"],
          key: "dev-night-attack",
          kind: "attack",
          label: "Choose attack target",
          phase: "night",
          status: "open",
        }),
      ],
      events: [createEvent(now, "game_started", {})],
      id: "night",
      label: "Night",
      phase: "night",
      phaseEndsAt: createFutureIso(now, PHASE_DURATION_SECONDS),
      revision: 11,
    }),
    createFixture({
      actionProgress: {
        label: "ready checks",
        required: 7,
        submitted: 4,
        visibility: "public",
      },
      actions: [
        createAction({
          eligibleTargetIds: [],
          key: "dev-day-ready",
          kind: "day_ready",
          label: "Ready for voting",
          phase: "day",
          status: "open",
          targetKind: "none",
        }),
      ],
      events: [
        createEvent(now - 300_000, "player_died", { targetPlayerId: "player-hiro" }),
        createEvent(now - 180_000, "phase_changed", { phase: "day" }),
      ],
      id: "day",
      label: "Day",
      phase: "day",
      phaseEndsAt: createFutureIso(now, PHASE_DURATION_SECONDS),
      revision: 17,
    }),
    createFixture({
      actionProgress: {
        label: "votes",
        required: 7,
        submitted: 3,
        visibility: "public",
      },
      actions: [
        createAction({
          eligibleTargetIds: [
            "player-mina",
            "player-kenji",
            "player-aiko",
            "player-riku",
            "player-taro",
            "player-yuki",
          ],
          key: "dev-vote",
          kind: "vote",
          label: "Cast vote",
          phase: "voting",
          status: "open",
        }),
      ],
      events: [
        createEvent(now - 240_000, "phase_changed", { phase: "voting" }),
        createEvent(now - 90_000, "vote_submitted", {}),
      ],
      id: "voting",
      label: "Voting",
      phase: "voting",
      phaseEndsAt: createFutureIso(now, 240),
      revision: 23,
    }),
    createFixture({
      actionProgress: {
        label: "execution confirmation",
        required: 1,
        submitted: 0,
        visibility: "public",
      },
      actions: [
        createAction({
          eligibleTargetIds: [],
          key: "dev-execution-skip",
          kind: "execution_skip",
          label: "Skip execution",
          phase: "execution",
          status: "open",
          targetKind: "none",
        }),
      ],
      events: [
        createEvent(now - 180_000, "vote_resolved", {
          executionCandidatePlayerId: "player-kenji",
          voteCountsByTarget: {
            "player-kenji": 4,
            "player-mina": 2,
            "player-yuki": 1,
          },
        }),
        createEvent(now - 60_000, "phase_changed", { phase: "execution" }),
      ],
      id: "execution",
      label: "Execution",
      phase: "execution",
      phaseEndsAt: createFutureIso(now, 180),
      revision: 31,
    }),
    createFixture({
      actionProgress: null,
      actions: [],
      events: [
        createEvent(now - 240_000, "player_executed", { targetPlayerId: "player-kenji" }),
        createEvent(now - 120_000, "game_ended", { winnerTeam: "villagers" }),
      ],
      id: "result",
      label: "Result",
      phase: null,
      phaseEndsAt: null,
      revision: 44,
      status: "ended",
      winnerTeam: "villagers",
    }),
  ] as const;

  return fixtures;
}

function createFixture(params: {
  readonly actionProgress: PublicActionProgress | null;
  readonly actions: readonly PublicAction[];
  readonly events: readonly PublicGameEvent[];
  readonly id: DevLiveFixtureId;
  readonly label: string;
  readonly phase: GamePhase | null;
  readonly phaseEndsAt: string | null;
  readonly revision: number;
  readonly status?: "ended" | "playing";
  readonly winnerTeam?: RoomSummary["game"] extends null
    ? never
    : NonNullable<RoomSummary["game"]>["winnerTeam"];
}): DevLiveFixture {
  return {
    id: params.id,
    label: params.label,
    summary: {
      code: ROOM_CODE,
      currentPlayerId: CURRENT_PLAYER_ID,
      game: {
        actionProgress: params.actionProgress,
        dayNumber: params.id === "night" ? 1 : 2,
        events: [...params.events],
        nightNumber: params.id === "night" ? 2 : 1,
        phase: params.phase,
        phaseEndsAt: params.phaseEndsAt,
        phaseInstanceId: `dev-${params.id}`,
        revision: params.revision,
        status: params.status ?? "playing",
        winnerTeam: params.winnerTeam ?? null,
      },
      defaultRoleCounts: makeDefaultRuleSetForPlayers(players.length).roleCounts,
      hostPlayerId: CURRENT_PLAYER_ID,
      isHost: true,
      lobbyExpiresAt: createFutureIso(Date.now(), 86_400),
      players: params.id === "result" ? createResultPlayers() : [...players],
      realtime: null,
      rolePrivate: params.id === "night" ? createWerewolfRolePrivateView() : null,
      roleCatalog: ROLE_IDS.map((roleId, index) => ({
        description: ROLE_DEFINITIONS[roleId].name,
        id: roleId,
        maxCount: ROLE_DEFINITIONS[roleId].maxCount,
        minCount: ROLE_DEFINITIONS[roleId].minCount,
        name: ROLE_DEFINITIONS[roleId].name,
        order: index,
        shortLabel: ROLE_DEFINITIONS[roleId].name.slice(0, 2),
        specificOptions: getRoleSpecificOptions(roleId),
        team: ROLE_DEFINITIONS[roleId].team,
      })),
      self: createSelfView(params.id, params.actions),
      status: params.status === "ended" ? "ended" : "playing",
      targetPlayerCount: players.length,
    },
  };
}

function createSelfView(
  fixtureId: DevLiveFixtureId,
  actions: readonly PublicAction[],
): SelfPrivateView {
  return {
    actions: [...actions],
    events:
      fixtureId === "night"
        ? [
            {
              createdAt: createFutureIso(Date.now(), -120),
              kind: "role_action_opened",
              message: "Werewolf attack is waiting for a target.",
            },
          ]
        : [],
    playerId: CURRENT_PLAYER_ID,
    result: fixtureId === "result" ? "lose" : null,
    roleId: "werewolf",
    roleName: "Werewolf",
    submittedActions:
      fixtureId === "night"
        ? [
            {
              kind: "first_night_ready",
              label: "First night ready",
              submittedAt: createFutureIso(Date.now(), -600),
            },
          ]
        : [],
  };
}

function createWerewolfRolePrivateView(): NonNullable<RoomSummary["rolePrivate"]> {
  return {
    label: "Werewolf",
    nightConversation: {
      canSend: true,
      groupId: "werewolf",
      label: "Werewolf night talk",
      maxMessageLength: 240,
      messages: [
        {
          body: "Mina has been steering the table hard.",
          createdAt: createFutureIso(Date.now(), -300),
          id: "dev-night-message-1",
          senderName: "Kenji",
          senderPlayerId: "player-kenji",
        },
        {
          body: "Attack target is still open for review.",
          createdAt: createFutureIso(Date.now(), -180),
          id: "dev-night-message-2",
          senderName: "Sora",
          senderPlayerId: CURRENT_PLAYER_ID,
        },
      ],
      nightNumber: 2,
      participantPlayerIds: [CURRENT_PLAYER_ID, "player-kenji"],
      readOnly: false,
    },
    roleId: "werewolf",
  };
}

function createAction(params: {
  readonly eligibleTargetIds: readonly string[];
  readonly key: string;
  readonly kind: ActionKind;
  readonly label: string;
  readonly phase: GamePhase;
  readonly status: PublicAction["status"];
  readonly targetKind?: PublicAction["targetKind"];
}): PublicAction {
  return {
    closesAt: createFutureIso(Date.now(), PHASE_DURATION_SECONDS),
    eligibleTargetIds: [...params.eligibleTargetIds],
    key: params.key,
    kind: params.kind,
    label: params.label,
    phaseInstanceId: `dev-${params.phase}`,
    status: params.status,
    targetKind: params.targetKind ?? "single_player",
  };
}

function createEvent(
  createdAtMs: number,
  kind: string,
  payload: Record<string, unknown>,
): PublicGameEvent {
  return {
    createdAt: new Date(createdAtMs).toISOString(),
    kind,
    payload,
  };
}

function createResultPlayers(): PublicPlayer[] {
  return players.map((player) =>
    player.id === "player-kenji" ? { ...player, alive: false } : player,
  );
}

function createFutureIso(baseTimeMs: number, seconds: number): string {
  return new Date(baseTimeMs + seconds * 1_000).toISOString();
}
