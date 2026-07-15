import { randomInt } from "node:crypto";

import {
  isActionKey,
  isActionKind,
  isEventKind,
  isRoleId,
  type ActionKind,
  type DeathReason,
  type GamePhase,
  type PlayerResult as SharedPlayerResult,
  type RoleId,
  type RuleSet,
  type RuleSetInput,
  type Team,
} from "@/lib/shared/game";

import { CoreActionKind, getCoreActionDefinition } from "./game/coreActions";
import {
  assertRoleOwnsEffects,
  collectDeathResolvedEffects,
  collectExecutionEffects,
  collectExecutionResolvedEffects,
  collectRoleActionEffects,
  expandRoleInteractionEffects,
  resolveEffects,
} from "./game/effects";
import {
  evaluatePlayerResult,
  evaluateWinnerTeam,
  getRoleCatalog,
  getRoleIds,
  makeDefaultRoleCounts,
  roleRegistry,
  scopeRoleContext,
  type RoleRegistry,
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
  ActionScope as RegisteredActionScope,
  ActionActorStateRequirement,
  ActionTargetStateRequirement,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  GamePhase as RegisteredGamePhase,
  GameStatus as RegisteredGameStatus,
  InspectionView,
  RoleTargetKind as RegisteredRoleTargetKind,
  type GameEffect,
  type CurrentAction as RegisteredCurrentAction,
  type PendingAction as RegisteredPendingAction,
  type PlayerResult as RegisteredPlayerResult,
  type ReadonlyGameState,
  type ResolvedRoleSetup,
  type ResolvedDeath,
  type RoleId as RegisteredRoleId,
} from "./game/types";

export const ENGINE_VERSION = "jinroh-game-engine-v1";
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
  actorStateRequirement: ActionActorStateRequirement;
  kind: ActionKind;
  key: string;
  resolverRoleId: RoleId | null;
  targetKind: "none" | "single_player";
  targetStateRequirement: ActionTargetStateRequirement;
  eligibleTargetPlayerIds: string[];
};

type CoreEngineActionInput = Omit<
  EngineAction,
  "resolverRoleId" | "targetKind" | "targetStateRequirement"
> & {
  kind: CoreActionKind;
};

function createCoreEngineAction(input: CoreEngineActionInput): EngineAction {
  const definition = getCoreActionDefinition(input.kind);

  return {
    ...input,
    kind: definition.kind,
    resolverRoleId: null,
    targetKind: definition.targetKind,
    targetStateRequirement: definition.targetStateRequirement,
  };
}

export type EngineEvent = {
  kind: string;
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
  currentActions?: readonly PhaseCurrentAction[];
  currentPhase: GamePhase;
  dayNumber: number;
  gameId: string;
  nightNumber: number;
  orderedSpeechSlots?: readonly OrderedSpeechSlot[];
  players: PlayerRuntimeState[];
  resolvedActionHistory?: readonly ResolvedActionHistoryEntry[];
  resolvedRoleSetup: ResolvedRoleSetup;
  roles?: RoleRegistry;
  ruleSet: RuleSet;
};

export type PhaseCurrentAction = EngineAction & {
  closesAt: string | null;
  id: string;
  openedAt: string;
};

type SubmittedActionBase = {
  actorPlayerId: string;
  actorRoleId?: RoleId | null;
  kind: ActionKind;
  targetPlayerId: string | null;
};

export type SubmittedAction =
  | (SubmittedActionBase & {
      actionKey?: string;
      currentActionId?: string;
      resolverRoleId: null;
      submittedAt?: string;
    })
  | (SubmittedActionBase & {
      actionKey: string;
      currentActionId: string;
      resolverRoleId: RoleId;
      submittedAt: string;
    });

export type ResolvedActionHistoryEntry = {
  actionKey: string;
  actionKind: ActionKind;
  actorPlayerId: string | null;
  actorRoleId: RoleId | null;
  dayNumber: number;
  eventId: string;
  nightNumber: number;
  phase: GamePhase;
  phaseInstanceId: string;
  resolutionStatus: "missing" | "submitted";
  resolverRoleId: RoleId | null;
  targetPlayerIds: readonly string[];
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
  gameId: string;
  nextDayNumber: number;
  nextNightNumber: number;
  nextPhase: GamePhase | null;
  nextPhaseDurationSeconds: number | null;
  speechSlotsToCreate: OrderedSpeechSlot[];
};

type PhaseResolutionDraft = Omit<PhaseResolution, "gameId">;

export type EngineFinalOutcome = {
  playerResultsByPlayerId: Record<string, SharedPlayerResult>;
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
  const actions = materializeEngineActions(
    [
      ...players.map((player) =>
        createCoreEngineAction({
          actorPlayerId: player.id,
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          eligibleTargetPlayerIds: [],
          key: `first-night-ready:${player.id}`,
          kind: CoreActionKind.FirstNightReady,
        }),
      ),
      ...getAvailableNightActions(runtimePlayers, 1, ruleSet, resolvedRoleSetup),
    ],
    runtimePlayers,
    resolvedRoleSetup,
    roleRegistry,
  );

  const initialEvents: EngineEvent[] = [
    {
      kind: "game_started",
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
  const resolution = resolvePhaseWithoutActionHistory(input);
  const nextPlayers = applyDeaths(input.players, resolution.deaths);
  const actionsToOpen = materializeEngineActions(
    resolution.actionsToOpen,
    nextPlayers,
    input.resolvedRoleSetup,
    input.roles ?? roleRegistry,
  );

  if (resolution.nextPhase === input.currentPhase && actionsToOpen.length === 0) {
    throw new Error("A same-phase continuation must open at least one action.");
  }

  return {
    ...resolution,
    actionsToOpen,
    gameId: input.gameId,
  };
}

function resolvePhaseWithoutActionHistory(input: PhaseResolutionInput): PhaseResolutionDraft {
  if (input.currentPhase === "night" && input.nightNumber === 1) {
    return resolveFirstNight(input);
  }

  if (input.currentPhase === "night") {
    return resolveNight(input);
  }

  if (input.currentPhase === "day" && input.ruleSet.dayMode === "ordered_speech") {
    return resolveOrderedSpeechDay(input);
  }

  if (input.currentPhase === "day") {
    return resolveReadyCheckDay(input);
  }

  if (input.currentPhase === "voting") {
    return resolveVoting(input);
  }

  return resolveExecution(input);
}

function materializeEngineActions(
  actions: readonly EngineAction[],
  players: readonly PlayerRuntimeState[],
  resolvedRoleSetup: ResolvedRoleSetup,
  roles: RoleRegistry,
): EngineAction[] {
  const activeRoleIds = new Set(resolvedRoleSetup.activeRoleIds);
  const actionKeys = new Set<string>();
  const playerById = new Map(players.map((player) => [player.playerId, player]));

  return actions.flatMap((action) => {
    const declaredTargetPlayerIds = new Set(action.eligibleTargetPlayerIds);

    if (
      !isActionKey(action.key) ||
      actionKeys.has(action.key) ||
      !isActionKind(action.kind) ||
      (action.resolverRoleId !== null &&
        (!isRoleId(action.resolverRoleId) || !activeRoleIds.has(action.resolverRoleId))) ||
      (action.actorRoleId !== null && !isRoleId(action.actorRoleId)) ||
      (action.actorPlayerId === null && action.actorRoleId === null) ||
      !isActionActorStateRequirement(action.actorStateRequirement) ||
      !isActionTargetStateRequirement(action.targetStateRequirement) ||
      declaredTargetPlayerIds.size !== action.eligibleTargetPlayerIds.length ||
      action.eligibleTargetPlayerIds.some((playerId) => !playerById.has(playerId)) ||
      !isEngineActionTargetKind(action.targetKind) ||
      (action.targetKind === "none" && declaredTargetPlayerIds.size !== 0) ||
      (action.targetKind === "single_player" && declaredTargetPlayerIds.size === 0)
    ) {
      throw new Error(`Invalid engine action contract: ${action.key}`);
    }

    actionKeys.add(action.key);

    if (action.resolverRoleId === null) {
      const definition = getCoreActionDefinition(action.kind);

      if (
        definition.targetKind !== action.targetKind ||
        definition.targetStateRequirement !== action.targetStateRequirement
      ) {
        throw new Error(`Core action does not match its definition: ${action.key}`);
      }
    } else {
      const definition = roles.get(action.resolverRoleId).getActionDefinition(action.kind);
      const definitionTargetKind = toSharedTargetKind(definition.target);

      if (
        definitionTargetKind !== action.targetKind ||
        definition.targetStateRequirement !== action.targetStateRequirement
      ) {
        throw new Error(`Role action does not match its definition: ${action.key}`);
      }
    }

    if (action.actorRoleId !== null) {
      roles.get(action.actorRoleId);
    }

    const eligibleTargetPlayerIds = action.eligibleTargetPlayerIds.filter((playerId) => {
      const target = playerById.get(playerId);

      return (
        target !== undefined &&
        (action.targetStateRequirement === ActionTargetStateRequirement.Assigned || target.alive)
      );
    });

    if (action.targetKind === "single_player" && eligibleTargetPlayerIds.length === 0) {
      return [];
    }

    const materializedAction = { ...action, eligibleTargetPlayerIds };

    if (action.actorPlayerId !== null) {
      const actor = playerById.get(action.actorPlayerId);

      if (
        actor === undefined ||
        (action.actorRoleId !== null && actor.roleId !== action.actorRoleId)
      ) {
        throw new Error(`Invalid engine action actor: ${action.key}`);
      }

      return action.actorStateRequirement === ActionActorStateRequirement.Alive && !actor.alive
        ? []
        : [materializedAction];
    }

    const hasEligibleRoleActor = players.some(
      (player) =>
        player.roleId === action.actorRoleId &&
        (action.actorStateRequirement === ActionActorStateRequirement.Assigned || player.alive),
    );

    return hasEligibleRoleActor ? [materializedAction] : [];
  });
}

export function getAvailableNightActions(
  players: readonly PlayerRuntimeState[],
  nightNumber: number,
  ruleSet: RuleSet = normalizeEngineRuleSet(null, players.length),
  resolvedRoleSetup?: ResolvedRoleSetup,
  resolvedActionHistory: readonly ResolvedActionHistoryEntry[] = [],
  roles: RoleRegistry = roleRegistry,
): EngineAction[] {
  if (nightNumber < 1) {
    return [];
  }

  return getAvailableRoleActions({
    dayNumber: Math.max(0, nightNumber - 1),
    nightNumber,
    phase: "night",
    players,
    resolvedActionHistory,
    resolvedRoleSetup: resolvedRoleSetup ?? makeResolvedRoleSetupForPlayers(ruleSet, players),
    roles,
    ruleSet,
  });
}

type AvailableRoleActionsInput = {
  dayNumber: number;
  nightNumber: number;
  phase: GamePhase;
  players: readonly PlayerRuntimeState[];
  resolvedActionHistory: readonly ResolvedActionHistoryEntry[];
  resolvedRoleSetup: ResolvedRoleSetup;
  roles: RoleRegistry;
  ruleSet: RuleSet;
};

function getAvailableRoleActions(input: AvailableRoleActionsInput): EngineAction[] {
  const roleContext = createRoleContext({
    currentPhase: input.phase,
    dayNumber: input.dayNumber,
    nightNumber: input.nightNumber,
    players: input.players,
    resolvedActionHistory: input.resolvedActionHistory,
    resolvedRoleSetup: input.resolvedRoleSetup,
    roles: input.roles,
    ruleSet: input.ruleSet,
  });
  const openedRoleGroupActionKeys = new Set<string>();
  const playerIds = new Set(input.players.map((player) => player.playerId));
  const actions: EngineAction[] = [];

  for (const player of input.players) {
    if (!player.alive) {
      continue;
    }

    const role = input.roles.get(player.roleId);
    const ownedRoleContext = scopeRoleContext(roleContext, role.id);
    const playerRoleContext = {
      ...ownedRoleContext,
      playerId: player.playerId,
    };

    for (const [actionIndex, roleAction] of role.getActions(playerRoleContext).entries()) {
      const kind = roleAction.kind;

      if (!isActionKind(kind)) {
        throw new Error(`Role ${role.id} returned an invalid action kind.`);
      }

      const definition = role.getActionDefinition(kind);
      const targetKind = toSharedTargetKind(definition.target);

      if (targetKind === null) {
        throw new Error(`Role ${role.id} returned an unsupported action target kind.`);
      }

      if (
        roleAction.target !== definition.target ||
        roleAction.targetStateRequirement !== definition.targetStateRequirement
      ) {
        throw new Error(`Role ${role.id} returned an action that differs from its definition.`);
      }

      const ownerRoleId = roleAction.roleGroupRoleId;

      if (
        ownerRoleId !== null &&
        !input.players.some((candidate) => candidate.alive && candidate.roleId === ownerRoleId)
      ) {
        input.roles.get(ownerRoleId);
        continue;
      }

      const actionKey = createDeclaredRoleActionKey({
        actionIndex,
        dayNumber: input.dayNumber,
        nightNumber: input.nightNumber,
        phase: input.phase,
        resolverRoleId: role.id,
        scopeIdentity:
          ownerRoleId === null
            ? `p:${player.playerId}`
            : `g:${getRoleRegistryIndex(input.roles, ownerRoleId).toString(36)}`,
      });

      if (!isActionKey(actionKey)) {
        throw new Error(`Role ${role.id} generated an invalid action key.`);
      }

      if (ownerRoleId !== null && openedRoleGroupActionKeys.has(actionKey)) {
        continue;
      }

      const eligibleTargetPlayerIds = role.getEligibleTargets(roleAction, playerRoleContext);
      const eligibleTargetIds = new Set(eligibleTargetPlayerIds);

      if (
        !isActionTargetStateRequirement(roleAction.targetStateRequirement) ||
        eligibleTargetIds.size !== eligibleTargetPlayerIds.length ||
        eligibleTargetPlayerIds.some((playerId) => !playerIds.has(playerId)) ||
        (definition.target === RegisteredRoleTargetKind.None && eligibleTargetIds.size !== 0)
      ) {
        throw new Error(`Role ${role.id} returned invalid eligible targets.`);
      }

      if (
        definition.target !== RegisteredRoleTargetKind.None &&
        eligibleTargetPlayerIds.length === 0
      ) {
        continue;
      }

      actions.push({
        actorPlayerId: ownerRoleId === null ? player.playerId : null,
        actorRoleId: ownerRoleId,
        actorStateRequirement: ActionActorStateRequirement.Alive,
        eligibleTargetPlayerIds: [...eligibleTargetPlayerIds],
        key: actionKey,
        kind,
        resolverRoleId: role.id,
        targetKind,
        targetStateRequirement: definition.targetStateRequirement,
      });
      openedRoleGroupActionKeys.add(actionKey);
    }
  }

  return actions;
}

function createDeclaredRoleActionKey(input: {
  actionIndex: number;
  dayNumber: number;
  nightNumber: number;
  phase: GamePhase;
  resolverRoleId: RoleId;
  scopeIdentity: string;
}): string {
  return `role:${input.resolverRoleId}:${input.phase}:${input.dayNumber.toString(36)}:${input.nightNumber.toString(36)}:${input.actionIndex.toString(36)}:${input.scopeIdentity}`;
}

function getRoleRegistryIndex(roles: RoleRegistry, roleId: RoleId): number {
  const role = roles.get(roleId);
  const roleIndex = roles.getAll().indexOf(role);

  if (roleIndex < 0) {
    throw new Error(`Role is not registered: ${roleId}`);
  }

  return roleIndex;
}

export function evaluateWinner(
  players: readonly PlayerRuntimeState[],
): { winnerTeam: Team } | null {
  const ruleSet = makeRuleSetForPlayers(players);
  const finalOutcome = evaluateFinalOutcome(
    players,
    createRoleContext({
      currentPhase: "night",
      dayNumber: 0,
      nightNumber: 0,
      players,
      resolvedRoleSetup: makeResolvedRoleSetupForPlayers(ruleSet, players),
      ruleSet,
    }),
  );

  return finalOutcome === null
    ? null
    : {
        winnerTeam: finalOutcome.winnerTeam,
      };
}

export function makeDefaultRuleSetForPlayers(playerCount: number): RuleSet {
  return makeDefaultEngineRuleSet(playerCount);
}

function assignRoles(players: readonly EnginePlayer[], ruleSet: RuleSet): RoleAssignment[] {
  const roleDeck = getRoleIds().flatMap((roleId) =>
    Array.from({ length: ruleSet.roleCounts[roleId] ?? 0 }, () => roleId),
  );
  const shuffledRoleDeck = secureShuffleRoleDeck(roleDeck);
  const canonicalPlayers = players.toSorted((left, right) => compareIds(left.id, right.id));

  return canonicalPlayers.map((player, index) => {
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

function secureShuffleRoleDeck(roleDeck: readonly RoleId[]): RoleId[] {
  const shuffledRoleDeck = [...roleDeck];

  for (let currentIndex = shuffledRoleDeck.length - 1; currentIndex > 0; currentIndex -= 1) {
    const swapIndex = randomInt(currentIndex + 1);
    const currentRoleId = shuffledRoleDeck[currentIndex];
    const swapRoleId = shuffledRoleDeck[swapIndex];

    if (currentRoleId === undefined || swapRoleId === undefined) {
      throw new Error("Role deck does not match player count.");
    }

    shuffledRoleDeck[currentIndex] = swapRoleId;
    shuffledRoleDeck[swapIndex] = currentRoleId;
  }

  return shuffledRoleDeck;
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
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
    nightSeconds: ruleSetInput.nightSeconds,
    normalDaySpeechRounds: ruleSetInput.normalDaySpeechRounds,
    roleOptions: normalizeEngineRoleOptions(ruleSetInput.roleOptions),
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

function normalizeEngineRoleOptions(input: RuleSet["roleOptions"]): RuleSet["roleOptions"] {
  return Object.fromEntries(
    getRoleCatalog().flatMap((role) =>
      role.specificOptions.length === 0
        ? []
        : [
            [
              role.id,
              Object.fromEntries(
                role.specificOptions.map((option) => [
                  option.key,
                  input[role.id]?.[option.key] ?? option.defaultValue,
                ]),
              ),
            ],
          ],
    ),
  );
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
    const role = roleRegistry.get(assignment.roleId);

    return assertRoleOwnsEffects(
      role.id,
      role.onFirstNightStarted({
        ...scopeRoleContext(context, role.id),
        playerId: assignment.playerId,
      }),
    );
  });
  assertGameEffectContracts(effects, context);
  assertFirstNightStartedEffects(effects);
  const effectResolution = resolveEffects(effects);

  return toEngineEffectEvents(effectResolution.appliedEffects, [], []);
}

function assertFirstNightStartedEffects(effects: readonly GameEffect[]): void {
  for (const effect of effects) {
    if (
      effect.kind !== GameEffectKind.InspectionResult &&
      effect.kind !== GameEffectKind.PrivateMessage &&
      effect.kind !== GameEffectKind.PublicMessage
    ) {
      throw new Error(`Unsupported first-night-started effect: ${effect.id}`);
    }
  }
}

function collectSubmittedActionEffects(
  action: SubmittedAction,
  context: RoleContext,
): readonly GameEffect[] {
  if (action.resolverRoleId === null) {
    return [];
  }

  return collectRoleActionEffects({
    actionKind: action.kind,
    actorId: action.actorPlayerId,
    context,
    resolverRoleId: action.resolverRoleId,
    sourceActionId: action.actionKey,
    targetId: action.targetPlayerId,
  });
}

function collectMissingActionEffects(
  input: PhaseResolutionInput,
  context: RoleContext,
): readonly GameEffect[] {
  const submittedActionIds = new Set(
    input.actions.flatMap((action) =>
      action.currentActionId === undefined ? [] : [action.currentActionId],
    ),
  );
  const submittedActionKeys = new Set(
    input.actions.flatMap((action) => (action.actionKey === undefined ? [] : [action.actionKey])),
  );
  const registeredActionById = new Map(
    context.state.currentActions.map((action) => [action.id, action]),
  );

  return (input.currentActions ?? []).flatMap((action) => {
    if (
      action.resolverRoleId === null ||
      submittedActionIds.has(action.id) ||
      submittedActionKeys.has(action.key)
    ) {
      return [];
    }

    const currentAction = registeredActionById.get(action.id);
    if (currentAction === undefined) {
      throw new Error(`Missing role action owner for action: ${action.key}`);
    }

    const resolverRole = context.roles.get(action.resolverRoleId);

    return assertRoleOwnsEffects(
      resolverRole.id,
      resolverRole.onMissingAction(currentAction, scopeRoleContext(context, resolverRole.id)),
    ).map((effect) => ({ ...effect, sourceActionId: action.key }));
  });
}

type ActionWindowEffectResolution = {
  actionsToOpen: EngineAction[];
  deaths: EngineDeath[];
  effectResolution: ReturnType<typeof resolveEffects>;
  events: EngineEvent[];
};

function resolveActionWindowEffects(params: {
  collectCoreEffects?: (context: RoleContext) => readonly GameEffect[];
  excludedDeathReasons?: readonly DeathReason[];
  input: PhaseResolutionInput;
  sourceActionId: string;
}): ActionWindowEffectResolution {
  const context = createRoleContext(params.input);
  const effects = [
    ...(params.collectCoreEffects?.(context) ?? []),
    ...params.input.actions.flatMap((action) => collectSubmittedActionEffects(action, context)),
    ...collectMissingActionEffects(params.input, context),
  ];
  const effectResolution = resolveEffectsWithDeathHooks({
    effects,
    input: params.input,
    sourceActionId: params.sourceActionId,
  });
  const deaths = toEngineDeaths(effectResolution.appliedEffects);
  const nextPlayers = applyDeaths(params.input.players, deaths);

  return {
    actionsToOpen: materializeEngineActions(
      toEngineActions(effectResolution.appliedEffects),
      nextPlayers,
      params.input.resolvedRoleSetup,
      params.input.roles ?? roleRegistry,
    ),
    deaths,
    effectResolution,
    events: toEngineEffectEvents(
      effectResolution.appliedEffects,
      deaths,
      params.excludedDeathReasons ?? [],
    ),
  };
}

function resolveEffectsWithDeathHooks(params: {
  effects: readonly GameEffect[];
  input: PhaseResolutionInput;
  sourceActionId: string | null;
}): ReturnType<typeof resolveEffects> {
  const appliedEffects: GameEffect[] = [];
  const deathEffectsByPlayerId = new Map<string, GameEffect>();
  const preventedEffects: ReturnType<typeof resolveEffects>["preventedEffects"][number][] = [];
  const protectionEffects: GameEffect[] = [];
  const validatedEffects: GameEffect[] = [];
  let players = [...params.input.players];
  let effectsToResolve = [...params.effects];

  while (effectsToResolve.length > 0) {
    const context = createRoleContext({ ...params.input, players });
    const expandedEffects = expandRoleInteractionEffects(effectsToResolve, context);

    assertGameEffectContracts([...validatedEffects, ...expandedEffects], context);
    validatedEffects.push(...expandedEffects);

    const currentEffectIds = new Set(expandedEffects.map((effect) => effect.id));
    const resolution = resolveEffects([...protectionEffects, ...expandedEffects]);
    const newlyAppliedEffects = resolution.appliedEffects.filter(
      (effect) =>
        currentEffectIds.has(effect.id) &&
        (effect.kind !== GameEffectKind.Death || !deathEffectsByPlayerId.has(effect.playerId)),
    );

    appliedEffects.push(...newlyAppliedEffects);
    preventedEffects.push(...resolution.preventedEffects);
    protectionEffects.push(
      ...newlyAppliedEffects.filter((effect) => effect.kind === GameEffectKind.Protection),
    );

    for (const effect of newlyAppliedEffects) {
      if (effect.kind === GameEffectKind.Death) {
        deathEffectsByPlayerId.set(effect.playerId, effect);
      }
    }

    const deaths = toResolvedDeaths(newlyAppliedEffects, players);

    if (deaths.length === 0) {
      break;
    }

    players = applyDeaths(players, toEngineDeaths(newlyAppliedEffects));
    effectsToResolve = [
      ...collectDeathResolvedEffects({
        context: createRoleContext({ ...params.input, players }),
        deaths,
        sourceActionId: params.sourceActionId,
      }),
    ];
  }

  return {
    appliedEffects,
    deathEffectsByPlayerId,
    preventedEffects,
  };
}

function assertGameEffectContracts(effects: readonly GameEffect[], context: RoleContext): void {
  const activeRoleIds = new Set(context.state.resolvedRoleSetup.activeRoleIds);
  const actionKeys = new Set<string>();
  const playerIds = new Set(context.state.roleByPlayerId.keys());
  const effectIds = new Set<string>();

  for (const effect of effects) {
    const tags = new Set(effect.tags);

    if (
      !isRoleId(effect.emitterRoleId) ||
      !activeRoleIds.has(effect.emitterRoleId) ||
      !isActionKey(effect.id) ||
      effectIds.has(effect.id) ||
      !isGameEffectKind(effect.kind) ||
      !Number.isSafeInteger(effect.priority) ||
      (effect.sourceActionId !== null && !isActionKey(effect.sourceActionId)) ||
      tags.size !== effect.tags.length ||
      effect.tags.some((tag) => !isActionKind(tag))
    ) {
      throw new Error(`Invalid effect contract: ${effect.id}`);
    }

    context.roles.get(effect.emitterRoleId);
    effectIds.add(effect.id);

    switch (effect.kind) {
      case GameEffectKind.Attack:
        if (
          effect.layer !== GameEffectLayer.Action ||
          effect.attackerIds.length === 0 ||
          new Set(effect.attackerIds).size !== effect.attackerIds.length ||
          effect.attackerIds.some((playerId) => !playerIds.has(playerId)) ||
          !playerIds.has(effect.targetId)
        ) {
          throw new Error(`Invalid attack effect: ${effect.id}`);
        }
        break;
      case GameEffectKind.CurrentAction: {
        const actorRoleIsValid =
          effect.actorRoleId === null ||
          (isRoleId(effect.actorRoleId) && activeRoleIds.has(effect.actorRoleId));
        const targetIds = new Set(effect.eligibleTargetPlayerIds);

        if (
          !isActionKey(effect.actionKey) ||
          actionKeys.has(effect.actionKey) ||
          !isActionKind(effect.actionKind) ||
          effect.layer !== GameEffectLayer.Action ||
          !isRoleId(effect.resolverRoleId) ||
          !activeRoleIds.has(effect.resolverRoleId) ||
          (effect.actorPlayerId === null && effect.actorRoleId === null) ||
          (effect.actorPlayerId !== null && !playerIds.has(effect.actorPlayerId)) ||
          (effect.actorPlayerId !== null &&
            effect.actorRoleId !== null &&
            context.state.roleByPlayerId.get(effect.actorPlayerId) !== effect.actorRoleId) ||
          !isActionActorStateRequirement(effect.actorStateRequirement) ||
          !isActionTargetStateRequirement(effect.targetStateRequirement) ||
          !actorRoleIsValid ||
          targetIds.size !== effect.eligibleTargetPlayerIds.length ||
          effect.eligibleTargetPlayerIds.some((playerId) => !playerIds.has(playerId)) ||
          (effect.target === RegisteredRoleTargetKind.None && targetIds.size !== 0) ||
          (effect.target === RegisteredRoleTargetKind.SinglePlayer && targetIds.size === 0)
        ) {
          throw new Error(`Invalid current action effect: ${effect.id}`);
        }

        const definition = context.roles
          .get(effect.resolverRoleId)
          .getActionDefinition(effect.actionKind);

        if (
          definition.target !== effect.target ||
          definition.targetStateRequirement !== effect.targetStateRequirement
        ) {
          throw new Error(`Current action effect differs from its definition: ${effect.id}`);
        }

        actionKeys.add(effect.actionKey);
        break;
      }
      case GameEffectKind.Death:
        if (
          effect.layer !== GameEffectLayer.Death ||
          !isActionKind(effect.reason) ||
          !playerIds.has(effect.playerId)
        ) {
          throw new Error(`Invalid death effect: ${effect.id}`);
        }
        break;
      case GameEffectKind.Protection:
        if (
          effect.layer !== GameEffectLayer.Prevention ||
          !isActionKind(effect.reason) ||
          effect.prevents.length === 0 ||
          new Set(effect.prevents).size !== effect.prevents.length ||
          effect.prevents.some((tag) => !isActionKind(tag)) ||
          !playerIds.has(effect.playerId)
        ) {
          throw new Error(`Invalid protection effect: ${effect.id}`);
        }
        break;
      case GameEffectKind.Inspection:
        if (
          effect.layer !== GameEffectLayer.Action ||
          !playerIds.has(effect.targetId) ||
          !playerIds.has(effect.viewerId)
        ) {
          throw new Error(`Invalid inspection effect: ${effect.id}`);
        }
        break;
      case GameEffectKind.InspectionResult:
        if (
          effect.layer !== GameEffectLayer.Information ||
          !Object.values(InspectionView).includes(effect.view) ||
          !playerIds.has(effect.targetId) ||
          !playerIds.has(effect.viewerId)
        ) {
          throw new Error(`Invalid inspection effect: ${effect.id}`);
        }
        break;
      case GameEffectKind.PrivateMessage:
        if (
          (effect.layer !== GameEffectLayer.Information &&
            effect.layer !== GameEffectLayer.Message) ||
          !isEventKind(effect.eventKind) ||
          !playerIds.has(effect.playerId)
        ) {
          throw new Error(`Invalid private message effect: ${effect.id}`);
        }
        break;
      case GameEffectKind.PublicMessage:
        if (
          (effect.layer !== GameEffectLayer.Information &&
            effect.layer !== GameEffectLayer.Message) ||
          !isEventKind(effect.eventKind)
        ) {
          throw new Error(`Invalid public message effect: ${effect.id}`);
        }
        break;
    }
  }
}

function evaluateFinalOutcome(
  players: readonly PlayerRuntimeState[],
  context: RoleContext,
): EngineFinalOutcome | null {
  const endCandidates = context.roles.getActiveRoles(context.state).flatMap((role) => {
    const candidate = role.checkEndCondition(scopeRoleContext(context, role.id));

    if (candidate === null) {
      return [];
    }

    if (candidate.sourceRoleId !== role.id) {
      throw new Error(
        `Role ${role.id} returned an end candidate owned by ${candidate.sourceRoleId}.`,
      );
    }

    return [candidate];
  });

  if (endCandidates.length === 0) {
    return null;
  }

  const winnerTeam = evaluateWinnerTeam({
    ...context,
    endCandidates,
  });

  return {
    playerResultsByPlayerId: Object.fromEntries(
      players.map((player) => [
        player.playerId,
        toSharedPlayerResult(
          evaluatePlayerResult({
            ...context,
            endCandidates,
            playerId: player.playerId,
            winnerTeam,
          }),
        ),
      ]),
    ),
    winnerTeam,
  };
}

function resolveGameEnd(
  input: PhaseResolutionInput,
  deaths: readonly EngineDeath[],
  events: readonly EngineEvent[],
): PhaseResolutionDraft | null {
  const nextPlayers = applyDeaths(input.players, deaths);
  const finalOutcome = evaluateFinalOutcome(
    nextPlayers,
    createRoleContext({ ...input, players: nextPlayers }),
  );

  if (finalOutcome === null) {
    return null;
  }

  return {
    actionsToOpen: [],
    deaths: [...deaths],
    events: [...events, createGameEndedEvent(finalOutcome.winnerTeam)],
    finalOutcome,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: null,
    nextPhaseDurationSeconds: null,
    speechSlotsToCreate: [],
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
      throw new Error(`Death effect targets an unknown player: ${effect.playerId}`);
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
    options: toRegisteredRuleOptions(ruleSet),
    roleCounts: Object.fromEntries(
      getRoleIds().map((roleId) => [roleId, ruleSet.roleCounts[roleId] ?? 0]),
    ),
  };
}

function toSharedPlayerResult(result: RegisteredPlayerResult): SharedPlayerResult {
  return result;
}

function resolveNight(input: PhaseResolutionInput): PhaseResolutionDraft {
  const actionWindow = resolveActionWindowEffects({
    input,
    sourceActionId: "night",
  });
  const attackWasPrevented = actionWindow.effectResolution.preventedEffects.some(
    ({ effect }) => effect.kind === GameEffectKind.Death && effect.tags.includes(EFFECT_TAG.Attack),
  );
  const events: EngineEvent[] = [
    ...toPublicNightOutcomeEvents(attackWasPrevented),
    ...actionWindow.events,
  ];
  if (actionWindow.actionsToOpen.length > 0) {
    return continueRoleActionWindow(input, actionWindow.actionsToOpen, actionWindow.deaths, events);
  }

  const gameEnd = resolveGameEnd(input, actionWindow.deaths, events);

  if (gameEnd !== null) {
    return gameEnd;
  }

  return openDay(input, actionWindow.deaths, events);
}

function resolveFirstNight(input: PhaseResolutionInput): PhaseResolutionDraft {
  const actionWindow = resolveActionWindowEffects({
    input,
    sourceActionId: "first_night",
  });
  if (actionWindow.actionsToOpen.length > 0) {
    return continueRoleActionWindow(
      input,
      actionWindow.actionsToOpen,
      actionWindow.deaths,
      actionWindow.events,
    );
  }

  const gameEnd = resolveGameEnd(input, actionWindow.deaths, actionWindow.events);

  if (gameEnd !== null) {
    return gameEnd;
  }

  return openDay(input, actionWindow.deaths, actionWindow.events);
}

function openDay(
  input: PhaseResolutionInput,
  deaths: EngineDeath[],
  events: EngineEvent[] = [],
): PhaseResolutionDraft {
  const nextPlayers = input.players.map((player) => ({
    ...player,
    alive: deaths.some((death) => death.playerId === player.playerId) ? false : player.alive,
  }));

  const nextDayNumber = input.dayNumber + 1;
  const alivePlayers = nextPlayers.filter((player) => player.alive);
  const orderedSpeechSlots = createOrderedSpeechSlots(alivePlayers, nextDayNumber, input.ruleSet);
  const firstSpeechSlot = orderedSpeechSlots[0];
  const coreActionsToOpen =
    input.ruleSet.dayMode === "ordered_speech" && firstSpeechSlot !== undefined
      ? [toOrderedSpeechAction(firstSpeechSlot, nextDayNumber)]
      : alivePlayers.map((player) =>
          createCoreEngineAction({
            actorPlayerId: player.playerId,
            actorRoleId: null,
            actorStateRequirement: ActionActorStateRequirement.Alive,
            eligibleTargetPlayerIds: [],
            key: `day-ready:${nextDayNumber}:${player.playerId}`,
            kind: CoreActionKind.ReadyForVoting,
          }),
        );
  const actionsToOpen = [
    ...coreActionsToOpen,
    ...getAvailableRoleActions({
      dayNumber: nextDayNumber,
      nightNumber: input.nightNumber,
      phase: "day",
      players: nextPlayers,
      resolvedActionHistory: input.resolvedActionHistory ?? [],
      resolvedRoleSetup: input.resolvedRoleSetup,
      roles: input.roles ?? roleRegistry,
      ruleSet: input.ruleSet,
    }),
  ];

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

function resolveOrderedSpeechDay(input: PhaseResolutionInput): PhaseResolutionDraft {
  const actionWindow = resolveActionWindowEffects({
    input,
    sourceActionId: "ordered_speech",
  });
  const currentSpeechAction =
    findElapsedCoreAction(input, CoreActionKind.EndSpeech) ?? findLatestResolvedSpeechAction(input);
  const currentSlotIndex = parseSpeechSlotIndex(currentSpeechAction?.actionKey);
  const nextPlayers = applyDeaths(input.players, actionWindow.deaths);
  const alivePlayerIds = new Set(
    nextPlayers.filter((player) => player.alive).map((player) => player.playerId),
  );
  const orderedSpeechSlots = getOrderedSpeechSlots(
    input,
    input.players.filter((player) => player.alive),
  );
  const currentSlotPosition = orderedSpeechSlots.findIndex(
    (slot) => slot.slotIndex === currentSlotIndex,
  );

  if (actionWindow.actionsToOpen.length > 0) {
    return continueRoleActionWindow(
      input,
      actionWindow.actionsToOpen,
      actionWindow.deaths,
      actionWindow.events,
      orderedSpeechSlots,
    );
  }

  const gameEnd = resolveGameEnd(input, actionWindow.deaths, actionWindow.events);

  if (gameEnd !== null) {
    return gameEnd;
  }

  if (currentSlotIndex === null || currentSlotPosition < 0) {
    throw new Error("Ordered speech continuation is missing its resolved core action.");
  }

  const nextSpeechSlot = orderedSpeechSlots
    .slice(currentSlotPosition + 1)
    .find((slot) => alivePlayerIds.has(slot.speakerPlayerId));

  if (nextSpeechSlot === undefined) {
    return openVoting(input, actionWindow.deaths, actionWindow.events);
  }

  return {
    actionsToOpen: [toOrderedSpeechAction(nextSpeechSlot, input.dayNumber)],
    deaths: actionWindow.deaths,
    events: actionWindow.events,
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "day",
    nextPhaseDurationSeconds: input.ruleSet.daySpeechSeconds,
    speechSlotsToCreate: orderedSpeechSlots,
  };
}

function resolveReadyCheckDay(input: PhaseResolutionInput): PhaseResolutionDraft {
  const actionWindow = resolveActionWindowEffects({
    input,
    sourceActionId: "day_ready",
  });
  if (actionWindow.actionsToOpen.length > 0) {
    return continueRoleActionWindow(
      input,
      actionWindow.actionsToOpen,
      actionWindow.deaths,
      actionWindow.events,
    );
  }

  const gameEnd = resolveGameEnd(input, actionWindow.deaths, actionWindow.events);

  if (gameEnd !== null) {
    return gameEnd;
  }

  return openVoting(input, actionWindow.deaths, actionWindow.events);
}

function getOrderedSpeechSlots(
  input: PhaseResolutionInput,
  alivePlayers: readonly PlayerRuntimeState[],
): OrderedSpeechSlot[] {
  if (input.orderedSpeechSlots !== undefined) {
    return input.orderedSpeechSlots.toSorted((left, right) => left.slotIndex - right.slotIndex);
  }

  return createOrderedSpeechSlots(alivePlayers, input.dayNumber, input.ruleSet);
}

function createOrderedSpeechSlots(
  alivePlayers: readonly PlayerRuntimeState[],
  dayNumber: number,
  ruleSet: RuleSet,
): OrderedSpeechSlot[] {
  const fixedPlayerIds = alivePlayers.map((player) => player.playerId);
  const startIndex = fixedPlayerIds.length === 0 ? 0 : randomInt(fixedPlayerIds.length);
  const orderedPlayerIds = [
    ...fixedPlayerIds.slice(startIndex),
    ...fixedPlayerIds.slice(0, startIndex),
  ];
  const rounds = dayNumber === 1 ? ruleSet.firstDaySpeechRounds : ruleSet.normalDaySpeechRounds;

  return [...Array(rounds).keys()].flatMap((roundIndex) =>
    orderedPlayerIds.map((speakerPlayerId, playerIndex) => ({
      speakerPlayerId,
      slotIndex: roundIndex * orderedPlayerIds.length + playerIndex,
    })),
  );
}

function toOrderedSpeechAction(slot: OrderedSpeechSlot, dayNumber: number): EngineAction {
  return createCoreEngineAction({
    actorPlayerId: slot.speakerPlayerId,
    actorRoleId: null,
    actorStateRequirement: ActionActorStateRequirement.Alive,
    eligibleTargetPlayerIds: [],
    key: `end-speech:${dayNumber}:${slot.slotIndex}:${slot.speakerPlayerId}`,
    kind: CoreActionKind.EndSpeech,
  });
}

function parseSpeechSlotIndex(actionKey: string | null | undefined): number | null {
  const match = actionKey?.match(/^end-speech:(?<dayNumber>\d+):(?<slotIndex>\d+):/);
  const slotIndex = match?.groups?.["slotIndex"];

  if (slotIndex === undefined) {
    return null;
  }

  const parsed = Number.parseInt(slotIndex, 10);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function findLatestResolvedSpeechAction(
  input: PhaseResolutionInput,
): ResolvedActionHistoryEntry | undefined {
  return input.resolvedActionHistory?.findLast(
    (action) =>
      action.phase === input.currentPhase &&
      action.dayNumber === input.dayNumber &&
      action.nightNumber === input.nightNumber &&
      action.actionKind === CoreActionKind.EndSpeech &&
      action.resolverRoleId === null &&
      action.actorPlayerId !== null,
  );
}

function openVoting(
  input: PhaseResolutionInput,
  deaths: EngineDeath[] = [],
  events: EngineEvent[] = [],
): PhaseResolutionDraft {
  const nextPlayers = applyDeaths(input.players, deaths);
  const alivePlayers = nextPlayers.filter((player) => player.alive);

  return {
    actionsToOpen: [
      ...alivePlayers.map((player) =>
        createCoreEngineAction({
          actorPlayerId: player.playerId,
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          eligibleTargetPlayerIds: alivePlayers.map((target) => target.playerId),
          key: `vote:${input.dayNumber}:${player.playerId}`,
          kind: CoreActionKind.Vote,
        }),
      ),
      ...getAvailableRoleActions({
        dayNumber: input.dayNumber,
        nightNumber: input.nightNumber,
        phase: "voting",
        players: nextPlayers,
        resolvedActionHistory: input.resolvedActionHistory ?? [],
        resolvedRoleSetup: input.resolvedRoleSetup,
        roles: input.roles ?? roleRegistry,
        ruleSet: input.ruleSet,
      }),
    ],
    deaths,
    events: [...events, createPhaseChangedEvent("voting")],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "voting",
    nextPhaseDurationSeconds: input.ruleSet.votingSeconds,
    speechSlotsToCreate: [],
  };
}

function resolveVoting(input: PhaseResolutionInput): PhaseResolutionDraft {
  const actionWindow = resolveActionWindowEffects({
    input,
    sourceActionId: "voting",
  });
  const acceptedVotes = getAcceptedVotes(input);
  const voteCounts = new Map<string, number>();

  for (const vote of acceptedVotes) {
    voteCounts.set(vote.targetPlayerId, (voteCounts.get(vote.targetPlayerId) ?? 0) + 1);
  }

  const nextPlayers = applyDeaths(input.players, actionWindow.deaths);
  const alivePlayerIds = new Set(
    nextPlayers.filter((player) => player.alive).map((player) => player.playerId),
  );
  const sortedTargets = [...voteCounts.entries()]
    .filter(([playerId]) => alivePlayerIds.has(playerId))
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount);
  const top = sortedTargets[0];
  const second = sortedTargets[1];
  const hasExecutionCandidate = top !== undefined && (second === undefined || top[1] !== second[1]);

  if (actionWindow.actionsToOpen.length > 0) {
    return continueRoleActionWindow(
      input,
      actionWindow.actionsToOpen,
      actionWindow.deaths,
      actionWindow.events,
    );
  }

  const voteResolvedEvent: EngineEvent = {
    kind: "vote_resolved",
    payload: toVoteResolvedPayload(
      input,
      acceptedVotes,
      voteCounts,
      hasExecutionCandidate ? top[0] : undefined,
    ),
    visibility: "public",
    visibleToPlayerIds: [],
    visibleToRoleIds: [],
  };
  const resolutionEvents = [voteResolvedEvent, ...actionWindow.events];
  const gameEnd = resolveGameEnd(input, actionWindow.deaths, resolutionEvents);

  if (gameEnd !== null) {
    return gameEnd;
  }

  if (top === undefined || !hasExecutionCandidate) {
    return openNight(input, resolutionEvents, actionWindow.deaths);
  }

  return {
    actionsToOpen: [
      createCoreEngineAction({
        actorPlayerId: top[0],
        actorRoleId: null,
        actorStateRequirement: ActionActorStateRequirement.Alive,
        eligibleTargetPlayerIds: [],
        key: `execution-skip:${input.dayNumber}:${top[0]}`,
        kind: CoreActionKind.ExecutionSkip,
      }),
      ...getAvailableRoleActions({
        dayNumber: input.dayNumber,
        nightNumber: input.nightNumber,
        phase: "execution",
        players: nextPlayers,
        resolvedActionHistory: input.resolvedActionHistory ?? [],
        resolvedRoleSetup: input.resolvedRoleSetup,
        roles: input.roles ?? roleRegistry,
        ruleSet: input.ruleSet,
      }),
    ],
    deaths: actionWindow.deaths,
    events: [...resolutionEvents, createPhaseChangedEvent("execution")],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: "execution",
    nextPhaseDurationSeconds: input.ruleSet.executionLastWordsSeconds,
    speechSlotsToCreate: [],
  };
}

type AcceptedVote = {
  targetPlayerId: string;
  voterPlayerId: string;
};

function getAcceptedVotes(input: PhaseResolutionInput): AcceptedVote[] {
  const hasCurrentVoteWindow =
    input.currentActions?.some(
      (action) => action.resolverRoleId === null && action.kind === CoreActionKind.Vote,
    ) ?? input.actions.some((action) => isSubmittedCoreAction(action, CoreActionKind.Vote));

  if (hasCurrentVoteWindow) {
    return input.actions.flatMap((action) =>
      isSubmittedCoreAction(action, CoreActionKind.Vote) && action.targetPlayerId !== null
        ? [{ targetPlayerId: action.targetPlayerId, voterPlayerId: action.actorPlayerId }]
        : [],
    );
  }

  const latestResolvedVote = input.resolvedActionHistory?.findLast(
    (action) =>
      action.phase === "voting" &&
      action.dayNumber === input.dayNumber &&
      action.nightNumber === input.nightNumber &&
      action.actionKind === CoreActionKind.Vote &&
      action.resolverRoleId === null,
  );

  if (latestResolvedVote === undefined) {
    throw new Error("Voting continuation is missing its resolved core action window.");
  }

  return (input.resolvedActionHistory ?? []).flatMap((action) =>
    action.phaseInstanceId === latestResolvedVote.phaseInstanceId &&
    action.actionKind === CoreActionKind.Vote &&
    action.resolverRoleId === null &&
    action.resolutionStatus === "submitted" &&
    action.actorPlayerId !== null &&
    action.targetPlayerIds[0] !== undefined
      ? [
          {
            targetPlayerId: action.targetPlayerIds[0],
            voterPlayerId: action.actorPlayerId,
          },
        ]
      : [],
  );
}

function toVoteResolvedPayload(
  input: PhaseResolutionInput,
  acceptedVotes: readonly AcceptedVote[],
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
    payload["acceptedVotes"] = acceptedVotes.toSorted((left, right) =>
      left.voterPlayerId.localeCompare(right.voterPlayerId),
    );
  }

  return payload;
}

function resolveExecution(input: PhaseResolutionInput): PhaseResolutionDraft {
  const event = findElapsedCoreAction(input, CoreActionKind.ExecutionSkip);
  const actionWindow = resolveActionWindowEffects({
    collectCoreEffects:
      event === undefined
        ? undefined
        : (context) => [
            ...collectExecutionEffects({
              context,
              sourceActionId: event.actionKey ?? null,
              targetId: event.actorPlayerId,
            }),
            ...collectExecutionResolvedEffects({
              context,
              sourceActionId: event.actionKey ?? null,
              targetId: event.actorPlayerId,
            }),
          ],
    excludedDeathReasons: event === undefined ? [] : ["execution"],
    input,
    sourceActionId: event?.actionKey ?? "execution",
  });
  const events: EngineEvent[] =
    event === undefined
      ? actionWindow.events
      : [
          {
            kind: "player_executed",
            payload: { targetPlayerId: event.actorPlayerId },
            visibility: "public",
            visibleToPlayerIds: [],
            visibleToRoleIds: [],
          },
          ...actionWindow.events,
        ];
  if (actionWindow.actionsToOpen.length > 0) {
    return continueRoleActionWindow(input, actionWindow.actionsToOpen, actionWindow.deaths, events);
  }

  const gameEnd = resolveGameEnd(input, actionWindow.deaths, events);

  if (gameEnd !== null) {
    return gameEnd;
  }

  return finishExecutionAfterRoleActions(input, events, actionWindow.deaths);
}

function continueRoleActionWindow(
  input: PhaseResolutionInput,
  actionsToOpen: readonly EngineAction[],
  deaths: readonly EngineDeath[],
  events: readonly EngineEvent[],
  speechSlotsToCreate: readonly OrderedSpeechSlot[] = [],
): PhaseResolutionDraft {
  return {
    actionsToOpen: [...actionsToOpen],
    deaths: [...deaths],
    events: [...events],
    finalOutcome: null,
    nextDayNumber: input.dayNumber,
    nextNightNumber: input.nightNumber,
    nextPhase: input.currentPhase,
    nextPhaseDurationSeconds: getCurrentPhaseDurationSeconds(input),
    speechSlotsToCreate: [...speechSlotsToCreate],
  };
}

function getCurrentPhaseDurationSeconds(input: PhaseResolutionInput): number {
  switch (input.currentPhase) {
    case "day":
      return input.ruleSet.dayMode === "ordered_speech"
        ? input.ruleSet.daySpeechSeconds
        : input.players.filter((player) => player.alive).length *
            input.ruleSet.dayReadyCheckSecondsPerPlayer;
    case "execution":
      return input.ruleSet.executionLastWordsSeconds;
    case "night":
      return input.nightNumber === 1 ? input.ruleSet.firstNightSeconds : input.ruleSet.nightSeconds;
    case "voting":
      return input.ruleSet.votingSeconds;
  }
}

function finishExecutionAfterRoleActions(
  input: PhaseResolutionInput,
  events: EngineEvent[],
  deaths: EngineDeath[],
): PhaseResolutionDraft {
  return openNight(input, events, deaths);
}

type RoleContextInput = {
  actions?: readonly SubmittedAction[];
  currentPhase: GamePhase;
  currentActions?: readonly PhaseCurrentAction[];
  dayNumber: number;
  nightNumber: number;
  players: readonly PlayerRuntimeState[];
  resolvedActionHistory?: readonly ResolvedActionHistoryEntry[];
  resolvedRoleSetup: ResolvedRoleSetup;
  roles?: RoleRegistry;
  ruleSet: RuleSet;
};

function createRoleContext(input: RoleContextInput): RoleContext {
  const roleByPlayerId = new Map(
    input.players.map((player) => [player.playerId, player.roleId as RegisteredRoleId]),
  );
  const currentActions = (input.currentActions ?? []).map((action) =>
    toRegisteredCurrentAction(action, input.players),
  );
  const currentActionById = new Map(currentActions.map((action) => [action.id, action]));
  const pendingActions = (input.actions ?? []).flatMap((action) => {
    if (action.currentActionId === undefined || action.submittedAt === undefined) {
      return [];
    }

    const currentAction = currentActionById.get(action.currentActionId);

    if (currentAction === undefined) {
      return [];
    }

    const pendingAction: RegisteredPendingAction = {
      currentActionId: action.currentActionId,
      id: action.currentActionId,
      kind: currentAction.kind,
      submittedAt: action.submittedAt,
      submitterPlayerId: action.actorPlayerId,
      targetPlayerIds: action.targetPlayerId === null ? [] : [action.targetPlayerId],
    };

    return [pendingAction];
  });

  return {
    roles: input.roles ?? roleRegistry,
    state: {
      alivePlayerIds: input.players
        .filter((player) => player.alive)
        .map((player) => player.playerId),
      currentActions,
      finalOutcome: null,
      nightConversationMessages: [],
      nightNumber: input.nightNumber,
      pendingActions,
      phase: toRegisteredPhase(input.currentPhase),
      phaseInstanceId: null,
      resolvedActions: createResolvedActionHistory(input.resolvedActionHistory ?? []),
      resolvedRoleSetup: input.resolvedRoleSetup,
      roleByPlayerId,
      ruleOptions: toRegisteredRuleOptions(input.ruleSet),
      status: RegisteredGameStatus.Playing,
    },
  };
}

function toRegisteredCurrentAction(
  action: PhaseCurrentAction,
  players: readonly PlayerRuntimeState[],
): RegisteredCurrentAction {
  const allowedPlayerIds = players
    .filter(
      (player) =>
        (action.actorPlayerId === null || action.actorPlayerId === player.playerId) &&
        (action.actorRoleId === null || action.actorRoleId === player.roleId) &&
        (action.actorStateRequirement === ActionActorStateRequirement.Assigned || player.alive),
    )
    .map((player) => player.playerId);

  return {
    actionKey: action.key,
    actorStateRequirement: action.actorStateRequirement,
    allowedPlayerIds,
    closesAt: action.closesAt,
    eligibleTargetPlayerIds: action.eligibleTargetPlayerIds,
    id: action.id,
    kind: action.kind,
    openedAt: action.openedAt,
    ownerPlayerId: action.actorPlayerId,
    ownerRoleId: action.actorRoleId,
    resolverRoleId: action.resolverRoleId,
    scope: getRegisteredActionScope(action),
    target:
      action.targetKind === "single_player"
        ? RegisteredRoleTargetKind.SinglePlayer
        : RegisteredRoleTargetKind.None,
    targetStateRequirement: action.targetStateRequirement,
  };
}

function getRegisteredActionScope(action: PhaseCurrentAction): RegisteredActionScope {
  if (action.actorPlayerId !== null) {
    return RegisteredActionScope.Player;
  }

  return action.actorRoleId === null
    ? RegisteredActionScope.AllAlivePlayers
    : RegisteredActionScope.RoleGroup;
}

function createResolvedActionHistory(
  history: readonly ResolvedActionHistoryEntry[],
): ReadonlyGameState["resolvedActions"] {
  return history.flatMap((entry) =>
    entry.resolverRoleId === null
      ? []
      : [
          {
            actionKey: entry.actionKey,
            actorPlayerId: entry.actorPlayerId,
            actorRoleId: entry.actorRoleId,
            dayNumber: entry.dayNumber,
            id: entry.eventId,
            kind: entry.actionKind,
            nightNumber: entry.nightNumber,
            phase: toRegisteredPhase(entry.phase),
            phaseInstanceId: entry.phaseInstanceId,
            resolutionStatus: entry.resolutionStatus,
            resolverRoleId: entry.resolverRoleId,
            targetPlayerIds: [...entry.targetPlayerIds],
          },
        ],
  );
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

function toEngineDeaths(effects: readonly GameEffect[]): EngineDeath[] {
  return effects.flatMap((effect) =>
    effect.kind === GameEffectKind.Death
      ? [
          {
            playerId: effect.playerId,
            reason: effect.reason,
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

    const kind = effect.actionKind;
    const targetKind = toSharedTargetKind(effect.target);

    if (!isActionKey(effect.actionKey) || !isActionKind(kind) || targetKind === null) {
      throw new Error(`Role ${effect.resolverRoleId} emitted an invalid current action.`);
    }

    if (targetKind !== "none" && effect.eligibleTargetPlayerIds.length === 0) {
      throw new Error(`Role ${effect.resolverRoleId} emitted an action without eligible targets.`);
    }

    return [
      {
        actorPlayerId: effect.actorPlayerId,
        actorRoleId: effect.actorRoleId,
        actorStateRequirement: effect.actorStateRequirement,
        eligibleTargetPlayerIds: [...effect.eligibleTargetPlayerIds],
        key: effect.actionKey,
        kind,
        resolverRoleId: effect.resolverRoleId,
        targetKind,
        targetStateRequirement: effect.targetStateRequirement,
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
              payload: { presentation: effect.presentation },
              visibility: "private",
              visibleToPlayerIds: [effect.viewerId],
              visibleToRoleIds: [],
            },
          ];
        case GameEffectKind.PrivateMessage:
          return [
            {
              kind: effect.eventKind,
              payload: { presentation: effect.presentation },
              visibility: "private",
              visibleToPlayerIds: [effect.playerId],
              visibleToRoleIds: [],
            },
          ];
        case GameEffectKind.PublicMessage:
          return [
            {
              kind: effect.eventKind,
              payload: { presentation: effect.presentation },
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

function isSubmittedCoreAction(action: SubmittedAction, actionKind: CoreActionKind): boolean {
  return action.resolverRoleId === null && action.kind === actionKind;
}

type ElapsedCoreAction = {
  actionKey: string | null;
  actorPlayerId: string;
};

function findElapsedCoreAction(
  input: PhaseResolutionInput,
  actionKind: CoreActionKind.EndSpeech | CoreActionKind.ExecutionSkip,
): ElapsedCoreAction | undefined {
  const currentAction = input.currentActions?.find(
    (action) =>
      action.resolverRoleId === null && action.kind === actionKind && action.actorPlayerId !== null,
  );

  if (currentAction !== undefined && currentAction.actorPlayerId !== null) {
    return {
      actionKey: currentAction.key,
      actorPlayerId: currentAction.actorPlayerId,
    };
  }

  const submittedAction = input.actions.find((action) => isSubmittedCoreAction(action, actionKind));

  return submittedAction === undefined
    ? undefined
    : {
        actionKey: submittedAction.actionKey ?? null,
        actorPlayerId: submittedAction.actorPlayerId,
      };
}

function isActionActorStateRequirement(value: unknown): value is ActionActorStateRequirement {
  return (
    value === ActionActorStateRequirement.Alive || value === ActionActorStateRequirement.Assigned
  );
}

function isActionTargetStateRequirement(value: unknown): value is ActionTargetStateRequirement {
  return (
    value === ActionTargetStateRequirement.Alive || value === ActionTargetStateRequirement.Assigned
  );
}

function isEngineActionTargetKind(value: unknown): value is EngineAction["targetKind"] {
  return value === "none" || value === "single_player";
}

function isGameEffectKind(value: unknown): value is GameEffectKind {
  return Object.values(GameEffectKind).some((kind) => kind === value);
}

function toPublicNightOutcomeEvents(attackWasPrevented: boolean): EngineEvent[] {
  if (attackWasPrevented) {
    return [
      {
        kind: "attack_guarded",
        payload: {},
        visibility: "public",
        visibleToPlayerIds: [],
        visibleToRoleIds: [],
      },
    ];
  }

  return [];
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

function openNight(
  input: PhaseResolutionInput,
  events: EngineEvent[],
  deaths: EngineDeath[] = [],
): PhaseResolutionDraft {
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
      input.resolvedRoleSetup,
      input.resolvedActionHistory,
      input.roles,
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
    payload: { phase },
    visibility: "public",
    visibleToPlayerIds: [],
    visibleToRoleIds: [],
  };
}

function createGameEndedEvent(winnerTeam: Team): EngineEvent {
  return {
    kind: "game_ended",
    payload: { winnerTeam },
    visibility: "public",
    visibleToPlayerIds: [],
    visibleToRoleIds: [],
  };
}
