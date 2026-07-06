import "server-only";
import {
  ActionScope,
  CountGroup,
  DayDiscussionMode,
  DeathReason,
  EffectTag,
  GameActionKind,
  GameEffectKind,
  GameEffectLayer,
  GameEndReason,
  GameEventKind,
  GamePhase,
  GameStatus,
  GuardConsecutiveTargetPolicy,
  InspectionView,
  InitialInspectionPolicy,
  PlayerResult,
  ResolveTiming,
  RoleGroupActionPolicy,
  ROLE_IDS,
  RoleSetupContributionKind,
  RoleTargetKind,
  SubmitPolicy,
  Team,
  VoteResultVisibility,
  WerewolfConsultationFieldKind,
  WerewolfConsultationPlayerCandidates,
  WerewolfConsultationRoleCandidates,
  WerewolfConsultationTemplateKind,
  WerewolfConsultationTemplateSource,
} from "./types";

import type {
  CurrentAction,
  GameEffect,
  GameEndCandidate,
  PlayerId,
  ReadonlyGameState,
  RoleActionDefinition,
  RoleId,
  RoleSetupContribution,
  WinnerJudgementContribution,
} from "./types";

export const ROLE_REGISTRY_VERSION = "jinroh-core-v1";

const WEREWOLF_ROLE_ID: RoleId = "werewolf";
const FOX_ROLE_ID: RoleId = "fox";
const SEER_ROLE_ID: RoleId = "seer";
const GUARD_ROLE_ID: RoleId = "guard";

export type RoleContext = {
  roles: RoleRegistry;
  state: ReadonlyGameState;
};

export type PlayerRoleContext = RoleContext & {
  playerId: PlayerId;
};

export type InspectionContext = RoleContext & {
  targetId: PlayerId;
  viewerId: PlayerId;
};

export type AttackContext = RoleContext & {
  attackerIds: readonly PlayerId[];
  targetId: PlayerId;
};

export type ExecutionContext = RoleContext & {
  targetId: PlayerId;
};

export type WinnerJudgementContext = RoleContext & {
  endReasons: readonly GameEndReason[];
};

export type PlayerResultContext = PlayerRoleContext & {
  endReasons: readonly GameEndReason[];
  winnerTeam: Team;
};

export abstract class Role {
  abstract readonly description: string;
  abstract readonly id: RoleId;
  abstract readonly name: string;
  abstract readonly team: Team;

  readonly incompatibleRoleIds: readonly RoleId[] = [];
  readonly maxCount: number | null = null;
  readonly minCount: number = 0;
  readonly required: boolean = false;

  countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.NonWerewolf;
  }

  seenAs(context: InspectionContext): InspectionView {
    void context;

    return InspectionView.Human;
  }

  getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    void context;

    return [];
  }

  getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [];
  }

  onInspected(context: InspectionContext): readonly GameEffect[] {
    void context;

    return [];
  }

  onAttacked(context: AttackContext): readonly GameEffect[] {
    return [
      createDeathEffect({
        emitterRoleId: this.id,
        id: `death:attack:${context.targetId}`,
        playerId: context.targetId,
        reason: DeathReason.Attack,
        tags: [EffectTag.Attack, EffectTag.Guardable],
      }),
    ];
  }

  onExecuted(context: ExecutionContext): readonly GameEffect[] {
    return [
      createDeathEffect({
        emitterRoleId: this.id,
        id: `death:execution:${context.targetId}`,
        playerId: context.targetId,
        reason: DeathReason.Execution,
        tags: [EffectTag.Execution, EffectTag.Unpreventable],
      }),
    ];
  }

  onMissingAction(currentAction: CurrentAction, context: RoleContext): readonly GameEffect[] {
    void currentAction;
    void context;

    return [];
  }

  checkEndCondition(context: RoleContext): GameEndCandidate | null {
    void context;

    return null;
  }

  evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    void judgement;
    void context;

    return false;
  }

  evaluateResult(context: PlayerResultContext): PlayerResult | null {
    void context;

    return null;
  }
}

export class VillagerRole extends Role {
  override readonly description = "Has no special action and wins with the village.";
  override readonly id: RoleId = "villager";
  override readonly name = "Villager";
  override readonly team = Team.Village;
}

export class WerewolfRole extends Role {
  override readonly description = "Attacks at night and wins when werewolves dominate.";
  override readonly id: RoleId = WEREWOLF_ROLE_ID;
  override readonly minCount = 1;
  override readonly name = "Werewolf";
  override readonly required = true;
  override readonly team = Team.Werewolf;

  override countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.Werewolf;
  }

  override seenAs(context: InspectionContext): InspectionView {
    void context;

    return InspectionView.Werewolf;
  }

  override getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night || context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GameActionKind.Attack,
        phase: GamePhase.Night,
        required: true,
        resolveTiming: ResolveTiming.PhaseEnd,
        roleGroupPolicy: RoleGroupActionPolicy.FirstSubmitWins,
        roleGroupRoleId: this.id,
        scope: ActionScope.RoleGroup,
        submitPolicy: SubmitPolicy.FirstSubmitWins,
        target: RoleTargetKind.SinglePlayer,
      },
    ];
  }

  override getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [
      {
        kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
        template: {
          fields: [
            {
              candidates: WerewolfConsultationPlayerCandidates.AlivePlayers,
              id: "target",
              kind: WerewolfConsultationFieldKind.Player,
            },
          ],
          id: "werewolf_attack_target",
          kind: WerewolfConsultationTemplateKind.AttackTarget,
          labelKey: "werewolf.consultation.attack_target",
          normalNightOnly: true,
          source: WerewolfConsultationTemplateSource.Role,
          sourceRoleId: this.id,
        },
      },
    ];
  }

  override checkEndCondition(context: RoleContext): GameEndCandidate | null {
    const aliveWerewolves = countAliveByGroup(context, CountGroup.Werewolf);
    const aliveOthers = countAliveByGroup(context, CountGroup.NonWerewolf);

    if (aliveWerewolves === 0) {
      return {
        reason: GameEndReason.WerewolvesEliminated,
        sourceRoleId: this.id,
      };
    }

    if (aliveWerewolves >= aliveOthers) {
      return {
        reason: GameEndReason.WerewolfDominance,
        sourceRoleId: this.id,
      };
    }

    return null;
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    return context.winnerTeam === Team.Werewolf ? PlayerResult.Win : null;
  }
}

export class MadmanRole extends Role {
  override readonly description = "Counts as non-werewolf but wins with the werewolf team.";
  override readonly id: RoleId = "madman";
  override readonly maxCount = 1;
  override readonly name = "Madman";
  override readonly team = Team.Werewolf;

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    return context.winnerTeam === Team.Werewolf ? PlayerResult.Win : null;
  }
}

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

  override getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [
      {
        kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
        template: {
          fields: [
            {
              candidates: WerewolfConsultationPlayerCandidates.SenderOrWerewolfAlly,
              id: "actor",
              kind: WerewolfConsultationFieldKind.Player,
            },
            {
              candidates: WerewolfConsultationPlayerCandidates.AlivePlayers,
              id: "target",
              kind: WerewolfConsultationFieldKind.Player,
            },
            {
              candidates: [InspectionView.Human, InspectionView.Werewolf],
              id: "result",
              kind: WerewolfConsultationFieldKind.InspectionView,
            },
          ],
          id: "seer_result_report",
          kind: WerewolfConsultationTemplateKind.SeerResultReport,
          labelKey: "werewolf.consultation.seer_result_report",
          normalNightOnly: false,
          source: WerewolfConsultationTemplateSource.Role,
          sourceRoleId: this.id,
        },
      },
    ];
  }
}

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

export class FoxRole extends Role {
  override readonly description =
    "Cannot be killed by attacks and can win alone if alive at game end.";
  override readonly id: RoleId = FOX_ROLE_ID;
  override readonly maxCount = 1;
  override readonly name = "Fox";
  override readonly team = Team.Fox;

  override countAs(context: PlayerRoleContext): CountGroup {
    void context;

    return CountGroup.NonWerewolf;
  }

  override getSetupContributions(context: RoleContext): readonly RoleSetupContribution[] {
    void context;

    return [
      {
        judgement: {
          id: "fox_alive",
          priority: 10,
          sourceRoleId: this.id,
          winnerTeam: Team.Fox,
        },
        kind: RoleSetupContributionKind.WinnerJudgement,
      },
    ];
  }

  override onInspected(context: InspectionContext): readonly GameEffect[] {
    return [
      createDeathEffect({
        emitterRoleId: this.id,
        id: `death:inspection:${context.targetId}`,
        playerId: context.targetId,
        reason: DeathReason.RuleEffect,
        tags: [EffectTag.Inspection, EffectTag.Unpreventable],
      }),
    ];
  }

  override onAttacked(context: AttackContext): readonly GameEffect[] {
    void context;

    return [];
  }

  override evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    void judgement;

    return context.state.alivePlayerIds.some((playerId) => {
      return context.state.roleByPlayerId.get(playerId) === this.id;
    });
  }

  override evaluateResult(context: PlayerResultContext): PlayerResult | null {
    if (context.winnerTeam !== Team.Fox) {
      return null;
    }

    return context.state.roleByPlayerId.get(context.playerId) === this.id
      ? PlayerResult.Win
      : PlayerResult.Lose;
  }
}

export class RoleRegistry {
  readonly version = ROLE_REGISTRY_VERSION;

  readonly #rolesById: ReadonlyMap<RoleId, Role>;

  constructor(roles: readonly Role[]) {
    this.#rolesById = new Map(roles.map((role) => [role.id, role]));
  }

  get(roleId: RoleId): Role {
    const role = this.#rolesById.get(roleId);

    if (role === undefined) {
      throw new Error(`Unknown role: ${roleId}`);
    }

    return role;
  }

  getAll(): readonly Role[] {
    return ROLE_IDS.map((roleId) => this.get(roleId));
  }

  getActiveRoles(state: ReadonlyGameState): readonly Role[] {
    return state.resolvedRoleSetup.activeRoleIds.map((roleId) => this.get(roleId));
  }
}

export const roleRegistry = new RoleRegistry([
  new WerewolfRole(),
  new VillagerRole(),
  new MadmanRole(),
  new SeerRole(),
  new GuardRole(),
  new FoxRole(),
]);

export function getCoreSetupContributions(): readonly RoleSetupContribution[] {
  return [
    {
      judgement: {
        id: "core_werewolf_dominance",
        priority: 100,
        sourceRoleId: null,
        winnerTeam: Team.Werewolf,
      },
      kind: RoleSetupContributionKind.WinnerJudgement,
    },
    {
      judgement: {
        id: "core_werewolves_eliminated",
        priority: 100,
        sourceRoleId: null,
        winnerTeam: Team.Village,
      },
      kind: RoleSetupContributionKind.WinnerJudgement,
    },
    {
      kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
      template: {
        fields: [
          {
            candidates: WerewolfConsultationPlayerCandidates.AlivePlayers,
            id: "target",
            kind: WerewolfConsultationFieldKind.Player,
          },
        ],
        id: "core_execution_target",
        kind: WerewolfConsultationTemplateKind.ExecutionTarget,
        labelKey: "werewolf.consultation.execution_target",
        normalNightOnly: false,
        source: WerewolfConsultationTemplateSource.Core,
        sourceRoleId: null,
      },
    },
    {
      kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
      template: {
        fields: [
          {
            candidates: WerewolfConsultationPlayerCandidates.SenderOrWerewolfAlly,
            id: "actor",
            kind: WerewolfConsultationFieldKind.Player,
          },
          {
            candidates: WerewolfConsultationRoleCandidates.ActiveRoles,
            id: "role",
            kind: WerewolfConsultationFieldKind.Role,
          },
        ],
        id: "core_coming_out",
        kind: WerewolfConsultationTemplateKind.ComingOut,
        labelKey: "werewolf.consultation.coming_out",
        normalNightOnly: false,
        source: WerewolfConsultationTemplateSource.Core,
        sourceRoleId: null,
      },
    },
  ];
}

export function countAliveByGroup(context: RoleContext, group: CountGroup): number {
  let count = 0;

  for (const playerId of context.state.alivePlayerIds) {
    const roleId = context.state.roleByPlayerId.get(playerId);

    if (roleId === undefined) {
      continue;
    }

    const role = context.roles.get(roleId);

    if (role.countAs({ ...context, playerId }) === group) {
      count += 1;
    }
  }

  return count;
}

export function createGuardProtectionEffect(params: {
  emitterRoleId?: RoleId;
  playerId: PlayerId;
  sourceActionId: string | null;
}): GameEffect {
  return {
    emitterRoleId: params.emitterRoleId ?? GUARD_ROLE_ID,
    id: `protection:guard:${params.playerId}`,
    kind: GameEffectKind.Protection,
    layer: GameEffectLayer.Prevention,
    playerId: params.playerId,
    prevents: [EffectTag.Guardable],
    priority: 10,
    reason: "guard",
    sourceActionId: params.sourceActionId,
    tags: [],
  };
}

export function isGuardTargetAllowed(params: {
  context: RoleContext;
  guardPlayerId: PlayerId;
  targetPlayerId: PlayerId;
}): boolean {
  if (
    params.context.state.ruleOptions.guardConsecutiveTargetPolicy ===
    GuardConsecutiveTargetPolicy.Allow
  ) {
    return true;
  }

  const previousGuardEvent = [...params.context.state.events].reverse().find((event) => {
    return (
      event.kind === GameEventKind.ActionResolved &&
      event.actorPlayerId === params.guardPlayerId &&
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

  return previousTargetIds[0] !== params.targetPlayerId;
}

export function evaluateCoreWinnerJudgement(
  judgement: WinnerJudgementContribution,
  endReasons: readonly GameEndReason[],
): boolean {
  if (judgement.id === "core_werewolf_dominance") {
    return endReasons.includes(GameEndReason.WerewolfDominance);
  }

  if (judgement.id === "core_werewolves_eliminated") {
    return endReasons.includes(GameEndReason.WerewolvesEliminated);
  }

  return false;
}

export function evaluateWinnerTeam(context: WinnerJudgementContext): Team {
  const judgements = [...context.state.resolvedRoleSetup.winnerJudgements].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
  });

  for (const judgement of judgements) {
    const winnerMatched =
      judgement.sourceRoleId === null
        ? evaluateCoreWinnerJudgement(judgement, context.endReasons)
        : context.roles.get(judgement.sourceRoleId).evaluateWinnerJudgement(judgement, context);

    if (winnerMatched) {
      return judgement.winnerTeam;
    }
  }

  return Team.Neutral;
}

export function evaluatePlayerResult(context: PlayerResultContext): PlayerResult {
  const roleId = context.state.roleByPlayerId.get(context.playerId);

  if (roleId === undefined) {
    return PlayerResult.Lose;
  }

  const role = context.roles.get(roleId);
  const roleResult = role.evaluateResult(context);

  if (roleResult !== null) {
    return roleResult;
  }

  return role.team === context.winnerTeam ? PlayerResult.Win : PlayerResult.Lose;
}

export function hasInitialInspectionHumanCandidate(params: {
  roleCounts: Readonly<Record<RoleId, number>>;
  seerCount: number;
}): boolean {
  if (params.seerCount <= 0) {
    return true;
  }

  return ROLE_IDS.some((roleId) => {
    if (roleId === SEER_ROLE_ID || params.roleCounts[roleId] <= 0) {
      return false;
    }

    const role = roleRegistry.get(roleId);

    return role.seenAs(createInspectionCandidateContext(roleId)) === InspectionView.Human;
  });
}

function createDeathEffect(params: {
  emitterRoleId: RoleId;
  id: string;
  playerId: PlayerId;
  reason: DeathReason;
  tags: readonly EffectTag[];
}): GameEffect {
  return {
    emitterRoleId: params.emitterRoleId,
    id: params.id,
    kind: GameEffectKind.Death,
    layer: GameEffectLayer.Death,
    playerId: params.playerId,
    priority: 100,
    reason: params.reason,
    sourceActionId: null,
    tags: params.tags,
  };
}

function createInspectionCandidateContext(roleId: RoleId): InspectionContext {
  return {
    roles: roleRegistry,
    state: {
      alivePlayerIds: ["candidate"],
      currentActions: [],
      events: [],
      finalOutcome: null,
      nightNumber: 1,
      pendingActions: [],
      phase: GamePhase.Night,
      phaseInstanceId: "setup",
      resolvedRoleSetup: {
        activeRoleIds: [roleId],
        contributions: [],
        werewolfConsultationTemplates: [],
        winnerJudgements: [],
      },
      roleByPlayerId: new Map([["candidate", roleId]]),
      ruleOptions: {
        dayDiscussionMode: DayDiscussionMode.ReadyCheck,
        dayReadyCheckSecondsPerPlayer: 90,
        daySpeechSeconds: 90,
        executionLastWordsSeconds: 60,
        firstDaySpeechRounds: 2,
        firstNightSeconds: 30,
        guardConsecutiveTargetPolicy: GuardConsecutiveTargetPolicy.DenySameTarget,
        initialInspectionPolicy: InitialInspectionPolicy.Enabled,
        nightSeconds: 180,
        normalDaySpeechRounds: 1,
        voteResultVisibility: VoteResultVisibility.CountOnly,
        votingSeconds: 30,
      },
      status: GameStatus.Playing,
      werewolfConsultations: [],
    },
    targetId: "candidate",
    viewerId: "seer",
  };
}
