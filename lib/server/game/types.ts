import "server-only";

export const ROLE_IDS = [
  "werewolf",
  "villager",
  "madman",
  "seer",
  "guard",
  "spiritist",
  "hunter",
  "fox",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export type PlayerId = string;

export type PhaseInstanceId = string;

export enum Team {
  Village = "village",
  Werewolf = "werewolf",
  Fox = "fox",
  Neutral = "neutral",
}

export enum GameStatus {
  Waiting = "waiting",
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

export enum InitialInspectionPolicy {
  Disabled = "disabled",
  Enabled = "enabled",
}

export enum GuardConsecutiveTargetPolicy {
  Allow = "allow",
  DenySameTarget = "deny_same_target",
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

export enum GameActionKind {
  Inspect = "inspect",
  Attack = "attack",
  Guard = "guard",
  ReadyForFirstDay = "ready_for_first_day",
  ReadyForVoting = "ready_for_voting",
  EndSpeech = "end_speech",
  HunterRetaliate = "hunter_retaliate",
  Vote = "vote",
  None = "none",
}

export enum RoleTargetKind {
  None = "none",
  SinglePlayer = "single_player",
  MultiplePlayers = "multiple_players",
}

export enum ActionScope {
  Player = "player",
  RoleGroup = "role_group",
  AllAlivePlayers = "all_alive_players",
}

export enum RoleGroupActionPolicy {
  FirstSubmitWins = "first_submit_wins",
}

export enum SubmitPolicy {
  FirstSubmitWins = "first_submit_wins",
}

export enum ResolveTiming {
  Immediate = "immediate",
  PhaseEnd = "phase_end",
}

export enum GameEffectKind {
  Death = "death",
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

export enum GameEndReason {
  WerewolfDominance = "werewolf_dominance",
  WerewolvesEliminated = "werewolves_eliminated",
}

export enum DeathReason {
  Attack = "attack",
  Execution = "execution",
  Retaliation = "retaliation",
  RuleEffect = "rule_effect",
}

export enum GameEventKind {
  ActionSubmitted = "action_submitted",
  ActionResolved = "action_resolved",
  EffectApplied = "effect_applied",
  PlayerDied = "player_died",
  PhaseChanged = "phase_changed",
  VoteResolved = "vote_resolved",
  GameEnded = "game_ended",
  SpiritistResult = "spiritist_result",
}

export enum GameEventVisibility {
  Public = "public",
  Private = "private",
  Internal = "internal",
}

export enum RoleSetupContributionKind {
  WinnerJudgement = "winner_judgement",
}

export enum EffectTag {
  Attack = "attack",
  Execution = "execution",
  Guardable = "guardable",
  Inspection = "inspection",
  Retaliation = "retaliation",
  Unpreventable = "unpreventable",
}

export type RoleActionDefinition = {
  kind: GameActionKind;
  phase: GamePhase;
  required: boolean;
  resolveTiming: ResolveTiming;
  roleGroupPolicy: RoleGroupActionPolicy | null;
  roleGroupRoleId: RoleId | null;
  scope: ActionScope;
  submitPolicy: SubmitPolicy;
  target: RoleTargetKind;
};

export type CurrentAction = {
  actionKey: string;
  allowedPlayerIds: readonly PlayerId[];
  closesAt: string | null;
  id: string;
  kind: GameActionKind;
  openedAt: string;
  ownerPlayerId: PlayerId | null;
  ownerRoleId: RoleId | null;
  scope: ActionScope;
  target: RoleTargetKind;
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
  guardConsecutiveTargetPolicy: GuardConsecutiveTargetPolicy;
  initialInspectionPolicy: InitialInspectionPolicy;
  nightSeconds: number;
  normalDaySpeechRounds: number;
  voteResultVisibility: VoteResultVisibility;
  votingSeconds: number;
};

export type RoleCounts = Readonly<Record<RoleId, number>>;

export type RoleNightConversationDefinition = {
  groupId: string;
  labelKey: string;
};

export type NightConversationGroup = RoleNightConversationDefinition & {
  roleIds: readonly RoleId[];
};

export type WinnerJudgementContribution = {
  id: string;
  priority: number;
  sourceRoleId: RoleId | null;
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
  winnerJudgements: readonly WinnerJudgementContribution[];
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
  | (GameEffectBase<GameEffectKind.Death> & {
      playerId: PlayerId;
      reason: DeathReason;
    })
  | (GameEffectBase<GameEffectKind.Protection> & {
      playerId: PlayerId;
      prevents: readonly EffectTag[];
      reason: string;
    })
  | (GameEffectBase<GameEffectKind.InspectionResult> & {
      targetId: PlayerId;
      view: InspectionView;
      viewerId: PlayerId;
    })
  | (GameEffectBase<GameEffectKind.CurrentAction> & {
      actionKind: GameActionKind;
      actionKey: string;
      actorPlayerId: PlayerId | null;
      actorRoleId: RoleId | null;
      eligibleTargetPlayerIds: readonly PlayerId[];
      target: RoleTargetKind;
    })
  | (GameEffectBase<GameEffectKind.PublicMessage> & {
      messageKey: string;
    })
  | (GameEffectBase<GameEffectKind.PrivateMessage> & {
      messageKey: string;
      payload: Readonly<Record<string, unknown>>;
      playerId: PlayerId;
    });

export type GameEndCandidate = {
  reason: GameEndReason;
  sourceRoleId: RoleId;
};

export type FinalOutcome = {
  endReasons: readonly GameEndReason[];
  playerResultsByPlayerId: ReadonlyMap<PlayerId, PlayerResult>;
  winnerTeam: Team;
};

export type GameEvent = {
  actorPlayerId: PlayerId | null;
  id: string;
  kind: GameEventKind;
  payload: Readonly<Record<string, unknown>>;
  phase: GamePhase | null;
  phaseInstanceId: PhaseInstanceId | null;
  targetPlayerIds: readonly PlayerId[];
  visibility: GameEventVisibility;
  visibleToPlayerIds: readonly PlayerId[];
  visibleToRoleIds: readonly RoleId[];
};

export type ReadonlyGameState = {
  alivePlayerIds: readonly PlayerId[];
  currentActions: readonly CurrentAction[];
  events: readonly GameEvent[];
  finalOutcome: FinalOutcome | null;
  nightNumber: number;
  pendingActions: readonly PendingAction[];
  phase: GamePhase | null;
  phaseInstanceId: PhaseInstanceId | null;
  resolvedRoleSetup: ResolvedRoleSetup;
  roleByPlayerId: ReadonlyMap<PlayerId, RoleId>;
  ruleOptions: RuleOptions;
  status: GameStatus;
  nightConversationMessages: readonly NightConversationMessageState[];
};
