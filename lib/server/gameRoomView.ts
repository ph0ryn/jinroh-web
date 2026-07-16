import "server-only";
import {
  DISPLAY_NAME_MAX_LENGTH,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  isActionKind,
  isActionKey,
  isEventKind,
  isRoleId,
  type ActionSubmissionReceipt,
  type LocalizedText,
  type PlayerResult,
  type PrivateGameEvent,
  type PublicAction,
  type PublicActionProgress,
  type PublicGameEvent,
  type PublicGameView,
  type PublicPhaseFocus,
  type PublicPlayer,
  type RealtimeScope,
  type RoleCatalogItem,
  type RoleId,
  type RolePrivateView,
  type RoomStatus,
  type RoomSummary,
  type RuleSet,
  type SelfPrivateView,
  type TeamCatalogItem,
} from "@/lib/shared/game";
import { isValidRuleSetNumber, RULE_SET_NUMBER_FIELDS } from "@/lib/shared/ruleSetConstraints";
import { getCodePointLength } from "@/lib/shared/text";

import { CoreActionKind, getCoreActionDefinition } from "./game/coreActions";
import { getRoleCatalog, getRoleIds, getTeamCatalog, roleRegistry } from "./game/roles";
import { makeDefaultRoleCounts, parseResolvedRoleSetup } from "./game/ruleset";
import {
  ENGINE_VERSION,
  ROLE_REGISTRY_VERSION,
  validateEngineRuleSet,
  type PlayerRuntimeState,
} from "./gameEngine";

export type JsonObject = Record<string, unknown>;

type RoomRuntimeStatus = RoomStatus | "closed";

export type RoomRecord = {
  closed_at: string | null;
  created_at: string;
  current_game_id: string | null;
  host_account_id: number;
  id: number;
  public_room_code: string;
  roster_revision: number;
  snapshot_revision: number;
  status: RoomRuntimeStatus;
  target_player_count: number;
  updated_at: string;
  lobby_expires_at: string;
};

export type PlayerRecord = {
  account_id: number;
  disconnected_at: string | null;
  display_name: string;
  id: number;
  joined_at: string;
  last_seen_at: string;
  left_at: string | null;
  private_snapshot_revision: number;
  public_player_id: string;
  ready_roster_revision: number | null;
  room_id: number;
  status: "joined" | "disconnected" | "left";
};

export type GameRecord = {
  action_revision: number;
  day_number: number;
  ended_at: string | null;
  id: string;
  night_number: number;
  phase: "night" | "day" | "voting" | "execution" | null;
  phase_ends_at: string | null;
  phase_instance_id: string | null;
  phase_started_at: string | null;
  revision: number;
  started_at: string;
  status: "playing" | "ended";
  winner_team: string | null;
};

export type GamePlayerRecord = {
  alive: boolean;
  player_id: number;
  result: PlayerResult | null;
  role_id: RoleId;
};

export type CurrentActionRecord = {
  action_key: string;
  action_kind: string;
  actor_player_id: number | null;
  actor_role_id: string | null;
  actor_state_requirement: "alive" | "assigned";
  closes_at: string | null;
  created_at: string;
  eligible_target_player_ids: number[];
  id: number;
  phase_instance_id: string;
  resolver_role_id: string | null;
  target_kind: "none" | "single_player";
  target_state_requirement: "alive" | "assigned";
};

export type PendingActionRecord = {
  current_action_id: number;
  submitted_at: string;
  submitter_player_id: number;
  target_player_id: number | null;
};

export type DaySpeechSlotRecord = {
  slot_index: number;
  speaker_player_id: number;
};

export type GameEventRecord = {
  created_at: string;
  event_kind: string;
  id: number;
  payload: Record<string, unknown>;
  phase_instance_id: string;
  visibility: "public" | "private" | "internal";
};

export type GameRuleSetRecord = {
  engine_version: string;
  options: Record<string, unknown>;
  resolved_role_setup: JsonObject;
  role_counts: Record<RoleId, number>;
  role_registry_version: string;
};

export type NightConversationMessageRecord = {
  body: string;
  conversation_group_id: string;
  created_at: string;
  id: number;
  night_number: number;
  sender_player_id: number;
};

export type RealtimeTopicRecord = {
  game_id: string | null;
  player_id: number | null;
  role_id: RoleId | null;
  scope: RealtimeScope;
  topic: string;
};

export type ResolvedActionRecord = {
  action_key: string;
  action_kind: string;
  actor_player_id: number | null;
  actor_role_id: RoleId | null;
  day_number: number;
  id: number;
  night_number: number;
  phase: NonNullable<GameRecord["phase"]>;
  phase_instance_id: string;
  resolution_status: "missing" | "submitted";
  resolved_at: string;
  resolver_role_id: RoleId | null;
  target_player_id: number | null;
};

export type GameRuntimeSnapshot = {
  currentActions: CurrentActionRecord[];
  daySpeechSlots: DaySpeechSlotRecord[];
  game: GameRecord;
  gamePlayers: GamePlayerRecord[];
  nightConversationMessages: NightConversationMessageRecord[];
  pendingActions: PendingActionRecord[];
  privateEvents: GameEventRecord[];
  publicEvents: GameEventRecord[];
  resolvedActions: ResolvedActionRecord[];
  ruleSet: GameRuleSetRecord;
};

export type RoomSnapshot = {
  currentGame: GameRuntimeSnapshot | null;
  lobbyPlayers: PlayerRecord[];
  realtimeTopics: RealtimeTopicRecord[];
  room: RoomRecord;
  version: 2;
  viewerPlayerId: number | null;
};

export type NightConversationGroupConfig = {
  groupId: string;
  label: LocalizedText;
  roleIds: readonly RoleId[];
};

export const NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH = 100;

export function buildRoomView(snapshot: RoomSnapshot): RoomSummary {
  const currentRoom = snapshot.room;
  const players = snapshot.lobbyPlayers;

  assertPersistedGameState(currentRoom, snapshot.currentGame, players, snapshot.viewerPlayerId);

  if (currentRoom.status === "closed") {
    throw new Error("A closed Room cannot be projected as a current Room.");
  }

  const visibleCurrentGame =
    snapshot.viewerPlayerId === null && snapshot.currentGame?.game.status === "ended"
      ? null
      : snapshot.currentGame;
  const state = visibleCurrentGame?.game ?? null;
  const gamePlayers = visibleCurrentGame?.gamePlayers ?? [];
  const actions = visibleCurrentGame?.currentActions ?? [];
  const pendingActions = visibleCurrentGame?.pendingActions ?? [];
  const nightConversationMessages = visibleCurrentGame?.nightConversationMessages ?? [];
  const currentPlayer =
    players.find((player) => player.id === snapshot.viewerPlayerId && player.status !== "left") ??
    null;
  const isHost = currentPlayer !== null && currentRoom.host_account_id === currentPlayer.account_id;
  const gamePlayerByPlayer = new Map(
    gamePlayers.map((gamePlayer) => [gamePlayer.player_id, gamePlayer]),
  );
  const publicPlayers: PublicPlayer[] = players.map((player) => ({
    alive: gamePlayerByPlayer.get(player.id)?.alive ?? null,
    displayName: player.display_name,
    id: player.public_player_id,
    isCurrent: currentPlayer?.id === player.id,
    isHost: player.account_id === currentRoom.host_account_id,
    isLobbyReady:
      player.status !== "left" && player.ready_roster_revision === currentRoom.roster_revision,
    revealedRoleId: toRevealedRoleId(
      state?.status ?? null,
      gamePlayerByPlayer.get(player.id)?.role_id ?? null,
    ),
    status: player.status,
  }));
  const currentGamePlayer =
    currentPlayer === null ? null : (gamePlayerByPlayer.get(currentPlayer.id) ?? null);
  const currentRoleId = currentGamePlayer?.role_id ?? null;
  const events = (visibleCurrentGame?.publicEvents ?? []).flatMap((event) => {
    const publicEvent = toPublicGameEvent(event, players);

    return publicEvent === null ? [] : [publicEvent];
  });
  const visiblePrivateEventRecords =
    currentPlayer === null ? [] : (visibleCurrentGame?.privateEvents ?? []);
  const publicGame: PublicGameView | null =
    state === null
      ? null
      : {
          actionProgress: toPublicActionProgress(state, actions, pendingActions),
          dayNumber: state.day_number,
          events,
          gameId: state.id,
          nightNumber: state.night_number,
          phase: state.phase,
          phaseEndsAt: state.phase_ends_at,
          phaseFocus: toPublicPhaseFocus(state, actions, players),
          phaseInstanceId: state.phase_instance_id,
          revision: state.revision,
          status: state.status,
          winnerTeam: state.winner_team,
        };
  const self: SelfPrivateView | null =
    currentPlayer === null
      ? null
      : {
          actionReceipts: visiblePrivateEventRecords.flatMap(toActionSubmissionReceipt),
          actions: toPublicActions(
            actions,
            pendingActions,
            players,
            currentPlayer,
            currentRoleId,
            currentGamePlayer?.alive === true,
          ),
          events: visiblePrivateEventRecords
            .filter((event) => event.event_kind !== "action_submitted")
            .flatMap((event) => {
              const projected = toPrivateGameEvent(event, players);

              return projected === null ? [] : [projected];
            }),
          playerId: currentPlayer.public_player_id,
          result: currentGamePlayer?.result ?? null,
          roleId: currentRoleId,
        };

  return {
    code: currentRoom.public_room_code,
    currentPlayerId: currentPlayer?.public_player_id ?? null,
    defaultRoleCounts: makeDefaultRoleCounts(
      currentRoom.target_player_count,
    ) as RoomSummary["defaultRoleCounts"],
    game: publicGame,
    hostPlayerId:
      players.find((player) => player.account_id === currentRoom.host_account_id)
        ?.public_player_id ?? null,
    isHost,
    lobbyExpiresAt: currentRoom.lobby_expires_at,
    players: publicPlayers,
    rolePrivate: toRolePrivateView(
      players,
      gamePlayers,
      nightConversationMessages,
      currentPlayer,
      currentRoleId,
      currentGamePlayer?.alive === true,
      state,
      visibleCurrentGame?.ruleSet ?? null,
    ),
    roleCatalog: getSharedRoleCatalog(),
    rosterRevision: currentRoom.roster_revision,
    self,
    snapshotRevision: currentRoom.snapshot_revision,
    status: currentRoom.status,
    targetPlayerCount: currentRoom.target_player_count,
    teamCatalog: getSharedTeamCatalog(),
  };
}

function assertPersistedGameState(
  room: RoomRecord,
  currentGame: GameRuntimeSnapshot | null,
  players: readonly PlayerRecord[],
  viewerPlayerId: number | null,
): void {
  if (currentGame === null) {
    if (room.status === "waiting" && room.current_game_id === null) {
      return;
    }

    if (
      viewerPlayerId === null &&
      (room.status === "playing" || room.status === "ended") &&
      room.current_game_id !== null
    ) {
      return;
    }

    if (room.status === "closed") {
      return;
    }

    throw new Error("Room and current Game pointer are inconsistent.");
  }

  const { game, gamePlayers } = currentGame;

  if (
    room.current_game_id !== game.id ||
    (game.status === "playing" && room.status !== "playing") ||
    (game.status === "ended" && room.status !== "ended" && room.status !== "closed")
  ) {
    throw new Error("Stored room and game statuses are inconsistent.");
  }

  const playerIds = new Set(players.map((player) => player.id));
  const gamePlayerIds = new Set(gamePlayers.map((gamePlayer) => gamePlayer.player_id));
  const registeredRoleIds = new Set(getRoleIds());

  if (
    players.length === 0 ||
    gamePlayers.length !== room.target_player_count ||
    gamePlayerIds.size !== gamePlayers.length ||
    gamePlayers.some(
      (gamePlayer) =>
        !playerIds.has(gamePlayer.player_id) || !registeredRoleIds.has(gamePlayer.role_id),
    )
  ) {
    throw new Error("Stored player runtime state is incomplete or invalid.");
  }

  if (game.status === "playing") {
    if (game.winner_team !== null || gamePlayers.some((gamePlayer) => gamePlayer.result !== null)) {
      throw new Error("An in-progress game contains final result artifacts.");
    }

    return;
  }

  if (game.winner_team === null || gamePlayers.some((gamePlayer) => gamePlayer.result === null)) {
    throw new Error("Stored final game result is incomplete or invalid.");
  }

  roleRegistry.getTeam(game.winner_team);
}

export function getRuntimePlayersFromSnapshot(snapshot: RoomSnapshot): PlayerRuntimeState[] {
  const currentGame = requireCurrentGame(snapshot);
  const registeredRoleIds = new Set(getRoleIds());

  if (currentGame.gamePlayers.length === 0) {
    throw new Error("Stored player runtime state is incomplete.");
  }

  return currentGame.gamePlayers.map((gamePlayer) => {
    if (!registeredRoleIds.has(gamePlayer.role_id)) {
      throw new Error("Stored player runtime state is invalid.");
    }

    return {
      alive: gamePlayer.alive,
      playerId: String(gamePlayer.player_id),
      roleId: gamePlayer.role_id,
    };
  });
}

export function parseSnapshotRuleSet(snapshot: RoomSnapshot): RuleSet {
  return parsePersistedRuleSet(
    requireCurrentGame(snapshot).ruleSet,
    snapshot.room.target_player_count,
  );
}

function requireCurrentGame(snapshot: RoomSnapshot): GameRuntimeSnapshot {
  if (snapshot.currentGame === null) {
    throw new Error("Stored current Game is missing.");
  }

  return snapshot.currentGame;
}

export function toRevealedRoleId(
  gameStatus: PublicGameView["status"] | null,
  roleId: RoleId | null,
): RoleId | null {
  return gameStatus === "ended" ? roleId : null;
}

function getSharedRoleCatalog(): RoleCatalogItem[] {
  return getRoleCatalog().map((role) => ({
    id: role.id,
    maxCount: role.maxCount,
    minCount: role.minCount,
    order: role.order,
    presentation: role.presentation,
    specificOptions: role.specificOptions.map((option) => ({
      choices: option.choices,
      defaultValue: option.defaultValue,
      key: option.key,
      label: option.label,
    })),
  }));
}

function getSharedTeamCatalog(): TeamCatalogItem[] {
  return getTeamCatalog().map((team) => ({
    id: team.id,
    presentation: team.presentation,
  }));
}

function toPublicActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
  players: readonly PlayerRecord[],
  currentPlayer: PlayerRecord,
  currentRoleId: RoleId | null,
  currentPlayerAlive: boolean,
): PublicAction[] {
  const publicIdByInternalId = new Map(
    players.map((player) => [player.id, player.public_player_id]),
  );
  const submittedActionIds = new Set(pendingActions.map((action) => action.current_action_id));

  return actions
    .filter((action) =>
      isActionAvailableToPlayer(action, currentPlayer, currentRoleId, currentPlayerAlive),
    )
    .map((action) => {
      const definition = getActionDefinition(action);
      const commonAction: PublicActionCommon = {
        closesAt: action.closes_at,
        eligibleTargetIds: action.eligible_target_player_ids
          .map((playerId) => publicIdByInternalId.get(playerId))
          .filter((playerId): playerId is string => playerId !== undefined),
        key: action.action_key,
        kind: action.action_kind as PublicAction["kind"],
        phaseInstanceId: action.phase_instance_id,
        status: submittedActionIds.has(action.id) ? "submitted" : "open",
      };

      if (definition.targetKind !== action.target_kind) {
        throw new Error(
          `Stored action target does not match its definition: ${action.action_kind}`,
        );
      }

      return toPublicAction(commonAction, definition);
    });
}

export function isActionAvailableToPlayer(
  action: CurrentActionRecord,
  currentPlayer: Pick<PlayerRecord, "id" | "status">,
  currentRoleId: RoleId | null,
  currentPlayerAlive: boolean,
): boolean {
  const hasOwner = action.actor_player_id !== null || action.actor_role_id !== null;
  const playerMatches =
    action.actor_player_id === null || action.actor_player_id === currentPlayer.id;
  const roleMatches = action.actor_role_id === null || action.actor_role_id === currentRoleId;
  const actorStateMatches = action.actor_state_requirement === "assigned" || currentPlayerAlive;

  return (
    currentPlayer.status === "joined" &&
    hasOwner &&
    playerMatches &&
    roleMatches &&
    actorStateMatches
  );
}

export function getSharedActionRoleRecipients(action: CurrentActionRecord): RoleId[] {
  return action.actor_player_id === null && action.actor_role_id !== null
    ? [action.actor_role_id]
    : [];
}

export function toPublicActionProgress(
  state: GameRecord,
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
): PublicActionProgress | null {
  if (state.status !== "playing" || state.phase === null || state.phase_instance_id === null) {
    return null;
  }

  if (state.phase === "night" && state.night_number > 1) {
    return {
      kind: "night_actions_hidden",
      visibility: "hidden",
    };
  }

  const actionIds = new Set(actions.map((action) => action.id));
  const submittedActionIds = new Set(
    pendingActions
      .filter((pendingAction) => actionIds.has(pendingAction.current_action_id))
      .map((pendingAction) => pendingAction.current_action_id),
  );

  const kind = getPublicActionProgressKind(state.phase, actions);

  return {
    kind,
    required: actions.length,
    submitted: submittedActionIds.size,
    visibility: "public",
  };
}

function getPublicActionProgressKind(
  phase: NonNullable<GameRecord["phase"]>,
  actions: readonly CurrentActionRecord[],
): Extract<PublicActionProgress, { visibility: "public" }>["kind"] {
  if (actions.length > 0 && actions.every((action) => action.resolver_role_id !== null)) {
    return "role_actions";
  }

  if (
    phase === "day" &&
    actions.some((action) => isCoreCurrentAction(action, CoreActionKind.EndSpeech))
  ) {
    return "current_speech_turn";
  }

  switch (phase) {
    case "day":
      return "day_ready";
    case "execution":
      return "execution_last_words";
    case "night":
      return "first_night_ready";
    case "voting":
      return "votes_submitted";
  }
}

export function toPublicPhaseFocus(
  state: GameRecord,
  actions: readonly CurrentActionRecord[],
  players: readonly PlayerRecord[],
): PublicPhaseFocus | null {
  let focusKind:
    | { actionKind: "end_speech"; kind: "current_speaker" }
    | { actionKind: "execution_skip"; kind: "execution_candidate" }
    | null = null;

  if (state.phase === "day") {
    focusKind = { actionKind: CoreActionKind.EndSpeech, kind: "current_speaker" };
  } else if (state.phase === "execution") {
    focusKind = { actionKind: CoreActionKind.ExecutionSkip, kind: "execution_candidate" };
  }

  if (state.status !== "playing" || focusKind === null) {
    return null;
  }

  const actorPlayerId = actions.find(
    (action) =>
      isCoreCurrentAction(action, focusKind.actionKind) && action.actor_player_id !== null,
  )?.actor_player_id;
  const publicPlayerId = players.find((player) => player.id === actorPlayerId)?.public_player_id;

  return publicPlayerId === undefined
    ? null
    : {
        kind: focusKind.kind,
        playerId: publicPlayerId,
      };
}

function isCoreCurrentAction(action: CurrentActionRecord, actionKind: string): boolean {
  return action.resolver_role_id === null && action.action_kind === actionKind;
}

function toRolePrivateView(
  players: readonly PlayerRecord[],
  gamePlayers: readonly GamePlayerRecord[],
  nightConversationMessages: readonly NightConversationMessageRecord[],
  currentPlayer: PlayerRecord | null,
  currentRoleId: RoleId | null,
  currentPlayerAlive: boolean,
  state: GameRecord | null,
  ruleSet: GameRuleSetRecord | null,
): RolePrivateView {
  if (currentPlayer === null || currentRoleId === null || state === null) {
    return null;
  }

  const group = getNightConversationGroups(ruleSet).find((candidate) =>
    candidate.roleIds.includes(currentRoleId),
  );

  if (group === undefined) {
    return null;
  }

  return {
    nightConversation: toNightConversationView({
      currentPlayer,
      currentPlayerAlive,
      gamePlayers,
      group,
      messages: nightConversationMessages,
      players,
      state,
    }),
  };
}

function toNightConversationView({
  currentPlayer,
  currentPlayerAlive,
  gamePlayers,
  group,
  messages,
  players,
  state,
}: {
  currentPlayer: Pick<PlayerRecord, "id" | "status">;
  currentPlayerAlive: boolean;
  gamePlayers: readonly GamePlayerRecord[];
  group: NightConversationGroupConfig;
  messages: readonly NightConversationMessageRecord[];
  players: readonly PlayerRecord[];
  state: GameRecord;
}): NonNullable<RolePrivateView>["nightConversation"] {
  if (state.phase === null || state.night_number < 1) {
    return null;
  }

  const playerById = new Map(players.map((player) => [player.id, player]));
  const registeredRoleIds = new Set(getRoleIds());
  const participantPlayerIds = gamePlayers
    .filter(
      (assignment) =>
        registeredRoleIds.has(assignment.role_id) && group.roleIds.includes(assignment.role_id),
    )
    .map((assignment) => playerById.get(assignment.player_id)?.public_player_id)
    .filter((playerId): playerId is string => playerId !== undefined);
  const visibleMessages = messages
    .filter(
      (message) =>
        message.conversation_group_id === group.groupId &&
        message.night_number === state.night_number,
    )
    .map((message) => {
      const sender = playerById.get(message.sender_player_id);

      return {
        body: message.body,
        createdAt: message.created_at,
        id: String(message.id),
        senderName: sender?.display_name ?? "Player",
        senderPlayerId: sender?.public_player_id ?? "",
      };
    });

  const canSend = canSendNightConversation(state, currentPlayer, currentPlayerAlive);

  return {
    canSend,
    groupId: group.groupId,
    label: group.label,
    maxMessageLength: NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH,
    messages: visibleMessages,
    nightNumber: state.night_number,
    participantPlayerIds,
    readOnly: !canSend,
  };
}

export function canSendNightConversation(
  state: GameRecord,
  currentPlayer: Pick<PlayerRecord, "id" | "status">,
  currentPlayerAlive: boolean,
): boolean {
  return (
    currentPlayer.status === "joined" &&
    currentPlayerAlive &&
    state.status === "playing" &&
    state.phase === "night"
  );
}

export function getNightConversationGroups(
  ruleSet: GameRuleSetRecord | null,
): readonly NightConversationGroupConfig[] {
  if (ruleSet === null) {
    return [];
  }

  const parsedRoleSetup = parsePersistedRoleSetup(ruleSet);

  if (parsedRoleSetup === null) {
    throw new Error("Stored role setup is invalid or incompatible with this server version.");
  }

  return parsedRoleSetup.nightConversationGroups;
}

export function parsePersistedRoleSetup(ruleSet: GameRuleSetRecord | null) {
  if (
    ruleSet?.engine_version !== ENGINE_VERSION ||
    ruleSet.role_registry_version !== ROLE_REGISTRY_VERSION
  ) {
    return null;
  }

  return parseResolvedRoleSetup(ruleSet.resolved_role_setup);
}

export function toActionSubmissionReceipt(event: GameEventRecord): ActionSubmissionReceipt[] {
  const actionKey = event.payload["actionKey"];
  const kind = event.payload["kind"];

  if (event.event_kind !== "action_submitted" || !isActionKey(actionKey) || !isActionKind(kind)) {
    return [];
  }

  return [
    {
      actionKey,
      id: String(event.id),
      kind,
      phaseInstanceId: event.phase_instance_id,
      submittedAt: event.created_at,
    },
  ];
}

export function toPrivateGameEvent(
  event: GameEventRecord,
  players: readonly PlayerRecord[],
): PrivateGameEvent | null {
  const presentation = projectEventPresentation(event.payload["presentation"], players);

  return presentation === null
    ? null
    : {
        createdAt: event.created_at,
        kind: event.event_kind,
        presentation,
      };
}

type PublicActionDefinition =
  | Pick<Extract<PublicAction, { targetKind: "none" }>, "presentation" | "targetKind">
  | Pick<Extract<PublicAction, { targetKind: "single_player" }>, "presentation" | "targetKind">;

type PublicActionCommon = Omit<PublicAction, "presentation" | "targetKind">;

function toPublicAction(
  commonAction: PublicActionCommon,
  definition: PublicActionDefinition,
): PublicAction {
  return {
    ...commonAction,
    ...definition,
  };
}

function toTargetlessPublicActionDefinition(
  presentation: Extract<PublicAction, { targetKind: "none" }>["presentation"],
): Extract<PublicActionDefinition, { targetKind: "none" }> {
  return { presentation, targetKind: "none" };
}

function toSinglePlayerPublicActionDefinition(
  presentation: Extract<PublicAction, { targetKind: "single_player" }>["presentation"],
): Extract<PublicActionDefinition, { targetKind: "single_player" }> {
  return { presentation, targetKind: "single_player" };
}

function getActionDefinition(action: CurrentActionRecord): PublicActionDefinition {
  if (action.resolver_role_id === null) {
    const definition = getCoreActionDefinition(action.action_kind);

    return definition.targetKind === "none"
      ? toTargetlessPublicActionDefinition(definition.presentation)
      : toSinglePlayerPublicActionDefinition(definition.presentation);
  }

  const definition = roleRegistry
    .get(action.resolver_role_id)
    .getActionDefinition(action.action_kind);

  return definition.target === "none"
    ? toTargetlessPublicActionDefinition(definition.presentation)
    : toSinglePlayerPublicActionDefinition(definition.presentation);
}

export function toPublicGameEvent(
  event: GameEventRecord,
  players: readonly PlayerRecord[],
): PublicGameEvent | null {
  const payload = projectPublicEventPayload(event.event_kind, event.payload, players);
  const presentation = projectEventPresentation(event.payload["presentation"], players);

  return payload === null && presentation === null
    ? null
    : {
        createdAt: event.created_at,
        id: String(event.id),
        kind: event.event_kind,
        payload: payload ?? {},
        presentation,
      };
}

function projectEventPresentation(
  value: unknown,
  players: readonly PlayerRecord[],
): PublicGameEvent["presentation"] {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isLocalizedText(value["title"], 100) ||
    !isLocalizedText(value["message"], 500) ||
    !Array.isArray(value["details"]) ||
    value["details"].length > 8
  ) {
    return null;
  }

  const details = value["details"].flatMap((detail) => {
    if (
      !isRecord(detail) ||
      Object.keys(detail).length !== 2 ||
      !isLocalizedText(detail["label"], 100) ||
      !isRecord(detail["value"])
    ) {
      return [];
    }

    const projectedValue = projectEventPresentationValue(detail["value"], players);

    return projectedValue === null ? [] : [{ label: detail["label"], value: projectedValue }];
  });

  if (details.length !== value["details"].length) {
    return null;
  }

  return {
    details,
    message: value["message"],
    title: value["title"],
  };
}

function projectEventPresentationValue(
  value: Record<string, unknown>,
  players: readonly PlayerRecord[],
): LocalizedText | null {
  if (
    value["kind"] === "localized_text" &&
    Object.keys(value).length === 2 &&
    isLocalizedText(value["text"], 500)
  ) {
    return value["text"];
  }

  if (
    value["kind"] === "player" &&
    Object.keys(value).length === 2 &&
    typeof value["playerId"] === "string"
  ) {
    const player = players.find((candidate) => String(candidate.id) === value["playerId"]);
    const name = player?.display_name ?? "Player";

    return { en: name, ja: name };
  }

  return null;
}

function isLocalizedText(value: unknown, maxLength: number): value is LocalizedText {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isStringWithCodePointLength(value["en"], 1, maxLength) &&
    isStringWithCodePointLength(value["ja"], 1, maxLength)
  );
}

function projectPublicEventPayload(
  eventKind: string,
  payload: Readonly<Record<string, unknown>>,
  players: readonly PlayerRecord[],
): Record<string, unknown> | null {
  switch (eventKind) {
    case "attack_guarded":
    case "game_started":
    case "vote_submitted":
      return {};
    case "game_ended":
      return projectGameEndedPayload(payload);
    case "phase_changed":
      return projectPhaseChangedPayload(payload);
    case "player_died":
      return projectPlayerDiedPayload(payload, players);
    case "player_executed":
      return projectTargetPlayerPayload(payload, players);
    case "vote_resolved":
      return projectVoteResolvedPayload(payload, players);
    default:
      return null;
  }
}

function projectGameEndedPayload(
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const winnerTeam = payload["winnerTeam"];

  return isRoleId(winnerTeam) ? { winnerTeam } : null;
}

function projectPhaseChangedPayload(
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const phase = payload["phase"];

  return phase === "day" || phase === "execution" || phase === "night" || phase === "voting"
    ? { phase }
    : null;
}

function projectPlayerDiedPayload(
  payload: Readonly<Record<string, unknown>>,
  players: readonly PlayerRecord[],
): Record<string, unknown> | null {
  const reason = payload["reason"];
  const targetPlayerId = toPublicPlayerId(payload["targetPlayerId"], players);

  if (targetPlayerId === null || !isDeathReason(reason)) {
    return null;
  }

  return { reason, targetPlayerId };
}

function projectTargetPlayerPayload(
  payload: Readonly<Record<string, unknown>>,
  players: readonly PlayerRecord[],
): Record<string, unknown> | null {
  const targetPlayerId = toPublicPlayerId(payload["targetPlayerId"], players);

  return targetPlayerId === null ? null : { targetPlayerId };
}

function projectVoteResolvedPayload(
  payload: Readonly<Record<string, unknown>>,
  players: readonly PlayerRecord[],
): Record<string, unknown> | null {
  const dayNumber = payload["dayNumber"];
  const voteCountsByTarget = projectVoteCounts(payload["voteCountsByTarget"], players);

  if (!isPositiveSafeInteger(dayNumber) || voteCountsByTarget === null) {
    return null;
  }

  const publicPayload: Record<string, unknown> = { dayNumber, voteCountsByTarget };

  if ("executionCandidatePlayerId" in payload) {
    const executionCandidatePlayerId = toPublicPlayerId(
      payload["executionCandidatePlayerId"],
      players,
    );

    if (executionCandidatePlayerId === null) {
      return null;
    }

    publicPayload["executionCandidatePlayerId"] = executionCandidatePlayerId;
  }

  if ("acceptedVotes" in payload) {
    const acceptedVotes = projectAcceptedVotes(payload["acceptedVotes"], players);

    if (acceptedVotes === null) {
      return null;
    }

    publicPayload["acceptedVotes"] = acceptedVotes;
  }

  return publicPayload;
}

function projectVoteCounts(
  value: unknown,
  players: readonly PlayerRecord[],
): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries: [string, number][] = [];

  for (const [internalPlayerId, count] of Object.entries(value)) {
    const publicPlayerId = toPublicPlayerId(internalPlayerId, players);

    if (publicPlayerId === null || !isNonNegativeSafeInteger(count)) {
      return null;
    }

    entries.push([publicPlayerId, count]);
  }

  return Object.fromEntries(entries);
}

function projectAcceptedVotes(
  value: unknown,
  players: readonly PlayerRecord[],
): { targetPlayerId: string; voterPlayerId: string }[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const acceptedVotes: { targetPlayerId: string; voterPlayerId: string }[] = [];

  for (const vote of value) {
    if (!isRecord(vote)) {
      return null;
    }

    const targetPlayerId = toPublicPlayerId(vote["targetPlayerId"], players);
    const voterPlayerId = toPublicPlayerId(vote["voterPlayerId"], players);

    if (targetPlayerId === null || voterPlayerId === null) {
      return null;
    }

    acceptedVotes.push({ targetPlayerId, voterPlayerId });
  }

  return acceptedVotes;
}

function toPublicPlayerId(value: unknown, players: readonly PlayerRecord[]): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const player = players.find((candidate) => String(candidate.id) === value);

  return player?.public_player_id ?? null;
}

function isDeathReason(value: unknown): boolean {
  return isActionKind(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parsePersistedRuleSet(data: GameRuleSetRecord, playerCount: number): RuleSet {
  if (
    data.engine_version !== ENGINE_VERSION ||
    data.role_registry_version !== ROLE_REGISTRY_VERSION
  ) {
    throw new Error("Stored rule set is incompatible with this server version.");
  }

  const roleIds = getRoleIds();
  const storedRoleIds = Object.keys(data.role_counts);

  if (
    storedRoleIds.length !== roleIds.length ||
    storedRoleIds.some((roleId) => !roleIds.includes(roleId))
  ) {
    throw new Error("Stored role counts are invalid.");
  }

  const roleCounts = Object.fromEntries(
    roleIds.map((roleId) => {
      const count = data.role_counts[roleId];

      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new Error("Stored role counts are invalid.");
      }

      return [roleId, count];
    }),
  ) as RuleSet["roleCounts"];
  const expectedOptionKeys = [
    ...RULE_SET_NUMBER_FIELDS,
    "dayMode",
    "roleOptions",
    "voteResultVisibility",
  ];
  const roleOptions = parseStoredRoleOptions(data.options["roleOptions"]);

  if (
    Object.keys(data.options).length !== expectedOptionKeys.length ||
    Object.keys(data.options).some((key) => !expectedOptionKeys.includes(key)) ||
    !RULE_SET_NUMBER_FIELDS.every((field) => isValidRuleSetNumber(field, data.options[field])) ||
    (data.options["dayMode"] !== "ordered_speech" && data.options["dayMode"] !== "ready_check") ||
    roleOptions === null ||
    (data.options["voteResultVisibility"] !== "count_only" &&
      data.options["voteResultVisibility"] !== "voter_to_target")
  ) {
    throw new Error("Stored rule options are invalid.");
  }

  const ruleSet: RuleSet = {
    dayMode: data.options["dayMode"],
    dayReadyCheckSecondsPerPlayer: data.options["dayReadyCheckSecondsPerPlayer"] as number,
    daySpeechSeconds: data.options["daySpeechSeconds"] as number,
    executionLastWordsSeconds: data.options["executionLastWordsSeconds"] as number,
    firstDaySpeechRounds: data.options["firstDaySpeechRounds"] as number,
    firstNightSeconds: data.options["firstNightSeconds"] as number,
    nightSeconds: data.options["nightSeconds"] as number,
    normalDaySpeechRounds: data.options["normalDaySpeechRounds"] as number,
    roleCounts,
    roleOptions,
    voteResultVisibility: data.options["voteResultVisibility"],
    votingSeconds: data.options["votingSeconds"] as number,
  };
  const validation = validateEngineRuleSet(ruleSet, playerCount);

  if (!validation.ok) {
    throw new Error(`Stored rule set is invalid. ${validation.errors.join(" ")}`);
  }

  return ruleSet;
}

function parseStoredRoleOptions(value: unknown): RuleSet["roleOptions"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const rolesWithOptions = getRoleCatalog().filter((role) => role.specificOptions.length > 0);
  const expectedRoleIds = rolesWithOptions.map((role) => role.id);

  if (
    Object.keys(value).length !== expectedRoleIds.length ||
    Object.keys(value).some((roleId) => !expectedRoleIds.includes(roleId))
  ) {
    return null;
  }

  const parsed: Record<string, Readonly<Record<string, string>>> = {};

  for (const role of rolesWithOptions) {
    const rawValues = value[role.id];

    if (
      !isRecord(rawValues) ||
      Object.keys(rawValues).length !== role.specificOptions.length ||
      Object.keys(rawValues).some(
        (optionKey) => !role.specificOptions.some((option) => option.key === optionKey),
      )
    ) {
      return null;
    }

    const values: Record<string, string> = {};

    for (const option of role.specificOptions) {
      const rawValue = rawValues[option.key];

      if (
        typeof rawValue !== "string" ||
        !option.choices.some((choice) => choice.value === rawValue)
      ) {
        return null;
      }

      values[option.key] = rawValue;
    }

    parsed[role.id] = values;
  }

  return parsed;
}

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!hasExactKeys(value, ROOM_SNAPSHOT_KEYS) || value["version"] !== 2) {
    return false;
  }

  if (
    !(
      isRoomRecord(value["room"]) &&
      isNullable(value["viewerPlayerId"], isPositiveSafeInteger) &&
      isArrayOf(value["lobbyPlayers"], isPlayerRecord) &&
      isNullable(value["currentGame"], isGameRuntimeSnapshot) &&
      isArrayOf(value["realtimeTopics"], isRealtimeTopicRecord)
    )
  ) {
    return false;
  }

  if (
    value["currentGame"] !== null &&
    Object.values(value["currentGame"].ruleSet.role_counts).reduce(
      (total, count) => total + count,
      0,
    ) !== value["room"].target_player_count
  ) {
    return false;
  }

  return hasConsistentRoomSnapshot(value as RoomSnapshot);
}

function isGameRuntimeSnapshot(value: unknown): value is GameRuntimeSnapshot {
  return (
    hasExactKeys(value, GAME_RUNTIME_SNAPSHOT_KEYS) &&
    isGameRecord(value["game"]) &&
    isGameRuleSetRecord(value["ruleSet"]) &&
    isArrayOf(value["gamePlayers"], isGamePlayerRecord) &&
    isArrayOf(value["currentActions"], isCurrentActionRecord) &&
    isArrayOf(value["pendingActions"], isPendingActionRecord) &&
    isArrayOf(value["resolvedActions"], isResolvedActionRecord) &&
    isArrayOf(value["daySpeechSlots"], isDaySpeechSlotRecord) &&
    isArrayOf(value["publicEvents"], (event) => isGameEventRecord(event, "public")) &&
    isArrayOf(value["privateEvents"], (event) => isGameEventRecord(event, "private")) &&
    isArrayOf(value["nightConversationMessages"], isNightConversationMessageRecord)
  );
}

function hasConsistentRoomSnapshot(snapshot: RoomSnapshot): boolean {
  const playerIds = new Set(snapshot.lobbyPlayers.map((player) => player.id));
  const playerById = new Map(snapshot.lobbyPlayers.map((player) => [player.id, player]));
  const viewer = snapshot.viewerPlayerId === null ? null : playerById.get(snapshot.viewerPlayerId);

  if (
    playerIds.size !== snapshot.lobbyPlayers.length ||
    !hasUniqueValues(snapshot.lobbyPlayers.map((player) => player.account_id)) ||
    !hasUniqueValues(snapshot.lobbyPlayers.map((player) => player.public_player_id)) ||
    snapshot.lobbyPlayers.some(
      (player) =>
        player.room_id !== snapshot.room.id ||
        Date.parse(player.joined_at) < Date.parse(snapshot.room.created_at) ||
        (player.ready_roster_revision !== null &&
          player.ready_roster_revision > snapshot.room.roster_revision),
    ) ||
    !snapshot.lobbyPlayers.some((player) => player.account_id === snapshot.room.host_account_id) ||
    (snapshot.viewerPlayerId !== null &&
      (viewer === null ||
        viewer === undefined ||
        (viewer.status === "left" && snapshot.room.status !== "closed"))) ||
    snapshot.lobbyPlayers.filter((player) => player.status !== "left").length >
      snapshot.room.target_player_count
  ) {
    return false;
  }

  if (snapshot.currentGame === null) {
    return (
      ((snapshot.room.current_game_id === null &&
        (snapshot.room.status === "waiting" || snapshot.room.status === "closed")) ||
        (snapshot.room.current_game_id !== null &&
          snapshot.viewerPlayerId === null &&
          snapshot.room.status !== "waiting")) &&
      hasConsistentRealtimeTopics(snapshot.realtimeTopics, playerIds, null, null)
    );
  }

  const currentGame = snapshot.currentGame;
  const state = currentGame.game;
  const ruleSet = currentGame.ruleSet;

  if (
    snapshot.room.current_game_id !== state.id ||
    snapshot.room.status === "waiting" ||
    currentGame.gamePlayers.length !== snapshot.room.target_player_count ||
    state.revision < 1 ||
    (state.phase_started_at !== null &&
      Date.parse(state.phase_started_at) < Date.parse(state.started_at)) ||
    !isResolvedRoleSetupRecord(ruleSet.resolved_role_setup)
  ) {
    return false;
  }

  const setup = ruleSet.resolved_role_setup;
  const activeRoleIds = new Set(setup.activeRoleIds);
  const assignmentByPlayer = new Map(
    currentGame.gamePlayers.map((gamePlayer) => [gamePlayer.player_id, gamePlayer]),
  );
  const stateByPlayer = assignmentByPlayer;

  if (
    assignmentByPlayer.size !== currentGame.gamePlayers.length ||
    currentGame.gamePlayers.some(
      (gamePlayer) =>
        !playerIds.has(gamePlayer.player_id) || !activeRoleIds.has(gamePlayer.role_id),
    ) ||
    !hasMatchingRoleCounts(ruleSet.role_counts, currentGame.gamePlayers) ||
    !hasConsistentRealtimeTopics(snapshot.realtimeTopics, playerIds, activeRoleIds, state.id)
  ) {
    return false;
  }

  if (snapshot.room.status === "playing") {
    if (
      state.status !== "playing" ||
      state.winner_team !== null ||
      currentGame.gamePlayers.some((gamePlayer) => gamePlayer.result !== null)
    ) {
      return false;
    }
  } else if (
    state.status !== "ended" ||
    state.winner_team === null ||
    currentGame.gamePlayers.some((gamePlayer) => gamePlayer.result === null) ||
    currentGame.currentActions.length !== 0 ||
    currentGame.pendingActions.length !== 0 ||
    currentGame.daySpeechSlots.length !== 0 ||
    state.action_revision !== 0
  ) {
    return false;
  }

  if (
    !hasConsistentCurrentActions(
      currentGame.currentActions,
      currentGame.pendingActions,
      state,
      assignmentByPlayer,
      stateByPlayer,
      playerIds,
      activeRoleIds,
    ) ||
    !hasConsistentDaySpeechSlots(currentGame.daySpeechSlots, state, ruleSet, stateByPlayer) ||
    !hasConsistentEvents(
      currentGame.publicEvents,
      currentGame.privateEvents,
      snapshot.viewerPlayerId,
    ) ||
    !hasConsistentNightConversationMessages(
      currentGame.nightConversationMessages,
      snapshot.viewerPlayerId,
      state,
      setup,
      assignmentByPlayer,
      playerIds,
    ) ||
    !hasConsistentResolvedActions(
      currentGame.resolvedActions,
      currentGame.currentActions,
      state,
      assignmentByPlayer,
      playerIds,
      activeRoleIds,
    )
  ) {
    return false;
  }

  return true;
}

function hasMatchingRoleCounts(
  roleCounts: Readonly<Record<RoleId, number>>,
  gamePlayers: readonly GamePlayerRecord[],
): boolean {
  const assignmentCountByRole = new Map<RoleId, number>();

  for (const gamePlayer of gamePlayers) {
    assignmentCountByRole.set(
      gamePlayer.role_id,
      (assignmentCountByRole.get(gamePlayer.role_id) ?? 0) + 1,
    );
  }

  return Object.entries(roleCounts).every(
    ([roleId, count]) => (assignmentCountByRole.get(roleId) ?? 0) === count,
  );
}

function hasConsistentCurrentActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
  state: GameRecord,
  assignmentByPlayer: ReadonlyMap<number, GamePlayerRecord>,
  stateByPlayer: ReadonlyMap<number, GamePlayerRecord>,
  playerIds: ReadonlySet<number>,
  activeRoleIds: ReadonlySet<RoleId>,
): boolean {
  const actionById = new Map(actions.map((action) => [action.id, action]));

  if (
    state.status !== "playing" &&
    (actions.length !== 0 || pendingActions.length !== 0 || state.action_revision !== 0)
  ) {
    return false;
  }

  if (
    actionById.size !== actions.length ||
    !hasUniqueValues(actions.map((action) => action.action_key)) ||
    !hasUniqueValues(pendingActions.map((pendingAction) => pendingAction.current_action_id)) ||
    state.action_revision !== pendingActions.length
  ) {
    return false;
  }

  for (const action of actions) {
    if (
      action.phase_instance_id !== state.phase_instance_id ||
      action.closes_at !== state.phase_ends_at ||
      (action.resolver_role_id !== null && !activeRoleIds.has(action.resolver_role_id)) ||
      (action.actor_role_id !== null && !activeRoleIds.has(action.actor_role_id)) ||
      action.eligible_target_player_ids.some((playerId) => !playerIds.has(playerId)) ||
      action.eligible_target_player_ids.some(
        (playerId) =>
          action.target_state_requirement === "alive" &&
          stateByPlayer.get(playerId)?.alive !== true,
      ) ||
      (action.target_kind === "none" && action.eligible_target_player_ids.length !== 0) ||
      (action.target_kind === "single_player" && action.eligible_target_player_ids.length === 0) ||
      !hasEligibleActor(action, null, assignmentByPlayer, stateByPlayer)
    ) {
      return false;
    }
  }

  for (const pendingAction of pendingActions) {
    const action = actionById.get(pendingAction.current_action_id);

    if (
      action === undefined ||
      !playerIds.has(pendingAction.submitter_player_id) ||
      !hasEligibleActor(
        action,
        pendingAction.submitter_player_id,
        assignmentByPlayer,
        stateByPlayer,
      ) ||
      Date.parse(pendingAction.submitted_at) < Date.parse(action.created_at) ||
      (action.closes_at !== null &&
        Date.parse(pendingAction.submitted_at) > Date.parse(action.closes_at)) ||
      (action.target_kind === "none" && pendingAction.target_player_id !== null) ||
      (action.target_kind === "single_player" &&
        (pendingAction.target_player_id === null ||
          !action.eligible_target_player_ids.includes(pendingAction.target_player_id)))
    ) {
      return false;
    }
  }

  return true;
}

function hasEligibleActor(
  action: CurrentActionRecord,
  submitterPlayerId: number | null,
  assignmentByPlayer: ReadonlyMap<number, GamePlayerRecord>,
  stateByPlayer: ReadonlyMap<number, GamePlayerRecord>,
): boolean {
  if (submitterPlayerId !== null) {
    if (action.actor_player_id !== null && action.actor_player_id !== submitterPlayerId) {
      return false;
    }

    const assignment = assignmentByPlayer.get(submitterPlayerId);
    const playerState = stateByPlayer.get(submitterPlayerId);

    return (
      assignment !== undefined &&
      playerState !== undefined &&
      (action.actor_role_id === null || assignment.role_id === action.actor_role_id) &&
      (action.actor_state_requirement === "assigned" || playerState.alive)
    );
  }

  if (action.actor_player_id !== null) {
    const assignment = assignmentByPlayer.get(action.actor_player_id);
    const playerState = stateByPlayer.get(action.actor_player_id);

    return (
      assignment !== undefined &&
      playerState !== undefined &&
      (action.actor_role_id === null || assignment.role_id === action.actor_role_id) &&
      (action.actor_state_requirement === "assigned" || playerState.alive)
    );
  }

  return [...assignmentByPlayer.values()].some(
    (assignment) =>
      assignment.role_id === action.actor_role_id &&
      (action.actor_state_requirement === "assigned" ||
        stateByPlayer.get(assignment.player_id)?.alive === true),
  );
}

function hasConsistentDaySpeechSlots(
  slots: readonly DaySpeechSlotRecord[],
  state: GameRecord,
  ruleSet: GameRuleSetRecord,
  stateByPlayer: ReadonlyMap<number, GamePlayerRecord>,
): boolean {
  if (slots.length === 0) {
    return true;
  }

  const sortedIndices = slots
    .map((slot) => slot.slot_index)
    .toSorted((left, right) => left - right);

  return (
    state.status === "playing" &&
    state.phase === "day" &&
    ruleSet.options["dayMode"] === "ordered_speech" &&
    hasUniqueValues(sortedIndices) &&
    sortedIndices.every((slotIndex, index) => slotIndex === index) &&
    slots.every((slot) => stateByPlayer.has(slot.speaker_player_id))
  );
}

function hasConsistentEvents(
  publicEvents: readonly GameEventRecord[],
  privateEvents: readonly GameEventRecord[],
  viewerPlayerId: number | null,
): boolean {
  const eventIds = [...publicEvents, ...privateEvents].map((event) => event.id);

  return (
    publicEvents.length <= 250 &&
    privateEvents.length <= 250 &&
    hasUniqueValues(eventIds) &&
    (viewerPlayerId !== null || privateEvents.length === 0)
  );
}

function hasConsistentNightConversationMessages(
  messages: readonly NightConversationMessageRecord[],
  viewerPlayerId: number | null,
  state: GameRecord,
  setup: ResolvedRoleSetupRecordShape,
  assignmentByPlayer: ReadonlyMap<number, GamePlayerRecord>,
  playerIds: ReadonlySet<number>,
): boolean {
  if (messages.length === 0) {
    return true;
  }

  const viewerRoleId =
    viewerPlayerId === null ? null : (assignmentByPlayer.get(viewerPlayerId)?.role_id ?? null);

  if (
    viewerRoleId === null ||
    messages.length > 100 ||
    !hasUniqueValues(messages.map((message) => message.id))
  ) {
    return false;
  }

  return messages.every((message) => {
    const group = setup.nightConversationGroups.find(
      (candidate) => candidate.groupId === message.conversation_group_id,
    );
    const senderRoleId = assignmentByPlayer.get(message.sender_player_id)?.role_id;

    return (
      group?.roleIds.includes(viewerRoleId) === true &&
      senderRoleId !== undefined &&
      group.roleIds.includes(senderRoleId) &&
      playerIds.has(message.sender_player_id) &&
      message.night_number === state.night_number
    );
  });
}

function hasConsistentRealtimeTopics(
  topics: readonly RealtimeTopicRecord[],
  playerIds: ReadonlySet<number>,
  activeRoleIds: ReadonlySet<RoleId> | null,
  gameId: string | null,
): boolean {
  const roomTopics = topics.filter((topic) => topic.scope === "room");
  const playerTopics = topics.filter((topic) => topic.scope === "player_private");
  const roleTopics = topics.filter((topic) => topic.scope === "role_private");
  const expectedRoleIds = activeRoleIds ?? new Set<RoleId>();

  return (
    hasUniqueValues(topics.map((topic) => topic.topic)) &&
    roomTopics.length === 1 &&
    roomTopics.every((topic) => topic.game_id === null) &&
    playerTopics.length === playerIds.size &&
    hasUniqueValues(playerTopics.map((topic) => topic.player_id)) &&
    playerTopics.every(
      (topic) =>
        topic.game_id === null && topic.player_id !== null && playerIds.has(topic.player_id),
    ) &&
    roleTopics.length === expectedRoleIds.size &&
    hasUniqueValues(roleTopics.map((topic) => topic.role_id)) &&
    roleTopics.every(
      (topic) =>
        topic.game_id === gameId && topic.role_id !== null && expectedRoleIds.has(topic.role_id),
    )
  );
}

function hasConsistentResolvedActions(
  resolvedActions: readonly ResolvedActionRecord[],
  currentActions: readonly CurrentActionRecord[],
  state: GameRecord,
  assignmentByPlayer: ReadonlyMap<number, GamePlayerRecord>,
  playerIds: ReadonlySet<number>,
  activeRoleIds: ReadonlySet<RoleId>,
): boolean {
  const currentActionKeys = new Set(
    currentActions.map((action) => `${action.phase_instance_id}:${action.action_key}`),
  );

  if (
    !hasUniqueValues(resolvedActions.map((action) => action.id)) ||
    !hasUniqueValues(
      resolvedActions.map((action) => `${action.phase_instance_id}:${action.action_key}`),
    ) ||
    !resolvedActions.every((action, index) => {
      const previous = resolvedActions[index - 1];

      if (previous === undefined) {
        return true;
      }

      const previousTime = Date.parse(previous.resolved_at);
      const currentTime = Date.parse(action.resolved_at);

      return (
        previousTime < currentTime || (previousTime === currentTime && previous.id < action.id)
      );
    })
  ) {
    return false;
  }

  return resolvedActions.every((action) => {
    const actorAssignment =
      action.actor_player_id === null ? null : assignmentByPlayer.get(action.actor_player_id);

    return (
      (action.resolver_role_id === null || activeRoleIds.has(action.resolver_role_id)) &&
      (action.actor_role_id === null || activeRoleIds.has(action.actor_role_id)) &&
      (action.actor_player_id === null || actorAssignment !== undefined) &&
      (action.actor_role_id === null ||
        (actorAssignment === null
          ? [...assignmentByPlayer.values()].some(
              (assignment) => assignment.role_id === action.actor_role_id,
            )
          : actorAssignment?.role_id === action.actor_role_id)) &&
      (action.target_player_id === null || playerIds.has(action.target_player_id)) &&
      action.phase_instance_id !== state.phase_instance_id &&
      !currentActionKeys.has(`${action.phase_instance_id}:${action.action_key}`)
    );
  });
}

const ROOM_SNAPSHOT_KEYS = [
  "currentGame",
  "lobbyPlayers",
  "realtimeTopics",
  "room",
  "version",
  "viewerPlayerId",
] as const satisfies readonly (keyof RoomSnapshot)[];

const GAME_RUNTIME_SNAPSHOT_KEYS = [
  "currentActions",
  "daySpeechSlots",
  "game",
  "gamePlayers",
  "nightConversationMessages",
  "pendingActions",
  "privateEvents",
  "publicEvents",
  "resolvedActions",
  "ruleSet",
] as const satisfies readonly (keyof GameRuntimeSnapshot)[];

const ROOM_RECORD_KEYS = [
  "closed_at",
  "created_at",
  "current_game_id",
  "host_account_id",
  "id",
  "public_room_code",
  "roster_revision",
  "snapshot_revision",
  "status",
  "target_player_count",
  "updated_at",
  "lobby_expires_at",
] as const satisfies readonly (keyof RoomRecord)[];

const PLAYER_RECORD_KEYS = [
  "account_id",
  "disconnected_at",
  "display_name",
  "id",
  "joined_at",
  "last_seen_at",
  "left_at",
  "private_snapshot_revision",
  "public_player_id",
  "ready_roster_revision",
  "room_id",
  "status",
] as const satisfies readonly (keyof PlayerRecord)[];

const GAME_RECORD_KEYS = [
  "action_revision",
  "day_number",
  "ended_at",
  "id",
  "night_number",
  "phase",
  "phase_ends_at",
  "phase_instance_id",
  "phase_started_at",
  "revision",
  "started_at",
  "status",
  "winner_team",
] as const satisfies readonly (keyof GameRecord)[];

const CURRENT_ACTION_RECORD_KEYS = [
  "action_key",
  "action_kind",
  "actor_player_id",
  "actor_role_id",
  "actor_state_requirement",
  "closes_at",
  "created_at",
  "eligible_target_player_ids",
  "id",
  "phase_instance_id",
  "resolver_role_id",
  "target_kind",
  "target_state_requirement",
] as const satisfies readonly (keyof CurrentActionRecord)[];

const GAME_EVENT_RECORD_KEYS = [
  "created_at",
  "event_kind",
  "id",
  "payload",
  "phase_instance_id",
  "visibility",
] as const satisfies readonly (keyof GameEventRecord)[];

const GAME_RULE_SET_RECORD_KEYS = [
  "engine_version",
  "options",
  "resolved_role_setup",
  "role_counts",
  "role_registry_version",
] as const satisfies readonly (keyof GameRuleSetRecord)[];

const RESOLVED_ACTION_RECORD_KEYS = [
  "action_key",
  "action_kind",
  "actor_player_id",
  "actor_role_id",
  "day_number",
  "id",
  "night_number",
  "phase",
  "phase_instance_id",
  "resolution_status",
  "resolved_at",
  "resolver_role_id",
  "target_player_id",
] as const satisfies readonly (keyof ResolvedActionRecord)[];

const RULE_SET_OPTION_KEYS = [
  ...RULE_SET_NUMBER_FIELDS,
  "dayMode",
  "roleOptions",
  "voteResultVisibility",
] as const;

const ISO_TIMESTAMP_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PUBLIC_PLAYER_ID_PATTERN = /^pl_[A-Za-z0-9_-]{16,64}$/u;
const CONVERSATION_GROUP_ID_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/u;
const REALTIME_TOPIC_PATTERNS: Readonly<Record<RealtimeScope, RegExp>> = {
  player_private: /^player:[A-Za-z0-9_-]{32,128}$/u,
  role_private: /^role:[A-Za-z0-9_-]{32,128}$/u,
  room: /^room:[A-Za-z0-9_-]{32,128}$/u,
};
const MAX_JSON_DEPTH = 100;

function isRoomRecord(value: unknown): value is RoomRecord {
  if (
    !hasExactKeys(value, ROOM_RECORD_KEYS) ||
    !isPositiveSafeInteger(value["id"]) ||
    !isPositiveSafeInteger(value["host_account_id"]) ||
    typeof value["public_room_code"] !== "string" ||
    !/^\d{6}$/u.test(value["public_room_code"]) ||
    !isNullable(value["current_game_id"], isUuid) ||
    !isNonNegativeSafeInteger(value["roster_revision"]) ||
    !isNonNegativeSafeInteger(value["snapshot_revision"]) ||
    !isSafeIntegerBetween(value["target_player_count"], MIN_ROOM_PLAYERS, MAX_ROOM_PLAYERS) ||
    !isTimestamp(value["created_at"]) ||
    !isTimestamp(value["lobby_expires_at"]) ||
    !isNullable(value["closed_at"], isTimestamp) ||
    !isTimestamp(value["updated_at"]) ||
    (value["status"] !== "waiting" &&
      value["status"] !== "playing" &&
      value["status"] !== "ended" &&
      value["status"] !== "closed")
  ) {
    return false;
  }

  const createdAt = Date.parse(value["created_at"]);
  const lobbyExpiresAt = Date.parse(value["lobby_expires_at"]);
  const closedAt = value["closed_at"] === null ? null : Date.parse(value["closed_at"]);
  const updatedAt = Date.parse(value["updated_at"]);

  if (
    lobbyExpiresAt < createdAt ||
    updatedAt < createdAt ||
    (closedAt !== null && (closedAt < createdAt || updatedAt < closedAt))
  ) {
    return false;
  }

  switch (value["status"]) {
    case "closed":
      return closedAt !== null;
    case "ended":
      return closedAt === null && value["current_game_id"] !== null;
    case "playing":
      return closedAt === null && value["current_game_id"] !== null;
    case "waiting":
      return closedAt === null && value["current_game_id"] === null;
  }
}

function isPlayerRecord(value: unknown): value is PlayerRecord {
  if (
    !hasExactKeys(value, PLAYER_RECORD_KEYS) ||
    !isPositiveSafeInteger(value["id"]) ||
    !isPositiveSafeInteger(value["room_id"]) ||
    !isPositiveSafeInteger(value["account_id"]) ||
    typeof value["public_player_id"] !== "string" ||
    !PUBLIC_PLAYER_ID_PATTERN.test(value["public_player_id"]) ||
    !isTrimmedString(value["display_name"], 1, DISPLAY_NAME_MAX_LENGTH) ||
    !isTimestamp(value["joined_at"]) ||
    !isTimestamp(value["last_seen_at"]) ||
    !isNonNegativeSafeInteger(value["private_snapshot_revision"]) ||
    !isNullable(value["ready_roster_revision"], isNonNegativeSafeInteger) ||
    !isNullable(value["left_at"], isTimestamp) ||
    !isNullable(value["disconnected_at"], isTimestamp) ||
    (value["status"] !== "joined" &&
      value["status"] !== "disconnected" &&
      value["status"] !== "left")
  ) {
    return false;
  }

  const joinedAt = Date.parse(value["joined_at"]);
  const lastSeenAt = Date.parse(value["last_seen_at"]);
  const leftAt = value["left_at"] === null ? null : Date.parse(value["left_at"]);
  const disconnectedAt =
    value["disconnected_at"] === null ? null : Date.parse(value["disconnected_at"]);

  if (
    lastSeenAt < joinedAt ||
    (leftAt !== null && leftAt < lastSeenAt) ||
    (disconnectedAt !== null && disconnectedAt < lastSeenAt)
  ) {
    return false;
  }

  switch (value["status"]) {
    case "disconnected":
      return disconnectedAt !== null && leftAt === null;
    case "joined":
      return disconnectedAt === null && leftAt === null;
    case "left":
      return disconnectedAt === null && leftAt !== null;
  }
}

function isGameRecord(value: unknown): value is GameRecord {
  if (
    !hasExactKeys(value, GAME_RECORD_KEYS) ||
    !isUuid(value["id"]) ||
    !isNonNegativeSafeInteger(value["action_revision"]) ||
    !isNonNegativeSafeInteger(value["revision"]) ||
    !isNonNegativeSafeInteger(value["day_number"]) ||
    !isPositiveSafeInteger(value["night_number"]) ||
    !isNullable(value["phase"], isGamePhase) ||
    !isNullable(value["phase_instance_id"], isUuid) ||
    !isNullable(value["phase_started_at"], isTimestamp) ||
    !isNullable(value["phase_ends_at"], isTimestamp) ||
    !isTimestamp(value["started_at"]) ||
    !isNullable(value["ended_at"], isTimestamp) ||
    !isNullable(value["winner_team"], isRoleId) ||
    (value["status"] !== "playing" && value["status"] !== "ended")
  ) {
    return false;
  }

  const phase = value["phase"];
  const dayNumber = value["day_number"];
  const nightNumber = value["night_number"];
  const countersMatch =
    (phase === "night" && nightNumber === dayNumber + 1) ||
    ((phase === "day" || phase === "voting" || phase === "execution") &&
      dayNumber >= 1 &&
      nightNumber === dayNumber) ||
    (phase === null && nightNumber >= dayNumber && nightNumber <= dayNumber + 1);

  if (!countersMatch) {
    return false;
  }

  const startedAt = Date.parse(value["started_at"]);

  if (
    (value["phase_started_at"] !== null && Date.parse(value["phase_started_at"]) < startedAt) ||
    (value["ended_at"] !== null && Date.parse(value["ended_at"]) < startedAt)
  ) {
    return false;
  }

  if (value["status"] === "playing") {
    return (
      phase !== null &&
      value["phase_instance_id"] !== null &&
      value["phase_started_at"] !== null &&
      value["phase_ends_at"] !== null &&
      value["ended_at"] === null &&
      value["winner_team"] === null &&
      Date.parse(value["phase_ends_at"]) > Date.parse(value["phase_started_at"])
    );
  }

  return (
    phase === null &&
    value["phase_instance_id"] === null &&
    value["phase_started_at"] === null &&
    value["phase_ends_at"] === null &&
    value["ended_at"] !== null &&
    value["winner_team"] !== null
  );
}

function isGamePlayerRecord(value: unknown): value is GamePlayerRecord {
  return (
    hasExactKeys(value, ["alive", "player_id", "result", "role_id"]) &&
    typeof value["alive"] === "boolean" &&
    isPositiveSafeInteger(value["player_id"]) &&
    isRoleId(value["role_id"]) &&
    isNullable(value["result"], isPlayerResult)
  );
}

function isCurrentActionRecord(value: unknown): value is CurrentActionRecord {
  if (
    !hasExactKeys(value, CURRENT_ACTION_RECORD_KEYS) ||
    !isPositiveSafeInteger(value["id"]) ||
    !isUuid(value["phase_instance_id"]) ||
    !isActionKey(value["action_key"]) ||
    !isActionKind(value["action_kind"]) ||
    !isNullable(value["resolver_role_id"], isRoleId) ||
    !isNullable(value["actor_player_id"], isPositiveSafeInteger) ||
    !isNullable(value["actor_role_id"], isRoleId) ||
    (value["actor_player_id"] === null && value["actor_role_id"] === null) ||
    (value["actor_state_requirement"] !== "alive" &&
      value["actor_state_requirement"] !== "assigned") ||
    (value["target_kind"] !== "none" && value["target_kind"] !== "single_player") ||
    (value["target_state_requirement"] !== "alive" &&
      value["target_state_requirement"] !== "assigned") ||
    !isTimestamp(value["created_at"]) ||
    !isNullable(value["closes_at"], isTimestamp) ||
    !isArrayOf(value["eligible_target_player_ids"], isPositiveSafeInteger) ||
    !hasUniqueValues(value["eligible_target_player_ids"])
  ) {
    return false;
  }

  return (
    value["closes_at"] === null || Date.parse(value["closes_at"]) >= Date.parse(value["created_at"])
  );
}

function isPendingActionRecord(value: unknown): value is PendingActionRecord {
  return (
    hasExactKeys(value, [
      "current_action_id",
      "submitted_at",
      "submitter_player_id",
      "target_player_id",
    ]) &&
    isPositiveSafeInteger(value["current_action_id"]) &&
    isPositiveSafeInteger(value["submitter_player_id"]) &&
    isNullable(value["target_player_id"], isPositiveSafeInteger) &&
    isTimestamp(value["submitted_at"])
  );
}

function isDaySpeechSlotRecord(value: unknown): value is DaySpeechSlotRecord {
  return (
    hasExactKeys(value, ["slot_index", "speaker_player_id"]) &&
    isNonNegativeSafeInteger(value["slot_index"]) &&
    isPositiveSafeInteger(value["speaker_player_id"])
  );
}

function isGameEventRecord(
  value: unknown,
  expectedVisibility: GameEventRecord["visibility"],
): value is GameEventRecord {
  return (
    hasExactKeys(value, GAME_EVENT_RECORD_KEYS) &&
    isPositiveSafeInteger(value["id"]) &&
    isEventKind(value["event_kind"]) &&
    value["visibility"] === expectedVisibility &&
    isJsonObject(value["payload"]) &&
    isUuid(value["phase_instance_id"]) &&
    isTimestamp(value["created_at"])
  );
}

function isPlayerResult(value: unknown): value is PlayerResult {
  return value === "win" || value === "lose" || value === "draw" || value === "special";
}

function isGameRuleSetRecord(value: unknown): value is GameRuleSetRecord {
  if (
    !hasExactKeys(value, GAME_RULE_SET_RECORD_KEYS) ||
    typeof value["engine_version"] !== "string" ||
    !VERSION_PATTERN.test(value["engine_version"]) ||
    typeof value["role_registry_version"] !== "string" ||
    !VERSION_PATTERN.test(value["role_registry_version"]) ||
    !isRoleCountsRecord(value["role_counts"]) ||
    !isRuleSetOptionsRecord(value["options"]) ||
    !isResolvedRoleSetupRecord(value["resolved_role_setup"])
  ) {
    return false;
  }

  const positiveRoleIds = Object.entries(value["role_counts"])
    .filter(([, count]) => count > 0)
    .map(([roleId]) => roleId);
  const activeRoleIds = value["resolved_role_setup"].activeRoleIds;

  return hasSameValues(positiveRoleIds, activeRoleIds);
}

function isRoleCountsRecord(value: unknown): value is Record<RoleId, number> {
  return (
    isJsonObject(value) &&
    Object.entries(value).every(
      ([roleId, count]) => isRoleId(roleId) && isNonNegativeSafeInteger(count),
    )
  );
}

function isRuleSetOptionsRecord(value: unknown): value is GameRuleSetRecord["options"] {
  return (
    hasExactKeys(value, RULE_SET_OPTION_KEYS) &&
    RULE_SET_NUMBER_FIELDS.every((field) => isValidRuleSetNumber(field, value[field])) &&
    (value["dayMode"] === "ready_check" || value["dayMode"] === "ordered_speech") &&
    (value["voteResultVisibility"] === "count_only" ||
      value["voteResultVisibility"] === "voter_to_target") &&
    isRoleOptionsRecord(value["roleOptions"])
  );
}

function isRoleOptionsRecord(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    Object.entries(value).every(
      ([roleId, roleOptions]) =>
        isRoleId(roleId) &&
        isJsonObject(roleOptions) &&
        Object.entries(roleOptions).every(
          ([optionKey, optionValue]) =>
            isRoleId(optionKey) && isStringWithCodePointLength(optionValue, 1, 64),
        ),
    )
  );
}

type ResolvedRoleSetupRecordShape = {
  activeRoleIds: RoleId[];
  contributions: {
    judgement: {
      id: string;
      priority: number;
      sourceRoleId: RoleId;
      winnerTeam: string;
    };
    kind: "winner_judgement";
  }[];
  nightConversationGroups: {
    groupId: string;
    label: LocalizedText;
    roleIds: RoleId[];
  }[];
};

function isResolvedRoleSetupRecord(value: unknown): value is ResolvedRoleSetupRecordShape {
  if (
    !hasExactKeys(value, ["activeRoleIds", "contributions", "nightConversationGroups"]) ||
    !isArrayOf(value["activeRoleIds"], isRoleId) ||
    !hasUniqueValues(value["activeRoleIds"]) ||
    !Array.isArray(value["contributions"]) ||
    !Array.isArray(value["nightConversationGroups"])
  ) {
    return false;
  }

  const activeRoleIds = new Set(value["activeRoleIds"]);
  const judgementKeys = new Set<string>();

  for (const contribution of value["contributions"]) {
    if (
      !hasExactKeys(contribution, ["judgement", "kind"]) ||
      contribution["kind"] !== "winner_judgement" ||
      !hasExactKeys(contribution["judgement"], ["id", "priority", "sourceRoleId", "winnerTeam"]) ||
      !isActionKey(contribution["judgement"]["id"]) ||
      !isSafeIntegerBetween(contribution["judgement"]["priority"], -2_147_483_648, 2_147_483_647) ||
      !isRoleId(contribution["judgement"]["sourceRoleId"]) ||
      !activeRoleIds.has(contribution["judgement"]["sourceRoleId"]) ||
      !isRoleId(contribution["judgement"]["winnerTeam"])
    ) {
      return false;
    }

    const judgementKey = `${contribution["judgement"]["sourceRoleId"]}\u0000${contribution["judgement"]["id"]}`;

    if (judgementKeys.has(judgementKey)) {
      return false;
    }

    judgementKeys.add(judgementKey);
  }

  if (judgementKeys.size === 0) {
    return false;
  }

  const groupIds = new Set<string>();
  const groupedRoleIds = new Set<RoleId>();

  for (const group of value["nightConversationGroups"]) {
    if (
      !hasExactKeys(group, ["groupId", "label", "roleIds"]) ||
      typeof group["groupId"] !== "string" ||
      !CONVERSATION_GROUP_ID_PATTERN.test(group["groupId"]) ||
      groupIds.has(group["groupId"]) ||
      !isLocalizedText(group["label"], 128) ||
      !isArrayOf(group["roleIds"], isRoleId) ||
      group["roleIds"].length === 0 ||
      !hasUniqueValues(group["roleIds"]) ||
      group["roleIds"].some((roleId) => !activeRoleIds.has(roleId) || groupedRoleIds.has(roleId))
    ) {
      return false;
    }

    groupIds.add(group["groupId"]);

    for (const roleId of group["roleIds"]) {
      groupedRoleIds.add(roleId);
    }
  }

  return true;
}

function isNightConversationMessageRecord(value: unknown): value is NightConversationMessageRecord {
  return (
    hasExactKeys(value, [
      "body",
      "conversation_group_id",
      "created_at",
      "id",
      "night_number",
      "sender_player_id",
    ]) &&
    isPositiveSafeInteger(value["id"]) &&
    isPositiveSafeInteger(value["night_number"]) &&
    typeof value["conversation_group_id"] === "string" &&
    CONVERSATION_GROUP_ID_PATTERN.test(value["conversation_group_id"]) &&
    isPositiveSafeInteger(value["sender_player_id"]) &&
    isTrimmedString(value["body"], 1, NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH) &&
    isTimestamp(value["created_at"])
  );
}

function isRealtimeTopicRecord(value: unknown): value is RealtimeTopicRecord {
  if (
    !hasExactKeys(value, ["game_id", "player_id", "role_id", "scope", "topic"]) ||
    !isNullable(value["game_id"], isUuid) ||
    (value["scope"] !== "room" &&
      value["scope"] !== "player_private" &&
      value["scope"] !== "role_private") ||
    typeof value["topic"] !== "string" ||
    !REALTIME_TOPIC_PATTERNS[value["scope"]].test(value["topic"])
  ) {
    return false;
  }

  switch (value["scope"]) {
    case "player_private":
      return (
        value["game_id"] === null &&
        isPositiveSafeInteger(value["player_id"]) &&
        value["role_id"] === null
      );
    case "role_private":
      return value["game_id"] !== null && value["player_id"] === null && isRoleId(value["role_id"]);
    case "room":
      return value["game_id"] === null && value["player_id"] === null && value["role_id"] === null;
  }
}

function isResolvedActionRecord(value: unknown): value is ResolvedActionRecord {
  if (
    !hasExactKeys(value, RESOLVED_ACTION_RECORD_KEYS) ||
    !isPositiveSafeInteger(value["id"]) ||
    !isUuid(value["phase_instance_id"]) ||
    !isGamePhase(value["phase"]) ||
    !isActionKey(value["action_key"]) ||
    !isActionKind(value["action_kind"]) ||
    !isNullable(value["resolver_role_id"], isRoleId) ||
    !isNullable(value["actor_player_id"], isPositiveSafeInteger) ||
    !isNullable(value["actor_role_id"], isRoleId) ||
    (value["actor_player_id"] === null && value["actor_role_id"] === null) ||
    !isNonNegativeSafeInteger(value["day_number"]) ||
    !isPositiveSafeInteger(value["night_number"]) ||
    !isNullable(value["target_player_id"], isPositiveSafeInteger) ||
    (value["resolution_status"] !== "missing" && value["resolution_status"] !== "submitted") ||
    !isTimestamp(value["resolved_at"])
  ) {
    return false;
  }

  const countersMatch =
    (value["phase"] === "night" && value["night_number"] === value["day_number"] + 1) ||
    (value["phase"] !== "night" &&
      value["day_number"] >= 1 &&
      value["night_number"] === value["day_number"]);

  return (
    countersMatch &&
    (value["resolution_status"] === "submitted"
      ? value["actor_player_id"] !== null
      : value["target_player_id"] === null)
  );
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value);

  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(predicate);
}

function isNullable<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
): value is T | null {
  return value === null || predicate(value);
}

function isGamePhase(value: unknown): value is NonNullable<GameRecord["phase"]> {
  return value === "night" || value === "day" || value === "voting" || value === "execution";
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (match?.groups === undefined) {
    return false;
  }

  const year = Number(match.groups["year"]);
  const month = Number(match.groups["month"]);
  const day = Number(match.groups["day"]);
  const hour = Number(match.groups["hour"]);
  const minute = Number(match.groups["minute"]);
  const second = Number(match.groups["second"]);
  const calendarDate = new Date(0);

  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(hour, minute, second, 0);

  return (
    year > 0 &&
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day &&
    calendarDate.getUTCHours() === hour &&
    calendarDate.getUTCMinutes() === minute &&
    calendarDate.getUTCSeconds() === second &&
    Number.isFinite(Date.parse(value))
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSafeIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function isStringWithCodePointLength(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const length = getCodePointLength(value);

  return length >= minimumLength && length <= maximumLength;
}

function isTrimmedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return isStringWithCodePointLength(value, minimumLength, maximumLength) && value.trim() === value;
}

function hasUniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function hasSameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && isRecord(value);
}

function isJsonValue(
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set<object>(),
): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }

  if (depth >= MAX_JSON_DEPTH || typeof value !== "object") {
    return false;
  }

  if (ancestors.has(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  const valid = children.every((child) => isJsonValue(child, depth + 1, ancestors));
  ancestors.delete(value);

  return valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
