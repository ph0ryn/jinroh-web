# Engine と State

## Game Engine

`Game Engine` は、ゲーム状態を進める中心の仕組み。

Engine の責務。

- 採用中の Role を registry から集める
- Player に Role を割り当てる
- 採用中 Role と core rule から setup contribution を解決する
- action を受け付ける
- action や event を現在の state に適用する
- Role hook を呼び出す
- Role hook が返した effect を集める
- effect の順序と衝突を解決する
- state を更新する
- 状態変化後に core rule の終了判定を実行する
- ゲーム終了後に各 Player の結果判定を実行する

Engine だけが game state を更新する。

`Role` は判断と提案を返す。
`Engine` はそれを集約して確定状態にする。

## GameState

`GameState` は、現在のゲーム状態。

含めるもの。

- Player 一覧
- Player ごとの割り当て Role
- 生存/死亡状態
- 現在の game status
- 現在の user-visible phase
- phase の開始時刻
- phase の終了予定時刻
- First night の進行状態
- Day phase の進行状態
- Execution phase の進行状態
- 固定済みの resolved role setup
- 夜ごとの夜会話 message state
- current action
- pending action
- event history
- RuleSet option
- final outcome

Account ID はゲームロジックに出さない。

ゲーム中の対象指定、役職割り当て、結果判定は Player を基準にする。

Role-specific な状態は `Role` class に持たせない。

GameState は、Engine が次の判定に使う現在値と、確定済み event history を持つ。

current action は、現在受け付けている action の枠を表す現在値。
提出内容や解決結果は current action に含めない。
current action は受付可否、二重送信防止、完了判定にだけ使う。

提出済みで未解決の action は pending action として扱う。
pending action は、対応する current action、submitter、target、submittedAt を持つ。
action が解決された後は、監査や Role hook の履歴参照のために event history へ resolved event を残す。
該当 timing が解決された current action と pending action は GameState から削除する。

final outcome は、ゲーム終了時に一度だけ確定して GameState に固定する。
結果画面は、この固定済み final outcome から表示する。
終了理由や PlayerResult を画面表示のたびに event history から再計算しない。

役職ごとの回数制限、直前対象、発動済み判定は event history から読む。

例。

- 狩人の前回護衛先は、過去の guard action resolved event から読む
- 魔女が薬を使ったかは、過去の potion used event から読む
- ハンターが発動済みかは、過去の hunter shot event から読む
- 占い師が誰を占ったかは、過去の inspect action resolved event から読む
- ordered speech の発言順は、Day 開始時に GameState / event history へ記録する

後から性能上の理由でキャッシュが必要になった場合でも、それは event history または
GameState の現在値から作る derived state として扱う。
正の状態を role-local state に分散させない。

## Game Event History

`GameEvent` は、ゲーム中に確定した出来事の履歴。

GameEvent は GameState の一部であり、役職処理や結果判定が参照できる。

記録する代表例。

- action が提出された
- action が解決された
- effect が適用された
- Player が死亡した
- phase が変わった
- ゲームが終了した

死亡 event には `DeathReason` を持たせる。

代表的な `DeathReason`。

- attack
- execution
- retaliation
- rule effect

`DeathReason` は、死亡の意味を Role 側が解釈するための情報。

例。

- 霊媒師は、処刑で死亡した Player の Role を見る
- ハンター系の役職は、自分の死亡理由を見て反撃可能かを判断する
- 妖狐系の役職は、襲撃や占いの履歴を見て結果判定できる

Event は公開用、個別公開用、内部用を分ける。
秘密情報を含む event を public game view にそのまま出さない。

`private` event は、必ず宛先を明示する。

- 特定 Player だけに見せる場合は visible player を指定する
- 人狼仲間のような共有秘密は visible faction を指定する
- 特定 Role の Player だけに見せる場合は visible role を指定する
- 宛先を決められない秘密情報は internal event にする

ただし、Werewolf night conversation は `Team.Werewolf` ではなく、
実際に `WerewolfRole` を持つ Player だけに見せる。
狂人は人狼側の結果判定に乗れるが、Werewolf night conversation の閲覧対象には含めない。
