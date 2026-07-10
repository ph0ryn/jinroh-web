import "server-only";

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

export class RoomExpiredError extends Error {
  constructor() {
    super("Room expired.");
    this.name = "RoomExpiredError";
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

export function toGameRepositoryError(message: string): Error {
  if (message.includes("current_room_exists")) {
    return new CurrentRoomExistsError();
  }

  if (message.includes("current_room_changed")) {
    return new CurrentRoomChangedError();
  }

  if (message.includes("room_switch_forbidden")) {
    return new RoomSwitchForbiddenError();
  }

  if (message.includes("room_expired")) {
    return new RoomExpiredError();
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
