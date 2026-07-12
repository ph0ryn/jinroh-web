import "server-only";
import { PlayerResult } from "../types";
import { Role } from "./base";
import { WEREWOLF_TEAM } from "./werewolf";

import type { RoleDefaultCountContext, RoleId } from "../types";
import type { PlayerResultContext } from "./base";

export class MadmanRole extends Role {
  override readonly id: RoleId = "madman";
  override readonly maxCount = 1;
  override readonly order = 20;
  override readonly presentation = {
    en: {
      description: "Help the werewolves win without knowing who they are.",
      name: "Madman",
      shortLabel: "M",
    },
    ja: {
      description: "人狼の正体を知らないまま、人狼陣営の勝利に力を貸します。",
      name: "狂人",
      shortLabel: "狂",
    },
  };
  override readonly team = WEREWOLF_TEAM;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 6 ? 1 : 0;
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    return context.winnerTeam === this.team.id ? PlayerResult.Win : null;
  }
}
