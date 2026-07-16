import "server-only";

export class InvalidDisplayNameError extends Error {
  constructor() {
    super("Display name is invalid.");
    this.name = "InvalidDisplayNameError";
  }
}

export class RoomNotFoundError extends Error {
  constructor() {
    super("Room not found.");
    this.name = "RoomNotFoundError";
  }
}

export class CurrentRoomExistsError extends Error {
  constructor() {
    super("Current account already belongs to a room.");
    this.name = "CurrentRoomExistsError";
  }
}

export class CurrentRoomChangedError extends Error {
  constructor() {
    super("Current room changed before the operation completed.");
    this.name = "CurrentRoomChangedError";
  }
}

export class RoomClosedError extends Error {
  constructor() {
    super("Room closed.");
    this.name = "RoomClosedError";
  }
}

export class RoomFullError extends Error {
  constructor() {
    super("Room is full.");
    this.name = "RoomFullError";
  }
}

export class RoomNotJoinableError extends Error {
  constructor() {
    super("Room is not joinable.");
    this.name = "RoomNotJoinableError";
  }
}

export class RoomSwitchForbiddenError extends Error {
  constructor() {
    super("Current room cannot be left while its game is in progress.");
    this.name = "RoomSwitchForbiddenError";
  }
}

export class StaleRosterRevisionError extends Error {
  constructor() {
    super("Room roster changed before the operation completed.");
    this.name = "StaleRosterRevisionError";
  }
}

export class RoomRosterNotReadyError extends Error {
  constructor() {
    super("Every active player must be ready before the Game can start.");
    this.name = "RoomRosterNotReadyError";
  }
}

export class StaleGameIdError extends Error {
  constructor() {
    super("Current Game changed before the operation completed.");
    this.name = "StaleGameIdError";
  }
}

export function toGameRepositoryError(message: string): Error {
  if (message.includes("stale_roster_revision")) {
    return new StaleRosterRevisionError();
  }

  if (message.includes("room_roster_not_ready") || message.includes("room_players_changed")) {
    return new RoomRosterNotReadyError();
  }

  if (message.includes("stale_game_id")) {
    return new StaleGameIdError();
  }

  if (message.includes("current_room_exists")) {
    return new CurrentRoomExistsError();
  }

  if (message.includes("current_room_changed")) {
    return new CurrentRoomChangedError();
  }

  if (message.includes("room_switch_forbidden")) {
    return new RoomSwitchForbiddenError();
  }

  if (message.includes("room_closed")) {
    return new RoomClosedError();
  }

  if (message.includes("room_full")) {
    return new RoomFullError();
  }

  if (message.includes("room_not_joinable")) {
    return new RoomNotJoinableError();
  }

  if (message.includes("room_not_found")) {
    return new RoomNotFoundError();
  }

  return new Error(message);
}
