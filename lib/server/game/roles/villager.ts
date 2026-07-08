import "server-only";
import { Team } from "../types";
import { Role } from "./base";

import type { RoleDefaultCountContext, RoleId } from "../types";

export class VillagerRole extends Role {
  override readonly description = "Has no special action and wins with the village.";
  override readonly id: RoleId = "villager";
  override readonly name = "Villager";
  override readonly order = 80;
  override readonly shortLabel = "V";
  override readonly team = Team.Village;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return Math.max(context.playerCount - context.assignedRoleCount, 0);
  }
}
