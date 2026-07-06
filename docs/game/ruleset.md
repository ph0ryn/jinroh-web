# RuleSet と Role Assignment

## RuleSet

`RuleSet` は、その Room で採用するゲーム設定。

含めるもの。

- 採用する役職
- 各役職の人数
- 参加人数の制約
- ゲームオプション
- 役職同士の制約

ゲームオプションは、役職 class に固定しないルール差分を表す。

例。

```text
dayDiscussionMode:
  ready_check
  ordered_speech

firstNightSeconds:
  30

daySpeechSeconds:
  90

dayReadyCheckSecondsPerPlayer:
  90

firstDaySpeechRounds:
  2

normalDaySpeechRounds:
  1

initialInspectionPolicy:
  enabled

guardConsecutiveTargetPolicy:
  allow
  deny_same_target

nightSeconds:
  180

votingSeconds:
  30

executionLastWordsSeconds:
  60

voteResultVisibility:
  count_only
  voter_to_target
```

狩人の連続護衛可否は `RuleSet` の option として扱う。
狩人 Role は、`RuleSet` の option と event history を見て action が有効かを判断する。

投票結果の公開範囲も `RuleSet` の option として扱う。
これは投票解決後に browser へ返す情報だけを変える。
投票の集計ロジックや処刑対象の決定ロジックは変えない。

phase の時間も `RuleSet` の option として扱う。
初期値は次の方針にする。

- first night は30秒
- normal night は180秒固定
- ready check の最大会議時間は生存人数 x 90秒
- voting は30秒
- execution の遺言時間は60秒
- ordered speech の1人あたりの発言時間はデフォルト90秒

normal night は、役職 action が早く揃っても時間切れまで進めない。
早く進めると、どの役職が残っているか推測できるため。

Day の会議方式は、ゲーム開始前に `ready_check` か `ordered_speech` の
どちらか1つを選ぶ。
同じゲーム中に2つの方式を併用しない。

初日襲撃は固定でなしにする。
これは `RuleSet` option にしない。

初日白判定確定占いは `RuleSet` option として扱う。
デフォルトでは有効にする。

初日白判定確定占いでは、占い師が対象を選ばない。
Engine が占い師本人を除く、占い結果 `human` になる生存 Player の中から
ランダムに1人を選び、占い師に結果を返す。
これは白判定確定の初日占いであり、占い結果が `werewolf` になる Player は候補に入れない。

`RuleSet` はゲーム開始前に検証する。

検証すること。

- 必須役職が含まれているか
- 役職数の合計が Player 数と合っているか
- 各役職の最小人数を満たしているか
- 各役職の最大人数を超えていないか
- 同居不可の役職が同時に含まれていないか
- 選択されたオプションが役職制約と矛盾していないか
- Day の会議方式が `ready_check` か `ordered_speech` のどちらか1つに決まっているか
- 初日白判定確定占いの設定が `disabled` か `enabled` のどちらかに決まっているか
- 初日白判定確定占いが有効な場合、占い結果 `human` になる対象候補が存在するか

ゲーム開始後、`RuleSet` は固定する。
開始後に役職構成やオプションを変えない。

`resolved role setup` は、固定された `RuleSet` と採用中 Role からゲーム開始時に作る。
開始後に Role 構成が変わらないため、setup contribution の結果も同じゲーム中は固定される。

## Role Assignment

Role assignment は、ゲーム開始時に実行する。

前提。

- RuleSet は検証済み
- Player 数と役職数が一致している
- Room は開始可能状態

方針。

- Role assignment は Player ID を基準に行う
- Account ID は使わない
- 割り当て結果は各 Player にのみ秘密情報として見せる
- 公開 room state には他人の役職を含めない
