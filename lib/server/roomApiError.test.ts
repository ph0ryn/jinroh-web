import { describe, expect, it } from "vitest";

import {
  RoomClosedError,
  RoomRosterNotReadyError,
  StaleGameIdError,
  StaleRosterRevisionError,
} from "./gameRepositoryErrors";
import { roomApiErrorResponse } from "./roomApiError";

describe("replayable Room API errors", () => {
  it.each([
    [new StaleRosterRevisionError(), "roster_changed", 409],
    [new RoomRosterNotReadyError(), "players_not_ready", 409],
    [new StaleGameIdError(), "game_changed", 409],
    [new RoomClosedError(), "room_closed", 410],
  ] as const)("maps %s to %s", async (error, expectedCode, expectedStatus) => {
    const response = roomApiErrorResponse(error);

    expect(response?.status).toBe(expectedStatus);
    await expect(response?.json()).resolves.toMatchObject({ error: { code: expectedCode } });
  });
});
