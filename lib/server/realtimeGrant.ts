import {
  isRoleId,
  type RealtimeScope,
  type RealtimeSubscription,
  type RoleId,
} from "@/lib/shared/game";

type ActiveRealtimeGrant = {
  actorPlayerId: number;
  expiresAt: string;
  gameId: string | null;
  grantId: string;
  kind: "active";
  roomId: number;
  subscriptions: RealtimeSubscription[];
};

type ClosedRoomGrant = {
  actorPlayerId: number;
  kind: "room_closed";
  roomId: number;
};

export type RealtimeGrantRpcResult = ActiveRealtimeGrant | ClosedRoomGrant;

type ActiveRecord = {
  actorPlayerId: number;
  expiresAt: string;
  gameId: string | null;
  grantId: string;
  roomId: number;
  playerId: number | null;
  roleId: RoleId | null;
  scope: RealtimeScope;
  topic: string;
};

type RealtimeGrantRecord = {
  actor_player_id?: unknown;
  expires_at?: unknown;
  game_id?: unknown;
  grant_id?: unknown;
  notification_reason?: unknown;
  player_id?: unknown;
  result_kind?: unknown;
  role_id?: unknown;
  room_id?: unknown;
  scope?: unknown;
  topic?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseRealtimeGrantRpcResult(value: unknown): RealtimeGrantRpcResult {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Realtime grant has no subscriptions.");
  }

  const firstRecord = value[0];

  if (isRecord(firstRecord) && firstRecord.notification_reason === "room_closed") {
    if (
      value.length !== 1 ||
      firstRecord.result_kind !== "room_closed" ||
      !isPositiveSafeInteger(firstRecord.room_id) ||
      !isPositiveSafeInteger(firstRecord.actor_player_id) ||
      firstRecord.topic !== null ||
      firstRecord.scope !== null ||
      firstRecord.grant_id !== null ||
      firstRecord.expires_at !== null ||
      firstRecord.game_id !== null ||
      firstRecord.role_id !== null ||
      firstRecord.player_id !== null
    ) {
      throw new Error("Realtime grant returned an invalid Room closure result.");
    }

    return {
      actorPlayerId: firstRecord.actor_player_id,
      kind: "room_closed",
      roomId: firstRecord.room_id,
    };
  }

  const records = value.map(parseActiveRecord);
  const firstActiveRecord = records[0];

  if (
    firstActiveRecord === undefined ||
    records.some(
      (record) =>
        record.actorPlayerId !== firstActiveRecord.actorPlayerId ||
        record.expiresAt !== firstActiveRecord.expiresAt ||
        record.gameId !== firstActiveRecord.gameId ||
        record.grantId !== firstActiveRecord.grantId ||
        record.roomId !== firstActiveRecord.roomId,
    )
  ) {
    throw new Error("Realtime grant returned an inconsistent subscription set.");
  }

  const scopes = new Set(records.map((record) => record.scope));
  const topics = new Set(records.map((record) => record.topic));

  if (
    records.length < 2 ||
    records.length > 3 ||
    scopes.size !== records.length ||
    topics.size !== records.length ||
    !scopes.has("room") ||
    !scopes.has("player_private") ||
    (firstActiveRecord.gameId === null ? scopes.has("role_private") : !scopes.has("role_private"))
  ) {
    throw new Error("Realtime grant returned an invalid subscription set.");
  }

  return {
    actorPlayerId: firstActiveRecord.actorPlayerId,
    expiresAt: firstActiveRecord.expiresAt,
    gameId: firstActiveRecord.gameId,
    grantId: firstActiveRecord.grantId,
    kind: "active",
    roomId: firstActiveRecord.roomId,
    subscriptions: records.map((record) => ({
      scope: record.scope,
      topic: record.topic,
    })),
  };
}

function parseActiveRecord(value: unknown): ActiveRecord {
  if (
    !isRecord(value) ||
    !isPositiveSafeInteger(value.actor_player_id) ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    typeof value.grant_id !== "string" ||
    !UUID_PATTERN.test(value.grant_id) ||
    value.notification_reason !== null ||
    value.result_kind !== "active" ||
    !isPositiveSafeInteger(value.room_id) ||
    !isRealtimeScope(value.scope) ||
    typeof value.topic !== "string" ||
    value.topic.length === 0 ||
    !isNullableUuid(value.game_id) ||
    !hasValidTopicOwnership(value)
  ) {
    throw new Error("Realtime grant returned an invalid subscription record.");
  }

  return {
    actorPlayerId: value.actor_player_id,
    expiresAt: value.expires_at,
    gameId: value.game_id,
    grantId: value.grant_id,
    roomId: value.room_id,
    playerId: isPositiveSafeInteger(value.player_id) ? value.player_id : null,
    roleId: isRoleId(value.role_id) ? value.role_id : null,
    scope: value.scope,
    topic: value.topic,
  };
}

function hasValidTopicOwnership(value: RealtimeGrantRecord): boolean {
  switch (value.scope) {
    case "player_private":
      return value.player_id === value.actor_player_id && value.role_id === null;
    case "role_private":
      return value.game_id !== null && value.player_id === null && isRoleId(value.role_id);
    case "room":
      return value.player_id === null && value.role_id === null;
    default:
      return false;
  }
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

function isRealtimeScope(value: unknown): value is RealtimeScope {
  return value === "room" || value === "player_private" || value === "role_private";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is RealtimeGrantRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
