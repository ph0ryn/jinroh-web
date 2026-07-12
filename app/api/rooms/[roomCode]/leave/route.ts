import { leaveRoom } from "@/lib/server/gameRepository";
import { createAuthenticatedRoomMutationRoute } from "@/lib/server/roomRoute";

export const POST = createAuthenticatedRoomMutationRoute(leaveRoom, "Leave failed.");
