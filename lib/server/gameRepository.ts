import "server-only";
import { randomUUID } from "node:crypto";

import {
  isActionKey,
  isActionKind,
  isRoleId,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type GamePhase,
  type RealtimeScope,
  type RealtimeSubscription,
  type RoleId,
  type RoomSummary,
  type RuleSet,
  type RuleSetInput,
  type SwitchRoomRequest,
} from "@/lib/shared/game";
import { getCodePointLength, truncateCodePoints } from "@/lib/shared/text";

import {
  createAccountToken,
  hashAccountToken,
  isValidTokenShape,
  TOKEN_HASH_KEY_ID,
} from "./accountToken";
import {
  ActionActorStateRequirement,
  ActionTargetStateRequirement,
  type ResolvedRoleSetup,
} from "./game/types";
import {
  ENGINE_VERSION,
  resolvePhase,
  ROLE_REGISTRY_VERSION,
  startGame,
  type EngineAction,
  type EngineEvent,
  type OrderedSpeechSlot,
  type PhaseCurrentAction,
  type ResolvedActionHistoryEntry,
  type SubmittedAction,
} from "./gameEngine";
import { RoomExpiredError, RoomNotFoundError, toGameRepositoryError } from "./gameRepositoryErrors";
import {
  buildRoomView,
  getExpectedPersistedGameStatus,
  getNightConversationGroups,
  getRuntimePlayersFromSnapshot,
  getSharedActionRoleRecipients,
  isRoomEndedBeforeStart,
  isRoomSnapshot,
  NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH,
  parsePersistedRoleSetup,
  parseSnapshotRuleSet,
  toPublicActionProgress,
  toPublicGameEvent,
  toPublicPhaseFocus,
  toRevealedRoleId,
  type CurrentActionRecord,
  type JsonObject,
  type PendingActionRecord,
  type RoomSnapshot,
  type ResolvedActionRecord,
} from "./gameRoomView";
import { parseRealtimeGrantRpcResult } from "./realtimeGrant";
import { buildRealtimeNotificationPayload } from "./realtimeNotification";
import { createServiceClient } from "./supabase";

export {
  getExpectedPersistedGameStatus,
  isRoomEndedBeforeStart,
  toPublicActionProgress,
  toPublicGameEvent,
  toPublicPhaseFocus,
  toRevealedRoleId,
};

type SupabaseClient = ReturnType<typeof createServiceClient>;

type AccountRecord = {
  id: number;
};

type AccountRpcRecord = {
  account_id: number;
};

type RoomMutationResultRecord = {
  room_id: number;
  actor_player_id: number | null;
  notification_reason: string | null;
};

type RoomTransitionMutationResultRecord = RoomMutationResultRecord & {
  result_kind: "source" | "target";
};

type RoomTransitionMutation = {
  sourceResult: RoomTransitionMutationResultRecord | null;
  targetResult: RoomTransitionMutationResultRecord;
};

type RealtimeGrantCleanupRecord = {
  deleted_grants: number;
};

type IssuedRealtimeGrant = {
  expiresAt: string;
  grantId: string;
  subscriptions: RealtimeSubscription[];
};

type BroadcastMutationOptions = {
  privateRoleIds?: readonly RoleId[];
};

export type IdentityResult = {
  token: string;
};

export type ExpiredWaitingRoomCleanupResult = {
  deletedRealtimeGrants: number;
  expiredRooms: number;
};

export async function createIdentity(): Promise<IdentityResult> {
  const supabase = createServiceClient();
  const token = createAccountToken();
  const tokenHash = hashAccountToken(token);
  const { error } = await supabase.rpc("app_create_identity", {
    p_token_hash: tokenHash,
    p_token_hash_key_id: TOKEN_HASH_KEY_ID,
  });

  if (error !== null) {
    throw new Error(error.message);
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
    .rpc("app_authenticate_account", { p_token_hash: tokenHash })
    .maybeSingle<AccountRpcRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  if (data === null) {
    return null;
  }

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

  const waitingExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const normalizedDisplayName = normalizeDisplayName(displayName);
  const transition = await callRoomTransitionRpc(supabase, "app_create_room", {
    p_account_id: account.id,
    p_display_name: normalizedDisplayName,
    p_waiting_expires_at: waitingExpiresAt,
    p_target_player_count: targetPlayerCount,
  });
  const snapshot = await readAndBroadcastRoomTransition(supabase, account.id, transition);

  return buildRoomView(snapshot);
}

export async function cleanupExpiredWaitingRooms(
  limit = 50,
): Promise<ExpiredWaitingRoomCleanupResult> {
  const supabase = createServiceClient();
  const expiredRooms = await cleanupExpiredWaitingRoomsWithClient(supabase, limit);
  const { data, error } = await supabase
    .rpc("app_cleanup_expired_realtime_grants", { p_limit: limit * 10 })
    .single<RealtimeGrantCleanupRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return {
    deletedRealtimeGrants: data.deleted_grants,
    expiredRooms: expiredRooms.length,
  };
}

export async function joinRoom(
  account: AccountRecord,
  roomCode: string,
  displayName: string,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transition = await callRoomTransitionRpc(supabase, "app_join_room", {
    p_account_id: account.id,
    p_display_name: normalizeDisplayName(displayName),
    p_room_code: roomCode,
  });
  const snapshot = await readAndBroadcastRoomTransition(supabase, account.id, transition);

  if (transition.targetResult.notification_reason === "waiting_room_ended") {
    throw new RoomExpiredError();
  }

  return buildRoomView(snapshot);
}

export async function getCurrentRoom(account: AccountRecord): Promise<RoomSummary | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .rpc("app_get_current_room", { p_account_id: account.id })
    .maybeSingle<RoomMutationResultRecord>();

  if (error !== null) {
    throw toGameRepositoryError(error.message);
  }

  if (data === null) {
    return null;
  }

  const snapshot = await readRoomSnapshot(supabase, account.id, { roomId: data.room_id });

  try {
    await broadcastMutationResult(supabase, snapshot, data);
  } catch {
    // The database mutation remains authoritative when invalidation delivery fails.
  }

  if (
    data.notification_reason === "waiting_room_ended" ||
    isRoomEndedBeforeStart(snapshot.room.status, snapshot.room.started_at)
  ) {
    return null;
  }

  await resolveRoom(snapshot.room.id);

  return buildRoomView(await readRoomSnapshot(supabase, account.id, { roomId: snapshot.room.id }));
}

export async function switchRoom(
  account: AccountRecord,
  request: SwitchRoomRequest,
): Promise<RoomSummary> {
  const supabase = createServiceClient();

  const transition = await callRoomTransitionRpc(supabase, "app_switch_room", {
    p_account_id: account.id,
    p_display_name: normalizeDisplayName(request.displayName),
    p_expected_current_room_code: request.expectedCurrentRoomCode,
    p_kind: request.kind,
    p_target_player_count: request.kind === "create" ? request.targetPlayerCount : null,
    p_target_room_code: request.kind === "join" ? request.targetRoomCode : null,
    p_waiting_expires_at:
      request.kind === "create" ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
  });

  if (transition.sourceResult === null) {
    throw new Error("Room switch returned an incomplete result.");
  }

  const targetSnapshot = await readAndBroadcastRoomTransition(supabase, account.id, transition);

  if (transition.targetResult.notification_reason === "waiting_room_ended") {
    throw new RoomExpiredError();
  }

  return buildRoomView(targetSnapshot);
}

export async function getRoomView(account: AccountRecord, roomCode: string): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const initialSnapshot = await readRoomSnapshot(supabase, account.id, { roomCode });
  const expirationResult = await callRoomMutationRpc(
    supabase,
    "app_expire_waiting_room_if_needed",
    { p_room_id: initialSnapshot.room.id },
  );

  if (expirationResult.notification_reason === "waiting_room_ended") {
    await broadcastMutationResult(supabase, initialSnapshot, expirationResult);
    throw new RoomNotFoundError();
  }

  if (isRoomEndedBeforeStart(initialSnapshot.room.status, initialSnapshot.room.started_at)) {
    throw new RoomNotFoundError();
  }

  await resolveRoom(initialSnapshot.room.id);

  return buildRoomView(
    await readRoomSnapshot(supabase, account.id, { roomId: initialSnapshot.room.id }),
  );
}

export async function issueRealtimeGrant(
  account: AccountRecord,
  roomCode: string,
): Promise<IssuedRealtimeGrant> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("app_issue_realtime_grant", {
    p_account_id: account.id,
    p_grant_seconds: 120,
    p_room_code: roomCode.trim().toUpperCase(),
  });

  if (error !== null) {
    throw toGameRepositoryError(error.message);
  }

  const result = parseRealtimeGrantRpcResult(data);

  if (result.kind === "waiting_room_ended") {
    const snapshot = await readRoomSnapshot(supabase, account.id, {
      roomId: result.roomId,
    });

    await broadcastMutationResult(supabase, snapshot, {
      actor_player_id: result.actorPlayerId,
      notification_reason: result.kind,
      room_id: result.roomId,
    });
    throw new RoomExpiredError();
  }

  return {
    expiresAt: result.expiresAt,
    grantId: result.grantId,
    subscriptions: result.subscriptions,
  };
}

export async function leaveRoom(account: AccountRecord, roomCode: string): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transactionResult = await callRoomMutationRpc(supabase, "app_leave_room", {
    p_account_id: account.id,
    p_room_code: roomCode,
  });
  const snapshot = await readRoomSnapshot(supabase, account.id, {
    roomId: transactionResult.room_id,
  });

  await broadcastMutationResult(supabase, snapshot, transactionResult);

  return buildRoomView(snapshot);
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
  const snapshot = await readRoomSnapshot(supabase, account.id, {
    roomId: transactionResult.room_id,
  });

  await broadcastMutationResult(supabase, snapshot, transactionResult);

  if (transactionResult.notification_reason === "waiting_room_ended") {
    throw new RoomExpiredError();
  }

  return buildRoomView(snapshot);
}

export async function startRoom(
  account: AccountRecord,
  roomCode: string,
  ruleSetInput: RuleSetInput | null,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const initialSnapshot = await readRoomSnapshot(supabase, account.id, { roomCode });
  const expirationResult = await callRoomMutationRpc(
    supabase,
    "app_expire_waiting_room_if_needed",
    { p_room_id: initialSnapshot.room.id },
  );

  if (expirationResult.notification_reason === "waiting_room_ended") {
    await broadcastMutationResult(supabase, initialSnapshot, expirationResult);
    throw new RoomExpiredError();
  }

  const snapshot = await readRoomSnapshot(supabase, account.id, {
    roomId: initialSnapshot.room.id,
  });
  const { room } = snapshot;

  if (room.host_account_id !== account.id) {
    throw new Error("Only the host can start the game.");
  }

  const hostPlayer = snapshot.players.find((player) => player.id === snapshot.viewerPlayerId);

  if (hostPlayer?.status !== "joined") {
    throw new Error("Current account is not an active room player.");
  }

  if (room.status !== "waiting") {
    throw new Error("Room must be waiting for the game to start.");
  }

  const joinedPlayers = snapshot.players.filter((player) => player.status === "joined");

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
    p_resolved_role_setup: serializeResolvedRoleSetup(startResult.resolvedRoleSetup),
    p_role_counts: startResult.ruleSet.roleCounts,
    p_role_registry_version: ROLE_REGISTRY_VERSION,
    p_room_code: roomCode,
  });
  const startedSnapshot = await readRoomSnapshot(supabase, account.id, {
    roomId: transactionResult.room_id,
  });

  await broadcastMutationResult(supabase, startedSnapshot, transactionResult);

  if (transactionResult.notification_reason === "waiting_room_ended") {
    throw new RoomExpiredError();
  }

  return buildRoomView(startedSnapshot);
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
  const submittedSnapshot = await readRoomSnapshot(supabase, account.id, {
    roomId: transactionResult.room_id,
  });
  const submittedAction = submittedSnapshot.currentActions.find(
    (action) => action.action_key === actionKey && action.phase_instance_id === phaseInstanceId,
  );

  await broadcastMutationResult(supabase, submittedSnapshot, transactionResult, {
    privateRoleIds:
      submittedAction === undefined ? [] : getSharedActionRoleRecipients(submittedAction),
  });

  await resolveRoom(transactionResult.room_id);

  return buildRoomView(
    await readRoomSnapshot(supabase, account.id, { roomId: transactionResult.room_id }),
  );
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
  const snapshot = await readRoomSnapshot(supabase, account.id, { roomCode });
  const { gameState: state, room } = snapshot;
  const currentPlayer = snapshot.players.find(
    (player) => player.id === snapshot.viewerPlayerId && player.status === "joined",
  );
  const currentAssignment =
    currentPlayer === undefined
      ? undefined
      : snapshot.assignments.find((assignment) => assignment.player_id === currentPlayer.id);
  const currentPlayerState =
    currentPlayer === undefined
      ? undefined
      : snapshot.playerStates.find((playerState) => playerState.player_id === currentPlayer.id);
  const group = getNightConversationGroups(snapshot.ruleSet).find(
    (candidate) => candidate.groupId === input.conversationGroupId,
  );
  const normalizedBody = input.body.trim();

  if (
    currentPlayer === undefined ||
    room.status !== "playing" ||
    state?.status !== "playing" ||
    state.phase !== "night" ||
    state.phase_instance_id !== input.phaseInstanceId ||
    state.night_number !== input.nightNumber ||
    currentAssignment === undefined ||
    currentPlayerState?.alive !== true ||
    group === undefined ||
    !group.roleIds.includes(currentAssignment.role_id)
  ) {
    throw new Error("Night conversation is not open.");
  }

  const bodyLength = getCodePointLength(normalizedBody);

  if (bodyLength < 1 || bodyLength > NIGHT_CONVERSATION_MESSAGE_MAX_LENGTH) {
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
  const updatedSnapshot = await readRoomSnapshot(supabase, account.id, {
    roomId: transactionResult.room_id,
  });

  await broadcastMutationResult(supabase, updatedSnapshot, transactionResult, {
    privateRoleIds: group.roleIds,
  });

  return buildRoomView(updatedSnapshot);
}

async function resolveRoom(roomId: number): Promise<void> {
  const supabase = createServiceClient();
  const snapshot = await readRoomSnapshot(
    supabase,
    null,
    { roomId },
    { includeEngineHistory: true },
  );
  const { room } = snapshot;

  if (room.status !== "playing") {
    return;
  }

  const state = snapshot.gameState;

  if (state?.status !== "playing" || state.phase === null || state.phase_instance_id === null) {
    return;
  }

  const actions = snapshot.currentActions.filter(
    (action) => action.phase_instance_id === state.phase_instance_id,
  );
  const currentActionIds = new Set(actions.map((action) => action.id));
  const currentPendingActions = snapshot.pendingActions.filter((pendingAction) =>
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
    return;
  }

  const runtimePlayers = getRuntimePlayersFromSnapshot(snapshot);
  const ruleSet = parseSnapshotRuleSet(snapshot);
  const resolvedActionHistory = toResolvedActionHistory(snapshot.resolvedActions);
  const orderedSpeechSlots: OrderedSpeechSlot[] =
    state.phase === "day"
      ? snapshot.daySpeechSlots.map((slot) => ({
          slotIndex: slot.slot_index,
          speakerPlayerId: String(slot.speaker_player_id),
        }))
      : [];
  const resolvedRoleSetup = parsePersistedRoleSetup(snapshot.ruleSet);

  if (resolvedRoleSetup === null) {
    throw new Error("Stored role setup is invalid or incompatible with this server version.");
  }

  const resolution = resolvePhase({
    actions: toSubmittedResolutionActions(actions, currentPendingActions),
    currentActions: toPhaseCurrentActions(actions),
    currentPhase: state.phase,
    dayNumber: state.day_number,
    nightNumber: state.night_number,
    orderedSpeechSlots,
    players: runtimePlayers,
    resolvedActionHistory,
    resolvedRoleSetup,
    ruleSet,
  });
  const nextPhaseInstanceId = resolution.nextPhase === null ? null : randomUUID();
  const nextEndsAt =
    resolution.nextPhaseDurationSeconds === null
      ? null
      : secondsFromNow(resolution.nextPhaseDurationSeconds);
  const finalOutcome = resolution.finalOutcome;
  const transactionResult = await callRoomMutationRpc(supabase, "app_resolve_phase", {
    p_actions: serializeActions(resolution.actionsToOpen),
    p_deaths: resolution.deaths.map((death) => ({
      player_id: Number.parseInt(death.playerId, 10),
      reason: death.reason,
    })),
    p_day_speech_slots: serializeDaySpeechSlots(resolution.speechSlotsToCreate),
    p_events: serializeEvents(resolution.events),
    p_expected_action_revision: state.action_revision,
    p_expected_revision: state.revision,
    p_final_outcome:
      finalOutcome === null
        ? null
        : {
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
        : runtimePlayers.map((runtimePlayer) => {
            const result = finalOutcome.playerResultsByPlayerId[runtimePlayer.playerId];

            if (result === undefined) {
              throw new Error("Final outcome is missing a player result.");
            }

            return {
              player_id: Number.parseInt(runtimePlayer.playerId, 10),
              result,
            };
          }),
    p_room_id: room.id,
  });
  const resolvedSnapshot = await readRoomSnapshot(supabase, null, {
    roomId: transactionResult.room_id,
  });

  await broadcastMutationResult(supabase, resolvedSnapshot, transactionResult);
}

export function toSubmittedResolutionActions(
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
): SubmittedAction[] {
  const actionById = new Map(actions.map((action) => [action.id, action]));
  return pendingActions.flatMap((pendingAction) => {
    const action = actionById.get(pendingAction.current_action_id);

    if (action === undefined) {
      return [];
    }

    return [
      {
        actorPlayerId: String(pendingAction.submitter_player_id),
        actorRoleId: action.actor_role_id,
        actionKey: action.action_key,
        currentActionId: String(action.id),
        kind: action.action_kind as SubmittedAction["kind"],
        resolverRoleId: action.resolver_role_id,
        submittedAt: pendingAction.submitted_at,
        targetPlayerId:
          pendingAction.target_player_id === null ? null : String(pendingAction.target_player_id),
      },
    ];
  });
}

function toPhaseCurrentActions(actions: readonly CurrentActionRecord[]): PhaseCurrentAction[] {
  return actions.map((action) => ({
    actorPlayerId: action.actor_player_id === null ? null : String(action.actor_player_id),
    actorRoleId: action.actor_role_id,
    actorStateRequirement:
      action.actor_state_requirement === "assigned"
        ? ActionActorStateRequirement.Assigned
        : ActionActorStateRequirement.Alive,
    closesAt: action.closes_at,
    eligibleTargetPlayerIds: action.eligible_target_player_ids.map(String),
    id: String(action.id),
    key: action.action_key,
    kind: action.action_kind as PhaseCurrentAction["kind"],
    openedAt: action.created_at,
    resolverRoleId: action.resolver_role_id,
    targetKind: action.target_kind,
    targetStateRequirement:
      action.target_state_requirement === "assigned"
        ? ActionTargetStateRequirement.Assigned
        : ActionTargetStateRequirement.Alive,
  }));
}

function toResolvedActionHistory(
  actions: readonly ResolvedActionRecord[],
): ResolvedActionHistoryEntry[] {
  return actions.map((action) => {
    if (
      !Number.isSafeInteger(action.id) ||
      action.id <= 0 ||
      !isActionKey(action.action_key) ||
      !isActionKind(action.action_kind) ||
      (action.actor_player_id !== null &&
        (!Number.isSafeInteger(action.actor_player_id) || action.actor_player_id <= 0)) ||
      (action.actor_role_id !== null && !isRoleId(action.actor_role_id)) ||
      (action.actor_player_id === null && action.actor_role_id === null) ||
      !isGamePhase(action.phase) ||
      action.phase_instance_id === "" ||
      (action.resolution_status === "submitted" && action.actor_player_id === null) ||
      (action.resolver_role_id !== null && !isRoleId(action.resolver_role_id)) ||
      (action.target_player_id !== null &&
        (!Number.isSafeInteger(action.target_player_id) || action.target_player_id <= 0))
    ) {
      throw new Error("Stored resolved action is invalid.");
    }

    return {
      actionKey: action.action_key,
      actionKind: action.action_kind,
      actorPlayerId: action.actor_player_id === null ? null : String(action.actor_player_id),
      actorRoleId: action.actor_role_id,
      dayNumber: action.day_number,
      eventId: String(action.id),
      nightNumber: action.night_number,
      phase: action.phase,
      phaseInstanceId: action.phase_instance_id,
      resolutionStatus: action.resolution_status,
      resolverRoleId: action.resolver_role_id,
      targetPlayerIds: action.target_player_id === null ? [] : [String(action.target_player_id)],
    };
  });
}

function isGamePhase(value: unknown): value is GamePhase {
  return value === "night" || value === "day" || value === "voting" || value === "execution";
}

function normalizeDisplayName(displayName: string): string {
  const normalized = truncateCodePoints(displayName.trim().replace(/\s+/g, " "), 32);

  return normalized === "" ? "Player" : normalized;
}

async function readRoomSnapshot(
  supabase: SupabaseClient,
  accountId: number | null,
  locator: { roomCode: string; roomId?: never } | { roomCode?: never; roomId: number },
  options: { includeEngineHistory?: boolean } = {},
): Promise<RoomSnapshot> {
  const { data, error } = await supabase
    .rpc("app_read_room_runtime_snapshot", {
      p_account_id: accountId,
      p_include_engine_history: options.includeEngineHistory ?? false,
      p_room_code: locator.roomCode ?? null,
      p_room_id: locator.roomId ?? null,
    })
    .single<{ snapshot: unknown }>();

  if (error !== null) {
    throw toGameRepositoryError(error.message);
  }

  if (!isRoomSnapshot(data.snapshot)) {
    throw new Error("Room snapshot is invalid or incompatible with this server version.");
  }

  return data.snapshot;
}

async function callRoomMutationRpc(
  supabase: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<RoomMutationResultRecord> {
  const { data, error } = await supabase.rpc(functionName, args).single<RoomMutationResultRecord>();

  if (error !== null) {
    throw toGameRepositoryError(error.message);
  }

  return data;
}

async function callRoomTransitionRpc(
  supabase: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<RoomTransitionMutation> {
  const { data, error } = await supabase.rpc(functionName, args);

  if (error !== null) {
    throw toGameRepositoryError(error.message);
  }

  const results = Array.isArray(data) ? data.filter(isRoomTransitionMutationResultRecord) : [];
  const sourceResults = results.filter((result) => result.result_kind === "source");
  const targetResults = results.filter((result) => result.result_kind === "target");
  const targetResult = targetResults[0];

  if (
    results.length !== (data as unknown[] | null)?.length ||
    sourceResults.length > 1 ||
    targetResults.length !== 1 ||
    targetResult === undefined
  ) {
    throw new Error(`${functionName} returned an invalid room transition result.`);
  }

  return {
    sourceResult: sourceResults[0] ?? null,
    targetResult,
  };
}

async function readAndBroadcastRoomTransition(
  supabase: SupabaseClient,
  accountId: number,
  transition: RoomTransitionMutation,
): Promise<RoomSnapshot> {
  const targetSnapshotPromise = readRoomSnapshot(supabase, accountId, {
    roomId: transition.targetResult.room_id,
  });
  const sourceSnapshotPromise =
    transition.sourceResult === null
      ? Promise.resolve(null)
      : readRoomSnapshot(supabase, accountId, {
          roomId: transition.sourceResult.room_id,
        });
  const [sourceSnapshot, targetSnapshot] = await Promise.all([
    sourceSnapshotPromise,
    targetSnapshotPromise,
  ]);

  await Promise.all([
    sourceSnapshot === null || transition.sourceResult === null
      ? Promise.resolve()
      : broadcastMutationResult(supabase, sourceSnapshot, transition.sourceResult),
    broadcastMutationResult(supabase, targetSnapshot, transition.targetResult),
  ]);

  return targetSnapshot;
}

function isRoomTransitionMutationResultRecord(
  value: unknown,
): value is RoomTransitionMutationResultRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    (record["result_kind"] === "source" || record["result_kind"] === "target") &&
    Number.isSafeInteger(record["room_id"]) &&
    (record["actor_player_id"] === null || Number.isSafeInteger(record["actor_player_id"])) &&
    (record["notification_reason"] === null || typeof record["notification_reason"] === "string")
  );
}

async function cleanupExpiredWaitingRoomsWithClient(
  supabase: SupabaseClient,
  limit: number,
): Promise<RoomMutationResultRecord[]> {
  const { data, error } = await supabase.rpc("app_cleanup_expired_waiting_rooms", {
    p_limit: limit,
  });

  if (error !== null) {
    throw new Error(error.message);
  }

  const results = (data ?? []) as RoomMutationResultRecord[];

  await Promise.all(
    results.map(async (result) => {
      const snapshot = await readRoomSnapshot(supabase, null, { roomId: result.room_id });

      await broadcastMutationResult(supabase, snapshot, result);
    }),
  );

  return results;
}

function serializeRuleSetOptions(ruleSet: RuleSet): JsonObject {
  return {
    dayMode: ruleSet.dayMode,
    dayReadyCheckSecondsPerPlayer: ruleSet.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: ruleSet.daySpeechSeconds,
    executionLastWordsSeconds: ruleSet.executionLastWordsSeconds,
    firstDaySpeechRounds: ruleSet.firstDaySpeechRounds,
    firstNightSeconds: ruleSet.firstNightSeconds,
    nightSeconds: ruleSet.nightSeconds,
    normalDaySpeechRounds: ruleSet.normalDaySpeechRounds,
    roleOptions: Object.fromEntries(
      Object.entries(ruleSet.roleOptions).map(([roleId, values]) => [roleId, { ...values }]),
    ),
    voteResultVisibility: ruleSet.voteResultVisibility,
    votingSeconds: ruleSet.votingSeconds,
  };
}

function serializeResolvedRoleSetup(resolvedRoleSetup: ResolvedRoleSetup): JsonObject {
  return { ...resolvedRoleSetup };
}

function serializeActions(actions: readonly EngineAction[]): JsonObject[] {
  return actions.map((action) => ({
    action_key: action.key,
    action_kind: action.kind,
    actor_player_id:
      action.actorPlayerId === null ? null : Number.parseInt(action.actorPlayerId, 10),
    actor_role_id: action.actorRoleId,
    actor_state_requirement: action.actorStateRequirement,
    eligible_target_player_ids: action.eligibleTargetPlayerIds.map((playerId) =>
      Number.parseInt(playerId, 10),
    ),
    resolver_role_id: action.resolverRoleId,
    target_kind: action.targetKind,
    target_state_requirement: action.targetStateRequirement,
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
  snapshot: RoomSnapshot,
  result: RoomMutationResultRecord,
  options: BroadcastMutationOptions = {},
): Promise<void> {
  if (result.notification_reason === null) {
    return;
  }

  if (result.notification_reason === "private_view_changed") {
    await broadcastPrivateInvalidation(supabase, snapshot, result, options.privateRoleIds ?? []);

    return;
  }

  const roomTopic = snapshot.realtimeTopics.find((topic) => topic.scope === "room");

  if (roomTopic === undefined) {
    return;
  }

  await broadcastRealtimeInvalidation(supabase, {
    reason: result.notification_reason,
    roomCode: snapshot.room.public_room_code,
    scope: "room",
    topic: roomTopic.topic,
  });
}

async function broadcastPrivateInvalidation(
  supabase: SupabaseClient,
  snapshot: RoomSnapshot,
  result: RoomMutationResultRecord,
  privateRoleIds: readonly RoleId[],
): Promise<void> {
  if (result.actor_player_id === null) {
    return;
  }

  const roleIds = new Set(privateRoleIds);
  const topics = snapshot.realtimeTopics.filter(
    (topic) =>
      (topic.scope === "player_private" && topic.player_id === result.actor_player_id) ||
      (topic.scope === "role_private" && topic.role_id !== null && roleIds.has(topic.role_id)),
  );

  await Promise.all(
    topics.map((topic) =>
      broadcastRealtimeInvalidation(supabase, {
        reason: result.notification_reason ?? "private_view_changed",
        roomCode: snapshot.room.public_room_code,
        scope: topic.scope,
        topic: topic.topic,
      }),
    ),
  );
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
      private: true,
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
