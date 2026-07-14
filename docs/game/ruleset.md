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

roleOptions:
  guard:
    consecutive_target: deny
  seer:
    initial_inspection: enabled

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

役職固有 option は `roleOptions[roleId][optionKey]` の opaque な値として保持する。
option key、default、選択肢、localized label、検証は owning Role の
`getSpecificOptions()` が定義する。Browser、HTTP API、persistence、common engine は
Role catalog から generic に検証・描画し、特定 option key を列挙しない。
Guard Role は自分の option と直近の action history を見て target eligibility を判断し、
Seer Role は自分の option から first-night inspection を判断する。
Guard の `consecutive_target: deny` は直前の Night に提出された target だけを除外する。
直前の Night が `missing` なら、それより古い target は再び選択できる。

投票結果の公開範囲も `RuleSet` の option として扱う。
これは投票解決後に browser へ返す情報だけを変える。
投票の集計ロジックや処刑対象の決定ロジックは変えない。

phase の時間も `RuleSet` の option として扱う。
初期値は次の方針にする。

- first night はデフォルト30秒
- normal night はデフォルト180秒
- ready check の最大会議時間はデフォルトで生存人数 x 90秒
- voting はデフォルト30秒
- execution の遺言時間はデフォルト60秒
- ordered speech の1人あたりの発言時間はデフォルト90秒

Browser、HTTP API、Game Engine は次の入力範囲を共通で使用する。

- `firstNightSeconds`、`daySpeechSeconds`、
  `dayReadyCheckSecondsPerPlayer`、`votingSeconds`、
  `executionLastWordsSeconds` は1秒以上300秒以下
- `nightSeconds` は1秒以上600秒以下
- `firstDaySpeechRounds` と `normalDaySpeechRounds` は1以上5以下

normal night は、開始時に固定した `nightSeconds` が終わるまで、役職 action が
早く揃っても次へ進めない。
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

ゲーム開始時に確定した `RuleSet` は、engine version、role registry version、
全role count、全optionを `game_rule_sets` に保存する。Phase解決時はこの保存値を
厳格に読み戻す。version不一致、field欠損、未知field、不正な値、または現在のdomain
validationに適合しない保存値をdefaultで補完してはならず、Phase解決を失敗させる。

検証すること。

- 必須役職が含まれているか
- 役職数の合計が Player 数と合っているか
- 各役職の最小人数を満たしているか
- 各役職の最大人数を超えていないか
- 同居不可の役職が同時に含まれていないか
- 選択されたオプションが役職制約と矛盾していないか
- Day の会議方式が `ready_check` か `ordered_speech` のどちらか1つに決まっているか
- 各 role option が owning Role の choice に含まれているか
- 初日白判定確定占いが有効な場合、占い結果 `human` になる対象候補が存在するか

ゲーム開始後、`RuleSet` は固定する。
開始後に役職構成やオプションを変えない。

`resolved role setup` は、固定された `RuleSet` と採用中 Role からゲーム開始時に作る。
開始後に Role 構成が変わらないため、setup contribution の結果も同じゲーム中は固定される。

`resolvedRoleSetup` は `activeRoleIds`、`contributions`、
`nightConversationGroups` だけを持つ。winner judgement は Role が生成する typed setup
contribution として `contributions` に保存し、同じ内容を並行する別 field に
複製しない。engine version と role registry version は
`game_rule_sets` の専用 column が正本であり、resolved setup JSON に重複させない。
winner judgement の一意性は `(sourceRoleId, id)` で検証し、winner Team は
`RoleRegistry` に登録された Role definitions の opaque Team ID から選ぶ。

## Role Assignment

Role assignment は、ゲーム開始時に実行する。

前提。

- RuleSet は検証済み
- Player 数と役職数が一致している
- Room は開始可能状態

方針。

- 開始時の Player 集合を固定 game roster とし、開始後に membership history から
  assignment や alive state を追加、削除、補完しない
- Role assignment は Player ID で正規化した固定 roster を基準に行い、呼び出し元の配列順や
  join 順に依存させない
- Role deck は application server の暗号学的乱数を使った unbiased Fisher-Yates shuffle で
  並べ替え、Player ID や Account ID から疑似乱数 seed を導出しない
- Account ID は使わない
- assignment、乱数、seed 相当の内部状態を public response、Realtime、event payload、log に
  含めない
- Room 開始 transaction が失敗した場合は assignment を保存しない。再試行では最新の固定候補
  roster に対して新しく shuffle し、transaction が成功した最初の assignment だけを固定する
- ゲーム終了前の割り当て結果は各 Player にのみ秘密情報として見せる
- game status と Room status がともに `ended` になる前は、公開 room state に他人の役職を
  含めない
- game status と Room status がともに `ended` になった後は、固定済み role assignment から
  全 Player の役職を公開 result view に含められる
