import "server-only";
import { EffectTag, GameEffectKind, GameEffectLayer } from "../types";
import { GUARD_ROLE_ID } from "./roleIds";

import type { DeathReason, GameEffect, PlayerId, RoleId } from "../types";

export function createDeathEffect(params: {
  emitterRoleId: RoleId;
  id: string;
  playerId: PlayerId;
  reason: DeathReason;
  tags: readonly EffectTag[];
}): GameEffect {
  return {
    emitterRoleId: params.emitterRoleId,
    id: params.id,
    kind: GameEffectKind.Death,
    layer: GameEffectLayer.Death,
    playerId: params.playerId,
    priority: 100,
    reason: params.reason,
    sourceActionId: null,
    tags: params.tags,
  };
}

export function createGuardProtectionEffect(params: {
  emitterRoleId?: RoleId;
  playerId: PlayerId;
  sourceActionId: string | null;
}): GameEffect {
  return {
    emitterRoleId: params.emitterRoleId ?? GUARD_ROLE_ID,
    id: `protection:guard:${params.playerId}`,
    kind: GameEffectKind.Protection,
    layer: GameEffectLayer.Prevention,
    playerId: params.playerId,
    prevents: [EffectTag.Guardable],
    priority: 10,
    reason: "guard",
    sourceActionId: params.sourceActionId,
    tags: [],
  };
}
