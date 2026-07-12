import "server-only";
import { randomInt } from "node:crypto";

import {
  ActionTargetStateRequirement,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  GamePhase,
  GameStatus,
  InspectionView,
  RoleTargetKind,
} from "../types";
import { Role, scopeRoleContext } from "./base";
import { VILLAGE_TEAM } from "./villager";

import type {
  GameActionKind,
  GameEffect,
  GameEventPresentation,
  FirstNightStartedEffect,
  ReadonlyGameState,
  RoleActionDefinition,
  RoleDefaultCountContext,
  RoleId,
  RoleSpecificOptionDefinition,
} from "../types";
import type {
  InspectionContext,
  PlayerRoleContext,
  RoleActionResolvedContext,
  RoleRuleValidationContext,
  RoleRuleValidationIssue,
} from "./base";

const INSPECT_ACTION_KIND: GameActionKind = "inspect";
const INITIAL_INSPECTION_OPTION_KEY = "initial_inspection";
const INITIAL_INSPECTION_DISABLED = "disabled";
const INITIAL_INSPECTION_ENABLED = "enabled";

export class SeerRole extends Role {
  override readonly id: RoleId = "seer";
  override readonly maxCount = 1;
  override readonly order = 30;
  override readonly presentation = {
    en: {
      description: "Inspect one player each night to learn whether they are a werewolf.",
      name: "Seer",
      shortLabel: "Se",
    },
    ja: {
      description: "毎夜1人を占い、人狼かどうかを知ることができます。",
      name: "占い師",
      shortLabel: "占",
    },
  };
  override readonly team = VILLAGE_TEAM;
  override readonly version = 2;

  override getActionPresentation(actionKind: GameActionKind) {
    if (actionKind !== INSPECT_ACTION_KIND) {
      return super.getActionPresentation(actionKind);
    }

    return {
      en: { label: "Choose someone to inspect", submitLabel: "Inspect" },
      ja: { label: "占う相手を選ぶ", submitLabel: "占う" },
    };
  }

  override getDefaultCount(context: RoleDefaultCountContext): number {
    return context.playerCount >= 4 ? 1 : 0;
  }

  override getSpecificOptions(): readonly RoleSpecificOptionDefinition[] {
    return [
      {
        choices: [
          {
            label: { en: "Enabled", ja: "有効" },
            value: INITIAL_INSPECTION_ENABLED,
          },
          {
            label: { en: "Disabled", ja: "無効" },
            value: INITIAL_INSPECTION_DISABLED,
          },
        ],
        defaultValue: INITIAL_INSPECTION_ENABLED,
        key: INITIAL_INSPECTION_OPTION_KEY,
        label: {
          en: "Receive an inspection result on the first night",
          ja: "初夜に占い結果を得る",
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
        kind: INSPECT_ACTION_KIND,
        roleGroupRoleId: null,
        target: RoleTargetKind.SinglePlayer,
        targetStateRequirement: ActionTargetStateRequirement.Alive,
      },
    ];
  }

  override validateRuleSet(context: RoleRuleValidationContext): readonly RoleRuleValidationIssue[] {
    if (
      this.getOptionValue(context.options, INITIAL_INSPECTION_OPTION_KEY) !==
        INITIAL_INSPECTION_ENABLED ||
      (context.roleCounts[this.id] ?? 0) <= 0 ||
      this.hasInitialInspectionHumanCandidate(context)
    ) {
      return [];
    }

    return [
      {
        code: "role:seer:no_initial_inspection_candidate",
        message: "Initial inspection requires at least one non-seer human inspection candidate.",
        roleId: this.id,
      },
    ];
  }

  override onFirstNightStarted(context: PlayerRoleContext): readonly FirstNightStartedEffect[] {
    if (
      this.getOptionValue(context.state.ruleOptions, INITIAL_INSPECTION_OPTION_KEY) !==
      INITIAL_INSPECTION_ENABLED
    ) {
      return [];
    }

    const candidateIds = context.state.alivePlayerIds.filter((playerId) => {
      if (playerId === context.playerId) {
        return false;
      }

      const roleId = context.state.roleByPlayerId.get(playerId);

      if (roleId === undefined) {
        return false;
      }

      const role = context.roles.get(roleId);

      return (
        role.seenAs({
          ...scopeRoleContext(context, role.id),
          targetId: playerId,
          viewerId: context.playerId,
        }) === InspectionView.Human
      );
    });
    if (candidateIds.length === 0) {
      return [];
    }

    const targetId = candidateIds[randomInt(candidateIds.length)];

    if (targetId === undefined) {
      return [];
    }

    return [
      {
        emitterRoleId: this.id,
        eventKind: "initial_inspection",
        id: `initial-inspection:${context.playerId}:${targetId}`,
        kind: GameEffectKind.PrivateMessage,
        layer: GameEffectLayer.Information,
        playerId: context.playerId,
        presentation: createInspectionPresentation(targetId, InspectionView.Human, true),
        priority: 100,
        sourceActionId: null,
        tags: [],
      },
    ];
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== INSPECT_ACTION_KIND || context.targetId === null) {
      return [];
    }

    const targetRoleId = context.state.roleByPlayerId.get(context.targetId);

    if (targetRoleId === undefined) {
      return [];
    }

    const targetRole = context.roles.get(targetRoleId);
    const inspectionContext = {
      ...scopeRoleContext(context, targetRole.id),
      targetId: context.targetId,
      viewerId: context.actorId,
    };
    const inspectionView = targetRole.seenAs(inspectionContext);

    return [
      {
        emitterRoleId: this.id,
        id: `inspection:${context.actorId}:${context.targetId}`,
        kind: GameEffectKind.InspectionResult,
        layer: GameEffectLayer.Information,
        presentation: createInspectionPresentation(context.targetId, inspectionView, false),
        priority: 100,
        sourceActionId: null,
        tags: [],
        targetId: context.targetId,
        view: inspectionView,
        viewerId: context.actorId,
      },
      {
        emitterRoleId: this.id,
        id: `inspection-hook:${context.actorId}:${context.targetId}`,
        kind: GameEffectKind.Inspection,
        layer: GameEffectLayer.Action,
        priority: 100,
        sourceActionId: null,
        tags: [EFFECT_TAG.Inspection],
        targetId: context.targetId,
        viewerId: context.actorId,
      },
    ];
  }

  private hasInitialInspectionHumanCandidate(context: RoleRuleValidationContext): boolean {
    return context.roles.getAll().some((role) => {
      if (role.id === this.id || (context.roleCounts[role.id] ?? 0) <= 0) {
        return false;
      }

      return (
        role.seenAs(createInspectionCandidateContext(context, this.id, role.id)) ===
        InspectionView.Human
      );
    });
  }
}

function createInspectionPresentation(
  targetId: string,
  view: InspectionView,
  initial: boolean,
): GameEventPresentation {
  let result = { en: "unknown", ja: "不明" };

  if (view === InspectionView.Werewolf) {
    result = { en: "a werewolf", ja: "人狼" };
  } else if (view === InspectionView.Human) {
    result = { en: "human", ja: "人間" };
  }

  return {
    details: [
      {
        label: { en: "Player", ja: "プレイヤー" },
        value: { kind: "player", playerId: targetId },
      },
      {
        label: { en: "Result", ja: "結果" },
        value: { kind: "localized_text", text: result },
      },
    ],
    message: initial
      ? { en: "Your first-night inspection is complete.", ja: "初夜の占いが完了しました。" }
      : { en: "Your inspection is complete.", ja: "占いが完了しました。" },
    title: initial
      ? { en: "Initial inspection", ja: "初日占い" }
      : { en: "Inspection result", ja: "占い結果" },
  };
}

function createInspectionCandidateContext(
  context: RoleRuleValidationContext,
  viewerRoleId: RoleId,
  roleId: RoleId,
): InspectionContext {
  return {
    roles: context.roles,
    state: createInspectionCandidateState(context, viewerRoleId, roleId),
    targetId: "candidate",
    viewerId: "viewer",
  };
}

function createInspectionCandidateState(
  context: RoleRuleValidationContext,
  viewerRoleId: RoleId,
  roleId: RoleId,
): ReadonlyGameState {
  return {
    alivePlayerIds: ["viewer", "candidate"],
    currentActions: [],
    finalOutcome: null,
    nightConversationMessages: [],
    nightNumber: 1,
    pendingActions: [],
    phase: GamePhase.Night,
    phaseInstanceId: "setup",
    resolvedActions: [],
    resolvedRoleSetup: {
      activeRoleIds: [...new Set([viewerRoleId, roleId])],
      contributions: [],
      nightConversationGroups: [],
    },
    roleByPlayerId: new Map([
      ["viewer", viewerRoleId],
      ["candidate", roleId],
    ]),
    ruleOptions: context.options,
    status: GameStatus.Playing,
  };
}
