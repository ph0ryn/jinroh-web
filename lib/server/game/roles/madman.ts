import "server-only";
import { PlayerResult, Team } from "../types";
import { Role } from "./base";

import type { RoleDefaultCountContext, RoleId } from "../types";
import type { PlayerResultContext } from "./base";

export class MadmanRole extends Role {
  override readonly description = "Counts as non-werewolf but wins with the werewolf team.";
  override readonly id: RoleId = "madman";
  override readonly maxCount = 1;
  override readonly name = "Madman";
  override readonly order = 20;
  override readonly shortLabel = "M";
  override readonly team = Team.Werewolf;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 6 ? 1 : 0;
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    return context.winnerTeam === Team.Werewolf ? PlayerResult.Win : null;
  }
}
