import {
  type ActionKind,
  type DeathReason,
  type GamePhase,
  type PlayerResult as SharedPlayerResult,
  type RoleId,
  type RuleSet,
  type RuleSetInput,
  type Team,
} from "@/lib/shared/game";

import {
  collectDeathResolvedEffects,
  collectExecutionEffects,
  collectExecutionResolvedEffects,
  collectRoleActionEffects,
  resolveEffects,
} from "./game/effects";
import {
  evaluatePlayerResult,
  evaluateWinnerTeam,
  getRoleIds,
  makeDefaultRoleCounts,
  roleRegistry,
  type RoleContext,
} from "./game/roles";
import {
  DEFAULT_RULE_OPTIONS,
  resolveRoleSetup,
  validateRuleSet as validateRegisteredRuleSet,
  type RuleSet as RegisteredRuleSet,
} from "./game/ruleset";
import { toRegisteredRuleOptions, toSharedRuleOptions } from "./game/ruleSetAdapters";
import {
  GameActionKind as RegisteredGameActionKind,
  DeathReason as RegisteredDeathReason,
  GameEffectKind,
  GameEndReason,
  GameEventKind as RegisteredGameEventKind,
  GameEventVisibility as RegisteredGameEventVisibility,
  GamePhase as RegisteredGamePhase,
  GameStatus as RegisteredGameStatus,
  InspectionView,
  RoleTargetKind as RegisteredRoleTargetKind,
  Team as RegisteredTeam,
  type GameEffect,
  type PlayerResult as RegisteredPlayerResult,
  type ReadonlyGameState,
  type ResolvedRoleSetup,
  type ResolvedDeath,
  type RoleId as RegisteredRoleId,
} from "./game/types";

export const ENGINE_VERSION = "2026-07-product-foundation";
export const ROLE_REGISTRY_VERSION = roleRegistry.version;

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
      resolvedRoleSetup: ResolvedRoleSetup;
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
  resolvedRoleSetup: ResolvedRoleSetup;
  ruleSet: RuleSet;
};

export type SubmittedAction = {
  actorPlayerId: string;
  actorRoleId?: RoleId | null;
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
  deaths: EngineDeath[];
  events: EngineEvent[];
  finalOutcome: EngineFinalOutcome | null;
  nextDayNumber: number;
  nextNightNumber: number;
  nextPhase: GamePhase | null;
  nextPhaseDurationSeconds: number | null;
  speechSlotsToCreate: OrderedSpeechSlot[];
};

export type EngineFinalOutcome = {
  playerResultsByPlayerId: Record<string, SharedPlayerResult>;
  reason: string;
  winnerTeam: Team;
};

type EngineDeath = {
  playerId: string;
  reason: DeathReason;
};

export function startGame(
  players: readonly EnginePlayer[],
  ruleSetInput: RuleSetInput | null,
): StartGameResult {
  const ruleSet = normalizeEngineRuleSet(ruleSetInput, players.length);
  const validation = validateEngineRuleSet(ruleSet, players.length);

  if (!validation.ok) {
    return validation;
  }

  const assignments = assignRoles(players, ruleSet);
  const runtimePlayers = assignments.map((assignment) => ({
    alive: true,
    playerId: assignment.playerId,
    roleId: assignment.roleId,
  }));
  const resolvedRoleSetup = makeResolvedRoleSetupForPlayers(ruleSet, runtimePlayers);
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
    createPhaseChangedEvent("night"),
    ...createFirstNightRoleEvents(assignments, ruleSet, resolvedRoleSetup),
  ];

  return {
    actions,
    assignments,
    initialEvents,
    ok: true,
    phase: "night",
    phaseDurationSeconds: ruleSet.firstNightSeconds,
    resolvedRoleSetup,
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
  ruleSet: RuleSet = normalizeEngineRuleSet(null, players.length),
  previousGuardTargetByPlayerId: Readonly<Record<string, string>> = {},
  resolvedRoleSetup?: ResolvedRoleSetup,
): EngineAction[] {
  if (nightNumber <= 1) {
    return [];
  }

  const roleContext = createRoleContext({
    currentPhase: "night",
    dayNumber: 0,
    nightNumber,
    players,
    previousGuardTargetByPlayerId,
    resolvedRoleSetup: resolvedRoleSetup ?? makeResolvedRoleSetupForPlayers(ruleSet, players),
    ruleSet,
  });
  const openedRoleGroupActionKeys = new Set<string>();
  const actions: EngineAction[] = [];

  for (const player of players) {
    if (!player.alive) {
      continue;
    }

    const role = roleRegistry.get(player.roleId);
    const playerRoleContext = {
      ...roleContext,
      playerId: player.playerId,
    };

    for (const roleAction of role.getActions(playerRoleContext)) {
      const kind = toSharedActionKind(roleAction.kind);
      const targetKind = toSharedTargetKind(roleAction.target);

      if (kind === null || targetKind === null) {
        continue;
      }

      const ownerRoleId = roleAction.roleGroupRoleId;
      const actionKey =
        ownerRoleId === null
          ? `${kind}:${nightNumber}:${player.playerId}`
          : `${kind}:${nightNumber}:${ownerRoleId}`;

      if (ownerRoleId !== null && openedRoleGroupActionKeys.has(actionKey)) {
        continue;
      }

      const eligibleTargetPlayerIds = role.getEligibleTargets(roleAction, playerRoleContext);

      if (
        roleAction.target !== RegisteredRoleTargetKind.None &&
        eligibleTargetPlayerIds.length === 0
      ) {
        continue;
      }

      actions.push({
        actorPlayerId: ownerRoleId === null ? player.playerId : null,
        actorRoleId: ownerRoleId,
        eligibleTargetPlayerIds: [...eligibleTargetPlayerIds],
        key: actionKey,
        kind,
        targetKind,
      });
      openedRoleGroupActionKeys.add(actionKey);
    }
  }

  return actions;
}

export function evaluateWinner(players: readonly PlayerRuntimeState[]): {
  reason: string;
  winnerTeam: Team;
} | null {
  const finalOutcome = evaluateFinalOutcome(players, makeRuleSetForPlayers(players));

  return finalOutcome === null
    ? null
    : {
        reason: finalOutcome.reason,
        winnerTeam: finalOutcome.winnerTeam,
      };
}

export function didPlayerWin(roleId: RoleId, winnerTeam: Team): boolean {
  const winner = toRegisteredTeam(winnerTeam);

  if (winner === null) {
    return false;
  }

  return roleRegistry.get(roleId).team === winner;
}

export function makeDefaultRuleSetForPlayers(playerCount: number): RuleSet {
  return makeDefaultEngineRuleSet(playerCount);
}

function assignRoles(players: readonly EnginePlayer[], ruleSet: RuleSet): RoleAssignment[] {
  const roleDeck = getRoleIds().flatMap((roleId) =>
    Array.from({ length: ruleSet.roleCounts[roleId] ?? 0 }, () => roleId),
  );
  const shuffledRoleDeck = stableShuffle(roleDeck, players.map((player) => player.id).join(":"));

  return players.map((player, index) => {
    const roleId = shuffledRoleDeck[index];

    if (roleId === undefined) {
      throw new Error("Role deck does not match player count.");
    }

    return {
      playerId: player.id,
      roleId,
    };
  });
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

function normalizeEngineRuleSet(ruleSetInput: RuleSetInput | null, playerCount: number): RuleSet {
  if (ruleSetInput === null) {
    return makeDefaultEngineRuleSet(playerCount);
  }

  const roleCounts = Object.fromEntries(
    getRoleIds().map((roleId) => [roleId, ruleSetInput.roleCounts[roleId] ?? 0]),
  ) as RuleSet["roleCounts"];
  const specifiedCount = getRoleIds().reduce(
    (total, roleId) => total + (roleCounts[roleId] ?? 0),
    0,
  );
  const options = {
    dayMode: ruleSetInput.dayMode,
    dayReadyCheckSecondsPerPlayer: ruleSetInput.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: ruleSetInput.daySpeechSeconds,
    executionLastWordsSeconds: ruleSetInput.executionLastWordsSeconds,
    firstDaySpeechRounds: ruleSetInput.firstDaySpeechRounds,
    firstNightSeconds: ruleSetInput.firstNightSeconds,
    guardConsecutiveTargetPolicy: ruleSetInput.guardConsecutiveTargetPolicy,
    initialInspectionPolicy: ruleSetInput.initialInspectionPolicy,
    nightSeconds: ruleSetInput.nightSeconds,
    normalDaySpeechRounds: ruleSetInput.normalDaySpeechRounds,
    voteResultVisibility: ruleSetInput.voteResultVisibility,
    votingSeconds: ruleSetInput.votingSeconds,
  } satisfies Omit<RuleSet, "roleCounts">;

  return {
    ...(specifiedCount === 0
      ? makeDefaultEngineRuleSet(playerCount)
      : {
          roleCounts,
        }),
    ...options,
  };
}

function makeDefaultEngineRuleSet(playerCount: number): RuleSet {
  return {
    ...toSharedRuleOptions(DEFAULT_RULE_OPTIONS),
    roleCounts: makeDefaultRoleCounts(playerCount) as RuleSet["roleCounts"],
  };
}

export function validateEngineRuleSet(
  ruleSet: RuleSet,
  playerCount: number,
): { ok: true } | { errors: string[]; ok: false } {
  const validation = validateRegisteredRuleSet(toRegisteredRuleSet(ruleSet), playerCount);

  if (validation.ok) {
    return { ok: true };
  }

  return {
    errors: validation.issues.map((issue) => issue.message),
    ok: false,
  };
}

function createFirstNightRoleEvents(
  assignments: readonly RoleAssignment[],
  ruleSet: RuleSet,
  resolvedRoleSetup: ResolvedRoleSetup,
): EngineEvent[] {
  const players = assignments.map((assignment) => ({
    alive: true,
    playerId: assignment.playerId,
    roleId: assignment.roleId,
  }));
  const context = createRoleContext({
    currentPhase: "night",
    dayNumber: 0,
    nightNumber: 1,
    players,
    resolvedRoleSetup,
    ruleSet,
  });
  const effects = assignments.flatMap((assignment) => {
    return roleRegistry.get(assignment.roleId).onFirstNightStarted({
      ...context,
      playerId: assignment.playerId,
    });
  });
  const effectResolution = resolveEffects(effects);

  return toEngineEffectEvents(effectResolution.appliedEffects, [], []);
}

function collectSubmittedActionEffects(
  action: SubmittedAction,
  context: RoleContext,
): readonly GameEffect[] {
  const actionKind = toRegisteredRoleActionKind(action.kind);

  if (actionKind === null) {
    return [];
  }

  return collectRoleActionEffects({
    actionKind,
    actorId: action.actorPlayerId,
    actorRoleId: action.actorRoleId ?? null,
    context,
    sourceActionId: action.actionKey ?? null,
    targetId: action.targetPlayerId,
  });
}

function resolveEffectsWithDeathHooks(params: {
  effects: readonly GameEffect[];
  input: PhaseResolutionInput;
  sourceActionId: string | null;
}): ReturnType<typeof resolveEffects> {
  const initialResolution = resolveEffects(params.effects);
  const initialDeaths = toResolvedDeaths(initialResolution.appliedEffects, params.input.players);

  if (initialDeaths.length === 0) {
    return initialResolution;
  }

  const nextPlayers = applyDeaths(
    params.input.players,
    toEngineDeaths(initialResolution.appliedEffects),
  );
  const deathResolvedContext = createRoleContext({
    ...params.input,
    players: nextPlayers,
  });
  const deathResolvedEffects = collectDeathResolvedEffects({
    context: deathResolvedContext,
    deaths: initialDeaths,
    sourceActionId: params.sourceActionId,
  });

  if (deathResolvedEffects.length === 0) {
    return initialResolution;
  }

  return resolveEffects([...initialResolution.appliedEffects, ...deathResolvedEffects]);
}

function evaluateFinalOutcome(
  players: readonly PlayerRuntimeState[],
  ruleSet: RuleSet,
  resolvedRoleSetup?: ResolvedRoleSetup,
): EngineFinalOutcome | null {
  const context = createRoleContext({
    currentPhase: "night",
    dayNumber: 0,
    nightNumber: 0,
    players,
    resolvedRoleSetup: resolvedRoleSetup ?? makeResolvedRoleSetupForPlayers(ruleSet, players),
    ruleSet,
  });
  const endReasons = [
    ...new Set(
      context.roles
        .getActiveRoles(context.state)
        .flatMap((role) => role.checkEndCondition(context)?.reason ?? []),
    ),
  ];

  if (endReasons.length === 0) {
    return null;
  }

  const winnerTeam = evaluateWinnerTeam({
    ...context,
    endReasons,
  });

  return {
    playerResultsByPlayerId: Object.fromEntries(
      players.map((player) => [
        player.playerId,
        toSharedPlayerResult(
          evaluatePlayerResult({
            ...context,
            endReasons,
            playerId: player.playerId,
            winnerTeam,
          }),
        ),
      ]),
    ),
    reason: formatFinalOutcomeReason(winnerTeam, endReasons),
    winnerTeam: toSharedTeam(winnerTeam),
  };
}

function makeRuleSetForPlayers(players: readonly PlayerRuntimeState[]): RuleSet {
  const roleCounts = Object.fromEntries(getRoleIds().map((roleId) => [roleId, 0])) as Record<
    RoleId,
    number
  >;

  for (const player of players) {
    roleCounts[player.roleId] = (roleCounts[player.roleId] ?? 0) + 1;
  }

  return {
    ...toSharedRuleOptions(DEFAULT_RULE_OPTIONS),
    roleCounts: roleCounts as RuleSet["roleCounts"],
  };
}

export function makeResolvedRoleSetupForPlayers(
  ruleSet: RuleSet,
  players: readonly PlayerRuntimeState[],
): ReturnType<typeof resolveRoleSetup> {
  const registeredRuleSet = toRegisteredRuleSet(ruleSet);
  const roleCounts = { ...registeredRuleSet.roleCounts };

  for (const player of players) {
    roleCounts[player.roleId] = Math.max(roleCounts[player.roleId] ?? 0, 1);
  }

  return resolveRoleSetup({
    ...registeredRuleSet,
    roleCounts,
  });
}

function toResolvedDeaths(
  effects: readonly GameEffect[],
  players: readonly PlayerRuntimeState[],
): ResolvedDeath[] {
  const roleByPlayerId = new Map(players.map((player) => [player.playerId, player.roleId]));

  return effects.flatMap((effect) => {
    if (effect.kind !== GameEffectKind.Death) {
      return [];
    }

    const roleId = roleByPlayerId.get(effect.playerId);

    if (roleId === undefined) {
      return [];
    }

    return [
      {
        playerId: effect.playerId,
        reason: effect.reason,
        roleId,
        sourceActionId: effect.sourceActionId,
      },
    ];
  });
}

function applyDeaths(
  players: readonly PlayerRuntimeState[],
  deaths: readonly EngineDeath[],
): PlayerRuntimeState[] {
  return players.map((player) => ({
    ...player,
    alive: deaths.some((death) => death.playerId === player.playerId) ? false : player.alive,
  }));
}

function toRegisteredRuleSet(ruleSet: RuleSet): RegisteredRuleSet {
  return {
    engineVersion: ENGINE_VERSION,
    options: toRegisteredRuleOptions(ruleSet),
    roleCounts: Object.fromEntries(
      getRoleIds().map((roleId) => [roleId, ruleSet.roleCounts[roleId] ?? 0]),
    ),
    roleRegistryVersion: ROLE_REGISTRY_VERSION,
  };
}

function toSharedTeam(team: RegisteredTeam): Team {
  switch (team) {
    case RegisteredTeam.Fox:
      return "fox";
    case RegisteredTeam.Neutral:
      return "neutral";
    case RegisteredTeam.Village:
      return "villagers";
    case RegisteredTeam.Werewolf:
      return "werewolves";
  }
}

function toRegisteredTeam(team: Team): RegisteredTeam | null {
  switch (team) {
    case "fox":
      return RegisteredTeam.Fox;
    case "neutral":
      return RegisteredTeam.Neutral;
    case "villagers":
      return RegisteredTeam.Village;
    case "werewolves":
      return RegisteredTeam.Werewolf;
    default:
      return null;
  }
}

function toSharedPlayerResult(result: RegisteredPlayerResult): SharedPlayerResult {
  return result;
}

function toSharedInspectionResult(view: InspectionView): "human" | "werewolf" {
  return view === InspectionView.Werewolf ? "werewolf" : "human";
}

function formatFinalOutcomeReason(
  winnerTeam: RegisteredTeam,
  endReasons: readonly GameEndReason[],
): string {
  if (winnerTeam === RegisteredTeam.Fox) {
    return "A fox survived when another team condition resolved.";
  }

  if (endReasons.includes(GameEndReason.WerewolvesEliminated)) {
    return "All werewolves are dead.";
  }

  if (endReasons.includes(GameEndReason.WerewolfDominance)) {
    return "Werewolves reached parity with villagers.";
  }

  return "Game ended.";
}

function resolveNight(input: PhaseResolutionInput): PhaseResolution {
  const roleContext = createRoleContext(input);
  const effects = input.actions.flatMap((action) =>
    collectSubmittedActionEffects(action, roleContext),
  );
  const effectResolution = resolveEffectsWithDeathHooks({
    effects,
    input,
    sourceActionId: "night",
  });
  const deaths = toEngineDeaths(effectResolution.appliedEffects);
  const attack = input.actions.find((action) => action.kind === "attack");
  const attackDeathResolved =
    attack?.targetPlayerId !== null &&
    attack?.targetPlayerId !== undefined &&
    deaths.some((death) => death.playerId === attack.targetPlayerId && death.reason === "attack");
  const events: EngineEvent[] = [
    ...input.actions.flatMap((action) => toActionResolvedEvents(action)),
    ...toPublicNightOutcomeEvents({
      attack,
      attackDeathResolved,
      deaths,
    }),
    ...toEngineEffectEvents(effectResolution.appliedEffects, deaths, []),
  ];

  return openDay(input, deaths, events);
}

function openDay(
  input: PhaseResolutionInput,
  deaths: EngineDeath[],
  events: EngineEvent[] = [],
): PhaseResolution {
  const nextPlayers = input.players.map((player) => ({
    ...player,
    alive: deaths.some((death) => death.playerId === player.playerId) ? false : player.alive,
  }));
  const finalOutcome = evaluateFinalOutcome(nextPlayers, input.ruleSet, input.resolvedRoleSetup);

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
    events: [...events, createPhaseChangedEvent("day")],
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
    events: [],
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
    events: [createPhaseChangedEvent("voting")],
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
      createPhaseChangedEvent("execution"),
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
    dayNumber: input.dayNumber,
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
  const roleAction = input.actions.find(
    (action) => toRegisteredRoleActionKind(action.kind) !== null,
  );

  if (roleAction !== undefined) {
    return resolveExecutionRoleAction(input, roleAction);
  }

  const event = input.actions.find((action) => action.kind === "execution_skip");

  if (event === undefined) {
    return finishExecutionAfterRoleActions(input, [], []);
  }

  const targetPlayerId = event.actorPlayerId;
  const roleContext = createRoleContext(input);
  const effects = [
    ...collectExecutionEffects({
      context: roleContext,
      sourceActionId: event.actionKey ?? null,
      targetId: targetPlayerId,
    }),
    ...collectExecutionResolvedEffects({
      context: roleContext,
      sourceActionId: event.actionKey ?? null,
      targetId: targetPlayerId,
    }),
  ];
  const effectResolution = resolveEffectsWithDeathHooks({
    effects,
    input,
    sourceActionId: event.actionKey ?? null,
  });
  const deaths = toEngineDeaths(effectResolution.appliedEffects);
  const actionsToOpen = toEngineActions(effectResolution.appliedEffects);
  const events: EngineEvent[] = [
    {
      kind: "player_executed",
      message: "The execution was resolved.",
      payload: { targetPlayerId },
      visibility: "public",
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    },
    ...toEngineEffectEvents(effectResolution.appliedEffects, deaths, ["execution"]),
  ];

  if (actionsToOpen.length > 0) {
    return {
      actionsToOpen,
      deaths,
      events,
      finalOutcome: null,
      nextDayNumber: input.dayNumber,
      nextNightNumber: input.nightNumber,
      nextPhase: "execution",
      nextPhaseDurationSeconds: input.ruleSet.executionLastWordsSeconds,
      speechSlotsToCreate: [],
    };
  }

  return finishExecutionAfterRoleActions(input, events, deaths);
}

function resolveExecutionRoleAction(
  input: PhaseResolutionInput,
  action: SubmittedAction,
): PhaseResolution {
  const actionKind = toRegisteredRoleActionKind(action.kind);

  if (actionKind === null) {
    return openNight(input, []);
  }

  const effects = collectRoleActionEffects({
    actionKind,
    actorId: action.actorPlayerId,
    actorRoleId: action.actorRoleId ?? null,
    context: createRoleContext(input),
    sourceActionId: action.actionKey ?? null,
    targetId: action.targetPlayerId,
  });
  const effectResolution = resolveEffectsWithDeathHooks({
    effects,
    input,
    sourceActionId: action.actionKey ?? null,
  });
  const deaths = toEngineDeaths(effectResolution.appliedEffects);
  const events = toEngineEffectEvents(effectResolution.appliedEffects, deaths, []);

  return finishExecutionAfterRoleActions(input, events, deaths);
}

function finishExecutionAfterRoleActions(
  input: PhaseResolutionInput,
  events: EngineEvent[],
  deaths: EngineDeath[],
): PhaseResolution {
  const nextPlayers = input.players.map((player) => ({
    ...player,
    alive: deaths.some((death) => death.playerId === player.playerId) ? false : player.alive,
  }));
  const finalOutcome = evaluateFinalOutcome(nextPlayers, input.ruleSet, input.resolvedRoleSetup);

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

type RoleContextInput = {
  currentPhase: GamePhase;
  dayNumber: number;
  nightNumber: number;
  players: readonly PlayerRuntimeState[];
  previousGuardTargetByPlayerId?: Readonly<Record<string, string>>;
  resolvedRoleSetup: ResolvedRoleSetup;
  ruleSet: RuleSet;
};

function createRoleContext(input: RoleContextInput): RoleContext {
  const roleByPlayerId = new Map(
    input.players.map((player) => [player.playerId, player.roleId as RegisteredRoleId]),
  );
  return {
    roles: roleRegistry,
    state: {
      alivePlayerIds: input.players
        .filter((player) => player.alive)
        .map((player) => player.playerId),
      currentActions: [],
      events: createGuardHistoryEvents(input.previousGuardTargetByPlayerId ?? {}),
      finalOutcome: null,
      nightConversationMessages: [],
      nightNumber: input.nightNumber,
      pendingActions: [],
      phase: toRegisteredPhase(input.currentPhase),
      phaseInstanceId: null,
      resolvedRoleSetup: input.resolvedRoleSetup,
      roleByPlayerId,
      ruleOptions: toRegisteredRuleOptions(input.ruleSet),
      status: RegisteredGameStatus.Playing,
    },
  };
}

function createGuardHistoryEvents(
  previousGuardTargetByPlayerId: Readonly<Record<string, string>>,
): ReadonlyGameState["events"] {
  return Object.entries(previousGuardTargetByPlayerId).map(([guardPlayerId, targetPlayerId]) => ({
    actorPlayerId: guardPlayerId,
    id: `previous-guard:${guardPlayerId}:${targetPlayerId}`,
    kind: RegisteredGameEventKind.ActionResolved,
    payload: {
      actionKind: RegisteredGameActionKind.Guard,
      targetPlayerIds: [targetPlayerId],
    },
    phase: RegisteredGamePhase.Night,
    phaseInstanceId: null,
    targetPlayerIds: [targetPlayerId],
    visibility: RegisteredGameEventVisibility.Internal,
    visibleToPlayerIds: [],
    visibleToRoleIds: [],
  }));
}

function toRegisteredPhase(phase: GamePhase): RegisteredGamePhase {
  switch (phase) {
    case "day":
      return RegisteredGamePhase.Day;
    case "execution":
      return RegisteredGamePhase.Execution;
    case "night":
      return RegisteredGamePhase.Night;
    case "voting":
      return RegisteredGamePhase.Voting;
  }
}

function toRegisteredRoleActionKind(actionKind: ActionKind): RegisteredGameActionKind | null {
  switch (actionKind) {
    case "attack":
      return RegisteredGameActionKind.Attack;
    case "guard":
      return RegisteredGameActionKind.Guard;
    case "hunter_retaliate":
      return RegisteredGameActionKind.HunterRetaliate;
    case "inspect":
      return RegisteredGameActionKind.Inspect;
    default:
      return null;
  }
}

function toEngineDeaths(effects: readonly GameEffect[]): EngineDeath[] {
  return effects.flatMap((effect) =>
    effect.kind === GameEffectKind.Death
      ? [
          {
            playerId: effect.playerId,
            reason: toSharedDeathReason(effect.reason),
          },
        ]
      : [],
  );
}

function toEngineActions(effects: readonly GameEffect[]): EngineAction[] {
  return effects.flatMap((effect) => {
    if (effect.kind !== GameEffectKind.CurrentAction) {
      return [];
    }

    const kind = toSharedActionKind(effect.actionKind);
    const targetKind = toSharedTargetKind(effect.target);

    if (
      kind === null ||
      targetKind === null ||
      (targetKind !== "none" && effect.eligibleTargetPlayerIds.length === 0)
    ) {
      return [];
    }

    return [
      {
        actorPlayerId: effect.actorPlayerId,
        actorRoleId: effect.actorRoleId,
        eligibleTargetPlayerIds: [...effect.eligibleTargetPlayerIds],
        key: effect.actionKey,
        kind,
        targetKind,
      },
    ];
  });
}

function toEngineEffectEvents(
  effects: readonly GameEffect[],
  deaths: readonly EngineDeath[],
  excludedDeathReasons: readonly DeathReason[],
): EngineEvent[] {
  return [
    ...effects.flatMap((effect): EngineEvent[] => {
      switch (effect.kind) {
        case GameEffectKind.InspectionResult:
          return [
            {
              kind: "inspection_result",
              message: null,
              payload: {
                result: toSharedInspectionResult(effect.view),
                targetPlayerId: effect.targetId,
              },
              visibility: "private",
              visibleToPlayerIds: [effect.viewerId],
              visibleToRoleIds: [],
            },
          ];
        case GameEffectKind.PrivateMessage:
          return [
            {
              kind: effect.messageKey,
              message: null,
              payload: { ...effect.payload },
              visibility: "private",
              visibleToPlayerIds: [effect.playerId],
              visibleToRoleIds: [],
            },
          ];
        case GameEffectKind.PublicMessage:
          return [
            {
              kind: effect.messageKey,
              message: null,
              payload: {},
              visibility: "public",
              visibleToPlayerIds: [],
              visibleToRoleIds: [],
            },
          ];
        default:
          return [];
      }
    }),
    ...toPublicDeathEvents(deaths, excludedDeathReasons),
  ];
}

function toActionResolvedEvents(action: SubmittedAction): EngineEvent[] {
  if (action.targetPlayerId === null) {
    return [];
  }

  const actionResolvedEvent: EngineEvent = {
    kind: "action_resolved",
    message: null,
    payload: {
      actionKind: action.kind,
      actorPlayerId: action.actorPlayerId,
      targetPlayerIds: [action.targetPlayerId],
    },
    visibility: "internal",
    visibleToPlayerIds: [],
    visibleToRoleIds: [],
  };

  return [actionResolvedEvent];
}

function toPublicNightOutcomeEvents(params: {
  attack: SubmittedAction | undefined;
  attackDeathResolved: boolean;
  deaths: readonly EngineDeath[];
}): EngineEvent[] {
  if (params.attack?.targetPlayerId !== null && params.attack?.targetPlayerId !== undefined) {
    return params.attackDeathResolved
      ? []
      : [
          {
            kind: "attack_guarded",
            message: "Someone was attacked, but no one died.",
            payload: {},
            visibility: "public",
            visibleToPlayerIds: [],
            visibleToRoleIds: [],
          },
        ];
  }

  if (params.deaths.length > 0) {
    return [];
  }

  return [
    {
      kind: "peaceful_night",
      message: "The night ended with no death.",
      payload: {},
      visibility: "public",
      visibleToPlayerIds: [],
      visibleToRoleIds: [],
    },
  ];
}

function toPublicDeathEvents(
  deaths: readonly EngineDeath[],
  excludedReasons: readonly DeathReason[],
): EngineEvent[] {
  return deaths.flatMap((death) =>
    excludedReasons.includes(death.reason)
      ? []
      : [
          {
            kind: "player_died",
            message: "A player died.",
            payload: {
              reason: death.reason,
              targetPlayerId: death.playerId,
            },
            visibility: "public",
            visibleToPlayerIds: [],
            visibleToRoleIds: [],
          },
        ],
  );
}

function toSharedActionKind(actionKind: RegisteredGameActionKind): ActionKind | null {
  switch (actionKind) {
    case RegisteredGameActionKind.Attack:
      return "attack";
    case RegisteredGameActionKind.EndSpeech:
      return "end_speech";
    case RegisteredGameActionKind.Guard:
      return "guard";
    case RegisteredGameActionKind.HunterRetaliate:
      return "hunter_retaliate";
    case RegisteredGameActionKind.Inspect:
      return "inspect";
    case RegisteredGameActionKind.Vote:
      return "vote";
    default:
      return null;
  }
}

function toSharedTargetKind(
  targetKind: RegisteredRoleTargetKind,
): EngineAction["targetKind"] | null {
  switch (targetKind) {
    case RegisteredRoleTargetKind.None:
      return "none";
    case RegisteredRoleTargetKind.SinglePlayer:
      return "single_player";
    default:
      return null;
  }
}

function toSharedDeathReason(reason: RegisteredDeathReason): DeathReason {
  switch (reason) {
    case RegisteredDeathReason.Attack:
      return "attack";
    case RegisteredDeathReason.Execution:
      return "execution";
    case RegisteredDeathReason.Retaliation:
      return "retaliation";
    case RegisteredDeathReason.RuleEffect:
      return "rule_effect";
  }
}

function openNight(
  input: PhaseResolutionInput,
  events: EngineEvent[],
  deaths: EngineDeath[] = [],
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
      input.resolvedRoleSetup,
    ),
    deaths,
    events: [...events, createPhaseChangedEvent("night")],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber,
    nextPhase: "night",
    nextPhaseDurationSeconds: input.ruleSet.nightSeconds,
    speechSlotsToCreate: [],
  };
}

function createPhaseChangedEvent(phase: GamePhase): EngineEvent {
  return {
    kind: "phase_changed",
    message: "The game phase changed.",
    payload: { phase },
    visibility: "public",
    visibleToPlayerIds: [],
    visibleToRoleIds: [],
  };
}

export function describeRole(roleId: RoleId | null): string {
  if (roleId === null) {
    return "Unknown";
  }

  try {
    return roleRegistry.get(roleId).name;
  } catch {
    return roleId;
  }
}
