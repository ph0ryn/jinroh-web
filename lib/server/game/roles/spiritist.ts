import "server-only";
import { GameEffectKind, GameEffectLayer, Team } from "../types";
import { Role } from "./base";
import { SPIRITIST_ROLE_ID } from "./roleIds";

import type { GameEffect, RoleId } from "../types";
import type { ExecutionResolvedContext } from "./base";

export class SpiritistRole extends Role {
  override readonly description = "Sees the role of an executed player.";
  override readonly id: RoleId = SPIRITIST_ROLE_ID;
  override readonly maxCount = 1;
  override readonly name = "Spiritist";
  override readonly team = Team.Village;

  override onExecutionResolved(context: ExecutionResolvedContext): readonly GameEffect[] {
    return context.state.alivePlayerIds
      .filter(
        (playerId) =>
          playerId !== context.targetId && context.state.roleByPlayerId.get(playerId) === this.id,
      )
      .map((playerId) => ({
        emitterRoleId: this.id,
        id: `spiritist-result:${context.targetId}:${playerId}`,
        kind: GameEffectKind.PrivateMessage,
        layer: GameEffectLayer.Information,
        messageKey: "spiritist_result",
        payload: {
          roleId: context.targetRoleId,
          targetPlayerId: context.targetId,
        },
        playerId,
        priority: 100,
        sourceActionId: null,
        tags: [],
      }));
  }
}
