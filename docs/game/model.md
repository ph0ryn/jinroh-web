# TypeScript モデルスケッチ

この文書は、ゲーム設計で共有する型と class 境界の sketch を扱う。
実装完了コードではなく、責務と境界を固定するための設計メモ。

この文書の code block は非網羅の例示。
`Role` class の method がここに載っていないことは、その extension point を使わないという意味ではない。
役職ごとの source of truth は `Role` class と `RoleRegistry` であり、実装で必要になった generic
hook、resolver、effect、rule extension は `Role` 側から提供できる形で追加する。
common engine に特定 role id の分岐を足して挙動を埋め込まない。

## TypeScript Design Sketch

`Role` は class として設計する。

この code block は実装完了コードではなく、責務と境界を固定するための設計スケッチ。
実装の public surface を完全に列挙するものではない。

```ts
export type RoleId = string;
export type PlayerId = string;
export type PhaseInstanceId = string;

export enum Team {
  Village = "village",
  Werewolf = "werewolf",
  Fox = "fox",
  Neutral = "neutral",
}

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

export enum InitialInspectionPolicy {
  Disabled = "disabled",
  Enabled = "enabled",
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

export enum CurrentActionStatus {
  Open = "open",
  Completed = "completed",
}

export enum ResolveTiming {
  Immediate = "immediate",
  PhaseEnd = "phase_end",
}

export enum VoteResolutionKind {
  ExecutionCandidate = "execution_candidate",
  NoExecution = "no_execution",
}

export enum NoExecutionReason {
  Tie = "tie",
  NoVotes = "no_votes",
}

export enum GameEffectKind {
  Death = "death",
  Protection = "protection",
  InspectionResult = "inspection_result",
  PublicMessage = "public_message",
  PrivateMessage = "private_message",
}

export enum GameEffectLayer {
  Prevention = "prevention",
  Death = "death",
  Information = "information",
  Message = "message",
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
  GameEnded = "game_ended",
}

export enum GameEventVisibility {
  Public = "public",
  Private = "private",
  Internal = "internal",
}

export enum GuardConsecutiveTargetPolicy {
  Allow = "allow",
  DenySameTarget = "deny_same_target",
}

export enum VoteResultVisibility {
  CountOnly = "count_only",
  VoterToTarget = "voter_to_target",
}

export enum RoleSetupContributionKind {
  WinnerJudgement = "winner_judgement",
}

export enum EffectTag {
  Attack = "attack",
  Execution = "execution",
  Retaliation = "retaliation",
  Guardable = "guardable",
  Unpreventable = "unpreventable",
}

export type RoleActionDefinition = {
  kind: GameActionKind;
  phase: GamePhase;
  target: RoleTargetKind;
  required: boolean;
  scope: ActionScope;
  roleGroupRoleId: RoleId | null;
  roleGroupPolicy: RoleGroupActionPolicy | null;
  submitPolicy: SubmitPolicy;
  resolveTiming: ResolveTiming;
};

export type CurrentAction = {
  id: string;
  kind: GameActionKind;
  target: RoleTargetKind;
  scope: ActionScope;
  ownerPlayerId: PlayerId | null;
  ownerRoleId: RoleId | null;
  allowedPlayerIds: readonly PlayerId[];
  status: CurrentActionStatus;
  openedAt: string;
  closesAt: string | null;
};

export type PendingAction = {
  id: string;
  currentActionId: string;
  kind: GameActionKind;
  submitterPlayerId: PlayerId;
  targetPlayerIds: readonly PlayerId[];
  submittedAt: string;
};

export type VoteRecord = {
  voterPlayerId: PlayerId;
  targetPlayerId: PlayerId;
};

export type VoteResolutionBase = {
  acceptedVotes: readonly VoteRecord[];
  voteCountsByTarget: Readonly<Record<PlayerId, number>>;
};

export type VoteResolution =
  | (VoteResolutionBase & {
      kind: VoteResolutionKind.ExecutionCandidate;
      targetPlayerId: PlayerId;
      voteCount: number;
    })
  | (VoteResolutionBase & {
      kind: VoteResolutionKind.NoExecution;
      reason: NoExecutionReason;
      tiedPlayerIds: readonly PlayerId[];
      maxVoteCount: number;
    });

export type RoleNightConversationDefinition = {
  groupId: string;
  labelKey: string;
};

export type NightConversationGroup = RoleNightConversationDefinition & {
  roleIds: readonly RoleId[];
};

export type NightConversationMessageState = {
  id: string;
  nightNumber: number;
  conversationGroupId: string;
  senderPlayerId: PlayerId;
  body: string;
  createdAt: string;
};

export type WinnerJudgementContribution = {
  id: string;
  sourceRoleId: RoleId | null;
  winnerTeam: Team;
  priority: number;
};

export type RoleSetupContribution = {
  kind: RoleSetupContributionKind.WinnerJudgement;
  judgement: WinnerJudgementContribution;
};

export type ResolvedRoleSetup = {
  activeRoleIds: readonly RoleId[];
  contributions: readonly RoleSetupContribution[];
  nightConversationGroups: readonly NightConversationGroup[];
  winnerJudgements: readonly WinnerJudgementContribution[];
};

export type DaySpeechSlot = {
  playerId: PlayerId;
  round: number;
  startsAt: string;
  scheduledEndsAt: string;
  endedAt: string | null;
};

export type DayState =
  | {
      mode: DayDiscussionMode.ReadyCheck;
      readyPlayerIds: readonly PlayerId[];
    }
  | {
      mode: DayDiscussionMode.OrderedSpeech;
      speechSlots: readonly DaySpeechSlot[];
      currentSpeechSlotIndex: number;
    };

export type FirstNightState = {
  readyPlayerIds: readonly PlayerId[];
};

export type ExecutionState = {
  targetPlayerId: PlayerId;
  startsAt: string;
  scheduledEndsAt: string;
  endedAt: string | null;
};

export type GameEffectBase<K extends GameEffectKind> = {
  id: string;
  kind: K;
  layer: GameEffectLayer;
  priority: number;
  emitterRoleId: RoleId;
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
      reason: string;
      prevents: readonly EffectTag[];
    })
  | (GameEffectBase<GameEffectKind.InspectionResult> & {
      viewerId: PlayerId;
      targetId: PlayerId;
      view: InspectionView;
    })
  | (GameEffectBase<GameEffectKind.PublicMessage> & {
      messageKey: string;
    })
  | (GameEffectBase<GameEffectKind.PrivateMessage> & {
      playerId: PlayerId;
      messageKey: string;
    });

export type GameEndCandidate = {
  reason: GameEndReason;
  sourceRoleId: RoleId;
};

export type FinalOutcome = {
  endReasons: readonly GameEndReason[];
  winnerTeam: Team;
  playerResultsByPlayerId: ReadonlyMap<PlayerId, PlayerResult>;
};

export type GameEvent = {
  id: string;
  kind: GameEventKind;
  phase: GamePhase | null;
  phaseInstanceId: PhaseInstanceId | null;
  actorPlayerId: PlayerId | null;
  targetPlayerIds: readonly PlayerId[];
  visibility: GameEventVisibility;
  visibleToPlayerIds: readonly PlayerId[];
  visibleToFaction: Team | null;
  visibleToRoleIds: readonly RoleId[];
  payload: Readonly<Record<string, unknown>>;
};

export type ActionResolver = {
  kind: GameActionKind;
  validate(pendingAction: PendingAction, context: RoleContext): boolean;
  collectEffects(pendingAction: PendingAction, context: RoleContext): readonly GameEffect[];
};

export type RuleOptions = {
  dayDiscussionMode: DayDiscussionMode;
  firstNightSeconds: number;
  daySpeechSeconds: number;
  dayReadyCheckSecondsPerPlayer: number;
  firstDaySpeechRounds: number;
  normalDaySpeechRounds: number;
  initialInspectionPolicy: InitialInspectionPolicy;
  guardConsecutiveTargetPolicy: GuardConsecutiveTargetPolicy;
  nightSeconds: number;
  votingSeconds: number;
  executionLastWordsSeconds: number;
  voteResultVisibility: VoteResultVisibility;
};

export type ReadonlyGameState = {
  status: GameStatus;
  phase: GamePhase | null;
  phaseInstanceId: PhaseInstanceId | null;
  dayNumber: number;
  nightNumber: number;
  phaseStartedAt: string | null;
  phaseEndsAt: string | null;
  firstNightState: FirstNightState | null;
  dayState: DayState | null;
  executionState: ExecutionState | null;
  resolvedRoleSetup: ResolvedRoleSetup;
  nightConversationMessages: readonly NightConversationMessageState[];
  alivePlayerIds: readonly PlayerId[];
  roleByPlayerId: ReadonlyMap<PlayerId, RoleId>;
  currentActions: readonly CurrentAction[];
  pendingActions: readonly PendingAction[];
  events: readonly GameEvent[];
  finalOutcome: FinalOutcome | null;
  ruleOptions: RuleOptions;
};

export type RoleContext = {
  state: ReadonlyGameState;
  roles: RoleRegistry;
};

export type PlayerRoleContext = RoleContext & {
  playerId: PlayerId;
};

export type InspectionContext = RoleContext & {
  viewerId: PlayerId;
  targetId: PlayerId;
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

export type RoleRegistry = {
  get(roleId: RoleId): Role;
  getActiveRoles(state: ReadonlyGameState): readonly Role[];
};

export abstract class Role {
  abstract readonly id: RoleId;
  abstract readonly name: string;
  abstract readonly team: Team;
  abstract readonly description: string;

  readonly required = false;
  readonly minCount = 0;
  readonly maxCount: number | null = null;
  readonly incompatibleRoleIds: readonly RoleId[] = [];

  countAs(_context: PlayerRoleContext): CountGroup {
    return CountGroup.NonWerewolf;
  }

  seenAs(_context: InspectionContext): InspectionView {
    return InspectionView.Human;
  }

  getActions(_context: PlayerRoleContext): readonly RoleActionDefinition[] {
    return [];
  }

  getSetupContributions(_context: RoleContext): readonly RoleSetupContribution[] {
    return [];
  }

  onInspected(_context: InspectionContext): readonly GameEffect[] {
    return [];
  }

  onAttacked(context: AttackContext): readonly GameEffect[] {
    return [
      {
        id: "effect_death_attacked",
        kind: GameEffectKind.Death,
        layer: GameEffectLayer.Death,
        priority: 100,
        emitterRoleId: this.id,
        sourceActionId: null,
        tags: [EffectTag.Attack, EffectTag.Guardable],
        playerId: context.targetId,
        reason: DeathReason.Attack,
      },
    ];
  }

  onExecuted(context: ExecutionContext): readonly GameEffect[] {
    return [
      {
        id: "effect_death_executed",
        kind: GameEffectKind.Death,
        layer: GameEffectLayer.Death,
        priority: 100,
        emitterRoleId: this.id,
        sourceActionId: null,
        tags: [EffectTag.Execution, EffectTag.Unpreventable],
        playerId: context.targetId,
        reason: DeathReason.Execution,
      },
    ];
  }

  onMissingAction(_currentAction: CurrentAction, _context: RoleContext): readonly GameEffect[] {
    return [];
  }

  checkEndCondition(_context: RoleContext): GameEndCandidate | null {
    return null;
  }

  evaluateWinnerJudgement(
    _judgement: WinnerJudgementContribution,
    _context: WinnerJudgementContext,
  ): boolean {
    return false;
  }

  evaluateResult(_context: PlayerResultContext): PlayerResult | null {
    return null;
  }
}
```
