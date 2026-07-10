import "server-only";
import {
  CurrentRoomChangedError,
  CurrentRoomExistsError,
  RoomExpiredError,
  RoomFullError,
  RoomNotFoundError,
  RoomNotJoinableError,
  RoomSwitchForbiddenError,
} from "./gameRepositoryErrors";
import { jsonError } from "./http";

export function roomApiErrorResponse(error: unknown): Response | null {
  if (error instanceof CurrentRoomExistsError) {
    return jsonError("current_room_exists", "This account is already in another room.", 409);
  }

  if (error instanceof CurrentRoomChangedError) {
    return jsonError(
      "current_room_changed",
      "The current room changed. Reload and try again.",
      409,
    );
  }

  if (error instanceof RoomSwitchForbiddenError) {
    return jsonError(
      "room_switch_forbidden",
      "Players cannot leave or switch rooms while a game is in progress.",
      409,
    );
  }

  if (error instanceof RoomExpiredError) {
    return jsonError("room_expired", "The room has expired.", 410);
  }

  if (error instanceof RoomFullError) {
    return jsonError("room_full", "The room is full.", 409);
  }

  if (error instanceof RoomNotJoinableError) {
    return jsonError("room_not_joinable", "The room is no longer joinable.", 409);
  }

  if (error instanceof RoomNotFoundError) {
    return jsonError("room_not_found", "Room not found.", 404);
  }

  return null;
}
