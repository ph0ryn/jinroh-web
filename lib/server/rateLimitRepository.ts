import "server-only";
import { createServiceClient } from "./supabase";

export type RateLimitRule = {
  readonly capacity: number;
  readonly key: string;
  readonly refillSeconds: number;
};

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
};

type RateLimitDecisionRecord = {
  allowed: boolean;
  retry_after_seconds: number;
};

export type RoomLookupAccess = "member" | "not_found" | "outsider";

type RoomLookupAccessRecord = {
  access_kind: RoomLookupAccess;
};

export async function classifyRoomLookup(
  accountId: number,
  roomCode: string,
): Promise<RoomLookupAccess> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .rpc("app_classify_room_lookup", {
      p_account_id: accountId,
      p_room_code: roomCode,
    })
    .single<RoomLookupAccessRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  if (!isRoomLookupAccess(data.access_kind)) {
    throw new Error("Room lookup classification is invalid.");
  }

  return data.access_kind;
}

export async function consumeRateLimits(
  rules: readonly RateLimitRule[],
): Promise<RateLimitDecision> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .rpc("app_consume_rate_limits", {
      p_rules: rules.map(({ capacity, key, refillSeconds }) => ({
        capacity,
        key,
        refillSeconds,
      })),
    })
    .single<RateLimitDecisionRecord>();

  if (error !== null) {
    throw new Error(error.message);
  }

  return {
    allowed: data.allowed,
    retryAfterSeconds: data.retry_after_seconds,
  };
}

function isRoomLookupAccess(value: string): value is RoomLookupAccess {
  return value === "member" || value === "not_found" || value === "outsider";
}
