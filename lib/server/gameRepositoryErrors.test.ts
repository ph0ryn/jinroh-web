import { describe, expect, it } from "vitest";

import {
  CurrentRoomChangedError,
  CurrentRoomExistsError,
  RoomExpiredError,
  RoomFullError,
  RoomNotFoundError,
  RoomNotJoinableError,
  RoomSwitchForbiddenError,
  toGameRepositoryError,
} from "./gameRepositoryErrors";

describe("toGameRepositoryError", () => {
  it.each([
    ["current_room_exists", CurrentRoomExistsError],
    ["current_room_changed", CurrentRoomChangedError],
    ["room_switch_forbidden", RoomSwitchForbiddenError],
    ["room_expired", RoomExpiredError],
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
