import "server-only";
import {
  ActionTargetStateRequirement,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  GamePhase,
  RoleTargetKind,
} from "../types";
import { Role } from "./base";
import { VILLAGE_TEAM } from "./villager";

import type {
  GameActionKind,
  GameEffect,
  PlayerId,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSpecificOptionDefinition,
} from "../types";
import type { PlayerRoleContext, RoleActionResolvedContext } from "./base";

const GUARD_ACTION_KIND: GameActionKind = "guard";
const CONSECUTIVE_TARGET_OPTION_KEY = "consecutive_target";
const ALLOW_CONSECUTIVE_TARGET = "allow";
const DENY_CONSECUTIVE_TARGET = "deny";

export class GuardRole extends Role {
  override readonly id: RoleId = "guard";
  override readonly maxCount = 1;
  override readonly order = 40;
  override readonly presentation = {
    en: {
      description: "Protect one player from the werewolves each night.",
      name: "Guard",
      shortLabel: "G",
    },
    ja: {
      description: "毎夜1人を選び、人狼の襲撃から守ります。",
      name: "狩人",
      shortLabel: "狩",
    },
  };
  override readonly team = VILLAGE_TEAM;
  override readonly version = 2;

  override getActionPresentation(actionKind: GameActionKind) {
    if (actionKind !== GUARD_ACTION_KIND) {
      return super.getActionPresentation(actionKind);
    }

    return {
      en: { label: "Choose someone to protect", submitLabel: "Protect" },
      ja: { label: "護衛する相手を選ぶ", submitLabel: "護衛する" },
    };
  }

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 5 ? 1 : 0;
  }

  override getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [
      {
        choices: [
          {
            label: { en: "Deny the same target", ja: "同じ相手への連続護衛を禁止" },
            value: DENY_CONSECUTIVE_TARGET,
          },
          {
            label: { en: "Allow the same target", ja: "同じ相手への連続護衛を許可" },
            value: ALLOW_CONSECUTIVE_TARGET,
          },
        ],
        defaultValue: DENY_CONSECUTIVE_TARGET,
        key: CONSECUTIVE_TARGET_OPTION_KEY,
        label: {
          en: "Protect the same player on consecutive nights",
          ja: "前夜と同じ相手を護衛する",
        },
      },
    ];
  }

  override getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night || context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GUARD_ACTION_KIND,
        roleGroupRoleId: null,
        target: RoleTargetKind.SinglePlayer,
        targetStateRequirement: ActionTargetStateRequirement.Alive,
      },
    ];
  }

  override getEligibleTargets(
    action: RoleActionDefinition,
    context: PlayerRoleContext,
  ): readonly string[] {
    if (action.kind !== GUARD_ACTION_KIND) {
      return super.getEligibleTargets(action, context);
    }

    return context.state.alivePlayerIds.filter((playerId) => {
      return playerId !== context.playerId && this.isTargetAllowed(context, playerId);
    });
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== GUARD_ACTION_KIND || context.targetId === null) {
      return [];
    }

    return [
      {
        emitterRoleId: this.id,
        id: `protection:guard:${context.targetId}`,
        kind: GameEffectKind.Protection,
        layer: GameEffectLayer.Prevention,
        playerId: context.targetId,
        prevents: [EFFECT_TAG.Guardable],
        priority: 10,
        reason: "guard",
        sourceActionId: null,
        tags: [],
      },
    ];
  }

  private isTargetAllowed(context: PlayerRoleContext, targetPlayerId: PlayerId): boolean {
    if (
      this.getOptionValue(context.state.ruleOptions, CONSECUTIVE_TARGET_OPTION_KEY) ===
      ALLOW_CONSECUTIVE_TARGET
    ) {
      return true;
    }

    const previousGuardAction = [...context.state.resolvedActions].reverse().find((action) => {
      return (
        action.resolutionStatus === "submitted" &&
        action.actorPlayerId === context.playerId &&
        action.kind === GUARD_ACTION_KIND &&
        action.nightNumber === context.state.nightNumber - 1 &&
        action.phase === GamePhase.Night &&
        action.resolverRoleId === this.id
      );
    });

    if (previousGuardAction === undefined) {
      return true;
    }

    return previousGuardAction.targetPlayerIds[0] !== targetPlayerId;
  }
}
