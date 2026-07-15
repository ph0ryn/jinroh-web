import { describe, expect, it } from "vitest";

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
  toGameRepositoryError,
} from "./gameRepositoryErrors";

describe("toGameRepositoryError", () => {
  it.each([
    ["stale_roster_revision", StaleRosterRevisionError],
    ["room_roster_not_ready", RoomRosterNotReadyError],
    ["room_players_changed", RoomRosterNotReadyError],
    ["stale_game_id", StaleGameIdError],
    ["current_room_exists", CurrentRoomExistsError],
    ["current_room_changed", CurrentRoomChangedError],
    ["room_switch_forbidden", RoomSwitchForbiddenError],
    ["room_closed", RoomClosedError],
    ["room_full", RoomFullError],
    ["room_not_joinable", RoomNotJoinableError],
    ["room_not_found", RoomNotFoundError],
  ])("maps the %s database marker", (marker, expectedError) => {
    expect(toGameRepositoryError(`Database operation failed: ${marker}`)).toBeInstanceOf(
      expectedError,
    );
  });

  it("preserves an unknown database message", () => {
    const error = toGameRepositoryError("unexpected failure");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("unexpected failure");
  });
});
