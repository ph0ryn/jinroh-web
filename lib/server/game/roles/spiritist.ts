import "server-only";
import { DeathReason, GameEffectKind, GameEffectLayer, InspectionView, Team } from "../types";
import { Role } from "./base";
import { SPIRITIST_ROLE_ID } from "./roleIds";

import type { GameEffect, RoleId } from "../types";
import type { DeathResolvedContext } from "./base";

export class SpiritistRole extends Role {
  override readonly description = "Learns whether the executed player was a werewolf.";
  override readonly id: RoleId = SPIRITIST_ROLE_ID;
  override readonly maxCount = 1;
  override readonly name = "Spiritist";
  override readonly order = 50;
  override readonly shortLabel = "Sp";
  override readonly team = Team.Village;

  override onDeathResolved(context: DeathResolvedContext): readonly GameEffect[] {
    if (context.death.reason !== DeathReason.Execution) {
      return [];
    }

    return context.state.alivePlayerIds
      .filter(
        (playerId) =>
          playerId !== context.death.playerId &&
          context.state.roleByPlayerId.get(playerId) === this.id,
      )
      .map((playerId) => {
        const executedRole = context.roles.get(context.death.roleId);
        const result =
          executedRole.seenAs({
            ...context,
            targetId: context.death.playerId,
            viewerId: playerId,
          }) === InspectionView.Werewolf
            ? "werewolf"
            : "human";

        return {
          emitterRoleId: this.id,
          id: `spiritist-result:${context.death.playerId}:${playerId}`,
          kind: GameEffectKind.PrivateMessage,
          layer: GameEffectLayer.Information,
          messageKey: "spiritist_result",
          payload: {
            result,
            targetPlayerId: context.death.playerId,
          },
          playerId,
          priority: 100,
          sourceActionId: null,
          tags: [],
        };
      });
  }
}
