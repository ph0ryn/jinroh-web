import "server-only";
import { Team } from "../types";
import { Role } from "./base";

import type { RoleId } from "../types";

export class VillagerRole extends Role {
  override readonly description = "Has no special action and wins with the village.";
  override readonly id: RoleId = "villager";
  override readonly name = "Villager";
  override readonly team = Team.Village;
}
