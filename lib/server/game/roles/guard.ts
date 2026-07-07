import "server-only";
import {
  ActionScope,
  GameActionKind,
  GamePhase,
  ResolveTiming,
  RoleTargetKind,
  SubmitPolicy,
  Team,
} from "../types";
import { Role } from "./base";
import { GUARD_ROLE_ID } from "./roleIds";

import type { RoleActionDefinition, RoleId } from "../types";
import type { PlayerRoleContext } from "./base";

export class GuardRole extends Role {
  override readonly description = "Protects one player from guardable night death effects.";
  override readonly id: RoleId = GUARD_ROLE_ID;
  override readonly maxCount = 1;
  override readonly name = "Guard";
  override readonly team = Team.Village;

  override getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night || context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GameActionKind.Guard,
        phase: GamePhase.Night,
        required: true,
        resolveTiming: ResolveTiming.PhaseEnd,
        roleGroupPolicy: null,
        roleGroupRoleId: null,
        scope: ActionScope.Player,
        submitPolicy: SubmitPolicy.FirstSubmitWins,
        target: RoleTargetKind.SinglePlayer,
      },
    ];
  }
}
