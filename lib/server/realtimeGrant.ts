import type { RealtimeScope, RealtimeSubscription } from "@/lib/shared/game";

type ActiveRealtimeGrant = {
  actorPlayerId: number;
  expiresAt: string;
  grantId: string;
  kind: "active";
  roomId: number;
  subscriptions: RealtimeSubscription[];
};

type ExpiredWaitingRoomGrant = {
  actorPlayerId: number;
  kind: "waiting_room_ended";
  roomId: number;
};

export type RealtimeGrantRpcResult = ActiveRealtimeGrant | ExpiredWaitingRoomGrant;

type ActiveRecord = {
  actorPlayerId: number;
  expiresAt: string;
  grantId: string;
  roomId: number;
  scope: RealtimeScope;
  topic: string;
};

type RealtimeGrantRecord = {
  actor_player_id?: unknown;
  expires_at?: unknown;
  grant_id?: unknown;
  notification_reason?: unknown;
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

  if (isRecord(firstRecord) && firstRecord.notification_reason === "waiting_room_ended") {
    if (
      value.length !== 1 ||
      !isPositiveSafeInteger(firstRecord.room_id) ||
      !isPositiveSafeInteger(firstRecord.actor_player_id) ||
      firstRecord.topic !== null ||
      firstRecord.scope !== null ||
      firstRecord.grant_id !== null ||
      firstRecord.expires_at !== null
    ) {
      throw new Error("Realtime grant returned an invalid room-expiration result.");
    }

    return {
      actorPlayerId: firstRecord.actor_player_id,
      kind: "waiting_room_ended",
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
    !scopes.has("player_private")
  ) {
    throw new Error("Realtime grant returned an invalid subscription set.");
  }

  return {
    actorPlayerId: firstActiveRecord.actorPlayerId,
    expiresAt: firstActiveRecord.expiresAt,
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
    !isPositiveSafeInteger(value.room_id) ||
    !isRealtimeScope(value.scope) ||
    typeof value.topic !== "string" ||
    value.topic.length === 0
  ) {
    throw new Error("Realtime grant returned an invalid subscription record.");
  }

  return {
    actorPlayerId: value.actor_player_id,
    expiresAt: value.expires_at,
    grantId: value.grant_id,
    roomId: value.room_id,
    scope: value.scope,
    topic: value.topic,
  };
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
