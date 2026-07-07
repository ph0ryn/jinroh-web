import { randomInt } from "node:crypto";

import {
  getRoleName,
  isRoleId,
  makeDefaultRuleSetForPlayers,
  normalizeRuleSet,
  ROLE_DEFINITIONS,
  ROLE_IDS,
  type ActionKind,
  type GamePhase,
  type InspectionResult,
  type RoleId,
  type RuleSet,
  type RuleSetInput,
  type Team,
  validateRuleSet,
} from "@/lib/shared/game";

export const ENGINE_VERSION = "2026-07-product-foundation";
export const ROLE_REGISTRY_VERSION = "2026-07-core-six";

export type EnginePlayer = {
  id: string;
  name: string;
};

export type RoleAssignment = {
  playerId: string;
  roleId: RoleId;
};

export type StartGameResult =
  | {
      actions: EngineAction[];
      assignments: RoleAssignment[];
      initialEvents: EngineEvent[];
      ok: true;
      phase: GamePhase;
      phaseDurationSeconds: number;
      ruleSet: RuleSet;
    }
  | {
      errors: string[];
      ok: false;
    };

export type EngineAction = {
  actorPlayerId: string | null;
  actorRoleId: RoleId | null;
  kind: ActionKind;
  key: string;
  targetKind: "none" | "single_player";
  eligibleTargetPlayerIds: string[];
};

export type EngineEvent = {
  kind: string;
  message: string | null;
  payload: Record<string, unknown>;
  visibleToPlayerIds: string[];
  visibleToRoleIds: RoleId[];
  visibility: "public" | "private" | "internal";
};

export type PlayerRuntimeState = {
  alive: boolean;
  playerId: string;
  roleId: RoleId;
};

export type PhaseResolutionInput = {
  actions: SubmittedAction[];
  currentPhase: GamePhase;
  dayNumber: number;
  nightNumber: number;
  orderedSpeechSlots?: readonly OrderedSpeechSlot[];
  players: PlayerRuntimeState[];
  previousGuardTargetByPlayerId?: Record<string, string>;
  ruleSet: RuleSet;
};

export type SubmittedAction = {
  actorPlayerId: string;
  actionKey?: string;
  kind: ActionKind;
  targetPlayerId: string | null;
};

export type OrderedSpeechSlot = {
  speakerPlayerId: string;
  slotIndex: number;
};

export type PhaseResolution = {
  actionsToOpen: EngineAction[];
  deaths: { playerId: string; reason: "attack" | "execution" | "rule_effect" }[];
  events: EngineEvent[];
  finalOutcome: { reason: string; winnerTeam: Team } | null;
  nextDayNumber: number;
  nextNightNumber: number;
  nextPhase: GamePhase | null;
  nextPhaseDurationSeconds: number | null;
  speechSlotsToCreate: OrderedSpeechSlot[];
};

export function startGame(
  players: readonly EnginePlayer[],
  ruleSetInput: RuleSetInput | null,
): StartGameResult {
  const ruleSet =
    ruleSetInput === null
      ? makeDefaultRuleSetForPlayers(players.length)
      : normalizeRuleSet(ruleSetInput, players.length);
  const validation = validateRuleSet(ruleSet, players.length);

  if (!validation.ok) {
    return validation;
  }

  const assignments = assignRoles(players, ruleSet);
  const actions = players.map((player) => ({
    actorPlayerId: player.id,
    actorRoleId: null,
    eligibleTargetPlayerIds: [],
    key: `first-night-ready:${player.id}`,
    kind: "first_night_ready" as const,
    targetKind: "none" as const,
  }));

  const initialEvents: EngineEvent[] = [
    {
      kind: "game_started",
      message: "The game started. Confirm your role before the first day.",
      payload: {},
      visibility: "public",
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    },
    ...createInitialInspectionEvents(assignments, ruleSet),
  ];

  return {
    actions,
    assignments,
    initialEvents,
    ok: true,
    phase: "night",
    phaseDurationSeconds: ruleSet.firstNightSeconds,
    ruleSet,
  };
}

export function resolvePhase(input: PhaseResolutionInput): PhaseResolution {
  if (input.currentPhase === "night" && input.nightNumber === 1) {
    return openDay(input, []);
  }

  if (input.currentPhase === "night") {
    return resolveNight(input);
  }

  if (input.currentPhase === "day" && input.ruleSet.dayMode === "ordered_speech") {
    return resolveOrderedSpeechDay(input);
  }

  if (input.currentPhase === "day") {
    return openVoting(input);
  }

  if (input.currentPhase === "voting") {
    return resolveVoting(input);
  }

  return resolveExecution(input);
}

export function getAvailableNightActions(
  players: readonly PlayerRuntimeState[],
  nightNumber: number,
  ruleSet: RuleSet = makeDefaultRuleSetForPlayers(players.length),
  previousGuardTargetByPlayerId: Readonly<Record<string, string>> = {},
): EngineAction[] {
  if (nightNumber <= 1) {
    return [];
  }

  const alivePlayers = players.filter((player) => player.alive);
  const actions: EngineAction[] = [];
  const werewolfIds = alivePlayers
    .filter((player) => player.roleId === "werewolf")
    .map((player) => player.playerId);
  const attackTargets = alivePlayers
    .filter((player) => player.roleId !== "werewolf")
    .map((player) => player.playerId);

  if (werewolfIds.length > 0) {
    actions.push({
      actorPlayerId: null,
      actorRoleId: "werewolf",
      eligibleTargetPlayerIds: attackTargets,
      key: `attack:${nightNumber}`,
      kind: "attack",
      targetKind: "single_player",
    });
  }

  for (const player of alivePlayers) {
    if (player.roleId === "seer") {
      actions.push({
        actorPlayerId: player.playerId,
        actorRoleId: "seer",
        eligibleTargetPlayerIds: alivePlayers
          .filter((target) => target.playerId !== player.playerId)
          .map((target) => target.playerId),
        key: `inspect:${nightNumber}:${player.playerId}`,
        kind: "inspect",
        targetKind: "single_player",
      });
    }

    if (player.roleId === "guard") {
      const previousTargetId = previousGuardTargetByPlayerId[player.playerId];
      const eligibleTargetPlayerIds = alivePlayers
        .filter((target) => target.playerId !== player.playerId)
        .filter(
          (target) =>
            ruleSet.guardConsecutiveTargetPolicy === "allow" ||
            target.playerId !== previousTargetId,
        )
        .map((target) => target.playerId);

      if (eligibleTargetPlayerIds.length > 0) {
        actions.push({
          actorPlayerId: player.playerId,
          actorRoleId: "guard",
          eligibleTargetPlayerIds,
          key: `guard:${nightNumber}:${player.playerId}`,
          kind: "guard",
          targetKind: "single_player",
        });
      }
    }
  }

  return actions;
}

export function getRoleInspectionResult(roleId: RoleId): InspectionResult {
  return ROLE_DEFINITIONS[roleId].seenAs;
}

export function evaluateWinner(players: readonly PlayerRuntimeState[]): {
  reason: string;
  winnerTeam: Team;
} | null {
  const alivePlayers = players.filter((player) => player.alive);
  const aliveFox = alivePlayers.some((player) => player.roleId === "fox");
  const aliveWerewolves = alivePlayers.filter(
    (player) => ROLE_DEFINITIONS[player.roleId].countAs === "werewolf",
  ).length;
  const aliveVillagers = alivePlayers.filter(
    (player) => ROLE_DEFINITIONS[player.roleId].countAs === "villager",
  ).length;

  if (aliveFox && (aliveWerewolves === 0 || aliveWerewolves >= aliveVillagers)) {
    return { reason: "A fox survived when another team condition resolved.", winnerTeam: "fox" };
  }

  if (aliveWerewolves === 0) {
    return { reason: "All werewolves are dead.", winnerTeam: "villagers" };
  }

  if (aliveWerewolves >= aliveVillagers) {
    return { reason: "Werewolves reached parity with villagers.", winnerTeam: "werewolves" };
  }

  return null;
}

export function didPlayerWin(roleId: RoleId, winnerTeam: Team): boolean {
  return ROLE_DEFINITIONS[roleId].team === winnerTeam;
}

export function parseRoleCounts(value: unknown): Record<RoleId, number> {
  const result = Object.fromEntries(ROLE_IDS.map((roleId) => [roleId, 0])) as Record<
    RoleId,
    number
  >;

  if (typeof value !== "object" || value === null) {
    return result;
  }

  for (const [key, rawCount] of Object.entries(value)) {
    if (isRoleId(key) && typeof rawCount === "number") {
      result[key] = rawCount;
    }
  }

  return result;
}

function assignRoles(players: readonly EnginePlayer[], ruleSet: RuleSet): RoleAssignment[] {
  const roleDeck = ROLE_IDS.flatMap((roleId) =>
    Array.from({ length: ruleSet.roleCounts[roleId] }, () => roleId),
  );
  const shuffledRoleDeck = stableShuffle(roleDeck, players.map((player) => player.id).join(":"));

  return players.map((player, index) => ({
    playerId: player.id,
    roleId: shuffledRoleDeck[index] ?? "villager",
  }));
}

function stableShuffle<Item>(items: readonly Item[], salt: string): Item[] {
  return [...items]
    .map((item, index) => ({
      item,
      sortKey: hashString(`${salt}:${index}:${String(item)}`),
    }))
    .sort((left, right) => left.sortKey - right.sortKey)
    .map(({ item }) => item);
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createInitialInspectionEvents(
  assignments: readonly RoleAssignment[],
  ruleSet: RuleSet,
): EngineEvent[] {
  if (ruleSet.initialInspectionPolicy !== "enabled") {
    return [];
  }

  const seer = assignments.find((assignment) => assignment.roleId === "seer");

  if (seer === undefined) {
    return [];
  }

  const candidates = assignments.filter(
    (assignment) =>
      assignment.playerId !== seer.playerId &&
      getRoleInspectionResult(assignment.roleId) === "human",
  );

  if (candidates.length === 0) {
    return [];
  }

  const target = candidates[randomInt(candidates.length)];

  if (target === undefined) {
    return [];
  }

  return [
    {
      kind: "initial_inspection",
      message: null,
      payload: {
        result: "human",
        targetPlayerId: target.playerId,
      },
      visibility: "private",
      visibleToPlayerIds: [seer.playerId],
      visibleToRoleIds: [],
    },
  ];
}

function resolveNight(input: PhaseResolutionInput): PhaseResolution {
  const attack = input.actions.find((action) => action.kind === "attack");
  const guardActions = input.actions.filter(
    (action) => action.kind === "guard" && action.targetPlayerId !== null,
  );
  const guardTargets = new Set(guardActions.map((action) => action.targetPlayerId));
  const events: EngineEvent[] = [];
  const deaths: { playerId: string; reason: "attack" | "rule_effect" }[] = [];

  for (const guardAction of guardActions) {
    events.push({
      kind: "guard_resolved",
      message: null,
      payload: {
        actorPlayerId: guardAction.actorPlayerId,
        targetPlayerId: guardAction.targetPlayerId,
      },
      visibility: "internal",
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    });
  }

  for (const inspect of input.actions.filter((action) => action.kind === "inspect")) {
    const target = input.players.find((player) => player.playerId === inspect.targetPlayerId);

    if (target !== undefined) {
      if (target.roleId === "fox") {
        deaths.push({ playerId: target.playerId, reason: "rule_effect" });
        events.push({
          kind: "player_died",
          message: "A player died after being inspected.",
          payload: { reason: "rule_effect", targetPlayerId: target.playerId },
          visibility: "public",
          visibleToPlayerIds: [],
          visibleToRoleIds: [],
        });
      }

      events.push({
        kind: "inspection_result",
        message: null,
        payload: {
          result: getRoleInspectionResult(target.roleId),
          targetPlayerId: target.playerId,
        },
        visibility: "private",
        visibleToPlayerIds: [inspect.actorPlayerId],
        visibleToRoleIds: [],
      });
    }
  }

  if (attack?.targetPlayerId !== null && attack?.targetPlayerId !== undefined) {
    if (guardTargets.has(attack.targetPlayerId)) {
      events.push({
        kind: "attack_guarded",
        message: "Someone was attacked, but no one died.",
        payload: {},
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      });
    } else {
      const target = input.players.find((player) => player.playerId === attack.targetPlayerId);

      if (target?.roleId === "fox") {
        events.push({
          kind: "attack_guarded",
          message: "Someone was attacked, but no one died.",
          payload: { reason: "fox_survived_attack" },
          visibility: "public",
          visibleToPlayerIds: [],
          visibleToRoleIds: [],
        });

        return openDay(input, deaths, events);
      }

      deaths.push({ playerId: attack.targetPlayerId, reason: "attack" });
      events.push({
        kind: "player_died",
        message: "A player died during the night.",
        payload: { reason: "attack", targetPlayerId: attack.targetPlayerId },
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      });
    }
  } else {
    events.push({
      kind: "peaceful_night",
      message: "The night ended with no death.",
      payload: {},
      visibility: "public",
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    });
  }

  return openDay(input, deaths, events);
}

function openDay(
  input: PhaseResolutionInput,
  deaths: { playerId: string; reason: "attack" | "execution" | "rule_effect" }[],
  events: EngineEvent[] = [],
): PhaseResolution {
  const nextPlayers = input.players.map((player) => ({
    ...player,
    alive: deaths.some((death) => death.playerId === player.playerId) ? false : player.alive,
  }));
  const finalOutcome = evaluateWinner(nextPlayers);

  if (finalOutcome !== null) {
    return {
      actionsToOpen: [],
      deaths,
      events: [
        ...events,
        {
          kind: "game_ended",
          message: `Game ended. Winner: ${finalOutcome.winnerTeam}.`,
          payload: finalOutcome,
          visibility: "public",
          visibleToPlayerIds: [],
          visibleToRoleIds: [],
        },
      ],
      finalOutcome,
      nextDayNumber: input.dayNumber,
      nextNightNumber: input.nightNumber,
      nextPhase: null,
      nextPhaseDurationSeconds: null,
      speechSlotsToCreate: [],
    };
  }

  const nextDayNumber = input.dayNumber + 1;
  const alivePlayers = nextPlayers.filter((player) => player.alive);
  const orderedSpeechSlots = createOrderedSpeechSlots(alivePlayers, nextDayNumber, input.ruleSet);
  const firstSpeechSlot = orderedSpeechSlots[0];
  const actionsToOpen =
    input.ruleSet.dayMode === "ordered_speech" && firstSpeechSlot !== undefined
      ? [toOrderedSpeechAction(firstSpeechSlot, nextDayNumber)]
      : alivePlayers.map((player) => ({
          actorPlayerId: player.playerId,
          actorRoleId: null,
          eligibleTargetPlayerIds: [],
          key: `day-ready:${nextDayNumber}:${player.playerId}`,
          kind: "day_ready" as const,
          targetKind: "none" as const,
        }));

  return {
    actionsToOpen,
    deaths,
    events: [
      ...events,
      {
        kind: "phase_changed",
        message:
          input.ruleSet.dayMode === "ordered_speech"
            ? "Day started. Follow the current speech turn."
            : "Day started. Discuss at the table or in your voice call.",
        payload: {
          dayMode: input.ruleSet.dayMode,
          phase: "day",
          ...(firstSpeechSlot === undefined
            ? {}
            : {
                speakerPlayerId: firstSpeechSlot.speakerPlayerId,
                speechSlotIndex: firstSpeechSlot.slotIndex,
              }),
        },
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ],
    finalOutcome: null,
    nextDayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "day",
    nextPhaseDurationSeconds:
      input.ruleSet.dayMode === "ordered_speech"
        ? input.ruleSet.daySpeechSeconds
        : alivePlayers.length * input.ruleSet.dayReadyCheckSecondsPerPlayer,
    speechSlotsToCreate: input.ruleSet.dayMode === "ordered_speech" ? orderedSpeechSlots : [],
  };
}

function resolveOrderedSpeechDay(input: PhaseResolutionInput): PhaseResolution {
  const currentSpeechAction = input.actions.find((action) => action.kind === "end_speech");
  const currentSlotIndex = parseSpeechSlotIndex(currentSpeechAction?.actionKey);
  const alivePlayers = input.players.filter((player) => player.alive);
  const orderedSpeechSlots = getOrderedSpeechSlots(input, alivePlayers);
  const nextSpeechSlot =
    currentSlotIndex === null ? undefined : orderedSpeechSlots[currentSlotIndex + 1];

  if (nextSpeechSlot === undefined) {
    return openVoting(input);
  }

  return {
    actionsToOpen: [toOrderedSpeechAction(nextSpeechSlot, input.dayNumber)],
    deaths: [],
    events: [
      {
        kind: "phase_changed",
        message: "Next speech turn started.",
        payload: {
          dayMode: "ordered_speech",
          phase: "day",
          speakerPlayerId: nextSpeechSlot.speakerPlayerId,
          speechSlotIndex: nextSpeechSlot.slotIndex,
        },
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "day",
    nextPhaseDurationSeconds: input.ruleSet.daySpeechSeconds,
    speechSlotsToCreate: [],
  };
}

function getOrderedSpeechSlots(
  input: PhaseResolutionInput,
  alivePlayers: readonly PlayerRuntimeState[],
): OrderedSpeechSlot[] {
  if (input.orderedSpeechSlots !== undefined && input.orderedSpeechSlots.length > 0) {
    return input.orderedSpeechSlots.toSorted((left, right) => left.slotIndex - right.slotIndex);
  }

  return createOrderedSpeechSlots(alivePlayers, input.dayNumber, input.ruleSet);
}

function createOrderedSpeechSlots(
  alivePlayers: readonly PlayerRuntimeState[],
  dayNumber: number,
  ruleSet: RuleSet,
): OrderedSpeechSlot[] {
  const orderedPlayerIds = stableShuffle(
    alivePlayers.map((player) => player.playerId),
    `speech:${dayNumber}:${alivePlayers.map((player) => player.playerId).join(":")}`,
  );
  const rounds = dayNumber === 1 ? ruleSet.firstDaySpeechRounds : ruleSet.normalDaySpeechRounds;

  return [...Array(rounds).keys()].flatMap((roundIndex) =>
    orderedPlayerIds.map((speakerPlayerId, playerIndex) => ({
      speakerPlayerId,
      slotIndex: roundIndex * orderedPlayerIds.length + playerIndex,
    })),
  );
}

function toOrderedSpeechAction(slot: OrderedSpeechSlot, dayNumber: number): EngineAction {
  return {
    actorPlayerId: slot.speakerPlayerId,
    actorRoleId: null,
    eligibleTargetPlayerIds: [],
    key: `end-speech:${dayNumber}:${slot.slotIndex}:${slot.speakerPlayerId}`,
    kind: "end_speech",
    targetKind: "none",
  };
}

function parseSpeechSlotIndex(actionKey: string | undefined): number | null {
  const match = actionKey?.match(/^end-speech:(?<dayNumber>\d+):(?<slotIndex>\d+):/);
  const slotIndex = match?.groups?.["slotIndex"];

  if (slotIndex === undefined) {
    return null;
  }

  const parsed = Number.parseInt(slotIndex, 10);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function openVoting(input: PhaseResolutionInput): PhaseResolution {
  const alivePlayers = input.players.filter((player) => player.alive);

  return {
    actionsToOpen: alivePlayers.map((player) => ({
      actorPlayerId: player.playerId,
      actorRoleId: null,
      eligibleTargetPlayerIds: alivePlayers.map((target) => target.playerId),
      key: `vote:${input.dayNumber}:${player.playerId}`,
      kind: "vote",
      targetKind: "single_player",
    })),
    deaths: [],
    events: [
      {
        kind: "phase_changed",
        message: "Voting started.",
        payload: { phase: "voting" },
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "voting",
    nextPhaseDurationSeconds: input.ruleSet.votingSeconds,
    speechSlotsToCreate: [],
  };
}

function resolveVoting(input: PhaseResolutionInput): PhaseResolution {
  const voteCounts = new Map<string, number>();

  for (const action of input.actions) {
    if (action.kind !== "vote" || action.targetPlayerId === null) {
      continue;
    }

    voteCounts.set(action.targetPlayerId, (voteCounts.get(action.targetPlayerId) ?? 0) + 1);
  }

  const sortedTargets = [...voteCounts.entries()].sort(
    ([, leftCount], [, rightCount]) => rightCount - leftCount,
  );
  const top = sortedTargets[0];
  const second = sortedTargets[1];

  if (top === undefined || (second !== undefined && top[1] === second[1])) {
    return openNight(input, [
      {
        kind: "vote_resolved",
        message: "Voting ended with no execution.",
        payload: toVoteResolvedPayload(input, voteCounts),
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ]);
  }

  return {
    actionsToOpen: [
      {
        actorPlayerId: top[0],
        actorRoleId: null,
        eligibleTargetPlayerIds: [],
        key: `execution-skip:${input.dayNumber}:${top[0]}`,
        kind: "execution_skip",
        targetKind: "none",
      },
    ],
    deaths: [],
    events: [
      {
        kind: "vote_resolved",
        message: "Voting selected an execution candidate.",
        payload: toVoteResolvedPayload(input, voteCounts, top[0]),
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "execution",
    nextPhaseDurationSeconds: input.ruleSet.executionLastWordsSeconds,
    speechSlotsToCreate: [],
  };
}

function toVoteResolvedPayload(
  input: PhaseResolutionInput,
  voteCounts: ReadonlyMap<string, number>,
  executionCandidatePlayerId?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    voteCountsByTarget: Object.fromEntries(voteCounts),
  };

  if (executionCandidatePlayerId !== undefined) {
    payload["executionCandidatePlayerId"] = executionCandidatePlayerId;
  }

  if (input.ruleSet.voteResultVisibility === "voter_to_target") {
    payload["acceptedVotes"] = input.actions
      .filter((action) => action.kind === "vote" && action.targetPlayerId !== null)
      .map((action) => ({
        targetPlayerId: action.targetPlayerId,
        voterPlayerId: action.actorPlayerId,
      }))
      .toSorted((left, right) => left.voterPlayerId.localeCompare(right.voterPlayerId));
  }

  return payload;
}

function resolveExecution(input: PhaseResolutionInput): PhaseResolution {
  const event = input.actions.find((action) => action.kind === "execution_skip");
  const targetPlayerId = event?.actorPlayerId;

  if (targetPlayerId === undefined) {
    return openNight(input, []);
  }

  const deaths = [{ playerId: targetPlayerId, reason: "execution" as const }];
  const nextPlayers = input.players.map((player) => ({
    ...player,
    alive: player.playerId === targetPlayerId ? false : player.alive,
  }));
  const finalOutcome = evaluateWinner(nextPlayers);
  const events: EngineEvent[] = [
    {
      kind: "player_executed",
      message: "The execution was resolved.",
      payload: { targetPlayerId },
      visibility: "public",
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    },
  ];

  if (finalOutcome !== null) {
    return {
      actionsToOpen: [],
      deaths,
      events: [
        ...events,
        {
          kind: "game_ended",
          message: `Game ended. Winner: ${finalOutcome.winnerTeam}.`,
          payload: finalOutcome,
          visibility: "public",
          visibleToPlayerIds: [],
          visibleToRoleIds: [],
        },
      ],
      finalOutcome,
      nextDayNumber: input.dayNumber,
      nextNightNumber: input.nightNumber,
      nextPhase: null,
      nextPhaseDurationSeconds: null,
      speechSlotsToCreate: [],
    };
  }

  return openNight(input, events, deaths);
}

function openNight(
  input: PhaseResolutionInput,
  events: EngineEvent[],
  deaths: { playerId: string; reason: "attack" | "execution" | "rule_effect" }[] = [],
): PhaseResolution {
  const nextPlayers = input.players.map((player) => ({
    ...player,
    alive: deaths.some((death) => death.playerId === player.playerId) ? false : player.alive,
  }));
  const nextNightNumber = input.nightNumber + 1;

  return {
    actionsToOpen: getAvailableNightActions(
      nextPlayers,
      nextNightNumber,
      input.ruleSet,
      input.previousGuardTargetByPlayerId,
    ),
    deaths,
    events: [
      ...events,
      {
        kind: "phase_changed",
        message: "Night started.",
        payload: { phase: "night" },
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber,
    nextPhase: "night",
    nextPhaseDurationSeconds: input.ruleSet.nightSeconds,
    speechSlotsToCreate: [],
  };
}

export function describeRole(roleId: RoleId | null): string {
  const roleName = getRoleName(roleId);

  return roleName ?? "Unknown";
}
