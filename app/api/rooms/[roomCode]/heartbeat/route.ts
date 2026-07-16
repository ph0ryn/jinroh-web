import { heartbeatRoom } from "@/lib/server/gameRepository";
import { createAuthenticatedRoomMutationRoute } from "@/lib/server/roomRoute";

export const POST = createAuthenticatedRoomMutationRoute(
  heartbeatRoom,
  "Heartbeat failed.",
  "heartbeat",
);
