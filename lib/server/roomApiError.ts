import "server-only";
import {
  CurrentRoomChangedError,
  CurrentRoomExistsError,
  RoomClosedError,
  RoomFullError,
  RoomNotFoundError,
  RoomNotJoinableError,
  RoomRosterNotReadyError,
  RoomSwitchForbiddenError,
  StaleGameIdError,
  StaleRosterRevisionError,
} from "./gameRepositoryErrors";
import { jsonError } from "./http";

export function roomApiErrorResponse(error: unknown): Response | null {
  if (error instanceof StaleRosterRevisionError) {
    return jsonError("roster_changed", "The room roster changed. Reload and try again.", 409);
  }

  if (error instanceof RoomRosterNotReadyError) {
    return jsonError("players_not_ready", "Every connected player must be ready to start.", 409);
  }

  if (error instanceof StaleGameIdError) {
    return jsonError("game_changed", "The current game changed. Reload and try again.", 409);
  }

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

  if (error instanceof RoomClosedError) {
    return jsonError("room_closed", "The room is closed.", 410);
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
