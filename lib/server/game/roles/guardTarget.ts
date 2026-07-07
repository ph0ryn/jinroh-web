import "server-only";
import { GameActionKind, GameEventKind, GuardConsecutiveTargetPolicy } from "../types";

import type { PlayerId } from "../types";
import type { RoleContext } from "./base";

export function isGuardTargetAllowed(params: {
  context: RoleContext;
  guardPlayerId: PlayerId;
  targetPlayerId: PlayerId;
}): boolean {
  if (
    params.context.state.ruleOptions.guardConsecutiveTargetPolicy ===
    GuardConsecutiveTargetPolicy.Allow
  ) {
    return true;
  }

  const previousGuardEvent = [...params.context.state.events].reverse().find((event) => {
    return (
      event.kind === GameEventKind.ActionResolved &&
      event.actorPlayerId === params.guardPlayerId &&
      event.payload["actionKind"] === GameActionKind.Guard
    );
  });

  if (previousGuardEvent === undefined) {
    return true;
  }

  const previousTargetIds = previousGuardEvent.payload["targetPlayerIds"];

  if (!Array.isArray(previousTargetIds)) {
    return true;
  }

  return previousTargetIds[0] !== params.targetPlayerId;
}
