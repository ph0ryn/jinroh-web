import "server-only";
import { randomBytes, randomUUID } from "node:crypto";

import {
  DEFAULT_RULE_SET,
  getRoleName,
  isRoleId,
  type PrivateGameEvent,
  type PublicAction,
  type PublicActionProgress,
  type PublicGameEvent,
  type PublicGameEventDetail,
  type PublicGameView,
  type PublicPlayer,
  type PublicSubmittedAction,
  type RoleId,
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
import {
  resolveRoleSetup as resolveRegisteredRoleSetup,
  type RuleSet as RegisteredRuleSet,
} from "./game/ruleset";
import {
  DayDiscussionMode,
  GuardConsecutiveTargetPolicy,
  InitialInspectionPolicy,
  VoteResultVisibility,
  type RuleOptions as RegisteredRuleOptions,
} from "./game/types";
import { buildRealtimeNotificationPayload } from "./game/views";
import {
  didPlayerWin,
  ENGINE_VERSION,
  parseRoleCounts,
  resolvePhase,
  ROLE_REGISTRY_VERSION,
  startGame,
  type EngineAction,
  type EngineEvent,
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
};

type RoomMutationResultRecord = RoomRecord & {
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

type GameEventRecord = {
  created_at: string;
  event_kind: string;
  id: number;
  payload: Record<string, unknown>;
  public_message: string | null;
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
  winner_team: "villagers" | "werewolves" | "fox";
};

type PlayerResultRecord = {
  player_id: number;
  result: "win" | "lose";
};

type GameRuleSetRecord = {
  options: Record<string, unknown>;
  role_counts: Record<string, unknown>;
};

type JsonObject = Record<string, unknown>;

export type IdentityResult = {
  token: string;
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
): Promise<RoomSummary> {
  const supabase = createServiceClient();
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
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  return getRoomViewByRoom(supabase, account, room);
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
  targetPublicPlayerId: string | null,
): Promise<RoomSummary> {
  const supabase = createServiceClient();
  const transactionResult = await callRoomMutationRpc(supabase, "app_submit_action", {
    p_account_id: account.id,
    p_action_key: actionKey,
    p_phase_instance_id: phaseInstanceId,
    p_room_code: roomCode,
    p_target_public_player_id: targetPublicPlayerId,
  });
  const room = toRoomRecord(transactionResult);

  await broadcastMutationResult(supabase, room, transactionResult);

  return getRoomViewByRoom(supabase, account, room);
}

export async function resolveRoom(account: AccountRecord, roomCode: string): Promise<RoomSummary> {
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

  const runtimePlayers = await getRuntimePlayers(supabase, room.id);
  const ruleSet = await getRuleSet(supabase, room.id);
  const resolution = resolvePhase({
    actions: toSubmittedResolutionActions(actions, currentPendingActions, state, phaseTimedOut),
    currentPhase: state.phase,
    dayNumber: state.day_number,
    nightNumber: state.night_number,
    players: runtimePlayers,
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
            result: didPlayerWin(runtimePlayer.roleId, finalOutcome.winnerTeam) ? "win" : "lose",
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
  const [players, state, assignments, playerStates, actions, pendingActions, outcome, results] =
    await Promise.all([
      getPlayers(supabase, room.id),
      getGameState(supabase, room.id),
      getAssignments(supabase, room.id),
      getGamePlayerStates(supabase, room.id),
      getCurrentActions(supabase, room.id),
      getPendingActions(supabase, room.id),
      getFinalOutcome(supabase, room.id),
      getPlayerResults(supabase, room.id),
    ]);
  const currentPlayer =
    players.find((player) => player.account_id === account.id && player.status === "joined") ??
    null;
  const isHost = currentPlayer !== null && room.host_account_id === account.id;
  const assignmentByPlayer = new Map(
    assignments.map((assignment) => [assignment.player_id, assignment]),
  );
  const stateByPlayer = new Map(
    playerStates.map((playerState) => [playerState.player_id, playerState]),
  );
  const resultByPlayer = new Map(results.map((result) => [result.player_id, result]));
  const events = await getPublicEvents(supabase, room.id, players);
  const publicPlayers: PublicPlayer[] = players.map((player) => ({
    alive: stateByPlayer.get(player.id)?.alive ?? null,
    displayName: player.display_name,
    id: player.public_player_id,
    isCurrent: currentPlayer?.id === player.id,
    isHost: player.account_id === room.host_account_id,
    status: player.status,
  }));
  const currentAssignment =
    currentPlayer === null ? null : (assignmentByPlayer.get(currentPlayer.id) ?? null);
  const currentRoleId =
    currentAssignment !== null && isRoleId(currentAssignment.role_id)
      ? currentAssignment.role_id
      : null;
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
          phaseInstanceId: state.phase_instance_id,
          status: state.status,
          winnerTeam: outcome?.winner_team ?? null,
        };
  const self: SelfPrivateView | null =
    currentPlayer === null
      ? null
      : {
          actions: toPublicActions(actions, pendingActions, players, currentPlayer, currentRoleId),
          events: await getVisiblePrivateEvents(
            supabase,
            room.id,
            players,
            currentPlayer,
            currentRoleId,
          ),
          playerId: currentPlayer.public_player_id,
          result: resultByPlayer.get(currentPlayer.id)?.result ?? null,
          roleId: currentRoleId,
          roleName: getRoleName(currentRoleId),
          submittedActions: toSubmittedActions(
            actions,
            pendingActions,
            currentPlayer,
            currentRoleId,
          ),
        };

  return {
    code: room.public_room_code,
    currentPlayerId: currentPlayer?.public_player_id ?? null,
    game: publicGame,
    hostPlayerId:
      players.find((player) => player.account_id === room.host_account_id)?.public_player_id ??
      null,
    isHost,
    lobbyExpiresAt: room.lobby_expires_at,
    players: publicPlayers,
    realtime: currentPlayer === null ? null : { topic: room.realtime_topic },
    rolePrivate: toRolePrivateView(players, assignments, currentPlayer, currentRoleId, state),
    self,
    status: room.status,
  };
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

function toPublicActionProgress(
  state: GameStateRecord,
  actions: readonly CurrentActionRecord[],
  pendingActions: readonly PendingActionRecord[],
): PublicActionProgress | null {
  if (state.status !== "playing" || state.phase === null || state.phase_instance_id === null) {
    return null;
  }

  if (state.phase === "night" && state.night_number > 1) {
    return {
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
    label: labelActionProgress(state.phase),
    required: actions.length,
    submitted: submittedActionIds.size,
    visibility: "public",
  };
}

function toRolePrivateView(
  players: readonly PlayerRecord[],
  assignments: readonly RoleAssignmentRecord[],
  currentPlayer: PlayerRecord | null,
  currentRoleId: RoleId | null,
  state: GameStateRecord | null,
): RolePrivateView {
  if (currentPlayer === null || currentRoleId !== "werewolf") {
    return null;
  }

  const publicIdByInternalId = new Map(
    players.map((player) => [player.id, player.public_player_id]),
  );
  const werewolfPartnerIds = assignments
    .filter(
      (assignment) =>
        assignment.role_id === "werewolf" && assignment.player_id !== currentPlayer.id,
    )
    .map((assignment) => publicIdByInternalId.get(assignment.player_id))
    .filter((playerId): playerId is string => playerId !== undefined);

  return {
    consultation:
      state?.phase === "night" || state?.phase === "day"
        ? [
            {
              label: "Execution candidate",
              readOnly: state.phase === "day",
              status: "empty",
              templateId: "execution_candidate",
              value: null,
            },
          ]
        : [],
    label: "Werewolf private view",
    roleId: "werewolf",
    werewolfPartnerIds,
  };
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

  return event.public_message ?? event.event_kind.replaceAll("_", " ");
}

function getPayloadPlayerName(value: unknown, players: readonly PlayerRecord[]): string {
  if (typeof value !== "string") {
    return "The target";
  }

  const player = players.find((candidate) => String(candidate.id) === value);

  return player?.display_name ?? "The target";
}

function getOptionalPayloadPlayerName(
  value: unknown,
  players: readonly PlayerRecord[],
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const player = players.find((candidate) => String(candidate.id) === value);

  return player?.display_name ?? null;
}

function formatWinnerTeam(value: unknown): string {
  if (value === "werewolves") {
    return "Werewolves";
  }

  if (value === "villagers") {
    return "Villagers";
  }

  if (value === "fox") {
    return "Fox";
  }

  return "Unknown";
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
    case "execution_skip":
      return "End last words";
    case "first_night_ready":
      return "Ready for first day";
    case "guard":
      return "Choose guard target";
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
        kind: action.action_kind as SubmittedAction["kind"],
        targetPlayerId:
          pendingAction.target_player_id === null ? null : String(pendingAction.target_player_id),
      },
    ];
  });

  if (state.phase !== "execution" || !phaseTimedOut) {
    return submittedActions;
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
      kind: "execution_skip" as const,
      targetPlayerId: null,
    }));

  return [...submittedActions, ...timedOutExecutionActions];
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
    .select("id,public_room_code,status,host_account_id,realtime_topic,lobby_expires_at")
    .eq("public_room_code", roomCode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RoomRecord>();

  if (error !== null || data === null) {
    throw new Error("Room not found.");
  }

  return data;
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
      "id,room_id,status,phase,phase_instance_id,phase_ends_at,day_number,night_number,revision,final_outcome_id",
    )
    .eq("room_id", roomId)
    .maybeSingle<GameStateRecord>();

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

  return assignments
    .filter((assignment) => isRoleId(assignment.role_id))
    .map((assignment) => ({
      alive: stateByPlayer.get(assignment.player_id)?.alive ?? true,
      playerId: String(assignment.player_id),
      roleId: assignment.role_id as RoleId,
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

async function getPublicEvents(
  supabase: SupabaseClient,
  roomId: number,
  players: readonly PlayerRecord[],
): Promise<PublicGameEvent[]> {
  const { data, error } = await supabase
    .from("game_events")
    .select("id,event_kind,visibility,payload,public_message,created_at")
    .eq("room_id", roomId)
    .eq("visibility", "public")
    .order("created_at", { ascending: true })
    .returns<GameEventRecord[]>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return data.map((event) => ({
    createdAt: event.created_at,
    details: toPublicEventDetails(event, players),
    kind: event.event_kind,
    message: event.public_message ?? event.event_kind.replaceAll("_", " "),
  }));
}

function toPublicEventDetails(
  event: GameEventRecord,
  players: readonly PlayerRecord[],
): PublicGameEventDetail[] {
  switch (event.event_kind) {
    case "player_died":
    case "player_executed": {
      const targetPlayerName = getPayloadPlayerName(event.payload["targetPlayerId"], players);

      return [{ label: "Player", value: targetPlayerName }];
    }

    case "vote_resolved":
      return toVoteResolvedDetails(event.payload, players);

    case "game_ended":
      return [{ label: "Winner", value: formatWinnerTeam(event.payload["winnerTeam"]) }];

    default:
      return [];
  }
}

function toVoteResolvedDetails(
  payload: Record<string, unknown>,
  players: readonly PlayerRecord[],
): PublicGameEventDetail[] {
  const details: PublicGameEventDetail[] = [];
  const executionCandidateName = getOptionalPayloadPlayerName(
    payload["executionCandidatePlayerId"],
    players,
  );

  if (executionCandidateName !== null) {
    details.push({ label: "Candidate", value: executionCandidateName });
  }

  const voteCountsByTarget = payload["voteCountsByTarget"];

  if (isRecord(voteCountsByTarget)) {
    const voteSummary = Object.entries(voteCountsByTarget)
      .map(([playerId, count]) => ({
        count: typeof count === "number" ? count : Number(count),
        playerName: getPayloadPlayerName(playerId, players),
      }))
      .filter((entry) => Number.isFinite(entry.count))
      .toSorted((left, right) => right.count - left.count)
      .map((entry) => `${entry.playerName} ${entry.count}`)
      .join(", ");

    if (voteSummary !== "") {
      details.push({ label: "Votes", value: voteSummary });
    }
  }

  return details;
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
    .select("id,event_kind,visibility,payload,public_message,created_at")
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

async function getRuleSet(supabase: SupabaseClient, roomId: number): Promise<RuleSet> {
  const { data, error } = await supabase
    .from("game_rule_sets")
    .select("role_counts,options")
    .eq("room_id", roomId)
    .maybeSingle<GameRuleSetRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  if (data === null) {
    return DEFAULT_RULE_SET;
  }

  return {
    dayMode: data.options["dayMode"] === "ordered_speech" ? "ordered_speech" : "ready_check",
    guardConsecutiveTargetPolicy:
      data.options["guardConsecutiveTargetPolicy"] === "allow" ? "allow" : "deny",
    initialInspectionPolicy:
      data.options["initialInspectionPolicy"] === "disabled" ? "disabled" : "enabled",
    roleCounts: parseRoleCounts(data.role_counts),
    voteResultVisibility:
      data.options["voteResultVisibility"] === "voter_to_target" ? "voter_to_target" : "count_only",
  };
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

function toRoomRecord(record: RoomMutationResultRecord): RoomRecord {
  return {
    host_account_id: record.host_account_id,
    id: record.id,
    lobby_expires_at: record.lobby_expires_at,
    public_room_code: record.public_room_code,
    realtime_topic: record.realtime_topic,
    status: record.status,
  };
}

function serializeRuleSetOptions(ruleSet: RuleSet): JsonObject {
  return {
    dayMode: ruleSet.dayMode,
    guardConsecutiveTargetPolicy: ruleSet.guardConsecutiveTargetPolicy,
    initialInspectionPolicy: ruleSet.initialInspectionPolicy,
    voteResultVisibility: ruleSet.voteResultVisibility,
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
    roleCounts: ruleSet.roleCounts,
    roleRegistryVersion: ROLE_REGISTRY_VERSION,
  };
}

function toRegisteredRuleOptions(ruleSet: RuleSet): RegisteredRuleOptions {
  return {
    dayDiscussionMode:
      ruleSet.dayMode === "ordered_speech"
        ? DayDiscussionMode.OrderedSpeech
        : DayDiscussionMode.ReadyCheck,
    dayReadyCheckSecondsPerPlayer: 90,
    daySpeechSeconds: 90,
    executionLastWordsSeconds: 60,
    firstDaySpeechRounds: 2,
    firstNightSeconds: 30,
    guardConsecutiveTargetPolicy:
      ruleSet.guardConsecutiveTargetPolicy === "allow"
        ? GuardConsecutiveTargetPolicy.Allow
        : GuardConsecutiveTargetPolicy.DenySameTarget,
    initialInspectionPolicy:
      ruleSet.initialInspectionPolicy === "disabled"
        ? InitialInspectionPolicy.Disabled
        : InitialInspectionPolicy.Enabled,
    nightSeconds: 180,
    normalDaySpeechRounds: 1,
    voteResultVisibility:
      ruleSet.voteResultVisibility === "voter_to_target"
        ? VoteResultVisibility.VoterToTarget
        : VoteResultVisibility.CountOnly,
    votingSeconds: 30,
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

function serializeEvents(events: readonly EngineEvent[]): JsonObject[] {
  return events.map((event) => ({
    event_kind: event.kind,
    payload: event.payload,
    public_message: event.message,
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
): Promise<void> {
  if (result.notification_reason === null) {
    return;
  }

  await broadcastRoomInvalidation(supabase, room, result.notification_reason);
}

async function broadcastRoomInvalidation(
  supabase: SupabaseClient,
  room: RoomRecord,
  reason: string,
): Promise<void> {
  const channel = supabase.channel(room.realtime_topic, {
    config: {
      broadcast: { self: false },
    },
  });

  try {
    const result = await channel.httpSend(
      "room_changed",
      buildRealtimeNotificationPayload({
        reason,
        roomCode: room.public_room_code,
        scope: "room",
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
