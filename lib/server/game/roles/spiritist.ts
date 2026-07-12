import "server-only";
import { DEATH_REASON, GameEffectKind, GameEffectLayer, InspectionView } from "../types";
import { Role, scopeRoleContext } from "./base";
import { VILLAGE_TEAM } from "./villager";

import type { GameEffect, GameEventPresentation, RoleId } from "../types";
import type { DeathResolvedContext } from "./base";

export class SpiritistRole extends Role {
  override readonly id: RoleId = "spiritist";
  override readonly maxCount = 1;
  override readonly order = 50;
  override readonly presentation = {
    en: {
      description: "Learn whether each executed player was a werewolf.",
      name: "Spiritist",
      shortLabel: "Sp",
    },
    ja: {
      description: "処刑された者が人狼だったかどうかを知ることができます。",
      name: "霊能者",
      shortLabel: "霊",
    },
  };
  override readonly team = VILLAGE_TEAM;
  override readonly version = 2;

  override onDeathResolved(context: DeathResolvedContext): readonly GameEffect[] {
    if (context.death.reason !== DEATH_REASON.Execution) {
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
            ...scopeRoleContext(context, executedRole.id),
            targetId: context.death.playerId,
            viewerId: playerId,
          }) === InspectionView.Werewolf
            ? "werewolf"
            : "human";

        return {
          emitterRoleId: this.id,
          eventKind: "spiritist_result",
          id: `spiritist-result:${context.death.playerId}:${playerId}`,
          kind: GameEffectKind.PrivateMessage,
          layer: GameEffectLayer.Information,
          playerId,
          presentation: createSpiritistPresentation(context.death.playerId, result),
          priority: 100,
          sourceActionId: null,
          tags: [],
        };
      });
  }
}

function createSpiritistPresentation(
  targetId: string,
  result: "human" | "werewolf",
): GameEventPresentation {
  return {
    details: [
      {
        label: { en: "Player", ja: "プレイヤー" },
        value: { kind: "player", playerId: targetId },
      },
      {
        label: { en: "Result", ja: "結果" },
        value: {
          kind: "localized_text",
          text:
            result === "werewolf" ? { en: "a werewolf", ja: "人狼" } : { en: "human", ja: "人間" },
        },
      },
    ],
    message: {
      en: "The executed player's result is available.",
      ja: "処刑されたプレイヤーの結果が判明しました。",
    },
    title: { en: "Spiritist result", ja: "霊能結果" },
  };
}
