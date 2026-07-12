import "server-only";
import { Role } from "./base";

import type { RoleDefaultCountContext, RoleId, RoleTeamDefinition } from "../types";

export const VILLAGE_TEAM = {
  id: "village",
  presentation: { en: "Villagers", ja: "村人陣営" },
} as const satisfies RoleTeamDefinition;

export class VillagerRole extends Role {
  override readonly id: RoleId = "villager";
  override readonly order = 80;
  override readonly presentation = {
    en: {
      description: "Find and execute the werewolves through discussion and voting.",
      name: "Villager",
      shortLabel: "V",
    },
    ja: {
      description: "話し合いと投票で人狼を見つけ、村を勝利へ導きます。",
      name: "村人",
      shortLabel: "村",
    },
  };
  override readonly team = VILLAGE_TEAM;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return Math.max(context.playerCount - context.assignedRoleCount, 0);
  }
}
