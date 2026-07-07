# Role 設計

## Role Model

`Role` は役職ごとに1つの定義として扱う。

たとえば、人狼が3人いる場合でも、`WerewolfRole` の定義は1つでよい。
各 Player がどの役職を持っているかは game state 側に保存する。

### Role が持つ情報

`Role` は、静的な情報と動的な判定ロジックを持つ。

静的な情報。

- role id
- 表示名
- 説明
- 基本陣営
- 最小人数
- 最大人数
- 必須役職かどうか
- 同居不可の役職

動的な判定ロジック。

- 終了判定上、どう数えるか
- 占いではどう見えるか
- 占われたときに何が起きるか
- 襲撃されたときに何が起きるか
- 処刑されたときに何が起きるか
- どの phase でどの action が可能か
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

この設計で重要なのは、`Role` の method が state を変更しないこと。

`Role` は以下だけを返す。

- 見え方
- 実行可能 action
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
- 未提出 action に独自挙動がある役職は `onMissingAction` を override する
- ゲーム開始時の固定影響を追加する役職は `getSetupContributions` を override する
- 独自の勝者判定を持つ役職は winner judgement contribution と `evaluateWinnerJudgement` を追加する
- 独自の結果判定を持つ役職は `evaluateResult` を override する

現時点では、終了条件は人狼を中心にした基本ルールだけを扱う。
追加役職が独自の終了条件を持つケースは想定しない。
必要な役職が出てきたら、その時点で設計を見直す。

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

代表的な hook。

- 占われたとき
- 襲撃されたとき
- 処刑されたとき
- 夜 action を実行するとき
- phase が変わるとき
- 終了後に結果判定するとき

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
