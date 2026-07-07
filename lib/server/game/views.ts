import "server-only";
import { GameEventVisibility, GamePhase } from "./types";

import type {
  CurrentAction,
  GameEvent,
  GameStatus,
  NightConversationMessageState,
  PlayerId,
  ReadonlyGameState,
  RoleId,
} from "./types";

export type GameViewPlayer = {
  alive: boolean;
  displayName: string;
  playerId: PlayerId;
};

export type InternalGameViewInput = {
  players: readonly GameViewPlayer[];
  state: ReadonlyGameState;
};

export type PublicGameEvent = {
  id: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
  targetPlayerIds: readonly PlayerId[];
};

export type PublicGameView = {
  events: readonly PublicGameEvent[];
  nightNumber: number;
  phase: GamePhase | null;
  players: readonly GameViewPlayer[];
  status: GameStatus;
};

export type SelfPrivateGameView = {
  currentActions: readonly CurrentAction[];
  events: readonly GameEvent[];
  playerId: PlayerId;
  roleId: RoleId | null;
};

export type NightConversationPrivateGameView = {
  events: readonly GameEvent[];
  groupId: string;
  labelKey: string;
  messages: readonly RolePrivateNightConversationMessage[];
  participantPlayerIds: readonly PlayerId[];
  readOnly: boolean;
};

export type RolePrivateNightConversationMessage = NightConversationMessageState;

export function buildPublicGameView(input: InternalGameViewInput): PublicGameView {
  return {
    events: input.state.events.flatMap((event) => {
      if (event.visibility !== GameEventVisibility.Public) {
        return [];
      }

      return [
        {
          id: event.id,
          kind: event.kind,
          payload: event.payload,
          targetPlayerIds: event.targetPlayerIds,
        },
      ];
    }),
    nightNumber: input.state.nightNumber,
    phase: input.state.phase,
    players: input.players.map((player) => ({ ...player })),
    status: input.state.status,
  };
}

export function buildSelfPrivateGameView(
  input: InternalGameViewInput,
  viewerPlayerId: PlayerId,
): SelfPrivateGameView {
  const viewerRoleId = input.state.roleByPlayerId.get(viewerPlayerId) ?? null;

  return {
    currentActions: input.state.currentActions.filter((action) => {
      return action.allowedPlayerIds.includes(viewerPlayerId);
    }),
    events: input.state.events.filter((event) => {
      return isEventVisibleToPlayer(event, viewerPlayerId, viewerRoleId);
    }),
    playerId: viewerPlayerId,
    roleId: viewerRoleId,
  };
}

export function buildNightConversationPrivateGameView(
  input: InternalGameViewInput,
  viewerPlayerId: PlayerId,
): NightConversationPrivateGameView | null {
  const viewerRoleId = input.state.roleByPlayerId.get(viewerPlayerId);
  const group =
    viewerRoleId === undefined
      ? undefined
      : input.state.resolvedRoleSetup.nightConversationGroups.find((candidate) =>
          candidate.roleIds.includes(viewerRoleId),
        );

  if (viewerRoleId === undefined || group === undefined) {
    return null;
  }

  const participantPlayerIds = [...input.state.roleByPlayerId.entries()]
    .filter(([, roleId]) => group.roleIds.includes(roleId))
    .map(([playerId]) => playerId);
  const readOnly = input.state.phase !== GamePhase.Night;

  return {
    events: input.state.events.filter((event) => event.visibleToRoleIds.includes(viewerRoleId)),
    groupId: group.groupId,
    labelKey: group.labelKey,
    messages: getVisibleNightConversationMessages(input.state, group.groupId),
    participantPlayerIds,
    readOnly,
  };
}

export function buildRealtimeNotificationPayload(params: {
  reason: string;
  roomCode: string;
  scope: "room" | "player_private" | "role_private";
  sentAt: string;
}): Readonly<Record<string, string>> {
  return {
    reason: params.reason,
    roomCode: params.roomCode,
    scope: params.scope,
    sentAt: params.sentAt,
  };
}

function isEventVisibleToPlayer(
  event: GameEvent,
  viewerPlayerId: PlayerId,
  viewerRoleId: RoleId | null,
): boolean {
  if (event.visibility === GameEventVisibility.Public) {
    return true;
  }

  if (event.visibility === GameEventVisibility.Internal) {
    return false;
  }

  return (
    event.visibleToPlayerIds.includes(viewerPlayerId) ||
    (viewerRoleId !== null && event.visibleToRoleIds.includes(viewerRoleId))
  );
}

function getVisibleNightConversationMessages(
  state: ReadonlyGameState,
  groupId: string,
): readonly NightConversationMessageState[] {
  if (state.phase === null || state.nightNumber < 1) {
    return [];
  }

  return state.nightConversationMessages.filter(
    (message) =>
      message.conversationGroupId === groupId && message.nightNumber === state.nightNumber,
  );
}
