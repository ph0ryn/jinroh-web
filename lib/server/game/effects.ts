import "server-only";
import { GameEffectKind, GameEffectLayer } from "./types";

import type { RoleContext } from "./roles";
import type { GameActionKind, GameEffect, PlayerId, ResolvedDeath, RoleId } from "./types";

export type PreventedEffect = {
  effect: GameEffect;
  preventedByEffectIds: readonly string[];
};

export type EffectResolution = {
  appliedEffects: readonly GameEffect[];
  deathEffectsByPlayerId: ReadonlyMap<PlayerId, GameEffect>;
  preventedEffects: readonly PreventedEffect[];
};

const EFFECT_LAYER_ORDER: Readonly<Record<GameEffectLayer, number>> = {
  [GameEffectLayer.Action]: 50,
  [GameEffectLayer.Prevention]: 10,
  [GameEffectLayer.Death]: 20,
  [GameEffectLayer.Information]: 30,
  [GameEffectLayer.Message]: 40,
};

export function resolveEffects(effects: readonly GameEffect[]): EffectResolution {
  const sortedEffects = [...effects].sort(compareEffects);
  const appliedEffects: GameEffect[] = [];
  const preventedEffects: PreventedEffect[] = [];
  const protectionEffects: GameEffect[] = [];
  const deathEffectsByPlayerId = new Map<PlayerId, GameEffect>();

  for (const effect of sortedEffects) {
    if (effect.kind === GameEffectKind.Protection) {
      protectionEffects.push(effect);
      appliedEffects.push(effect);
      continue;
    }

    if (effect.kind !== GameEffectKind.Death) {
      appliedEffects.push(effect);
      continue;
    }

    const preventingProtectionIds = protectionEffects
      .filter((protectionEffect) => {
        return (
          protectionEffect.kind === GameEffectKind.Protection &&
          protectionEffect.playerId === effect.playerId &&
          protectionEffect.prevents.some((tag) => effect.tags.includes(tag))
        );
      })
      .map((protectionEffect) => protectionEffect.id);

    if (preventingProtectionIds.length > 0) {
      preventedEffects.push({
        effect,
        preventedByEffectIds: preventingProtectionIds,
      });
      continue;
    }

    if (!deathEffectsByPlayerId.has(effect.playerId)) {
      deathEffectsByPlayerId.set(effect.playerId, effect);
      appliedEffects.push(effect);
    }
  }

  return {
    appliedEffects,
    deathEffectsByPlayerId,
    preventedEffects,
  };
}

export function collectExecutionEffects(params: {
  context: RoleContext;
  sourceActionId: string | null;
  targetId: PlayerId;
}): readonly GameEffect[] {
  const targetRole = params.context.roles.get(
    getRequiredRoleIdForPlayer(params.context, params.targetId),
  );

  return targetRole
    .onExecuted({
      ...params.context,
      targetId: params.targetId,
    })
    .map((effect) => {
      return {
        ...effect,
        sourceActionId: params.sourceActionId,
      };
    });
}

export function collectExecutionResolvedEffects(params: {
  context: RoleContext;
  sourceActionId: string | null;
  targetId: PlayerId;
}): readonly GameEffect[] {
  const targetRoleId = getRequiredRoleIdForPlayer(params.context, params.targetId);

  return params.context.roles.getActiveRoles(params.context.state).flatMap((role) =>
    role
      .onExecutionResolved({
        ...params.context,
        targetId: params.targetId,
        targetRoleId,
      })
      .map((effect) => {
        return {
          ...effect,
          sourceActionId: params.sourceActionId,
        };
      }),
  );
}

export function collectDeathResolvedEffects(params: {
  context: RoleContext;
  deaths: readonly ResolvedDeath[];
  sourceActionId: string | null;
}): readonly GameEffect[] {
  return params.deaths.flatMap((death) =>
    params.context.roles.getActiveRoles(params.context.state).flatMap((role) =>
      role
        .onDeathResolved({
          ...params.context,
          death,
        })
        .map((effect) => {
          return {
            ...effect,
            sourceActionId: params.sourceActionId,
          };
        }),
    ),
  );
}

export function collectRoleActionEffects(params: {
  actionKind: GameActionKind;
  actorId: PlayerId;
  actorRoleId: RoleId | null;
  context: RoleContext;
  sourceActionId: string | null;
  targetId: PlayerId | null;
}): readonly GameEffect[] {
  const actorRoleId =
    params.actorRoleId ?? getRequiredRoleIdForPlayer(params.context, params.actorId);
  const actorRole = params.context.roles.get(actorRoleId);

  return actorRole
    .onActionResolved({
      ...params.context,
      actionKind: params.actionKind,
      actorId: params.actorId,
      actorRoleId,
      targetId: params.targetId,
    })
    .map((effect) => {
      return {
        ...effect,
        sourceActionId: params.sourceActionId,
      };
    });
}

function compareEffects(left: GameEffect, right: GameEffect): number {
  const layerComparison = EFFECT_LAYER_ORDER[left.layer] - EFFECT_LAYER_ORDER[right.layer];

  if (layerComparison !== 0) {
    return layerComparison;
  }

  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  return left.id.localeCompare(right.id);
}

function getRequiredRoleIdForPlayer(context: RoleContext, playerId: PlayerId): RoleId {
  const roleId = context.state.roleByPlayerId.get(playerId);

  if (roleId === undefined) {
    throw new Error(`Missing role assignment for player: ${playerId}`);
  }

  return roleId;
}
