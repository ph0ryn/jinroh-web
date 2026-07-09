# Role 設計

## Role Model

`Role` は役職ごとに1つの定義として扱う。

たとえば、人狼が3人いる場合でも、`WerewolfRole` の定義は1つでよい。
各 Player がどの役職を持っているかは game state 側に保存する。

### Source Of Truth

役職ごとのゲームロジックの source of truth は `Role` class と `RoleRegistry`。

新しい役職を追加するときの基本単位は以下。

- 新しい `Role` class を追加する
- `RoleRegistry` に登録する
- 必要なら、その役職だけでなく将来の役職にも使える generic hook、resolver、effect、rule
  extension を追加する

common engine に特定の role id を直接分岐として追加しない。
例外は、人狼の襲撃、処刑、投票、死亡、占い結果など、ゲーム全体の core primitive として明示的に
扱うものだけにする。

`lib/shared/game.ts` などの shared module は browser と API の contract を持つ場所であり、
役職の挙動、表示 metadata、並び順、default count、min/max、勝利条件、占い結果、死亡反応の
source of truth にはしない。
UI は server が `RoleRegistry` から作る role catalog と rule data を使う。

### Role が持つ情報

`Role` は、静的な情報と動的な判定ロジックを持つ。

静的な情報。

- role id
- 表示名
- 説明
- 表示順
- 短い表示 label
- 基本陣営
- 最小人数
- 最大人数
- 必須役職かどうか
- 同居不可の役職

動的な判定ロジック。

- default role count へどう寄与するか
- role-specific option をどう公開するか
- role-specific option と role count の組み合わせをどう検証するか
- 終了判定上、どう数えるか
- 占いではどう見えるか
- 占われたときに何が起きるか
- 襲撃されたときに何が起きるか
- 処刑されたときに何が起きるか
- 死亡が解決されたあとに何が起きるか
- どの phase でどの action が可能か
- action の対象候補をどう決めるか
- first night 開始時に自動で何が起きるか
- 夜会話 group に参加するか
- 勝者判定にどの priority の judgement を追加するか
- 人狼 Role としてゲーム終了条件を満たすか
- ゲーム終了後に Player の結果をどう判定するか

### Property と Method の使い分け

固定的で UI やルール確認に使うものは property にする。

例。

- 表示名
- 説明
- 基本陣営
- 最小人数
- 最大人数
- 同居不可役職

基本陣営 `team` は、勝者判定で使う Team と同じ概念。
妖狐は `Team.Fox` を持つが、v1 では複数人チームではなく1人独自陣営として扱う。
この人数制約は FoxRole の `maxCount = 1` として Role 側に持たせる。
RuleSet は妖狐専用の制約を持たず、通常の Role count validation として検証する。

状態や相手によって変わるものは method にする。

例。

- 占いでどう見えるか
- 襲撃されたときに死ぬか
- 守られているときにどうなるか
- 特定条件下で陣営扱いが変わるか
- 終了条件を満たすか
- 終了後に勝ちか負けか

「占いで人間か」を単純な boolean にしない。
後から、占い結果を偽装する役職、占われると追加効果が起きる役職、占う側の能力で結果が変わる役職が出るため。

TypeScript の全体 sketch は `model.md` に置く。
この文書では、Role の責務、hook、setup contribution、代表例を扱う。
`model.md` の code block は非網羅の sketch であり、実装 interface の完全な写しではない。

この設計で重要なのは、`Role` の method が state を変更しないこと。

`Role` は以下だけを返す。

- 見え方
- catalog metadata
- role-specific option metadata
- 実行可能 action
- action target 候補
- setup contribution
- effect 候補
- 終了候補
- 勝者 Team 候補
- Player の結果候補

実際に state を変更するのは Game Engine。

通常の役職は、襲撃や処刑に対する処理を書かなくてよい。

`Role` の default hook は、人狼の基本ルールで自然な挙動を持つ。

- 占われても追加効果なし
- 襲撃されたら death effect を返す
- 処刑されたら death effect を返す
- action は持たない
- post-resolution hook は何もしない
- 未提出 action は追加効果なし
- setup contribution は追加しない
- winner judgement は追加しない
- 終了条件は追加しない
- PlayerResult は自分では決めない

特殊役職だけが必要な method を override する。

例。

- 襲撃で死なない役職は `onAttacked` を override する
- 占われたら追加効果が起きる役職は `onInspected` を override する
- 夜 action を持つ役職は `getActions` を override する
- action 対象候補が通常と違う役職は `getEligibleTargets` を override する
- first night に自動通知や自動効果を持つ役職は `onFirstNightStarted` を override する
- 死亡解決後に反応する役職は `onDeathResolved` を override する
- 未提出 action に独自挙動がある役職は `onMissingAction` を override する
- ゲーム開始時の固定影響を追加する役職は `getSetupContributions` を override する
- 独自の勝者判定を持つ役職は winner judgement contribution と `evaluateWinnerJudgement` を追加する
- 独自の結果判定を持つ役職は `evaluateResult` を override する

現時点では、終了条件は人狼を中心にした基本ルールだけを扱う。
追加役職が独自の終了条件を持つケースは想定しない。
必要な役職が出てきたら、その時点で設計を見直す。

### Role Extension Surface

`Role` の extension surface は、役職固有の判断を common engine から切り離すためにある。
以下は代表的な分類であり、実装の method 名一覧を固定する目的ではない。

- Catalog と設定:
  `name`、`description`、`order`、`shortLabel`、`minCount`、`maxCount`、
  `getDefaultCount`、`getSpecificOptions`、`getPublicMetadata`
- Rule validation:
  `validateRuleSet`、role-specific validation issue code
- 表示と意味:
  `team`、`countAs`、`seenAs`、`nightConversation`
- Action:
  `getActions`、`getEligibleTargets`、role group action、submit policy、resolve timing
- Setup:
  `getSetupContributions`、resolved role setup、winner judgement contribution
- Runtime hook:
  `onFirstNightStarted`、`onInspected`、`onAttacked`、`onExecuted`、
  `onExecutionResolved`、`onDeathResolved`、`onActionResolved`、`onMissingAction`
- 終了と結果:
  `checkEndCondition`、`evaluateWinnerJudgement`、`evaluateResult`

新しい役職に既存の extension surface では表せない挙動が必要な場合は、
common engine に role id 分岐を足すのではなく、generic な hook、resolver、effect、rule
extension を設計して `Role` から提供する。

### Example Role Sketch

人狼と狂人の違いは、同じ陣営に見えても複数の観点で分かれる。

```ts
export class WerewolfRole extends Role {
  readonly id = "werewolf";
  readonly name = "人狼";
  readonly team = Team.Werewolf;
  readonly description = "夜に襲撃し、人狼数が非人狼数以上になると勝利する。";
  readonly required = true;
  readonly minCount = 1;
  override readonly nightConversation = {
    groupId: "werewolf",
    labelKey: "nightConversation.werewolf",
  };

  countAs(_context: PlayerRoleContext): CountGroup {
    return CountGroup.Werewolf;
  }

  seenAs(_context: InspectionContext): InspectionView {
    return InspectionView.Werewolf;
  }

  getActions(context: PlayerRoleContext): readonly RoleActionDefinition[] {
    if (context.state.phase !== GamePhase.Night) {
      return [];
    }

    if (context.state.nightNumber === 1) {
      return [];
    }

    return [
      {
        kind: GameActionKind.Attack,
        phase: GamePhase.Night,
        target: RoleTargetKind.SinglePlayer,
        required: true,
        scope: ActionScope.RoleGroup,
        roleGroupRoleId: this.id,
        roleGroupPolicy: RoleGroupActionPolicy.FirstSubmitWins,
        submitPolicy: SubmitPolicy.FirstSubmitWins,
        resolveTiming: ResolveTiming.PhaseEnd,
      },
    ];
  }

  checkEndCondition(context: RoleContext): GameEndCandidate | null {
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

  evaluateResult(context: PlayerResultContext): PlayerResult | null {
    if (context.winnerTeam === Team.Werewolf) {
      return PlayerResult.Win;
    }

    return null;
  }
}

export class MadmanRole extends Role {
  readonly id = "madman";
  readonly name = "狂人";
  readonly team = Team.Werewolf;
  readonly description = "人間として数えられるが、人狼側が勝つと勝利する。";

  countAs(_context: PlayerRoleContext): CountGroup {
    return CountGroup.NonWerewolf;
  }

  seenAs(_context: InspectionContext): InspectionView {
    return InspectionView.Human;
  }

  evaluateResult(context: PlayerResultContext): PlayerResult | null {
    if (context.winnerTeam === Team.Werewolf) {
      return PlayerResult.Win;
    }

    return null;
  }
}

declare function countAliveByGroup(context: RoleContext, group: CountGroup): number;
```

この例では、`WerewolfRole` と `MadmanRole` は同じ人狼側でも役割が違う。

- 人狼は終了判定上 `werewolf` として数えられる
- 狂人は終了判定上 `non_werewolf` として数えられる
- 狂人は占いで `human` として見える
- 狂人は PlayerResult では人狼側勝利に乗る

そのため、`team`、`countAs`、`seenAs`、`evaluateResult` は別々に持つ。
同じように、`team` と action 提出権限も別に扱う。
狂人は `Team.Werewolf` でも、`MadmanRole.getActions` が襲撃 action を返さないため、
人狼の襲撃 action は提出できない。

## Role Hook

`Role` は、ゲーム中の出来事に hook で反応できる。

代表的な hook と責務。

- `onFirstNightStarted`:
  first night 開始時の自動効果を返す。対象選択 action ではない。
- `onInspected`:
  占われた target role が追加効果を返す。
- `onAttacked`:
  襲撃された target role が死亡、無効化、反撃などの候補を返す。
- `onExecuted`:
  処刑対象 role が処刑反応を返す。default は execution death effect。
- `onExecutionResolved`:
  処刑が解決されたあと、処刑という出来事に限定して反応する。
- `onDeathResolved`:
  death reason を問わず、死亡が確定したあとに反応する。
- `onActionResolved`:
  role action が解決されたあとに反応する。
- `onMissingAction`:
  role 由来 action が未提出で締め切られたときに反応する。

Hook は game state を直接変更しない。
Hook は「こういう effect を発生させたい」という結果を返す。

基本 hook は冗長さを避けるため、普通の人狼ルールに近い default を持つ。
特殊な反応がある役職だけが override する。

```text
襲撃された
  default Role
    death effect を返す

  襲撃で死なない Role
    death effect を返さない

  反撃する Role
    attacker death effect を返す
```

実際に誰が死ぬか、複数 effect が衝突したときどう処理するかは Game Engine が決める。

`DeathReason` は hook の分離に使う。
たとえば、処刑で死んだか、襲撃で死んだか、反撃で死んだかは `onDeathResolved` の
context から判断する。
「死亡後に反応するが、死亡理由によって挙動が変わる」役職は、死亡理由ごとの core 分岐ではなく、
`onDeathResolved` に集約する。

## Role Setup Contribution

`Role` がゲーム全体へ与える影響には、開始時に解決できるものと、
ゲーム中に state を見ないと決められないものがある。

開始時に解決できるものは `setup contribution` として扱う。
Engine は、`RuleSet` が固定されて Role assignment が終わった時点で、
採用中 Role definition から setup contribution を集める。

```text
game start
  RuleSet を検証する
  Player に Role を割り当てる
  採用中 Role を registry から集める
  core setup contribution を追加する
  Role.getSetupContributions を呼ぶ
  contribution を resolved role setup にまとめる
  まとめた結果を GameState に固定する
```

setup contribution は、そのゲーム中に変わらない。
途中で Role 構成や contribution を追加、削除、再計算しない。

現時点で具体的に扱う setup contribution は winner judgement。
将来、開始時に固定できる Role 由来の影響が増えた場合も、同じ入口に追加する。

夜会話 group は Role の静的 property から解決し、
`resolvedRoleSetup.nightConversationGroups` に固定する。

setup contribution に向いているもの。

- 採用 Role に応じて有効になる固定 resolver
- 採用 Role に応じて有効になる固定 winner judgement
- 採用 Role に応じて必要になる固定 private view group
- ゲーム開始後に変化しない Role 由来の rule extension

setup contribution にしないもの。

- 生存人数によって変わる終了判定
- 対象 Player によって変わる占い結果
- 襲撃、処刑、護衛などの event 反応
- Player ごとの最終結果判定
- event history を見ないと決められない能力制限

これらは runtime hook として、必要なタイミングで `Role` に問い合わせる。

## Example: Werewolf And Madman

人狼 Role が提供するもの。

- 基本陣営は人狼
- 占いでは人狼として見える
- 夜に襲撃 action を持つ
- Werewolf night conversation group に参加する
- 終了判定上、人狼数として数えられる
- 生存人狼数が生存非人狼数以上なら終了候補を返す
- 人狼側勝利なら PlayerResult は win

狂人 Role が提供するもの。

- 基本陣営は人狼側
- 占いでは人間として見える
- 終了判定上は非人狼として数えられる
- 人狼側勝利なら PlayerResult は win

この例では、狂人は「人数カウント」と「結果判定」が一致しない。
そのため、Role には count logic と result logic の両方を持たせる。

## Example: Passive And Post-Resolution Roles

占い師の first night 白通知は、first night 用の対象選択 action ではない。
`SeerRole.onFirstNightStarted` が、自分以外の human 候補から対象を決め、占い師本人だけに
private event として通知する。
通常の夜の占いは `SeerRole.getActions` が返す inspect action として扱う。

霊媒師は、夜に操作する action を持たない。
処刑で死亡した Player の Role が人狼として見えるかどうかを、
`SpiritistRole.onDeathResolved` が alive な霊媒師本人だけへ private event として通知する。
それ以外は村人と同じ扱いにする。

ハンターは、処刑されたときに `onExecuted` で反撃 action を開く。
反撃 action が解決されたら、`onActionResolved` で反撃対象への death effect を返す。
処刑処理の core rule は、ハンターという role id を知らない。

妖狐は、襲撃耐性、占い死亡、独自勝利判定、最終結果判定を `FoxRole` 側で持つ。
common engine は、占い、襲撃、死亡、winner judgement の generic な処理だけを行う。
