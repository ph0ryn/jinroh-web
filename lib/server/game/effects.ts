import "server-only";
import { scopeRoleContext } from "./roles/base";
import { GameEffectKind, GameEffectLayer } from "./types";

import type { RoleContext } from "./roles/base";
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

export function assertRoleOwnsEffects(
  ownerRoleId: RoleId,
  effects: readonly GameEffect[],
): readonly GameEffect[] {
  const foreignEffect = effects.find((effect) => effect.emitterRoleId !== ownerRoleId);

  if (foreignEffect !== undefined) {
    throw new Error(
      `Role ${ownerRoleId} returned an effect owned by ${foreignEffect.emitterRoleId}.`,
    );
  }

  return effects;
}

export function expandRoleInteractionEffects(
  effects: readonly GameEffect[],
  context: RoleContext,
): GameEffect[] {
  const expandedEffects: GameEffect[] = [];
  const pendingEffects = [...effects];

  while (pendingEffects.length > 0) {
    if (expandedEffects.length + pendingEffects.length > 1_000) {
      throw new Error("Role interaction effect expansion exceeded its safe limit.");
    }

    const effect = pendingEffects.shift();

    if (effect === undefined) {
      break;
    }

    expandedEffects.push(effect);

    if (effect.kind !== GameEffectKind.Attack && effect.kind !== GameEffectKind.Inspection) {
      continue;
    }

    const targetRoleId = context.state.roleByPlayerId.get(effect.targetId);

    if (targetRoleId === undefined) {
      throw new Error(`Role interaction targets an unknown player: ${effect.targetId}`);
    }

    const targetRole = context.roles.get(targetRoleId);
    const targetContext = scopeRoleContext(context, targetRole.id);
    const interactionEffects =
      effect.kind === GameEffectKind.Attack
        ? targetRole.onAttacked({
            ...targetContext,
            attackerIds: effect.attackerIds,
            targetId: effect.targetId,
          })
        : targetRole.onInspected({
            ...targetContext,
            targetId: effect.targetId,
            viewerId: effect.viewerId,
          });

    pendingEffects.push(
      ...assertRoleOwnsEffects(targetRole.id, interactionEffects).map((interactionEffect) => ({
        ...interactionEffect,
        sourceActionId: effect.sourceActionId,
      })),
    );
  }

  return expandedEffects;
}

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

  return assertRoleOwnsEffects(
    targetRole.id,
    targetRole.onExecuted({
      ...scopeRoleContext(params.context, targetRole.id),
      targetId: params.targetId,
    }),
  ).map((effect) => {
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
    assertRoleOwnsEffects(
      role.id,
      role.onExecutionResolved({
        ...scopeRoleContext(params.context, role.id),
        targetId: params.targetId,
        targetRoleId,
      }),
    ).map((effect) => {
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
      assertRoleOwnsEffects(
        role.id,
        role.onDeathResolved({
          ...scopeRoleContext(params.context, role.id),
          death,
        }),
      ).map((effect) => {
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
  context: RoleContext;
  resolverRoleId: RoleId;
  sourceActionId: string | null;
  targetId: PlayerId | null;
}): readonly GameEffect[] {
  const actorRoleId = getRequiredRoleIdForPlayer(params.context, params.actorId);
  const resolverRole = params.context.roles.get(params.resolverRoleId);

  return assertRoleOwnsEffects(
    resolverRole.id,
    resolverRole.onActionResolved({
      ...scopeRoleContext(params.context, resolverRole.id),
      actionKind: params.actionKind,
      actorId: params.actorId,
      actorRoleId,
      targetId: params.targetId,
    }),
  ).map((effect) => {
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
