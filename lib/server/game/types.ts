import "server-only";
import type {
  ActionPresentation,
  LocalizedText,
  RoleOptionValues,
  RolePresentation,
} from "@/lib/shared/game";

export type RoleId = string;

export type PlayerId = string;

export type PhaseInstanceId = string;

export type Team = string;

export type RoleTeamDefinition = {
  id: Team;
  presentation: LocalizedText;
};

export enum GameStatus {
  AssigningRoles = "assigning_roles",
  Playing = "playing",
  Ended = "ended",
}

export enum GamePhase {
  Night = "night",
  Day = "day",
  Voting = "voting",
  Execution = "execution",
}

export enum DayDiscussionMode {
  ReadyCheck = "ready_check",
  OrderedSpeech = "ordered_speech",
}

export enum VoteResultVisibility {
  CountOnly = "count_only",
  VoterToTarget = "voter_to_target",
}

export enum CountGroup {
  Werewolf = "werewolf",
  NonWerewolf = "non_werewolf",
  Excluded = "excluded",
}

export enum InspectionView {
  Human = "human",
  Werewolf = "werewolf",
  Unknown = "unknown",
}

export enum PlayerResult {
  Win = "win",
  Lose = "lose",
  Draw = "draw",
  Special = "special",
}

export type GameActionKind = string;

export enum RoleTargetKind {
  None = "none",
  SinglePlayer = "single_player",
}

export enum ActionScope {
  Player = "player",
  RoleGroup = "role_group",
  AllAlivePlayers = "all_alive_players",
}

export enum GameEffectKind {
  Attack = "attack",
  Death = "death",
  Inspection = "inspection",
  Protection = "protection",
  InspectionResult = "inspection_result",
  CurrentAction = "current_action",
  PublicMessage = "public_message",
  PrivateMessage = "private_message",
}

export enum GameEffectLayer {
  Prevention = "prevention",
  Death = "death",
  Information = "information",
  Message = "message",
  Action = "action",
}

export type GameEndReason = string;

export type DeathReason = string;

export const DEATH_REASON = {
  Attack: "attack",
  Execution: "execution",
  RuleEffect: "rule_effect",
} as const;

export enum RoleSetupContributionKind {
  WinnerJudgement = "winner_judgement",
}

export type EffectTag = string;

export const EFFECT_TAG = {
  Attack: "attack",
  Execution: "execution",
  Guardable: "guardable",
  Inspection: "inspection",
  Unpreventable: "unpreventable",
} as const;

export enum ActionActorStateRequirement {
  Alive = "alive",
  Assigned = "assigned",
}

export enum ActionTargetStateRequirement {
  Alive = "alive",
  Assigned = "assigned",
}

export type RoleActionDefinition = {
  kind: GameActionKind;
  roleGroupRoleId: RoleId | null;
  target: RoleTargetKind;
  targetStateRequirement: ActionTargetStateRequirement;
};

export type RolePublicMetadata = {
  id: RoleId;
  maxCount: number | null;
  minCount: number;
  order: number;
  presentation: RolePresentation;
  specificOptions: readonly RoleSpecificOptionDefinition[];
};

export type RoleActionPresentation = ActionPresentation;

export type RoleDefaultCountContext = {
  assignedRoleCount: number;
  playerCount: number;
};

export type RoleSpecificOptionDefinition = {
  choices: readonly RoleSpecificOptionChoice[];
  defaultValue: string;
  key: string;
  label: LocalizedText;
};

export type RoleSpecificOptionChoice = {
  label: LocalizedText;
  value: string;
};

export type CurrentAction = {
  actionKey: string;
  actorStateRequirement: ActionActorStateRequirement;
  allowedPlayerIds: readonly PlayerId[];
  closesAt: string | null;
  eligibleTargetPlayerIds: readonly PlayerId[];
  id: string;
  kind: GameActionKind;
  openedAt: string;
  ownerPlayerId: PlayerId | null;
  ownerRoleId: RoleId | null;
  resolverRoleId: RoleId | null;
  scope: ActionScope;
  target: RoleTargetKind;
  targetStateRequirement: ActionTargetStateRequirement;
};

export type PendingAction = {
  currentActionId: string;
  id: string;
  kind: GameActionKind;
  submittedAt: string;
  submitterPlayerId: PlayerId;
  targetPlayerIds: readonly PlayerId[];
};

export type RuleOptions = {
  dayDiscussionMode: DayDiscussionMode;
  dayReadyCheckSecondsPerPlayer: number;
  daySpeechSeconds: number;
  executionLastWordsSeconds: number;
  firstDaySpeechRounds: number;
  firstNightSeconds: number;
  nightSeconds: number;
  normalDaySpeechRounds: number;
  roleOptions: RoleOptionValues;
  voteResultVisibility: VoteResultVisibility;
  votingSeconds: number;
};

export type RoleCounts = Readonly<Record<RoleId, number>>;

export type RoleNightConversationDefinition = {
  groupId: string;
  label: LocalizedText;
};

export type NightConversationGroup = RoleNightConversationDefinition & {
  roleIds: readonly RoleId[];
};

export type WinnerJudgementContribution = {
  id: string;
  priority: number;
  sourceRoleId: RoleId;
  winnerTeam: Team;
};

export type RoleSetupContribution = {
  judgement: WinnerJudgementContribution;
  kind: RoleSetupContributionKind.WinnerJudgement;
};

export type ResolvedRoleSetup = {
  activeRoleIds: readonly RoleId[];
  contributions: readonly RoleSetupContribution[];
  nightConversationGroups: readonly NightConversationGroup[];
};

export type NightConversationMessageState = {
  body: string;
  conversationGroupId: string;
  createdAt: string;
  id: string;
  nightNumber: number;
  senderPlayerId: PlayerId;
};

export type GameEffectBase<K extends GameEffectKind> = {
  emitterRoleId: RoleId;
  id: string;
  kind: K;
  layer: GameEffectLayer;
  priority: number;
  sourceActionId: string | null;
  tags: readonly EffectTag[];
};

export type GameEffect =
  | (GameEffectBase<GameEffectKind.Attack> & {
      attackerIds: readonly PlayerId[];
      targetId: PlayerId;
    })
  | (GameEffectBase<GameEffectKind.Death> & {
      playerId: PlayerId;
      reason: DeathReason;
    })
  | (GameEffectBase<GameEffectKind.Inspection> & {
      targetId: PlayerId;
      viewerId: PlayerId;
    })
  | (GameEffectBase<GameEffectKind.Protection> & {
      playerId: PlayerId;
      prevents: readonly EffectTag[];
      reason: string;
    })
  | (GameEffectBase<GameEffectKind.InspectionResult> & {
      presentation: GameEventPresentation;
      targetId: PlayerId;
      view: InspectionView;
      viewerId: PlayerId;
    })
  | (GameEffectBase<GameEffectKind.CurrentAction> & {
      actionKind: GameActionKind;
      actionKey: string;
      actorPlayerId: PlayerId | null;
      actorRoleId: RoleId | null;
      actorStateRequirement: ActionActorStateRequirement;
      eligibleTargetPlayerIds: readonly PlayerId[];
      resolverRoleId: RoleId;
      target: RoleTargetKind;
      targetStateRequirement: ActionTargetStateRequirement;
    })
  | (GameEffectBase<GameEffectKind.PublicMessage> & {
      eventKind: string;
      presentation: GameEventPresentation;
    })
  | (GameEffectBase<GameEffectKind.PrivateMessage> & {
      eventKind: string;
      playerId: PlayerId;
      presentation: GameEventPresentation;
    });

export type FirstNightStartedEffect = Extract<
  GameEffect,
  {
    kind:
      | GameEffectKind.InspectionResult
      | GameEffectKind.PrivateMessage
      | GameEffectKind.PublicMessage;
  }
>;

export type GameEventPresentation = {
  details: readonly GameEventPresentationDetail[];
  message: LocalizedText;
  title: LocalizedText;
};

export type GameEventPresentationDetail = {
  label: LocalizedText;
  value: GameEventPresentationValue;
};

export type GameEventPresentationValue =
  | {
      kind: "localized_text";
      text: LocalizedText;
    }
  | {
      kind: "player";
      playerId: PlayerId;
    };

export type GameEndCandidate = {
  reason: GameEndReason;
  sourceRoleId: RoleId;
};

export type ResolvedDeath = {
  playerId: PlayerId;
  reason: DeathReason;
  roleId: RoleId;
  sourceActionId: string | null;
};

export type FinalOutcome = {
  endCandidates: readonly GameEndCandidate[];
  playerResultsByPlayerId: ReadonlyMap<PlayerId, PlayerResult>;
  winnerTeam: Team;
};

export type ResolvedRoleAction = {
  actionKey: string;
  actorPlayerId: PlayerId | null;
  actorRoleId: RoleId | null;
  dayNumber: number;
  id: string;
  kind: GameActionKind;
  nightNumber: number;
  phase: GamePhase;
  phaseInstanceId: PhaseInstanceId;
  resolutionStatus: "missing" | "submitted";
  resolverRoleId: RoleId;
  targetPlayerIds: readonly PlayerId[];
};

export type ReadonlyGameState = {
  alivePlayerIds: readonly PlayerId[];
  currentActions: readonly CurrentAction[];
  finalOutcome: FinalOutcome | null;
  nightNumber: number;
  pendingActions: readonly PendingAction[];
  phase: GamePhase | null;
  phaseInstanceId: PhaseInstanceId | null;
  resolvedActions: readonly ResolvedRoleAction[];
  resolvedRoleSetup: ResolvedRoleSetup;
  roleByPlayerId: ReadonlyMap<PlayerId, RoleId>;
  ruleOptions: RuleOptions;
  status: GameStatus;
  nightConversationMessages: readonly NightConversationMessageState[];
};
