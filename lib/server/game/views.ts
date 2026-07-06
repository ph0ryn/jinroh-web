import "server-only";
import { GameEventVisibility, GamePhase } from "./types";

import type {
  CurrentAction,
  GameEvent,
  GameStatus,
  PlayerId,
  ReadonlyGameState,
  RoleId,
  WerewolfConsultationSlotState,
} from "./types";

const WEREWOLF_ROLE_ID = "werewolf";

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

export type WerewolfPrivateGameView = {
  consultationSlots: readonly RolePrivateConsultationSlot[];
  events: readonly GameEvent[];
  partnerPlayerIds: readonly PlayerId[];
  roleId: typeof WEREWOLF_ROLE_ID;
};

export type RolePrivateConsultationSlot = WerewolfConsultationSlotState & {
  readOnly: boolean;
};

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

export function buildWerewolfPrivateGameView(
  input: InternalGameViewInput,
  viewerPlayerId: PlayerId,
): WerewolfPrivateGameView | null {
  const viewerRoleId = input.state.roleByPlayerId.get(viewerPlayerId);

  if (viewerRoleId !== WEREWOLF_ROLE_ID) {
    return null;
  }

  const partnerPlayerIds = [...input.state.roleByPlayerId.entries()]
    .filter(([, roleId]) => roleId === WEREWOLF_ROLE_ID)
    .map(([playerId]) => playerId);

  return {
    consultationSlots: getVisibleWerewolfConsultationSlots(input.state),
    events: input.state.events.filter((event) => event.visibleToRoleIds.includes(WEREWOLF_ROLE_ID)),
    partnerPlayerIds,
    roleId: WEREWOLF_ROLE_ID,
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

function getVisibleWerewolfConsultationSlots(
  state: ReadonlyGameState,
): readonly RolePrivateConsultationSlot[] {
  if (state.phase === GamePhase.Night) {
    return state.werewolfConsultations
      .filter((slot) => slot.nightNumber === state.nightNumber)
      .map((slot) => ({ ...slot, readOnly: false }));
  }

  if (state.phase === GamePhase.Day && state.nightNumber > 1) {
    return state.werewolfConsultations
      .filter((slot) => slot.nightNumber === state.nightNumber - 1)
      .map((slot) => ({ ...slot, readOnly: true }));
  }

  return [];
}
