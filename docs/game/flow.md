# Phase と進行

## Status, Phase, And Action

Game Engine は game status と phase を分けて持つ。

`phase` は、ゲーム中にユーザーへ表示する現在の進行状態。
`status` が `playing` の間だけ、`phase` は次のいずれかを持つ。

ユーザー表示対象の phase。

- night
- day
- voting
- execution

`role assignment` や `result` は phase ではなく、ゲーム前後の status として扱う。
結果画面は `ended` status と final outcome から表示する。

代表的な status。

- waiting
- assigning_roles
- playing
- ended

`status` が `waiting`、`assigning_roles`、`ended` の場合、`phase` は `null` でもよい。

基本サイクル。

```text
waiting
  -> assigning_roles
  -> playing / night
  -> day
  -> voting
  -> execution or night
  -> day
```

phase の番号は、その phase に入る時点で更新する。

```text
role assignment complete
  enter night
    nightNumber = 1
    dayNumber = 0
    phaseInstanceId を発行する
    first night current actions を作る

first night end
  enter day
    dayNumber += 1
    phaseInstanceId を発行する
    day current actions を作る

day end
  enter voting
    dayNumber と nightNumber は変えない
    phaseInstanceId を発行する
    vote current actions を作る

voting result = execution candidate
  enter execution
    dayNumber と nightNumber は変えない
    phaseInstanceId を発行する
    execution current actions を作る

voting result = no execution
  enter night
    nightNumber += 1
    phaseInstanceId を発行する
    night current actions を作る

execution end and game continues
  enter night
    nightNumber += 1
    phaseInstanceId を発行する
    night current actions を作る

normal night end and game continues
  enter day
    dayNumber += 1
    phaseInstanceId を発行する
    day current actions を作る
```

最初の `night` は初日夜として扱う。
ユーザー表示は通常の `night` と同じだが、内部では `nightNumber === 1` で通常夜と区別する。

各 Role は、自分がどの phase で action 可能かを定義できる。

例。

- 占い師は夜に対象を選ぶ
- 人狼は夜に襲撃対象を選ぶ
- 全生存者は投票 phase で投票できる

Action の受付と確定は分ける。

```text
action submitted
  Player が意思決定を送る

action resolved
  Engine が必要な action を集めて処理する
```

Role は action の意味を定義できる。
Engine は action の受付、順序、解決、状態反映を管理する。

Action の責務は3層に分ける。

```text
Role
  その役職が可能な action を定義する

ActionResolver
  action を検証し、基本 effect を生成する

Game Engine
  action を受け付け、resolver と Role hook の結果を集約する
```

Role は action の存在を定義する。
ActionResolver は action の解決方法を定義する。
Role hook は action や effect に反応する。

一部の action は Role ではなく core rule から提供する。
投票はその代表で、全生存 Player が参加する昼の基本 action として Engine が扱う。

Action には scope がある。

```text
player
  1人の Player が提出する action

role_group
  特定 Role を持つ Player group として提出する action

all_alive_players
  全生存者が提出する action
```

人狼の襲撃は role group action として扱う。
人狼が複数いても、`WerewolfRole` を持つ Player group として最終的に1つの襲撃先だけを解決する。
狂人は `Team.Werewolf` でも、`WerewolfRole` を持たないため襲撃 action には関係しない。

Engine は action の受付可否を `currentActions` で管理する。
`currentActions` は、現在受け付けている action の枠だけを表す。
提出内容、解決結果、公開/非公開 result は `currentActions` に含めない。

```text
current action
  誰が、どの action を、いつまで提出できるか

pending action
  実際に提出された target や submittedAt

resolved event / result
  解決済みの結果、公開情報、秘密情報
```

二重送信や再送が来た場合は、同じ current action に対して最初に受理した有効 pending action だけを見る。
後から届いた同じ current action への pending action は state に反映しない。
これは通常の player action でも role group action でも同じ。

```text
submitPolicy:
  first_submit_wins
```

current action は、投票開始、夜開始、発言 slot 開始など、action を受け付ける timing の開始時に作る。
timing が解決されたら、該当する current action は削除する。
過去の action と衝突しないように phase name や phase instance を key に含める必要はない。

current action の作り方。

```text
player action
  action kind + player

role group action
  action kind + role id

all alive players action
  action kind + player ごとに1つずつ作る
```

無効な pending action は current action を完了させない。
最初に受理された有効 pending action だけが、その current action の完了条件になる。
同じ current action に後から届いた pending action は、通信再送や二重クリックとして扱い、状態上は no-op にする。

人狼が2人いて同じ夜に別々の襲撃先を送った場合も、最初に受理された有効な襲撃だけを解決する。

action の提出権限は、submitter の Role が現在その action を提供しているかで判定する。
`Role.team` が action 権限を直接意味するわけではない。
たとえば狂人は `Team.Werewolf` でも、`MadmanRole` が襲撃 action を提供しない限り、襲撃 action を提出できない。

## First Night

First night は、Role assignment 後、最初の Day に入る前の `night` phase。
ユーザー表示上は夜として扱う。

通常夜とは `nightNumber === 1` で区別する。

目的。

- 各 Player が自分の役職を確認する
- 初日白判定確定占いが有効な場合、占い師へ結果を配る
- Player が開始準備完了を押せるようにする
- 最大30秒で最初の Day に進める

初日襲撃は固定で発生しない。
人狼の襲撃 action は出さない。
その他の night action も、初日夜では Player 操作として受け付けない。

夜会話は action ではないため、初日夜でも表示対象になり得る。
Werewolf night conversation は、実際に WerewolfRole を持つ Player だけに表示する。

基本ルール。

- status は `playing`
- phase は `night`
- nightNumber は1
- 制限時間は30秒
- 全 Player が開始準備完了を押したら、30秒を待たずに Day へ進む
- 30秒経過したら、未準備の Player がいても Day へ進む
- 準備完了 action は core action として扱う
- 同じ Player の二重送信は最初の有効 action だけを受理する
- Day へ進んだら、ready current action は削除する

```text
ready for first day slot
  night phase + nightNumber 1 + ready_for_first_day + player
```

初日白判定確定占いが有効な場合、Engine が占い師本人を除く、占い結果 `human` になる
生存 Player からランダムに対象を選び、占い師に private result を返す。
この抽選は internal event として記録し、public view には対象を出さない。

First night が終わったら、`status` は `playing` のまま、`phase` は `day` になる。

## Night

通常の Night は、最初の Day 以降に発生する夜 phase。
内部的には `nightNumber >= 2` の夜を指す。
固定で180秒にする。

夜 action が全員分揃っても、180秒が経過するまでは次の phase に進めない。
早く進めると、残っている役職や行動可能な役職が推測されやすいため。

Night の基本ルール。

- phase 開始時に終了予定時刻を決める
- Role ごとの night current action を作る
- 夜会話 group の対象 Player には night conversation を表示できる
- 受理済み pending action は current action ごとに固定する
- すべての night action が揃っても phase は短縮しない
- 180秒経過後に受理済み pending action を解決する
- action 解決後、night current action を削除する
- action 解決後、対応する pending action を削除する
- action 解決後に終了判定を実行する

未提出 action の扱いは Role 定義側で決める。
Role 由来の current action に対応する pending action がない場合、Engine は
owner Role の `onMissingAction` を呼ぶ。
default の `onMissingAction` は何も effect を返さない。
core action の未提出は core rule 側で扱う。
ただし、未提出 action のために Night を延長しない。

## Day

Day は、会議のための phase。
会話そのものはこのアプリの責任外にする。

対面、外部 voice chat、その他の通信手段で会話する前提。
アプリは Day の進行、現在の発言者、残り時間、Voting への移行だけを管理する。

人狼同士の夜会話は、Night 中に送信できる role-private chat として扱う。
Day の自由会話内容は引き続きアプリの責任外にする。

Day の会議方式は `RuleSet` の option で選ぶ。
ゲーム開始前に `ready_check` か `ordered_speech` のどちらか1つを選び、
開始後は固定する。

```text
ready_check
  全生存 Player が投票開始を押したら Voting に移行する

ordered_speech
  ランダムな位置から順番に、各 Player が一定時間ずつ話す
```

### Ready Check Day

`ready_check` は、全員の「会議終了 / 投票開始」入力で Voting に進む方式。

これは core action として扱う。
Role 固有の action ではない。

基本ルール。

- 対象は持たない
- 生存 Player だけが提出できる
- action scope は all alive players
- 同じ Player の二重送信は最初の有効 action だけを受理する
- 全生存 Player の ready action が揃ったら Voting に移行する
- 最大会議時間は Day 開始時点の生存人数 x 90秒
- 最大会議時間に達したら、未 ready の Player がいても Voting に移行する
- Voting に移行したら、ready current action は削除する

```text
ready for voting slot
  day phase + ready_for_voting + player
```

### Ordered Speech Day

`ordered_speech` は、順番に発言時間を割り当てる方式。

基本ルール。

- Day 開始時点の生存 Player から発言順を作る
- 開始位置はランダムに決める
- 作成した発言順はその Day の間固定する
- 1人あたりの発言時間は `daySpeechSeconds`
- `daySpeechSeconds` のデフォルトは90秒
- 最初の Day は2周する
- 2回目以降の Day は1周する
- 現在の発言者は、自分の発言 slot を早く終了できる
- すべての発言 slot が終わったら Voting に移行する

発言順のランダム開始位置は、Day 開始時に一度だけ決める。
再接続、再描画、Realtime 再送で順番を作り直さない。

発言 slot には予定終了時刻と実終了時刻を分けて持つ。

```text
scheduled end
  timer 上の終了予定時刻

actual end
  時間切れ、または本人の終了操作で実際に終わった時刻
```

現在の発言者が終了を選んだ場合、その slot は即時終了する。
次の発言 slot があれば、次の発言者へ進む。
次の発言 slot は即時開始し、余った時間は繰り越さない。
最後の発言 slot が終わった場合は、Voting に移行する。

発言終了は core action として扱う。
Role 固有の action ではない。

基本ルール。

- 対象は持たない
- 現在の発言者だけが提出できる
- 現在の発言 slot が終わっている場合は無効
- 同じ発言 slot への二重送信は最初の有効 action だけを受理する
- 発言終了 action は会話内容を記録しない
- 発言 slot が終わったら、対応する end speech current action は削除する

```text
end speech slot
  day phase + end_speech + current speech slot
```

## Voting

投票は Role 固有の能力ではなく、昼の core rule として扱う。

生存 Player は voting phase で1票を提出できる。
投票 action は `ActionScope.AllAlivePlayers` の action として扱う。
投票 action は `Role.getActions` ではなく、Game Engine が core action として提供する。

Voting は30秒にする。
ただし、全生存 Player の有効票が揃った場合は30秒を待たずに解決する。

投票の基本ルール。

- 投票できるのは生存 Player だけ
- 投票対象にできるのは生存 Player だけ
- 自分自身への投票は可能
- 投票変更はできない
- 最初に受理された有効な投票だけを採用する
- 未投票の Player は投票放棄として扱う
- 30秒経過時点で未投票者がいても voting phase は解決できる
- 全生存 Player が投票済みなら30秒を待たずに解決できる
- 投票中は、誰が誰に投票したかを public view に出さない
- 投票解決後に誰が誰へ投票したか公開するかは RuleSet option で決める

Voting 開始時、Engine は生存 Player ごとに vote current action を作る。
同じ Player が複数回投票を送っても、最初に受理された有効 pending action だけが残る。

```text
vote current action
  vote + voter player
```

集計時には、vote current action に対して受理済みの有効 pending action だけを見る。
未投票者は票を持たない。
Voting が解決されたら、vote current action と対応する pending action はすべて GameState から削除する。

集計結果。

```text
最多票が1人
  execution candidate

最多票が同数で複数人
  no execution

有効票が0
  no execution
```

投票の内部記録と公開情報は分ける。

内部 event には、集計や監査に必要な完全な投票情報を残してよい。
ただし public event と public view は `voteResultVisibility` に従って作る。

```text
count_only
  各 Player が何票を得たかだけを公開する
  誰が誰に投票したかは公開しない

voter_to_target
  誰が誰に投票したかまで公開する
```

どちらの設定でも、処刑対象の決定ロジックは同じ。
違うのは、投票解決後に browser へ返す情報だけ。

`count_only` の場合でも、内部 event には `acceptedVotes` を残してよい。
public event では `voteCountsByTarget` だけを返す。

`voter_to_target` の場合は、public event に `acceptedVotes` も含めてよい。

投票集計と処刑は分ける。

```text
VoteResolver
  有効票を集計する
  execution candidate または no execution を返す

ExecutionResolver
  execution candidate がいる場合だけ Role.onExecuted を呼ぶ
  Role hook から death effect などを集める

Game Engine
  effect を解決して state を更新する
  その後に終了判定を実行する
```

同票や有効票なしで `no execution` になった場合、`onExecuted` は呼ばない。
その場合でも phase が進んだ後に終了判定は実行できる。

投票数を変更する役職や、投票できなくする役職は現時点では扱わない。
必要になったら、VoteResolver に modifier の入力点を追加する。

## Execution

Execution は、Voting で決まった処刑候補の遺言時間を扱う phase。

Voting が `no execution` を返した場合、Execution phase は発生しなくてよい。
その場合は処刑 hook を呼ばず、次の phase へ進む。

Execution の基本ルール。

- 処刑候補がいる場合だけ開始する
- 処刑候補を public view に表示する
- 遺言時間は60秒
- 処刑候補は遺言時間を早く終了できる
- 60秒が経過するか、処刑候補が早期終了したら `Role.onExecuted` を呼ぶ
- `Role.onExecuted` から返った effect を Engine が解決する
- effect 解決後に終了判定を実行する

遺言の会話内容そのものはこのアプリの責任外にする。
アプリは処刑候補と残り時間だけを管理する。

遺言は single speaker slot として扱う。
ordered speech と同じく、話している本人だけが早期終了できる。

基本ルール。

- 対象は持たない
- 処刑候補だけが提出できる
- 遺言 slot が終わっている場合は無効
- 同じ遺言 slot への二重送信は最初の有効 action だけを受理する
- 発言終了 action は会話内容を記録しない
- 遺言 slot が終わったら、対応する end speech current action は削除する

```text
end last words slot
  execution phase + end_speech + execution target
```

処刑候補が遺言終了を選んだ場合、その slot は即時終了する。
その後、`Role.onExecuted` を呼び、処刑 effect の解決へ進む。

ハンターなど、処刑に反応する役職の特殊処理は各 Role に書く。
Execution phase の core rule には入れない。
