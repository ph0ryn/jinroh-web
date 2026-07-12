import "server-only";
import {
  ActionActorStateRequirement,
  ActionTargetStateRequirement,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  RoleTargetKind,
} from "../types";
import { Role } from "./base";
import { VILLAGE_TEAM } from "./villager";

import type {
  DeathReason as RoleDeathReason,
  EffectTag as RoleEffectTag,
  GameActionKind,
  GameEffect,
  RoleId,
} from "../types";
import type { ExecutionContext, RoleActionResolvedContext } from "./base";

const RETALIATION_ACTION_KIND: GameActionKind = "hunter_retaliate";
const RETALIATION_DEATH_REASON: RoleDeathReason = "retaliation";
const RETALIATION_EFFECT_TAG: RoleEffectTag = "retaliation";

export class HunterRole extends Role {
  override readonly id: RoleId = "hunter";
  override readonly maxCount = 1;
  override readonly order = 60;
  override readonly presentation = {
    en: {
      description: "If executed, choose one living player to take with you.",
      name: "Hunter",
      shortLabel: "H",
    },
    ja: {
      description: "処刑されたとき、生存者1人を道連れにします。",
      name: "ハンター",
      shortLabel: "猟",
    },
  };
  override readonly team = VILLAGE_TEAM;
  override readonly version = 2;

  override getActionPresentation(actionKind: GameActionKind) {
    if (actionKind !== RETALIATION_ACTION_KIND) {
      return super.getActionPresentation(actionKind);
    }

    return {
      en: { label: "Choose someone to take with you", submitLabel: "Take with you" },
      ja: { label: "道連れにする相手を選ぶ", submitLabel: "道連れにする" },
    };
  }

  override onExecuted(context: ExecutionContext): readonly GameEffect[] {
    const eligibleTargetPlayerIds = context.state.alivePlayerIds.filter(
      (playerId) => playerId !== context.targetId,
    );

    return [
      ...super.onExecuted(context),
      ...(eligibleTargetPlayerIds.length === 0
        ? []
        : [
            {
              actionKey: `hunter-retaliate:${context.state.phaseInstanceId ?? "execution"}:${context.targetId}`,
              actionKind: RETALIATION_ACTION_KIND,
              actorPlayerId: context.targetId,
              actorRoleId: this.id,
              actorStateRequirement: ActionActorStateRequirement.Assigned,
              eligibleTargetPlayerIds,
              emitterRoleId: this.id,
              id: `action:hunter-retaliate:${context.targetId}`,
              kind: GameEffectKind.CurrentAction,
              layer: GameEffectLayer.Action,
              priority: 200,
              resolverRoleId: this.id,
              sourceActionId: null,
              tags: [],
              target: RoleTargetKind.SinglePlayer,
              targetStateRequirement: ActionTargetStateRequirement.Alive,
            } satisfies GameEffect,
          ]),
    ];
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== RETALIATION_ACTION_KIND || context.targetId === null) {
      return [];
    }

    return [
      this.createDeathEffect({
        id: `death:retaliation:${context.actorId}:${context.targetId}`,
        playerId: context.targetId,
        reason: RETALIATION_DEATH_REASON,
        tags: [RETALIATION_EFFECT_TAG, EFFECT_TAG.Unpreventable],
      }),
    ];
  }
}
