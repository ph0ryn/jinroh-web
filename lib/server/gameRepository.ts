import "server-only";
import { randomBytes, randomUUID } from "node:crypto";

import {
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type PrivateGameEvent,
  type PlayerResult,
  type PublicAction,
  type PublicActionProgress,
  type PublicGameEvent,
  type PublicGameView,
  type PublicPhaseFocus,
  type PublicPlayer,
  type PublicSubmittedAction,
  type RealtimeScope,
  type RealtimeSubscription,
  type RoleId,
  type RoleCatalogItem,
  type RolePrivateView,
  type RoomStatus,
  type RoomSummary,
  type RuleSet,
  type RuleSetInput,
  type SelfPrivateView,
} from "@/lib/shared/game";

import {
  createAccountToken,
  hashAccountToken,
  isValidTokenShape,
  TOKEN_HASH_KEY_ID,
} from "./accountToken";
import { getRoleCatalog, getRoleIds, roleRegistry } from "./game/roles";
import {
  DEFAULT_RULE_OPTIONS,
  makeDefaultRoleCounts,
  resolveRoleSetup as resolveRegisteredRoleSetup,
  type RuleSet as RegisteredRuleSet,
} from "./game/ruleset";
import { toRegisteredRuleOptions, toSharedRuleOptions } from "./game/ruleSetAdapters";
import { Team as RegisteredTeam } from "./game/types";
import { buildRealtimeNotificationPayload } from "./game/views";
import {
  ENGINE_VERSION,
  parseRoleCounts,
  resolvePhase,
  ROLE_REGISTRY_VERSION,
  startGame,
  type EngineAction,
  type EngineEvent,
  type OrderedSpeechSlot,
  type PlayerRuntimeState,
  type SubmittedAction,
} from "./gameEngine";
import { createServiceClient } from "./supabase";

type SupabaseClient = ReturnType<typeof createServiceClient>;

type AccountRecord = {
  id: number;
};

type TokenRecord = {
  account_id: number;
};

type RoomRecord = {
  id: number;
  public_room_code: string;
  status: RoomStatus;
  host_account_id: number;
  realtime_topic: string;
  lobby_expires_at: string;
  target_player_count: number;
};

type RoomMutationResultRecord = Omit<RoomRecord, "target_player_count"> & {
  actor_player_id: number | null;
  notification_reason: string | null;
};

type PlayerRecord = {
  account_id: number;
  display_name: string;
  id: number;
  public_player_id: string;
  room_id: number;
  status: "joined" | "disconnected" | "left";
};

type GameStateRecord = {
  day_number: number;
  final_outcome_id: number | null;
  id: number;
  night_number: number;
  phase: "night" | "day" | "voting" | "execution" | null;
  phase_ends_at: string | null;
  phase_instance_id: string | null;
  revision: number;
  resolved_role_setup: JsonObject | null;
  room_id: number;
  status: "waiting" | "assigning_roles" | "playing" | "ended";
};

type RoleAssignmentRecord = {
  player_id: number;
  role_id: string;
};

type GamePlayerStateRecord = {
  alive: boolean;
  player_id: number;
};

type CurrentActionRecord = {
  action_key: string;
  action_kind: string;
  actor_player_id: number | null;
  actor_role_id: string | null;
  closes_at: string | null;
  eligible_target_player_ids: number[];
  id: number;
  phase_instance_id: string;
  target_kind: "none" | "single_player";
};

type PendingActionRecord = {
  id: number;
  current_action_id: number;
  submitter_player_id: number;
  submitted_at: string;
  target_player_id: number | null;
};

type DaySpeechSlotRecord = {
  slot_index: number;
  speaker_player_id: number;
};

type GameEventRecord = {
  created_at: string;
  event_kind: string;
  id: number;
  payload: Record<string, unknown>;
  visibility: "public" | "private" | "internal";
};

type GameEventVisiblePlayerRecord = {
  game_event_id: number;
  player_id: number;
};

type GameEventVisibleRoleRecord = {
  game_event_id: number;
  role_id: string;
};

type FinalOutcomeRecord = {
  reason: string;
  winner_team: string;
};

type PlayerResultRecord = {
  player_id: number;
  result: PlayerResult;
};

type GameRuleSetRecord = {
  options: Record<string, unknown>;
  role_counts: Record<string, unknown>;
};

type NightConversationMessageRecord = {
  body: string;
  conversation_group_id: string;
  created_at: string;
  id: number;
  night_number: number;
  sender_player_id: number;
};

type RealtimeSubscriptionRecord = {
  expires_at: string;
  grant_id: string;
  scope: RealtimeScope;
  topic: string;
};

type RealtimeTopicRecord = {
  scope: RealtimeScope;
  topic: string;
};

type BroadcastMutationOptions = {
  privateRoleIds?: readonly RoleId[];
};

type JsonObject = Record<string, unknown>;

const NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH = 100;

export type IdentityResult = {
  token: string;
};

export type ExpiredLobbyCleanupResult = {
  expiredRooms: number;
};

export async function createIdentity(): Promise<IdentityResult> {
  const supabase = createServiceClient();
  const token = createAccountToken();
  const tokenHash = hashAccountToken(token);
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({})
    .select("id")
    .single<AccountRecord>();

  if (accountError !== null) {
    throw new Error(accountError.message);
  }

  const { error: tokenError } = await supabase.from("account_tokens").insert({
    account_id: account.id,
    token_hash: tokenHash,
    token_hash_key_id: TOKEN_HASH_KEY_ID,
  });

  if (tokenError !== null) {
    throw new Error(tokenError.message);
  }

  return { token };
}

export async function authenticate(rawToken: string): Promise<AccountRecord | null> {
  if (!isValidTokenShape(rawToken)) {
    return null;
  }

  const supabase = createServiceClient();
  const tokenHash = hashAccountToken(rawToken);
  const { data, error } = await supabase
    .from("account_tokens")
    .select("account_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle<TokenRecord>();

  if (error !== null || data === null) {
    return null;
  }

  await supabase
    .from("account_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return { id: data.account_id };
}

export async function createRoom(
  account: AccountRecord,
  displayName: string,
  targetPlayerCount: number,
): Promise<RoomSummary> {
  if (
    !Number.isInteger(targetPlayerCount) ||
    targetPlayerCount < MIN_ROOM_PLAYERS ||
    targetPlayerCount > MAX_ROOM_PLAYERS
  ) {
    throw new Error("Target player count is out of range.");
  }

  const supabase = createServiceClient();

  await cleanupExpiredLobbiesWithClient(supabase, 50);

  const roomCode = await createUniqueRoomCode(supabase);
  const lobbyExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const realtimeTopic = `room:${randomBytes(24).toString("base64url")}`;
  const playerId = createPublicPlayerId();
  const normalizedDisplayName = normalizeDisplayName(displayName);
  const transactionResult = await callRoomMutationRpc(supabase, "app_create_room", {
    p_account_id: account.id,
    p_display_name: normalizedDisplayName,
    p_lobby_expires_at: lobbyExpiresAt,
    p_public_player_id: playerId,
    p_public_room_code: roomCode,
    p_realtime_topic: realtimeTopic,
    p_target_player_count: targetPlayerCount,
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  return getRoomViewByRoom(supabase, account, room);
}

export async function cleanupExpiredLobbies(limit = 50): Promise<ExpiredLobbyCleanupResult> {
  const supabase = createServiceClient();
  const expiredRooms = await cleanupExpiredLobbiesWithClient(supabase, limit);

  return { expiredRooms: expiredRooms.length };
}

export async function joinRoom(
  account: AccountRecord,
  roomCode: string,
  displayName: string,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transactionResult = await callRoomMutationRpc(supabase, "app_join_room", {
    p_account_id: account.id,
    p_display_name: normalizeDisplayName(displayName),
    p_public_player_id: createPublicPlayerId(),
    p_room_code: roomCode,
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  return getRoomViewByRoom(supabase, account, room);
}

export async function getRoomView(account: AccountRecord, roomCode: string): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const room = await getRoomByCodeOrThrow(supabase, roomCode);
  const activeRoom = await expireLobbyIfNeeded(supabase, room);

  await resolveRoom({ id: activeRoom.host_account_id }, roomCode);

  return getRoomViewByRoom(supabase, account, activeRoom);
}

export async function leaveRoom(account: AccountRecord, roomCode: string): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transactionResult = await callRoomMutationRpc(supabase, "app_leave_room", {
    p_account_id: account.id,
    p_room_code: roomCode,
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  return getRoomViewByRoom(supabase, account, room);
}

export async function heartbeatRoom(
  account: AccountRecord,
  roomCode: string,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transactionResult = await callRoomMutationRpc(supabase, "app_heartbeat_room_player", {
    p_account_id: account.id,
    p_disconnect_after_seconds: 45,
    p_room_code: roomCode,
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  return getRoomViewByRoom(supabase, account, room);
}

export async function startRoom(
  account: AccountRecord,
  roomCode: string,
  ruleSetInput: RuleSetInput | null,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const room = await expireLobbyIfNeeded(supabase, await getRoomByCodeOrThrow(supabase, roomCode));

  if (room.host_account_id !== account.id) {
    throw new Error("Only the host can start the game.");
  }

  await requireJoinedPlayerForAccount(supabase, room.id, account.id);

  if (room.status !== "lobby") {
    throw new Error("Room must be in lobby.");
  }

  const players = await getPlayers(supabase, room.id);
  const joinedPlayers = players.filter((player) => player.status === "joined");

  if (joinedPlayers.length !== room.target_player_count) {
    throw new Error("Room must have the selected number of active players before starting.");
  }

  const startResult = startGame(
    joinedPlayers.map((player) => ({ id: String(player.id), name: player.display_name })),
    ruleSetInput,
  );

  if (!startResult.ok) {
    throw new Error(startResult.errors.join(" "));
  }

  const phaseInstanceId = randomUUID();
  const phaseEndsAt = secondsFromNow(startResult.phaseDurationSeconds);
  const transactionResult = await callRoomMutationRpc(supabase, "app_start_room", {
    p_account_id: account.id,
    p_actions: serializeActions(startResult.actions),
    p_assignments: startResult.assignments.map((assignment) => ({
      player_id: Number.parseInt(assignment.playerId, 10),
      role_id: assignment.roleId,
    })),
    p_engine_version: ENGINE_VERSION,
    p_events: serializeEvents(startResult.initialEvents),
    p_expected_player_ids: joinedPlayers.map((player) => player.id),
    p_options: serializeRuleSetOptions(startResult.ruleSet),
    p_phase_ends_at: phaseEndsAt,
    p_phase_instance_id: phaseInstanceId,
    p_resolved_role_setup: buildResolvedRoleSetup(startResult.ruleSet),
    p_role_counts: startResult.ruleSet.roleCounts,
    p_role_registry_version: ROLE_REGISTRY_VERSION,
    p_room_code: roomCode,
  });
  const startedRoom = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, startedRoom, transactionResult);

  return getRoomViewByRoom(supabase, account, startedRoom);
}

export async function submitAction(
  account: AccountRecord,
  roomCode: string,
  actionKey: string,
  phaseInstanceId: string,
  expectedRevision: number,
  targetPublicPlayerId: string | null,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transactionResult = await callRoomMutationRpc(supabase, "app_submit_action", {
    p_account_id: account.id,
    p_action_key: actionKey,
    p_expected_revision: expectedRevision,
    p_phase_instance_id: phaseInstanceId,
    p_room_code: roomCode,
    p_target_public_player_id: targetPublicPlayerId,
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  // The host identity comes from the persisted room record, not from the action request.
  await resolveRoom({ id: room.host_account_id }, roomCode);

  return getRoomViewByRoom(supabase, account, room);
}

export async function submitNightConversationMessage(
  account: AccountRecord,
  roomCode: string,
  input: {
    body: string;
    conversationGroupId: string;
    nightNumber: number;
    phaseInstanceId: string;
  },
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const room = await getRoomByCodeOrThrow(supabase, roomCode);
  const [currentPlayer, state, assignments] = await Promise.all([
    requireJoinedPlayerForAccount(supabase, room.id, account.id),
    getGameState(supabase, room.id),
    getAssignments(supabase, room.id),
  ]);
  const currentAssignment = assignments.find(
    (assignment) => assignment.player_id === currentPlayer.id,
  );
  const group = getNightConversationGroups(state?.resolved_role_setup ?? null).find(
    (candidate) => candidate.groupId === input.conversationGroupId,
  );
  const normalizedBody = input.body.trim();

  if (
    room.status !== "playing" ||
    state?.status !== "playing" ||
    state.phase !== "night" ||
    state.phase_instance_id !== input.phaseInstanceId ||
    state.night_number !== input.nightNumber ||
    currentAssignment === undefined ||
    !getRoleIds().includes(currentAssignment.role_id) ||
    group === undefined ||
    !group.roleIds.includes(currentAssignment.role_id)
  ) {
    throw new Error("Night conversation is not open.");
  }

  if (normalizedBody.length < 1 || normalizedBody.length > NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH) {
    throw new Error("Night conversation message is invalid.");
  }

  const transactionResult = await callRoomMutationRpc(
    supabase,
    "app_send_night_conversation_message",
    {
      p_account_id: account.id,
      p_body: normalizedBody,
      p_conversation_group_id: input.conversationGroupId,
      p_night_number: input.nightNumber,
      p_phase_instance_id: input.phaseInstanceId,
      p_room_code: roomCode,
    },
  );
  const updatedRoom = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, updatedRoom, transactionResult, {
    privateRoleIds: group.roleIds,
  });

  return getRoomViewByRoom(supabase, account, updatedRoom);
}

async function resolveRoom(account: AccountRecord, roomCode: string): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const room = await getRoomByCodeOrThrow(supabase, roomCode);
  await requireJoinedPlayerForAccount(supabase, room.id, account.id);

  if (room.host_account_id !== account.id) {
    throw new Error("Only the host can advance the phase.");
  }

  if (room.status !== "playing") {
    return getRoomViewByRoom(supabase, account, room);
  }

  const state = await getGameState(supabase, room.id);

  if (state?.status !== "playing" || state.phase === null || state.phase_instance_id === null) {
    return getRoomViewByRoom(supabase, account, room);
  }

  const actions = (await getCurrentActions(supabase, room.id)).filter(
    (action) => action.phase_instance_id === state.phase_instance_id,
  );
  const pendingActions = await getPendingActions(supabase, room.id);
  const currentActionIds = new Set(actions.map((action) => action.id));
  const currentPendingActions = pendingActions.filter((pendingAction) =>
    currentActionIds.has(pendingAction.current_action_id),
  );
  const now = Date.now();
  const phaseTimedOut = state.phase_ends_at !== null && Date.parse(state.phase_ends_at) <= now;
  const allActionsSubmitted =
    actions.length > 0 &&
    actions.every((action) =>
      currentPendingActions.some((pendingAction) => pendingAction.current_action_id === action.id),
    );
  const canResolve =
    phaseTimedOut || ((state.phase !== "night" || state.night_number === 1) && allActionsSubmitted);

  if (!canResolve) {
    return getRoomViewByRoom(supabase, account, room);
  }

  const [runtimePlayers, ruleSet, previousGuardTargetByPlayerId, orderedSpeechSlots] =
    await Promise.all([
      getRuntimePlayers(supabase, room.id),
      getRuleSet(supabase, room.id, room.target_player_count),
      getPreviousGuardTargetByPlayerId(supabase, room.id),
      state.phase === "day" ? getDaySpeechSlots(supabase, room.id, state.phase_instance_id) : [],
    ]);
  const resolution = resolvePhase({
    actions: toSubmittedResolutionActions(actions, currentPendingActions, state, phaseTimedOut),
    currentPhase: state.phase,
    dayNumber: state.day_number,
    nightNumber: state.night_number,
    orderedSpeechSlots,
    players: runtimePlayers,
    previousGuardTargetByPlayerId,
    ruleSet,
  });
  const nextPhaseInstanceId = resolution.nextPhase === null ? null : randomUUID();
  const nextEndsAt =
    resolution.nextPhaseDurationSeconds === null
      ? null
      : secondsFromNow(resolution.nextPhaseDurationSeconds);
  const finalOutcome = resolution.finalOutcome;
  const transactionResult = await callRoomMutationRpc(supabase, "app_resolve_phase", {
    p_account_id: account.id,
    p_actions: serializeActions(resolution.actionsToOpen),
    p_deaths: resolution.deaths.map((death) => ({
      player_id: Number.parseInt(death.playerId, 10),
      reason: death.reason,
    })),
    p_day_speech_slots: serializeDaySpeechSlots(resolution.speechSlotsToCreate),
    p_events: serializeEvents(resolution.events),
    p_expected_current_action_ids: actions
      .map((action) => action.id)
      .toSorted((left, right) => left - right),
    p_expected_pending_action_ids: currentPendingActions
      .map((action) => action.id)
      .toSorted((left, right) => left - right),
    p_expected_revision: state.revision,
    p_final_outcome:
      finalOutcome === null
        ? null
        : {
            reason: finalOutcome.reason,
            winner_team: finalOutcome.winnerTeam,
          },
    p_next_day_number: resolution.nextDayNumber,
    p_next_night_number: resolution.nextNightNumber,
    p_next_phase: resolution.nextPhase,
    p_next_phase_ends_at: nextEndsAt,
    p_next_phase_instance_id: nextPhaseInstanceId,
    p_phase_instance_id: state.phase_instance_id,
    p_player_results:
      finalOutcome === null
        ? []
        : runtimePlayers.map((runtimePlayer) => ({
            player_id: Number.parseInt(runtimePlayer.playerId, 10),
            result: finalOutcome.playerResultsByPlayerId[runtimePlayer.playerId] ?? "lose",
          })),
    p_room_code: roomCode,
  });
  const resolvedRoom = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, resolvedRoom, transactionResult);

  return getRoomViewByRoom(supabase, account, resolvedRoom);
}

async function getRoomViewByRoom(
  supabase: SupabaseClient,
  account: AccountRecord,
  room: RoomRecord,
): Promise<RoomSummary> {
  const currentRoom = await getRoomByIdOrThrow(supabase, room.id);
  const [
    players,
    state,
    assignments,
    playerStates,
    actions,
    pendingActions,
    outcome,
    results,
    nightConversationMessages,
  ] = await Promise.all([
    getPlayers(supabase, currentRoom.id),
    getGameState(supabase, currentRoom.id),
    getAssignments(supabase, currentRoom.id),
    getGamePlayerStates(supabase, currentRoom.id),
    getCurrentActions(supabase, currentRoom.id),
    getPendingActions(supabase, currentRoom.id),
    getFinalOutcome(supabase, currentRoom.id),
    getPlayerResults(supabase, currentRoom.id),
    getNightConversationMessages(supabase, currentRoom.id),
  ]);
  const currentPlayer =
    players.find((player) => player.account_id === account.id && player.status === "joined") ??
    null;
  const isHost = currentPlayer !== null && currentRoom.host_account_id === account.id;
  const assignmentByPlayer = new Map(
    assignments.map((assignment) => [assignment.player_id, assignment]),
  );
  const stateByPlayer = new Map(
    playerStates.map((playerState) => [playerState.player_id, playerState]),
  );
  const resultByPlayer = new Map(results.map((result) => [result.player_id, result]));
  const publicPlayers: PublicPlayer[] = players.map((player) => ({
    alive: stateByPlayer.get(player.id)?.alive ?? null,
    displayName: player.display_name,
    id: player.public_player_id,
    isCurrent: currentPlayer?.id === player.id,
    isHost: player.account_id === currentRoom.host_account_id,
    status: player.status,
  }));
  const currentAssignment =
    currentPlayer === null ? null : (assignmentByPlayer.get(currentPlayer.id) ?? null);
  const registeredRoleIds = new Set(getRoleIds());
  const currentRoleId =
    currentAssignment !== null && registeredRoleIds.has(currentAssignment.role_id)
      ? currentAssignment.role_id
      : null;
  const [events, realtimeSubscriptions, visiblePrivateEvents] = await Promise.all([
    getPublicEvents(supabase, currentRoom.id, players),
    currentPlayer === null
      ? Promise.resolve<RealtimeSubscription[]>([])
      : getRealtimeSubscriptions(supabase, account, currentRoom),
    currentPlayer === null
      ? Promise.resolve<PrivateGameEvent[]>([])
      : getVisiblePrivateEvents(supabase, currentRoom.id, players, currentPlayer, currentRoleId),
  ]);
  const publicGame: PublicGameView | null =
    state === null
      ? null
      : {
          actionProgress: toPublicActionProgress(state, actions, pendingActions),
          dayNumber: state.day_number,
          events,
          nightNumber: state.night_number,
          phase: state.phase,
          phaseEndsAt: state.phase_ends_at,
          phaseFocus: toPublicPhaseFocus(state, actions, players),
          phaseInstanceId: state.phase_instance_id,
          revision: state.revision,
          status: state.status,
          winnerTeam: outcome?.winner_team ?? null,
        };
  const self: SelfPrivateView | null =
    currentPlayer === null
      ? null
      : {
          actions: toPublicActions(actions, pendingActions, players, currentPlayer, currentRoleId),
          events: visiblePrivateEvents,
          playerId: currentPlayer.public_player_id,
          result: resultByPlayer.get(currentPlayer.id)?.result ?? null,
          roleId: currentRoleId,
          roleName: getRoleDisplayName(currentRoleId),
          submittedActions: toSubmittedActions(
            actions,
            pendingActions,
            currentPlayer,
            currentRoleId,
          ),
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
    realtime:
      currentPlayer === null
        ? null
        : { subscriptions: realtimeSubscriptions, topic: currentRoom.realtime_topic },
    rolePrivate: toRolePrivateView(
      players,
      assignments,
      nightConversationMessages,
      currentPlayer,
      currentRoleId,
      state,
    ),
    roleCatalog: getSharedRoleCatalog(),
    self,
    status: currentRoom.status,
    targetPlayerCount: currentRoom.target_player_count,
  };
}

function getSharedRoleCatalog(): RoleCatalogItem[] {
  return getRoleCatalog().map((role) => ({
    description: role.description,
    id: role.id,
    maxCount: role.maxCount,
    minCount: role.minCount,
    name: role.name,
    order: role.order,
    shortLabel: role.shortLabel,
    specificOptions: role.specificOptions.map((option) => ({
      key: option.key,
      label: option.label,
      roleId: option.roleId,
    })),
    team: toSharedTeam(role.team),
  }));
}

function toSharedTeam(team: RegisteredTeam): RoleCatalogItem["team"] {
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

function toPublicActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
  players: readonly PlayerRecord[],
  currentPlayer: PlayerRecord,
  currentRoleId: RoleId | null,
): PublicAction[] {
  const publicIdByInternalId = new Map(
    players.map((player) => [player.id, player.public_player_id]),
  );
  const submittedActionIds = new Set(pendingActions.map((action) => action.current_action_id));

  return actions
    .filter((action) => isActionVisibleToPlayer(action, currentPlayer.id, currentRoleId))
    .map((action) => ({
      closesAt: action.closes_at,
      eligibleTargetIds: action.eligible_target_player_ids
        .map((playerId) => publicIdByInternalId.get(playerId))
        .filter((playerId): playerId is string => playerId !== undefined),
      key: action.action_key,
      kind: action.action_kind as PublicAction["kind"],
      label: labelAction(action.action_kind),
      phaseInstanceId: action.phase_instance_id,
      status: submittedActionIds.has(action.id) ? "submitted" : "open",
      targetKind: action.target_kind,
    }));
}

function toSubmittedActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
  currentPlayer: PlayerRecord,
  currentRoleId: RoleId | null,
): PublicSubmittedAction[] {
  const actionById = new Map(actions.map((action) => [action.id, action]));

  return pendingActions.flatMap((pendingAction) => {
    const action = actionById.get(pendingAction.current_action_id);

    if (action === undefined || !isActionVisibleToPlayer(action, currentPlayer.id, currentRoleId)) {
      return [];
    }

    return [
      {
        kind: action.action_kind as PublicSubmittedAction["kind"],
        label: labelAction(action.action_kind),
        submittedAt: pendingAction.submitted_at,
      },
    ];
  });
}

function isActionVisibleToPlayer(
  action: CurrentActionRecord,
  currentPlayerId: number,
  currentRoleId: RoleId | null,
): boolean {
  if (action.actor_player_id !== null) {
    return action.actor_player_id === currentPlayerId;
  }

  return action.actor_role_id === currentRoleId;
}

export function toPublicActionProgress(
  state: GameStateRecord,
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
): PublicActionProgress | null {
  if (state.status !== "playing" || state.phase === null || state.phase_instance_id === null) {
    return null;
  }

  if (state.phase === "night" && state.night_number > 1) {
    return {
      kind: "night_actions_hidden",
      label: "Night actions are private until dawn.",
      visibility: "hidden",
    };
  }

  const actionIds = new Set(actions.map((action) => action.id));
  const submittedActionIds = new Set(
    pendingActions
      .filter((pendingAction) => actionIds.has(pendingAction.current_action_id))
      .map((pendingAction) => pendingAction.current_action_id),
  );

  return {
    kind:
      state.phase === "day" && actions.some((action) => action.action_kind === "end_speech")
        ? "current_speech_turn"
        : getPublicActionProgressKind(state.phase),
    label:
      state.phase === "day" && actions.some((action) => action.action_kind === "end_speech")
        ? "Current speech turn."
        : labelActionProgress(state.phase),
    required: actions.length,
    submitted: submittedActionIds.size,
    visibility: "public",
  };
}

function getPublicActionProgressKind(
  phase: NonNullable<GameStateRecord["phase"]>,
): Extract<PublicActionProgress, { visibility: "public" }>["kind"] {
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
  state: GameStateRecord,
  actions: readonly CurrentActionRecord[],
  players: readonly PlayerRecord[],
): PublicPhaseFocus | null {
  let focusKind:
    | { actionKind: "end_speech"; kind: "current_speaker" }
    | { actionKind: "execution_skip"; kind: "execution_candidate" }
    | null = null;

  if (state.phase === "day") {
    focusKind = { actionKind: "end_speech", kind: "current_speaker" };
  } else if (state.phase === "execution") {
    focusKind = { actionKind: "execution_skip", kind: "execution_candidate" };
  }

  if (state.status !== "playing" || focusKind === null) {
    return null;
  }

  const actorPlayerId = actions.find(
    (action) => action.action_kind === focusKind.actionKind && action.actor_player_id !== null,
  )?.actor_player_id;
  const publicPlayerId = players.find((player) => player.id === actorPlayerId)?.public_player_id;

  return publicPlayerId === undefined
    ? null
    : {
        kind: focusKind.kind,
        playerId: publicPlayerId,
      };
}

function toRolePrivateView(
  players: readonly PlayerRecord[],
  assignments: readonly RoleAssignmentRecord[],
  nightConversationMessages: readonly NightConversationMessageRecord[],
  currentPlayer: PlayerRecord | null,
  currentRoleId: RoleId | null,
  state: GameStateRecord | null,
): RolePrivateView {
  if (currentPlayer === null || currentRoleId === null || state === null) {
    return null;
  }

  const group = getNightConversationGroups(state.resolved_role_setup).find((candidate) =>
    candidate.roleIds.includes(currentRoleId),
  );

  if (group === undefined) {
    return null;
  }

  return {
    label: `${labelNightConversationGroup(group.labelKey)} private view`,
    nightConversation: toNightConversationView({
      assignments,
      group,
      messages: nightConversationMessages,
      players,
      state,
    }),
    roleId: currentRoleId,
  };
}

type NightConversationGroupConfig = {
  groupId: string;
  labelKey: string;
  roleIds: RoleId[];
};

function toNightConversationView({
  assignments,
  group,
  messages,
  players,
  state,
}: {
  assignments: readonly RoleAssignmentRecord[];
  group: NightConversationGroupConfig;
  messages: readonly NightConversationMessageRecord[];
  players: readonly PlayerRecord[];
  state: GameStateRecord;
}): NonNullable<RolePrivateView>["nightConversation"] {
  if (state.phase === null || state.night_number < 1) {
    return null;
  }

  const playerById = new Map(players.map((player) => [player.id, player]));
  const registeredRoleIds = new Set(getRoleIds());
  const participantPlayerIds = assignments
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

  return {
    canSend: state.status === "playing" && state.phase === "night",
    groupId: group.groupId,
    label: labelNightConversationGroup(group.labelKey),
    labelKey: group.labelKey,
    maxMessageLength: NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH,
    messages: visibleMessages,
    nightNumber: state.night_number,
    participantPlayerIds,
    readOnly: state.phase !== "night",
  };
}

function getNightConversationGroups(
  resolvedRoleSetup: JsonObject | null,
): NightConversationGroupConfig[] {
  const groups = resolvedRoleSetup?.["nightConversationGroups"];

  if (!Array.isArray(groups)) {
    return [];
  }

  return groups.flatMap((group): NightConversationGroupConfig[] => {
    if (
      !isRecord(group) ||
      typeof group["groupId"] !== "string" ||
      typeof group["labelKey"] !== "string" ||
      !Array.isArray(group["roleIds"])
    ) {
      return [];
    }

    const registeredRoleIds = new Set(getRoleIds());
    const roleIds = group["roleIds"].filter(
      (roleId): roleId is RoleId => typeof roleId === "string" && registeredRoleIds.has(roleId),
    );

    return roleIds.length === 0
      ? []
      : [
          {
            groupId: group["groupId"],
            labelKey: group["labelKey"],
            roleIds,
          },
        ];
  });
}

function labelNightConversationGroup(labelKey: string): string {
  switch (labelKey) {
    case "nightConversation.werewolf":
      return "Werewolf night chat";
    default:
      return "Night chat";
  }
}

function groupSetByEventId<Value>(
  records: readonly { eventId: number; value: Value }[],
): Map<number, Set<Value>> {
  const grouped = new Map<number, Set<Value>>();

  for (const record of records) {
    const values = grouped.get(record.eventId) ?? new Set<Value>();

    values.add(record.value);
    grouped.set(record.eventId, values);
  }

  return grouped;
}

function toPrivateGameEvent(
  event: GameEventRecord,
  players: readonly PlayerRecord[],
): PrivateGameEvent {
  return {
    createdAt: event.created_at,
    kind: event.event_kind,
    message: formatPrivateEventMessage(event, players),
  };
}

function formatPrivateEventMessage(
  event: GameEventRecord,
  players: readonly PlayerRecord[],
): string {
  if (event.event_kind === "initial_inspection" || event.event_kind === "inspection_result") {
    const targetPlayerName = getPayloadPlayerName(event.payload["targetPlayerId"], players);
    const result = event.payload["result"] === "werewolf" ? "werewolf" : "human";

    return `${targetPlayerName} appears to be ${result}.`;
  }

  if (event.event_kind === "spiritist_result") {
    const targetPlayerName = getPayloadPlayerName(event.payload["targetPlayerId"], players);
    const result = event.payload["result"] === "werewolf" ? "a werewolf" : "not a werewolf";

    return `${targetPlayerName} was ${result}.`;
  }

  return event.event_kind.replaceAll("_", " ");
}

function getPayloadPlayerName(value: unknown, players: readonly PlayerRecord[]): string {
  if (typeof value !== "string") {
    return "The target";
  }

  const player = players.find((candidate) => String(candidate.id) === value);

  return player?.display_name ?? "The target";
}

function getRoleDisplayName(roleId: RoleId | null): string | null {
  if (roleId === null) {
    return null;
  }

  try {
    return roleRegistry.get(roleId).name;
  } catch {
    return roleId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function labelAction(actionKind: string): string {
  switch (actionKind) {
    case "attack":
      return "Choose attack target";
    case "day_ready":
      return "Ready for voting";
    case "end_speech":
      return "End speech turn";
    case "execution_skip":
      return "End last words";
    case "first_night_ready":
      return "Ready for first day";
    case "guard":
      return "Choose guard target";
    case "hunter_retaliate":
      return "Choose retaliation target";
    case "inspect":
      return "Choose inspection target";
    case "vote":
      return "Vote";
    default:
      return "Submit";
  }
}

function labelActionProgress(phase: GameStateRecord["phase"]): string {
  switch (phase) {
    case "day":
      return "Players ready for voting.";
    case "execution":
      return "Execution last words ready.";
    case "night":
      return "Players ready for first day.";
    case "voting":
      return "Votes submitted.";
    default:
      return "Phase actions submitted.";
  }
}

function toSubmittedResolutionActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
  state: GameStateRecord,
  phaseTimedOut: boolean,
): SubmittedAction[] {
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const submittedActions = pendingActions.flatMap((pendingAction) => {
    const action = actionById.get(pendingAction.current_action_id);

    if (action === undefined) {
      return [];
    }

    return [
      {
        actorPlayerId: String(pendingAction.submitter_player_id),
        actorRoleId: action.actor_role_id,
        actionKey: action.action_key,
        kind: action.action_kind as SubmittedAction["kind"],
        targetPlayerId:
          pendingAction.target_player_id === null ? null : String(pendingAction.target_player_id),
      },
    ];
  });

  if (state.phase !== "execution" || !phaseTimedOut) {
    return state.phase === "day" && phaseTimedOut
      ? [...submittedActions, ...toTimedOutSpeechActions(actions, pendingActions)]
      : submittedActions;
  }

  const submittedActionIds = new Set(pendingActions.map((action) => action.current_action_id));
  const timedOutExecutionActions = actions
    .filter(
      (action) =>
        action.action_kind === "execution_skip" &&
        action.actor_player_id !== null &&
        !submittedActionIds.has(action.id),
    )
    .map((action) => ({
      actorPlayerId: String(action.actor_player_id),
      actorRoleId: action.actor_role_id,
      actionKey: action.action_key,
      kind: "execution_skip" as const,
      targetPlayerId: null,
    }));

  return [...submittedActions, ...timedOutExecutionActions];
}

function toTimedOutSpeechActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
): SubmittedAction[] {
  const submittedActionIds = new Set(pendingActions.map((action) => action.current_action_id));

  return actions
    .filter(
      (action) =>
        action.action_kind === "end_speech" &&
        action.actor_player_id !== null &&
        !submittedActionIds.has(action.id),
    )
    .map((action) => ({
      actorPlayerId: String(action.actor_player_id),
      actionKey: action.action_key,
      kind: "end_speech" as const,
      targetPlayerId: null,
    }));
}

async function createUniqueRoomCode(supabase: SupabaseClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const { data } = await supabase
      .from("rooms")
      .select("id")
      .eq("public_room_code", code)
      .in("status", ["lobby", "playing"])
      .maybeSingle<{ id: number }>();

    if (data === null) {
      return code;
    }
  }

  throw new Error("Unable to allocate room code.");
}

function createPublicPlayerId(): string {
  return `pl_${randomBytes(9).toString("base64url")}`;
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim().replace(/\s+/g, " ").slice(0, 32);

  return normalized === "" ? "Player" : normalized;
}

async function getRoomByCodeOrThrow(
  supabase: SupabaseClient,
  roomCode: string,
): Promise<RoomRecord> {
  const { data, error } = await supabase
    .from("rooms")
    .select(
      "id,public_room_code,status,host_account_id,realtime_topic,lobby_expires_at,target_player_count",
    )
    .eq("public_room_code", roomCode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RoomRecord>();

  if (error !== null || data === null) {
    throw new Error("Room not found.");
  }

  return data;
}

async function getRoomByIdOrThrow(supabase: SupabaseClient, roomId: number): Promise<RoomRecord> {
  const { data, error } = await supabase
    .from("rooms")
    .select(
      "id,public_room_code,status,host_account_id,realtime_topic,lobby_expires_at,target_player_count",
    )
    .eq("id", roomId)
    .maybeSingle<RoomRecord>();

  if (error !== null || data === null) {
    throw new Error("Room not found.");
  }

  return data;
}

async function getRealtimeSubscriptions(
  supabase: SupabaseClient,
  account: AccountRecord,
  room: RoomRecord,
): Promise<RealtimeSubscription[]> {
  const { data, error } = await supabase.rpc("app_get_realtime_subscriptions", {
    p_account_id: account.id,
    p_grant_seconds: 900,
    p_room_code: room.public_room_code,
  });

  if (error !== null) {
    throw new Error(error.message);
  }

  return ((data ?? []) as RealtimeSubscriptionRecord[]).map((subscription) => ({
    expiresAt: subscription.expires_at,
    grantId: subscription.grant_id,
    scope: subscription.scope,
    topic: subscription.topic,
  }));
}

async function expireLobbyIfNeeded(
  supabase: SupabaseClient,
  room: RoomRecord,
): Promise<RoomRecord> {
  if (room.status !== "lobby" || Date.parse(room.lobby_expires_at) > Date.now()) {
    return room;
  }

  const transactionResult = await callRoomMutationRpc(supabase, "app_expire_lobby_if_needed", {
    p_room_id: room.id,
  });
  const expiredRoom = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, expiredRoom, transactionResult);

  return expiredRoom;
}

async function getPlayerForAccount(
  supabase: SupabaseClient,
  roomId: number,
  accountId: number,
): Promise<PlayerRecord | null> {
  const { data, error } = await supabase
    .from("players")
    .select("id,public_player_id,room_id,account_id,display_name,status")
    .eq("room_id", roomId)
    .eq("account_id", accountId)
    .maybeSingle<PlayerRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function requirePlayerForAccount(
  supabase: SupabaseClient,
  roomId: number,
  accountId: number,
): Promise<PlayerRecord> {
  const player = await getPlayerForAccount(supabase, roomId, accountId);

  if (player === null) {
    throw new Error("Current account is not a room player.");
  }

  return player;
}

async function requireJoinedPlayerForAccount(
  supabase: SupabaseClient,
  roomId: number,
  accountId: number,
): Promise<PlayerRecord> {
  const player = await requirePlayerForAccount(supabase, roomId, accountId);

  if (player.status !== "joined") {
    throw new Error("Current account is not an active room player.");
  }

  return player;
}

async function getPlayers(supabase: SupabaseClient, roomId: number): Promise<PlayerRecord[]> {
  const { data, error } = await supabase
    .from("players")
    .select("id,public_player_id,room_id,account_id,display_name,status")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<PlayerRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getGameState(
  supabase: SupabaseClient,
  roomId: number,
): Promise<GameStateRecord | null> {
  const { data, error } = await supabase
    .from("game_states")
    .select(
      "id,room_id,status,phase,phase_instance_id,phase_ends_at,day_number,night_number,revision,final_outcome_id,resolved_role_setup",
    )
    .eq("room_id", roomId)
    .maybeSingle<GameStateRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getNightConversationMessages(
  supabase: SupabaseClient,
  roomId: number,
): Promise<NightConversationMessageRecord[]> {
  const { data, error } = await supabase
    .from("night_conversation_messages")
    .select("id,night_number,conversation_group_id,sender_player_id,body,created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<NightConversationMessageRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getAssignments(
  supabase: SupabaseClient,
  roomId: number,
): Promise<RoleAssignmentRecord[]> {
  const { data, error } = await supabase
    .from("role_assignments")
    .select("player_id,role_id")
    .eq("room_id", roomId)
    .returns<RoleAssignmentRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getGamePlayerStates(
  supabase: SupabaseClient,
  roomId: number,
): Promise<GamePlayerStateRecord[]> {
  const { data, error } = await supabase
    .from("game_player_states")
    .select("player_id,alive")
    .eq("room_id", roomId)
    .returns<GamePlayerStateRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getRuntimePlayers(
  supabase: SupabaseClient,
  roomId: number,
): Promise<PlayerRuntimeState[]> {
  const [assignments, playerStates] = await Promise.all([
    getAssignments(supabase, roomId),
    getGamePlayerStates(supabase, roomId),
  ]);
  const stateByPlayer = new Map(playerStates.map((state) => [state.player_id, state]));
  const registeredRoleIds = new Set(getRoleIds());

  return assignments
    .filter((assignment) => registeredRoleIds.has(assignment.role_id))
    .map((assignment) => ({
      alive: stateByPlayer.get(assignment.player_id)?.alive ?? true,
      playerId: String(assignment.player_id),
      roleId: assignment.role_id,
    }));
}

async function getCurrentActions(
  supabase: SupabaseClient,
  roomId: number,
): Promise<CurrentActionRecord[]> {
  const { data, error } = await supabase
    .from("current_actions")
    .select(
      "id,action_key,action_kind,actor_player_id,actor_role_id,target_kind,eligible_target_player_ids,phase_instance_id,closes_at",
    )
    .eq("room_id", roomId)
    .returns<CurrentActionRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getDaySpeechSlots(
  supabase: SupabaseClient,
  roomId: number,
  phaseInstanceId: string,
): Promise<OrderedSpeechSlot[]> {
  const { data, error } = await supabase
    .from("day_speech_slots")
    .select("slot_index,speaker_player_id")
    .eq("room_id", roomId)
    .eq("phase_instance_id", phaseInstanceId)
    .order("slot_index", { ascending: true })
    .returns<DaySpeechSlotRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data.map((slot) => ({
    slotIndex: slot.slot_index,
    speakerPlayerId: String(slot.speaker_player_id),
  }));
}

async function getPendingActions(
  supabase: SupabaseClient,
  roomId: number,
): Promise<PendingActionRecord[]> {
  const { data, error } = await supabase
    .from("pending_actions")
    .select("id,current_action_id,submitter_player_id,target_player_id,submitted_at")
    .eq("room_id", roomId)
    .returns<PendingActionRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getPreviousGuardTargetByPlayerId(
  supabase: SupabaseClient,
  roomId: number,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("game_events")
    .select("payload,created_at")
    .eq("room_id", roomId)
    .eq("event_kind", "action_resolved")
    .eq("visibility", "internal")
    .order("created_at", { ascending: true })
    .returns<Pick<GameEventRecord, "created_at" | "payload">[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  const previousGuardTargetByPlayerId: Record<string, string> = {};

  for (const event of data) {
    if (event.payload["actionKind"] !== "guard") {
      continue;
    }

    const actorPlayerId = event.payload["actorPlayerId"];
    const targetPlayerIds = event.payload["targetPlayerIds"];
    const targetPlayerId = Array.isArray(targetPlayerIds) ? targetPlayerIds[0] : null;

    if (typeof actorPlayerId === "string" && typeof targetPlayerId === "string") {
      previousGuardTargetByPlayerId[actorPlayerId] = targetPlayerId;
    }
  }

  return previousGuardTargetByPlayerId;
}

async function getPublicEvents(
  supabase: SupabaseClient,
  roomId: number,
  players: readonly PlayerRecord[],
): Promise<PublicGameEvent[]> {
  const { data, error } = await supabase
    .from("game_events")
    .select("id,event_kind,visibility,payload,created_at")
    .eq("room_id", roomId)
    .eq("visibility", "public")
    .order("created_at", { ascending: true })
    .returns<GameEventRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data.map((event) => ({
    createdAt: event.created_at,
    kind: event.event_kind,
    payload: toPublicEventPayload(event.payload, players),
  }));
}

function toPublicEventPayload(
  payload: Record<string, unknown>,
  players: readonly PlayerRecord[],
): Record<string, unknown> {
  const publicPayload: Record<string, unknown> = { ...payload };

  mapPayloadPlayerId(publicPayload, "actorPlayerId", players);
  mapPayloadPlayerId(publicPayload, "targetPlayerId", players);
  mapPayloadPlayerId(publicPayload, "executionCandidatePlayerId", players);

  if (Array.isArray(publicPayload["targetPlayerIds"])) {
    publicPayload["targetPlayerIds"] = publicPayload["targetPlayerIds"].map((playerId) =>
      toPublicPlayerId(playerId, players),
    );
  }

  if (isRecord(publicPayload["voteCountsByTarget"])) {
    publicPayload["voteCountsByTarget"] = Object.fromEntries(
      Object.entries(publicPayload["voteCountsByTarget"]).map(([playerId, count]) => [
        toPublicPlayerId(playerId, players),
        count,
      ]),
    );
  }

  if (Array.isArray(publicPayload["acceptedVotes"])) {
    publicPayload["acceptedVotes"] = publicPayload["acceptedVotes"].map((vote) => {
      if (!isRecord(vote)) {
        return vote;
      }

      return {
        ...vote,
        targetPlayerId: toPublicPlayerId(vote["targetPlayerId"], players),
        voterPlayerId: toPublicPlayerId(vote["voterPlayerId"], players),
      };
    });
  }

  return publicPayload;
}

function mapPayloadPlayerId(
  payload: Record<string, unknown>,
  key: string,
  players: readonly PlayerRecord[],
): void {
  if (key in payload) {
    payload[key] = toPublicPlayerId(payload[key], players);
  }
}

function toPublicPlayerId(value: unknown, players: readonly PlayerRecord[]): unknown {
  if (typeof value !== "string" && typeof value !== "number") {
    return value;
  }

  const player = players.find((candidate) => String(candidate.id) === String(value));

  return player?.public_player_id ?? value;
}

async function getVisiblePrivateEvents(
  supabase: SupabaseClient,
  roomId: number,
  players: readonly PlayerRecord[],
  currentPlayer: PlayerRecord,
  currentRoleId: RoleId | null,
): Promise<PrivateGameEvent[]> {
  const { data: events, error: eventError } = await supabase
    .from("game_events")
    .select("id,event_kind,visibility,payload,created_at")
    .eq("room_id", roomId)
    .eq("visibility", "private")
    .order("created_at", { ascending: true })
    .returns<GameEventRecord[]>();

  if (eventError !== null) {
    throw new Error(eventError.message);
  }

  if (events.length === 0) {
    return [];
  }

  const eventIds = events.map((event) => event.id);
  const [visiblePlayers, visibleRoles] = await Promise.all([
    getEventVisiblePlayers(supabase, eventIds),
    getEventVisibleRoles(supabase, eventIds),
  ]);
  const visiblePlayerIdsByEvent = groupSetByEventId(
    visiblePlayers.map((record) => ({
      eventId: record.game_event_id,
      value: record.player_id,
    })),
  );
  const visibleRoleIdsByEvent = groupSetByEventId(
    visibleRoles.map((record) => ({
      eventId: record.game_event_id,
      value: record.role_id,
    })),
  );

  return events
    .filter((event) => {
      const playerIds = visiblePlayerIdsByEvent.get(event.id);
      const roleIds = visibleRoleIdsByEvent.get(event.id);

      return (
        playerIds?.has(currentPlayer.id) === true ||
        (currentRoleId !== null && roleIds?.has(currentRoleId) === true)
      );
    })
    .map((event) => toPrivateGameEvent(event, players));
}

async function getEventVisiblePlayers(
  supabase: SupabaseClient,
  eventIds: readonly number[],
): Promise<GameEventVisiblePlayerRecord[]> {
  const { data, error } = await supabase
    .from("game_event_visible_players")
    .select("game_event_id,player_id")
    .in("game_event_id", eventIds)
    .returns<GameEventVisiblePlayerRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getEventVisibleRoles(
  supabase: SupabaseClient,
  eventIds: readonly number[],
): Promise<GameEventVisibleRoleRecord[]> {
  const { data, error } = await supabase
    .from("game_event_visible_roles")
    .select("game_event_id,role_id")
    .in("game_event_id", eventIds)
    .returns<GameEventVisibleRoleRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getFinalOutcome(
  supabase: SupabaseClient,
  roomId: number,
): Promise<FinalOutcomeRecord | null> {
  const { data, error } = await supabase
    .from("final_outcomes")
    .select("winner_team,reason")
    .eq("room_id", roomId)
    .maybeSingle<FinalOutcomeRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getPlayerResults(
  supabase: SupabaseClient,
  roomId: number,
): Promise<PlayerResultRecord[]> {
  const { data, error } = await supabase
    .from("player_results")
    .select("player_id,result")
    .eq("room_id", roomId)
    .returns<PlayerResultRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function getRuleSet(
  supabase: SupabaseClient,
  roomId: number,
  targetPlayerCount: number,
): Promise<RuleSet> {
  const { data, error } = await supabase
    .from("game_rule_sets")
    .select("role_counts,options")
    .eq("room_id", roomId)
    .maybeSingle<GameRuleSetRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  if (data === null) {
    return {
      ...toSharedRuleOptions(DEFAULT_RULE_OPTIONS),
      roleCounts: makeDefaultRoleCounts(targetPlayerCount) as RuleSet["roleCounts"],
    };
  }

  return {
    dayMode: data.options["dayMode"] === "ordered_speech" ? "ordered_speech" : "ready_check",
    dayReadyCheckSecondsPerPlayer: parsePositiveRuleOption(
      data.options,
      "dayReadyCheckSecondsPerPlayer",
      DEFAULT_RULE_OPTIONS.dayReadyCheckSecondsPerPlayer,
    ),
    daySpeechSeconds: parsePositiveRuleOption(
      data.options,
      "daySpeechSeconds",
      DEFAULT_RULE_OPTIONS.daySpeechSeconds,
    ),
    executionLastWordsSeconds: parsePositiveRuleOption(
      data.options,
      "executionLastWordsSeconds",
      DEFAULT_RULE_OPTIONS.executionLastWordsSeconds,
    ),
    firstDaySpeechRounds: parsePositiveRuleOption(
      data.options,
      "firstDaySpeechRounds",
      DEFAULT_RULE_OPTIONS.firstDaySpeechRounds,
    ),
    firstNightSeconds: parsePositiveRuleOption(
      data.options,
      "firstNightSeconds",
      DEFAULT_RULE_OPTIONS.firstNightSeconds,
    ),
    guardConsecutiveTargetPolicy:
      data.options["guardConsecutiveTargetPolicy"] === "allow" ? "allow" : "deny",
    initialInspectionPolicy:
      data.options["initialInspectionPolicy"] === "disabled" ? "disabled" : "enabled",
    nightSeconds: parsePositiveRuleOption(
      data.options,
      "nightSeconds",
      DEFAULT_RULE_OPTIONS.nightSeconds,
    ),
    normalDaySpeechRounds: parsePositiveRuleOption(
      data.options,
      "normalDaySpeechRounds",
      DEFAULT_RULE_OPTIONS.normalDaySpeechRounds,
    ),
    roleCounts: parseRoleCounts(data.role_counts) as RuleSet["roleCounts"],
    voteResultVisibility:
      data.options["voteResultVisibility"] === "voter_to_target" ? "voter_to_target" : "count_only",
    votingSeconds: parsePositiveRuleOption(
      data.options,
      "votingSeconds",
      DEFAULT_RULE_OPTIONS.votingSeconds,
    ),
  };
}

function parsePositiveRuleOption(
  options: JsonObject,
  optionName: string,
  fallbackValue: number,
): number {
  const value = options[optionName];

  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallbackValue;
}

async function callRoomMutationRpc(
  supabase: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<RoomMutationResultRecord> {
  const { data, error } = await supabase.rpc(functionName, args).single<RoomMutationResultRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data;
}

async function cleanupExpiredLobbiesWithClient(
  supabase: SupabaseClient,
  limit: number,
): Promise<RoomMutationResultRecord[]> {
  const { data, error } = await supabase.rpc("app_cleanup_expired_lobbies", { p_limit: limit });

  if (error !== null) {
    throw new Error(error.message);
  }

  const results = (data ?? []) as RoomMutationResultRecord[];

  await Promise.all(
    results.map(async (result) => {
      await broadcastMutationResult(supabase, toRoomRecord(result), result);
    }),
  );

  return results;
}

function toRoomRecord(record: RoomMutationResultRecord): RoomRecord {
  return {
    host_account_id: record.host_account_id,
    id: record.id,
    lobby_expires_at: record.lobby_expires_at,
    public_room_code: record.public_room_code,
    realtime_topic: record.realtime_topic,
    status: record.status,
    target_player_count: 10,
  };
}

function serializeRuleSetOptions(ruleSet: RuleSet): JsonObject {
  return {
    dayMode: ruleSet.dayMode,
    dayReadyCheckSecondsPerPlayer: ruleSet.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: ruleSet.daySpeechSeconds,
    executionLastWordsSeconds: ruleSet.executionLastWordsSeconds,
    firstDaySpeechRounds: ruleSet.firstDaySpeechRounds,
    firstNightSeconds: ruleSet.firstNightSeconds,
    guardConsecutiveTargetPolicy: ruleSet.guardConsecutiveTargetPolicy,
    initialInspectionPolicy: ruleSet.initialInspectionPolicy,
    nightSeconds: ruleSet.nightSeconds,
    normalDaySpeechRounds: ruleSet.normalDaySpeechRounds,
    voteResultVisibility: ruleSet.voteResultVisibility,
    votingSeconds: ruleSet.votingSeconds,
  };
}

function buildResolvedRoleSetup(ruleSet: RuleSet): JsonObject {
  const registeredRuleSet = toRegisteredRuleSet(ruleSet);
  const resolvedRoleSetup = resolveRegisteredRoleSetup(registeredRuleSet);

  return {
    ...resolvedRoleSetup,
    engineVersion: ENGINE_VERSION,
    roleRegistryVersion: ROLE_REGISTRY_VERSION,
  };
}

function toRegisteredRuleSet(ruleSet: RuleSet): RegisteredRuleSet {
  return {
    engineVersion: ENGINE_VERSION,
    options: toRegisteredRuleOptions(ruleSet),
    roleCounts: Object.fromEntries(
      getRoleCatalog().map((role) => [role.id, ruleSet.roleCounts[role.id] ?? 0]),
    ),
    roleRegistryVersion: ROLE_REGISTRY_VERSION,
  };
}

function serializeActions(actions: readonly EngineAction[]): JsonObject[] {
  return actions.map((action) => ({
    action_key: action.key,
    action_kind: action.kind,
    actor_player_id:
      action.actorPlayerId === null ? null : Number.parseInt(action.actorPlayerId, 10),
    actor_role_id: action.actorRoleId,
    eligible_target_player_ids: action.eligibleTargetPlayerIds.map((playerId) =>
      Number.parseInt(playerId, 10),
    ),
    target_kind: action.targetKind,
  }));
}

function serializeDaySpeechSlots(slots: readonly OrderedSpeechSlot[]): JsonObject[] {
  return slots.map((slot) => ({
    slot_index: slot.slotIndex,
    speaker_player_id: Number.parseInt(slot.speakerPlayerId, 10),
  }));
}

function serializeEvents(events: readonly EngineEvent[]): JsonObject[] {
  return events.map((event) => ({
    event_kind: event.kind,
    payload: event.payload,
    visibility: event.visibility,
    visible_to_player_ids: event.visibleToPlayerIds.map((playerId) =>
      Number.parseInt(playerId, 10),
    ),
    visible_to_role_ids: event.visibleToRoleIds,
  }));
}

async function broadcastMutationResult(
  supabase: SupabaseClient,
  room: RoomRecord,
  result: RoomMutationResultRecord,
  options: BroadcastMutationOptions = {},
): Promise<void> {
  if (result.notification_reason === null) {
    return;
  }

  if (result.notification_reason === "private_view_changed") {
    try {
      await broadcastPrivateInvalidation(supabase, room, result, options.privateRoleIds ?? []);
    } catch {
      // Realtime lookup/broadcast failures should not fail the authoritative mutation.
    }

    return;
  }

  await broadcastRealtimeInvalidation(supabase, {
    reason: result.notification_reason,
    roomCode: room.public_room_code,
    scope: "room",
    topic: room.realtime_topic,
  });
}

async function broadcastPrivateInvalidation(
  supabase: SupabaseClient,
  room: RoomRecord,
  result: RoomMutationResultRecord,
  privateRoleIds: readonly RoleId[],
): Promise<void> {
  if (result.actor_player_id === null) {
    return;
  }

  const topics = await getPrivateRealtimeTopicsForPlayer(
    supabase,
    room.id,
    result.actor_player_id,
    privateRoleIds,
  );

  await Promise.all(
    topics.map((topic) =>
      broadcastRealtimeInvalidation(supabase, {
        reason: result.notification_reason ?? "private_view_changed",
        roomCode: room.public_room_code,
        scope: topic.scope,
        topic: topic.topic,
      }),
    ),
  );
}

async function getPrivateRealtimeTopicsForPlayer(
  supabase: SupabaseClient,
  roomId: number,
  playerId: number,
  privateRoleIds: readonly RoleId[],
): Promise<RealtimeTopicRecord[]> {
  const uniqueRoleIds = [...new Set(privateRoleIds)];
  const playerTopicPromise = supabase
    .from("realtime_topics")
    .select("scope,topic")
    .eq("room_id", roomId)
    .eq("scope", "player_private")
    .eq("player_id", playerId)
    .returns<RealtimeTopicRecord[]>();
  const roleTopicPromise =
    uniqueRoleIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("realtime_topics")
          .select("scope,topic")
          .eq("room_id", roomId)
          .eq("scope", "role_private")
          .in("role_id", uniqueRoleIds)
          .returns<RealtimeTopicRecord[]>();
  const [playerTopicResult, roleTopicResult] = await Promise.all([
    playerTopicPromise,
    roleTopicPromise,
  ]);

  if (playerTopicResult.error !== null) {
    throw new Error(playerTopicResult.error.message);
  }

  if (roleTopicResult.error !== null) {
    throw new Error(roleTopicResult.error.message);
  }

  return [...playerTopicResult.data, ...roleTopicResult.data];
}

async function broadcastRealtimeInvalidation(
  supabase: SupabaseClient,
  input: {
    reason: string;
    roomCode: string;
    scope: RealtimeScope;
    topic: string;
  },
): Promise<void> {
  const { reason, roomCode, scope, topic } = input;
  const channel = supabase.channel(topic, {
    config: {
      broadcast: { self: false },
    },
  });

  try {
    const result = await channel.httpSend(
      "room_changed",
      buildRealtimeNotificationPayload({
        reason,
        roomCode,
        scope,
        sentAt: new Date().toISOString(),
      }),
    );

    if (!result.success) {
      throw new Error(result.error);
    }
  } catch {
    // Realtime is an invalidation layer; HTTP mutations remain authoritative.
  } finally {
    try {
      await supabase.removeChannel(channel);
    } catch {
      // Realtime cleanup failure should not fail the authoritative mutation.
    }
  }
}

function secondsFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
