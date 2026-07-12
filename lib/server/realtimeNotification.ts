import type { RealtimeScope } from "@/lib/shared/game";

export function buildRealtimeNotificationPayload(params: {
  reason: string;
  roomCode: string;
  scope: RealtimeScope;
  sentAt: string;
}): Readonly<Record<string, string>> {
  return {
    reason: params.reason,
    roomCode: params.roomCode,
    scope: params.scope,
    sentAt: params.sentAt,
  };
}
