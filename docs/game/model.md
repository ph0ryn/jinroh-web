# TypeScript モデルスケッチ

この文書は、ゲーム設計で共有する型と class 境界を扱う。
型の完全な定義は [`lib/server/game/types.ts`](../../lib/server/game/types.ts)、
役職の extension point は
[`lib/server/game/roles/base.ts`](../../lib/server/game/roles/base.ts) を source of truth とする。
ここに載せる code block は、責務と所有関係を説明するための非網羅な抜粋であり、
実装の public surface を複製する API reference ではない。

役職ごとの behavior は `Role` class と `RoleRegistry` が所有する。
generic hook、resolver、effect、rule extension は `Role` から提供できる形で追加し、
common engine に特定 role id の分岐を埋め込まない。

Game Engine が受け取る Player 一覧は、ゲーム開始時に Role assignment と alive
state を固定した game roster。Room membership history とは別物であり、開始後に
membership row から game player を追加、補完しない。

## Team の所有関係

Team は closed enum ではなく、Role が提供して `RoleRegistry` に登録する opaque
な文字列 ID。Role は ID と localized presentation をまとめた definition を持つ。

```ts
export type Team = string;

export type RoleTeamDefinition = {
  id: Team;
  presentation: LocalizedText;
};
```

Registry は Team ID の重複自体を共有として許可するが、同じ ID の presentation が
一致することを検証する。winner judgement は登録済み Team ID だけを参照し、view
adapter は registry 由来の team catalog を使う。shared type、SQL、localization は
Team ID の allowlist にならない。

## Action の所有関係

`RoleActionDefinition` は、各 `Role` が通常の phase action を宣言するための template。
Engine はこの定義と game state から、現在受け付ける `CurrentAction` を具体化する。

`CurrentAction` は受付単位の runtime state。

- `id` は runtime record の識別子
- `actionKey` は phase 内で action の意味を安定して識別する key
- `ownerPlayerId` は player 固有 action の owner
- `ownerRoleId` は role group action の owner
- `resolverRoleId` は action の意味を解決する Role。core action では `null`
- `allowedPlayerIds` はその action を閲覧・提出できる Player の集合
- `target` は提出時に必要な target の形

`CurrentAction` 自体に `status` は持たせない。
提出済みかどうかは、同じ `currentActionId` を参照する `PendingAction` の有無で表す。
この分離により、受付対象と first-submit-wins の提出結果を別の state として扱える。

```ts
export type ActionKind = string;

export enum RoleTargetKind {
  None = "none",
  SinglePlayer = "single_player",
}

export enum ActionScope {
  Player = "player",
  RoleGroup = "role_group",
  AllAlivePlayers = "all_alive_players",
}

export enum ActionTargetStateRequirement {
  Alive = "alive",
  Assigned = "assigned",
}

export type RoleActionDefinition = {
  kind: ActionKind;
  roleGroupRoleId: RoleId | null;
  target: RoleTargetKind;
  targetStateRequirement: ActionTargetStateRequirement;
};

export type CurrentAction = {
  actionKey: string;
  actorStateRequirement: ActionActorStateRequirement;
  allowedPlayerIds: readonly PlayerId[];
  closesAt: string | null;
  eligibleTargetPlayerIds: readonly PlayerId[];
  id: string;
  kind: ActionKind;
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
  kind: ActionKind;
  submittedAt: string;
  submitterPlayerId: PlayerId;
  targetPlayerIds: readonly PlayerId[];
};
```

Role 由来の `ActionKind` は、その Role module が所有する opaque な識別子。
common enum、shared allowlist、adapter の `switch` には列挙しない。
Database と API は識別子の文字列 shape だけを検証し、値を変換せずに保持する。
core phase action の識別子は core rule 内で閉じてもよいが、それを Role action の
completeness gate として使わない。

`resolverRoleId` は action の意味を持つ Role を示し、提出できる相手を表す
`ownerPlayerId` / `ownerRoleId` とは独立する。Role action は `resolverRoleId` の
`onActionResolved` / `onMissingAction` へ dispatch し、core action は `null` として
core resolver へ渡す。これにより、同じ effect を持つ別 Role が独自の action kind を定義しても、
common engine、persistence、view adapter の変更を必要としない。

Role action の fallback label と submit label も Role module が所有する。
View adapter は `resolverRoleId` と opaque action kind から `RoleRegistry` の presentation を解決し、
API に渡す。Role metadata、option、message、night conversation の localized fallback も
Role module が持ち、shared localization を role identifier の completeness gate にしない。

`getActions()` を呼ぶ phase は Role 自身が判断する。現在の role action はすべて
phase-end 解決かつ first-submit-wins であり、変更できない policy を定義 field として重複させない。
`roleGroupRoleId` がある action は Role group 所有、ない action は各 Player 所有として具体化する。
Role hook 向け `CurrentAction` view も `actorStateRequirement`、
`eligibleTargetPlayerIds`、`targetStateRequirement` を保持する。未提出時の hook を含め、
Role は common engine の識別子別分岐に頼らず、具体化済み action の完全な policy を参照できる。

## Effect から開く Action

通常の phase action は `Role.getActions()` から作る。
一方、処刑や死亡などの解決結果に反応して追加 action を開く場合、Role hook は
`GameEffectKind.CurrentAction` を返す。
たとえば、処刑 effect の解決後に対象選択を要求する Role は、この経路で追加 action を開く。

`GameEffectKind.CurrentAction` は永続化済みの `CurrentAction` そのものではなく、
Engine に action の作成を要求する候補。
Engine が effect resolution を通したあと、`actorPlayerId` / `actorRoleId` を runtime action の
owner に変換する。
`emitterRoleId` は effect を発行した Role、`resolverRoleId` は action を解決する Role、
`actorPlayerId` / `actorRoleId` は提出権限を表す。これらを暗黙に同一視しない。

effect resolution 後に有効な `CurrentAction` が具体化された場合、Engine は同じ
user-visible phase の follow-up window を開く。follow-up は game end と core phase
transition より先に submitted / missing まで解決する blocking action である。

`ActionActorStateRequirement` は actor の有効性を指定する。

- `Alive`: Role が割り当てられ、かつ生存中の actor だけが action を持てる
- `Assigned`: Role の割り当てが残っていれば、死亡後でも action を持てる

`Assigned` は、処刑後や死亡後にも提出を許可する Role action の明示的な policy に使う。
これは actor の状態要件であり、`eligibleTargetPlayerIds` が表す target eligibility とは独立する。

`ActionTargetStateRequirement` は target の状態要件を指定する。

- `Alive`: materialization 時に生存する target だけを残し、提出時にも生存を再確認する
- `Assigned`: fixed game roster に assignment があれば、死亡後も target にできる

この値は Role action definition または `CurrentAction` effect から、materialized
Engine action と `current_actions.target_state_requirement` へ引き継ぐ。これは現在の
action window の受付 policy であり、解決結果を表す semantic history には保存しない。

```ts
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

export type DeathReason = string;

export type EffectTag = string;

export enum ActionActorStateRequirement {
  Alive = "alive",
  Assigned = "assigned",
}

export type GameEffectBase<K extends GameEffectKind> = {
  emitterRoleId: RoleId;
  id: string;
  kind: K;
  layer: GameEffectLayer;
  priority: number;
  sourceActionId: string | null;
  tags: readonly EffectTag[];
};

export type GameEventPresentation = {
  title: LocalizedText;
  message: LocalizedText;
  details: readonly GameEventPresentationDetail[];
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
      presentation: GameEventPresentation;
      targetId: PlayerId;
      view: InspectionView;
      viewerId: PlayerId;
    })
  | (GameEffectBase<GameEffectKind.CurrentAction> & {
      actionKind: ActionKind;
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
```

## History と Game State

`GameEvent` の visibility は public、private、internal の3種類。
private event の宛先は Player または Role で明示し、Team 単位の宛先 field は持たない。
Role group の private information は `visibleToRoleIds` を使う。

永続層と phase Engine が参照する action history は arbitrary event payload ではなく、
normalized な `resolved_actions` / `ResolvedActionHistoryEntry` として扱う。core と
Role 由来のすべての current action が、提出の有無にかかわらず1件ずつ記録される。
core action は nullable な `resolverRoleId` を `null` として保持する。
各 entry は owning phase instance の `dayNumber` / `nightNumber` も持ち、snapshot
boundary が phase/counter consistency と chronological order を検証してから Engine に渡す。

Role hook の `ReadonlyGameState.resolvedActions` は、この完全な履歴から non-null
resolver を持つ role-owned row だけを射影した `ResolvedRoleAction`。Role は自分が
所有する opaque action の semantic history を参照し、core action を解釈しない。
`currentActions` と対応する `pendingActions` は、明示された core action とその Role が
所有する action だけを hook context に射影し、別 Role の opaque action state は渡さない。

phase の時刻、day speech slot、execution timer などの persistence detail は、
この domain state に重複して持たせない。
`ReadonlyGameState` は Role と rule evaluation に必要な semantic state に限定する。

```ts
export type ResolvedRoleAction = {
  actionKey: string;
  actorPlayerId: PlayerId | null;
  actorRoleId: RoleId | null;
  dayNumber: number;
  id: string;
  kind: ActionKind;
  nightNumber: number;
  phase: GamePhase;
  phaseInstanceId: PhaseInstanceId;
  resolutionStatus: "missing" | "submitted";
  resolverRoleId: RoleId;
  targetPlayerIds: readonly PlayerId[];
};

export type ResolvedRoleSetup = {
  activeRoleIds: readonly RoleId[];
  contributions: readonly RoleSetupContribution[];
  nightConversationGroups: readonly NightConversationGroup[];
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
```

`resolvedRoleSetup.contributions` は setup contribution の単一の保存先。winner
judgement を別 field に複製しない。`activeRoleIds` は contribution と runtime hook
の有効範囲を固定し、`nightConversationGroups` は Role の静的 opt-in を解決した
group を固定する。

winner judgement の identity は `(sourceRoleId, id)`。`id` は Role-local であり、
異なる Role が同じ値を使える。Team ID と同様に、common code が judgement ID の
global enum や allowlist を持たない。

`DeathReason` と `EffectTag` も open identifier。core は generic な再利用可能値を
定義できるが、Role 固有の値は owning Role module に閉じる。shared sketch は Role
固有 reason や tag を列挙せず、永続層は文字列 shape だけを検証する。

## Role と Engine の境界

`Role` は metadata、target resolver、setup contribution、effect hook、終了条件、勝敗評価を所有する。
現在の代表的な extension point は次のとおり。

- `getActions` と `getEligibleTargets`
- `getSetupContributions` と `validateRuleSet`
- `onInspected`、informational-only な `onFirstNightStarted`、`onAttacked`、`onExecuted`
- `onExecutionResolved`、`onDeathResolved`、`onActionResolved`
- `onMissingAction`
- `checkEndCondition`、`evaluateWinnerJudgement`、`evaluateResult`

Role hook は状態を直接変更せず、`GameEffect` または end candidate を返す。
end candidate の reason は owning Role だけが解釈する opaque な識別子とし、
`sourceRoleId` に必ずその Role 自身を指定する。winner judgement の id と評価も
contribution を出した Role が所有し、Engine は別 Role の candidate を混ぜずに dispatch する。
Engine は generic な phase progression、effect ordering、conflict resolution、action materialization を
担当する。新しい Role の追加は、原則として Role class の追加と `RoleRegistry` への登録だけで完結させる。
