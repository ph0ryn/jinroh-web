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
import { SEER_ROLE_ID } from "./roleIds";

import type { RoleActionDefinition, RoleId } from "../types";
import type { PlayerRoleContext } from "./base";

export class SeerRole extends Role {
  override readonly description =
    "Inspects one player at night and receives their inspection view.";
  override readonly id: RoleId = SEER_ROLE_ID;
  override readonly maxCount = 1;
  override readonly name = "Seer";
  override readonly team = Team.Village;

  override getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night || context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GameActionKind.Inspect,
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
