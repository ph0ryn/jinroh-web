# Engine と State

## Game Engine

`Game Engine` は、ゲーム状態を進める中心の仕組み。

Engine の責務。

- 採用中の Role を registry から集める
- Player に Role を割り当てる
- 採用中 Role から setup contribution を解決する
- action を受け付ける
- action や event を現在の state に適用する
- Role hook を呼び出す
- Role hook が返した effect を集める
- effect の順序と衝突を解決する
- state を更新する
- 状態変化後に採用中 Role の終了判定を集約する
- ゲーム終了後に各 Player の結果判定を実行する

Engine だけが game state を更新する。

`Role` は判断と提案を返す。
`Engine` はそれを集約して確定状態にする。

Room membership と game roster は別の境界。ゲーム開始時に
`role_assignments` と `game_player_states` を全員分固定し、以後の Engine input は
この roster だけから作る。開始後の game actor、target、speaker、result owner を
単なる `players` membership row から補完しない。

## GameState

`GameState` は、現在のゲーム状態。

含めるもの。

- Player 一覧
- Player ごとの割り当て Role
- 生存/死亡状態
- 現在の game status
- 現在の user-visible phase
- 現在の phase instance
- phase の開始時刻
- phase の終了予定時刻
- First night の進行状態
- Day phase の進行状態
- Execution phase の進行状態
- 固定済みの resolved role setup
- 夜ごとの夜会話 message state
- current action
- pending action
- normalized resolved action history
- event history
- RuleSet option
- final outcome

Account ID はゲームロジックに出さない。

ゲーム中の対象指定、役職割り当て、結果判定は Player を基準にする。

Role-specific な状態は `Role` class に持たせない。

GameState は、Engine が次の判定に使う現在値、normalized resolved action history、
必要な event state を持つ。完了済み phase の identity と timing は、現在値とは別に
`game_phase_instances` で保存する。

current action は、現在受け付けている action の枠を表す現在値。
提出内容や解決結果は current action に含めない。
current action は受付可否、二重送信防止、完了判定にだけ使う。

提出済みで未解決の action は pending action として扱う。
pending action は、対応する current action、submitter、target、submittedAt を持つ。
phase timing の解決時に、その timing で開いていた core / Role 由来 action を
normalized resolved action history へ1件ずつ固定する。提出済みは
`submitted`、未提出は `missing` とし、target を持たない action も空の
target 集合として記録する。
該当 timing が解決された current action と pending action は GameState から削除する。

final outcome は、ゲーム終了時に一度だけ確定して GameState に固定する。
結果画面は、この固定済み winner Team と PlayerResult から表示する。
Role が返す終了候補と opaque な reason は勝者判定の入力であり、表示のたびに
event history から再構築しない。

Team は shared enum ではなく opaque な文字列 ID。各 Role は localized
presentation と一緒に Team definition を提供し、`RoleRegistry` が同じ ID の定義を
整合させて登録する。winner judgement と final outcome は登録済み Team ID だけを
扱い、UI は registry 由来の team catalog から表示する。

役職ごとの回数制限、直前対象、発動済み判定は完全な resolved action history
から読む。永続層は `resolved_actions` を public/private event と分けて Engine に
渡し、event の件数上限や表示用 payload の形によって semantic history を
欠落させない。Role hook の context には、この完全な履歴から role-owned action
だけを射影して渡す。

例。

- 直前対象を制限する Role は、自分が解決した submitted action の前回 target を読む
- 使用回数に上限がある Role は、自分が解決した action history の件数を読む
- 一度だけ発動する Role は、自分の opaque action kind が解決済みかを読む
- ordered speech は全周分の plan を Day 開始時に一度だけ作り、同じ Day の
  action window が切り替わっても plan 全体を次の phase instance へ引き継ぐ

Role hook が generic な `CurrentAction` effect を返し、有効な action が具体化された
場合、その follow-up window は blocking として扱う。Engine は同じ user-visible
phase の新しい phase instance を開き、follow-up が submitted または missing として
解決されるまで game end と core phase transition を保留する。同じ phase の通常の
Role action declaration は再度開かない。

follow-up 後に core progression を再開するときは、直前の core decision を normalized
history から復元する。ordered speech は現在の Day で解決済みの speech action を使い、
早期終了の `submitted` と時間切れの `missing` のどちらでも同じ slot から再開する。
Voting は現在の Day / Night counters に属する submitted vote action を使い、follow-up
window の pending action や bounded event payload から推測しない。

後から性能上の理由でキャッシュが必要になった場合でも、それは normalized history または
GameState の現在値から作る derived state として扱う。
正の状態を role-local state に分散させない。

## Resolved Actions And Game Events

core / Role 由来 action の semantic history と、browser へ投影する game event は分ける。

`ResolvedActionHistoryEntry` は phase Engine が履歴判定に使う typed state。
`submitted` と `missing` のどちらも保持し、次の情報を持つ。

- opaque な `actionKey` と `actionKind`
- action の意味を解決した nullable な `resolverRoleId`
- actor Player または actor Role
- target Player の集合。target を持たない action では空集合
- `submitted` または `missing` の resolution status
- action を解決した phase、phase instance、Day / Night counters

snapshot boundary は phase と counters の整合性、および `resolvedAt`、ID の昇順を
検証する。Engine は検証済みの完全な順序を使い、presentation event の件数制限や
取得順へ依存しない。

Role action の `resolverRoleId` と `actionKind` は behavior owner が定義した値を
変換せずに保持する。core action は `resolverRoleId = null` として同じ normalized
history に保存する。common engine と persistence は特定 Role の識別子を列挙せず、
generic な typed record だけを扱う。Role hook へは non-null resolver を持つ
`ResolvedRoleAction` だけを射影し、Role が core history を解釈する境界にはしない。

`GameEvent` は、phase change、投票結果、死亡、Role が safe presentation contract で
返した message など、ユーザーへ投影できる確定済みの出来事を保持する。
Role hook に arbitrary JSON event payload を渡して意味を再解釈させない。

記録する代表例。

- effect が適用された
- Player が死亡した
- phase が変わった
- ゲームが終了した

死亡 event には opaque な文字列 `DeathReason` を持たせる。`attack`、
`execution`、`rule_effect` は generic な core reason の例だが、値の全集合ではない。
Role 固有の reason は owning Role module に置き、common enum、SQL allowlist、
view adapter の分岐へ追加しない。永続層は安全な identifier shape と参照整合性
だけを検証し、owning Role hook が reason の意味を解釈する。

例。

- 霊媒師は、処刑で死亡した Player が人狼だったかどうかを見る
- 死亡後に反応する Role は、自分の死亡理由を見て追加 effect が可能か判断する

Event は公開用、個別公開用、内部用を分ける。
秘密情報を含む event を public game view にそのまま出さない。

`private` event は、必ず宛先を明示する。

- 特定 Player だけに見せる場合は visible player を指定する
- 特定 Role の Player だけに見せる場合は visible role を指定する
- 宛先を決められない秘密情報は internal event にする

ただし、Werewolf night conversation は人狼側の Team ID ではなく、
実際に `WerewolfRole` を持つ Player だけに見せる。
狂人は人狼側の結果判定に乗れるが、Werewolf night conversation の閲覧対象には含めない。
