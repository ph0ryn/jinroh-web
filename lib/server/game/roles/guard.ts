import "server-only";
import {
  ActionScope,
  EffectTag,
  GameActionKind,
  GameEffectKind,
  GameEffectLayer,
  GameEventKind,
  GamePhase,
  GuardConsecutiveTargetPolicy,
  ResolveTiming,
  RoleTargetKind,
  SubmitPolicy,
  Team,
} from "../types";
import { Role } from "./base";

import type {
  GameEffect,
  PlayerId,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSpecificOptionDefinition,
} from "../types";
import type { PlayerRoleContext, RoleActionResolvedContext } from "./base";

export class GuardRole extends Role {
  override readonly description = "Protects one player from guardable night death effects.";
  override readonly id: RoleId = "guard";
  override readonly maxCount = 1;
  override readonly name = "Guard";
  override readonly order = 40;
  override readonly shortLabel = "G";
  override readonly team = Team.Village;

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 5 ? 1 : 0;
  }

  override getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [
      {
        key: "guardConsecutiveTargetPolicy",
        label: "Consecutive target",
        roleId: this.id,
      },
    ];
  }

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

  override getEligibleTargets(
    action: RoleActionDefinition,
    context: PlayerRoleContext,
  ): readonly string[] {
    if (action.kind !== GameActionKind.Guard) {
      return super.getEligibleTargets(action, context);
    }

    return context.state.alivePlayerIds.filter((playerId) => {
      return playerId !== context.playerId && this.isTargetAllowed(context, playerId);
    });
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== GameActionKind.Guard || context.targetId === null) {
      return [];
    }

    return [
      {
        emitterRoleId: this.id,
        id: `protection:guard:${context.targetId}`,
        kind: GameEffectKind.Protection,
        layer: GameEffectLayer.Prevention,
        playerId: context.targetId,
        prevents: [EffectTag.Guardable],
        priority: 10,
        reason: "guard",
        sourceActionId: null,
        tags: [],
      },
    ];
  }

  private isTargetAllowed(context: PlayerRoleContext, targetPlayerId: PlayerId): boolean {
    if (
      context.state.ruleOptions.guardConsecutiveTargetPolicy === GuardConsecutiveTargetPolicy.Allow
    ) {
      return true;
    }

    const previousGuardEvent = [...context.state.events].reverse().find((event) => {
      return (
        event.kind === GameEventKind.ActionResolved &&
        event.actorPlayerId === context.playerId &&
        event.payload["actionKind"] === GameActionKind.Guard
      );
    });

    if (previousGuardEvent === undefined) {
      return true;
    }

    const previousTargetIds = previousGuardEvent.payload["targetPlayerIds"];

    if (!Array.isArray(previousTargetIds)) {
      return true;
    }

    return previousTargetIds[0] !== targetPlayerId;
  }
}
