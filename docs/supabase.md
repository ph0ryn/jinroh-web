# Supabase / Database Design

この文書は、`docs/spec.md` と `docs/game/` を Supabase / Postgres の
永続化設計へ落とし込むための設計書。

`docs/game/` をゲーム本体仕様の正とする。ここでは、その仕様を壊さずに
「何を DB に保存する必要があるか」「何を保存しないか」「何を view として
切り出すか」を固定する。

完成した migration SQL ではない。実装前に schema、transaction、権限境界を
決めるための設計文書として扱う。

## Source Documents

- `docs/spec.md`
- `docs/game/overview.md`
- `docs/game/engine.md`
- `docs/game/flow.md`
- `docs/game/ruleset.md`
- `docs/game/roles.md`
- `docs/game/resolution.md`
- `docs/game/visibility.md`
- `docs/game/werewolf-consultation.md`
- `docs/game/model.md`
- `docs/game/constraints.md`

## Design Principles

DB は永続状態の正本である。

Realtime は状態そのものではなく、状態が変わったことを知らせる通知として扱う。
Browser は通知を受け取った後、Next.js API から最新 view を読み直す。

基本方針。

- Browser から Supabase base table を直接読ませない
- DB は内部状態を完全に保存する
- Next.js server-side runtime が認証、認可、view 切り出しを行う
- Browser には public / self private / role private view だけを返す
- Realtime payload には秘密情報や完全な game state を入れない
- Account ID は認証と認可境界だけで使う
- game logic の主体は Player であり、Account ではない
- Role definition と Game Engine の logic は application code に置く
- DB には固定済み設定、現在状態、未解決入力、確定履歴を保存する

Postgres 設計の基本方針。

- 内部 primary key は `bigint generated always as identity` を基本にする
- Browser に出す identifier は内部 primary key と分ける
- 状態値は `text` と check constraint で表す
- 時刻は `timestamptz` を使う
- 外部 key column には index を張る
- 複数 column で検索する access pattern には composite index を使う
- active row だけを見る query には partial index を使う
- base table は RLS default deny に寄せる
- service role key は server-only secret として扱い、Browser に絶対に渡さない

## Data Classification

### Must Store As Source Of Truth

DB に保存する必要がある正本。

- Account と token hash
- Room lifecycle
- Room 内 Player と display name snapshot
- Room event history
- Game status / phase / phase instance
- day number / night number
- phase started / ends time
- game revision
- Room で固定された RuleSet
- Player ごとの role assignment
- Player ごとの生存 / 死亡状態
- resolved role setup
- current action
- pending action
- game event history
- game event visibility targets
- werewolf consultation slot state
- ordered speech slot state
- final outcome
- player result
- Realtime topic / grant

### Must Store As Event History

解決済みの出来事は、現在値から削除しても event history に残す。

- action submitted
- action resolved
- effect applied
- player died
- phase changed
- vote resolved
- initial inspection target selected
- inspection result produced
- werewolf consultation submitted
- werewolf consultation retracted
- game ended

過去の護衛先、使用済み能力、過去の占い先などは、role-local state として
分散保存しない。必要な Role hook は event history を読む。

### Must Store Temporarily

現在の timing でだけ意味を持つ状態。

- current action
- pending action
- first night ready state
- ready check day state
- current ordered speech slot
- execution last words slot
- current phase timer

これらは解決後に正本の現在値から削除する。監査や結果表示に必要な情報は
`game_events` に移す。

### May Store As JSONB

最初から細かく正規化しすぎない対象。

- rule options
- role counts
- resolved role setup
- setup contributions
- phase-local state
- event payload
- action target player IDs
- public / redacted display payload
- final outcome payload 補助

JSONB にしてよいのは、DB query の主条件になりにくく、application code が構造を
検証して扱う値に限る。権限判定、一意性、外部 key、phase 解決の競合制御に使う値は
独立 column または table に出す。

private event の閲覧可否に使う Player / Role 宛先は JSONB にしない。
`game_event_visible_players` と `game_event_visible_roles` に分け、view 生成時の
認可 query が通常の join と index で検証できるようにする。

### Do Not Store In DB

DB に保存しないもの。

- raw account token
- Authorization header
- service role key
- Role class implementation
- Role hook implementation
- Action resolver implementation
- Game Engine implementation
- RuleSet validation implementation
- effect resolution algorithm
- generated browser view DTO
- Realtime full state payload
- Day の自由会話内容
- execution last words の会話内容

Role の名前、説明、基本陣営、最小人数、最大人数、同居不可役職などの静的定義は
application code の Role registry に置く。ただし、game start 時点の
`role_registry_version` と固定済み `resolved_role_setup` は DB に保存する。

### Generate As Views

base table として Browser に直接公開しないもの。

- public room view
- public game view
- self private game view
- role private game view
- current player action view
- vote result display view
- werewolf consultation display view
- Realtime notification payload

これらは、認証済み Account から対応する Player を求めた後、Next.js API が
DB 内部状態から切り出して返す。

## Access Model

このプロジェクトの Account token は独自の anonymous bearer credential。
Supabase Auth の user ID ではない。

通常の DB 読み書き。

- Browser は Account token を Next.js API へ送る
- Next.js API は raw token を server-side で hash 化する
- Next.js API は `account_tokens` から Account を認証する
- Next.js API は Account と Room / Player の関係から認可する
- Next.js API は Supabase service role key または server-only DB credential で DB を読む
- Next.js API は Browser に見せてよい view だけを返す

Supabase client-side access。

- Browser が Supabase を直接使う範囲は Realtime 購読に限定する
- Browser から base table を直接 select / insert / update / delete しない
- Browser に service role key を渡さない
- Browser に Account ID を返さない

RLS の扱い。

- base table は RLS enabled / default deny を基本にする
- server-side admin operation は service role で実行してよい
- service role key は server-only environment variable に置く
- Realtime private channel には短命 Realtime JWT を使う
- Realtime JWT は購読許可だけに使い、view 取得権限として扱わない

独自 Account token を Supabase JWT claim として扱う設計に変える場合は、
Account ID 非公開の不変条件と矛盾しないかを先に再設計する。

## Base Tables

### `accounts`

匿名 identity。

保存する情報。

- internal account ID
- created time
- updated time
- deleted time

ルール。

- Account ID は server-only
- Account ID を Browser へ返さない
- Account ID を Browser から受け取らない
- Account は display name を持たない
- 表示名 preference は Browser local storage に保存する

`accounts` は game logic の主体ではない。game logic は必ず `players` を主体にする。

### `account_tokens`

Account token の hash。

保存する情報。

- token hash
- token hash key ID
- account reference
- created time
- last used time
- revoked time

ルール。

- raw token は DB に保存しない
- token hash は一意にする
- token を URL に含めない
- token や Authorization header をログに出さない
- revoked token は認証に使えない
- active Room に紐づく Player を持つ Account の token は cleanup しない

token 形式。

- raw token は `jat_` prefix を持つ
- random part は 32 bytes の CSPRNG output を base64url no-padding で表す
- token hash は raw token 全体の `HMAC-SHA-256`
- HMAC key は `ACCOUNT_TOKEN_HASH_SECRET` 環境変数から読み込む
- `ACCOUNT_TOKEN_HASH_SECRET` は、32 bytes の HMAC key を standard base64 で
  表した文字列とする
- application server は `ACCOUNT_TOKEN_HASH_SECRET` を base64 decode して
  HMAC key bytes として使う
- `ACCOUNT_TOKEN_HASH_SECRET` が未設定、空文字、不正な base64、または decode 後
  32 bytes でない場合、application server は起動しない
- DB には HMAC 結果を base64url no-padding で保存する
- `token_hash_key_id` で key rotation に対応する

local secret の生成例。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### `rooms`

1回の人狼ゲームを行う場所。

保存する情報。

- internal room ID
- public room code
- room status
- host account reference
- room realtime topic
- lobby expiration time
- created time
- started time
- disbanded time
- ended time
- updated time

Room status。

- `lobby`
- `playing`
- `disbanded`
- `ended`

ルール。

- public room code は6桁の数字文字列
- active Room の public room code は衝突させない
- `disbanded` / `ended` の古い Room の code は再利用してよい
- Room は `lobby` で作成する
- lobby Room は30分以内に開始されなければ期限切れ
- 期限切れの Room は物理削除せず `disbanded` にする
- host account reference は Browser に返さない
- realtime topic は public room code から作らない
- realtime topic は参加済み Account にだけ返す

### `players`

特定 Room 内の Account。

保存する情報。

- internal player record ID
- room-scoped public player ID
- room reference
- account reference
- display name snapshot
- player status
- joined time
- left time
- disconnected time
- last seen time

Player status。

- `joined`
- `disconnected`
- `left`

ルール。

- `room_id + account_id` は一意
- `room_id + public_player_id` は一意
- Player ID は秘密情報ではない
- Player ID は権限の証明ではない
- 認可には認証済み Account を使う
- 新しい Player は Room が `lobby` の間だけ作れる
- 既存 Player は `lobby` または `playing` で再参加できる
- Player display name は新規 Player 作成時だけ snapshot する
- 同じ Account が同じ Room に戻る場合、既存 Player を再利用する

game logic では `players.id` を内部 FK として使う。
Browser-facing view では `public_player_id` を使う。

### `room_events`

Room lifecycle と lobby 操作の履歴。

保存する情報。

- room reference
- event kind
- actor player reference
- actor account reference
- payload
- created time

代表的な event kind。

- `room_created`
- `player_joined`
- `player_reconnected`
- `player_disconnected`
- `player_left`
- `game_started`
- `room_disbanded`
- `room_ended`

ルール。

- Room、Player、event は通常動作で物理削除しない
- Account ID などの内部情報は public view に出さない
- payload に秘密情報を混ぜない
- 状態変更と event 記録は同じ transaction で行う

## Lobby Transactions

### Room Create

同じ transaction で行う。

- Account を認証する
- Room code を発行する
- random realtime topic を発行する
- Room を `lobby` で作成する
- host Account を保存する
- host Player を作成する
- display name を host Player に snapshot する
- lobby expiration time を設定する
- `game_states` を `waiting / phase = null` で作成する
- `room_created` event を記録する

commit 後に Realtime 通知を送る。

### Room Join

同じ transaction で行う。

- Account を認証する
- public room code で Room を取得して lock する
- lobby 期限切れを確認し、必要なら `disbanded` にする
- 新規 Player は `lobby` の間だけ作成する
- 既存 Player は `lobby` または `playing` で再参加させる
- 新規 Player 作成時だけ display name を snapshot する
- `player_joined` または `player_reconnected` event を記録する

commit 後に Realtime 通知を送る。

### Room Start And Game Start

Room start は game start transaction と同じ境界で扱う。

- Account を認証する
- host Account か確認する
- Room を lock する
- Room が `lobby` か確認する
- lobby 期限切れでないことを確認する
- RuleSet を検証する
- `game_states` を lock して `assigning_roles` にする
- role assignment を確定する
- resolved role setup を確定する
- Room を `playing` にする
- `game_states` を `playing / night / night_number = 1` にする
- `role_assignments` を作成する
- `game_player_states` を作成する
- first night の `current_actions` を作成する
- 必要な initial inspection event を記録する
- `game_started` room event を記録する
- `phase_changed` game event を記録する

commit 後に Realtime 通知を送る。

### Room Leave

同じ transaction で行う。

- Account を認証する
- Account に対応する Player を取得する
- Player を `left` にする
- `player_left` event を記録する
- host が `lobby` から退出した場合、Room を `disbanded` にする
- disband した場合は `room_disbanded` event も記録する

commit 後に Realtime 通知を送る。

### Lobby Expiration

Lobby expiration は正しさの一部。

- Room read / write API の先頭で期限切れを確認する
- `rooms.status = lobby`
- `rooms.lobby_expires_at <= now`
- 条件を満たす場合は `disbanded` にする
- `room_disbanded` event を記録する

scheduled cleanup はあってもよいが、正しさの入口にしない。

## Game Tables

### `game_rule_sets`

Room で採用するゲーム設定。

保存する情報。

- room reference
- role registry version
- engine version
- role counts
- rule options
- validation result
- locked time
- created time
- updated time

保存する rule options。

- `day_discussion_mode`
- `first_night_seconds`
- `day_speech_seconds`
- `day_ready_check_seconds_per_player`
- `first_day_speech_rounds`
- `normal_day_speech_rounds`
- `initial_inspection_policy`
- `guard_consecutive_target_policy`
- `night_seconds`
- `voting_seconds`
- `execution_last_words_seconds`
- `vote_result_visibility`

ルール。

- Room ごとに高々1行
- game start 前に検証する
- role 数の合計は Player 数と一致させる
- required role、min count、max count、incompatible role を検証する
- selected options が Role constraints と矛盾しないか検証する
- game start 後は固定する
- game start 後に role counts や options を変更しない

Role definition の logic は DB ではなく code に置く。
DB には、Room で選ばれ、開始時に固定された設定だけを保存する。

`engine_version` と `role_registry_version` は、進行中または終了済み game を
後日の code 変更から守るために保存する。互換性のない Role logic 変更を行う場合、
既存 game を新しい logic で再解釈してはならない。

### `game_states`

Room に紐づくゲーム本体の現在状態。

保存する情報。

- room reference
- game status
- phase
- phase instance ID
- day number
- night number
- phase started time
- phase ends time
- revision
- resolved role setup
- first night state
- day state
- execution state
- created time
- updated time

Game status。

- `waiting`
- `assigning_roles`
- `playing`
- `ended`

Game phase。

- `night`
- `day`
- `voting`
- `execution`

ルール。

- Room ごとに高々1行
- Room 作成時に `waiting / phase = null` で作成する
- Room status は Room lifecycle を表す
- Game status は Room の内側にある game engine 状態を表す
- `rooms.status = lobby` の間、Game status は `waiting`
- game start transaction 内で `assigning_roles` を経由し、同じ transaction で
  `playing / night` まで進める
- active game 中は phase が変わっても `rooms.status` は `playing` のまま
- game 終了時は同じ transaction で `game_states.status = ended` と
  `rooms.status = ended` を確定する
- `phase` は `playing` の間だけ持つ
- `waiting` / `assigning_roles` / `ended` では `phase` は null
- phase が変わるたびに `phase_instance_id` を発行する
- first night は `phase = night` かつ `night_number = 1` で表す
- `resolved_role_setup` は role assignment 完了まで null
- update のたびに `revision` を増やす
- game write transaction は `game_states` row を lock する

`resolved_role_setup` は JSONB として持つ。

含めるもの。

- active role IDs
- setup contributions
- werewolf consultation templates
- winner judgements

含めないもの。

- Role class implementation
- Role hook implementation
- runtime evaluation result

### `role_assignments`

Player ごとの役職割り当て。

保存する情報。

- room reference
- player reference
- role ID
- assigned time

ルール。

- `room_id + player_id` は一意
- role assignment は game start transaction で固定する
- Account ID ではなく Player ID を基準にする
- 他人の role assignment を public view に含めない
- 自分の role は self private view にだけ含める
- WerewolfRole group などの role private view 判定に使う

role ID は application code の Role registry と対応する。
Role registry version は `game_rule_sets` に保存する。

### `game_player_states`

ゲーム中の Player 現在状態。

保存する情報。

- room reference
- player reference
- alive flag
- death reason
- died phase instance ID
- died day number
- died night number
- died time
- created time
- updated time

ルール。

- `room_id + player_id` は一意
- Room 参加状態の `players.status` とは分ける
- 生存 / 死亡は game logic の状態
- disconnect / leave は lobby / transport / participation の状態
- Player が死亡しても `players.status` は自動で変えない
- death が確定したら `game_events` にも `player_died` を残す

`alive_player_ids` を `game_states` に JSONB cache として持つ必要はない。
必要なら `game_player_states` から作る。性能上の理由で cache する場合も、
`game_player_states` と `game_events` から再生成できる derived state とする。

### `current_actions`

現在受け付けている action の枠。

保存する情報。

- room reference
- phase instance ID
- action kind
- target kind
- scope
- owner player reference
- owner role ID
- allowed player IDs
- action key
- opened time
- closes time
- created time

Action scope。

- `player`
- `role_group`
- `all_alive_players`

ルール。

- current action は受付可否だけを表す
- submitted target や resolved result は持たない
- `phase_instance_id` と紐づける
- timing が解決されたら削除する
- 同じ current action では最初の有効 pending action だけを採用する
- action 提出権限は Role が提供する action から判定する
- `Team` だけで role group action の権限を決めない
- `action_key` は `room_id` 内で一意

action key の作り方。

- player action: action kind + owner player
- role group action: action kind + owner role ID
- all alive players action: action kind + owner player
- speech slot action: action kind + speech slot
- execution last words action: action kind + execution target

`status = completed` の current action row は残さない。
完了済みの事実は `game_events` に残す。

### `pending_actions`

提出済みで未解決の action。

保存する情報。

- current action reference
- room reference
- phase instance ID
- action kind
- submitter player reference
- target player IDs
- submitted time
- idempotency key
- created time

ルール。

- pending action は未解決の提出内容だけを表す
- `current_action_id` は一意にする
- 二重送信は最初の有効 action だけを採用する
- 無効な submission は current action を完了させない
- timing が解決されたら削除する
- 解決済みの結果は `game_events` に残す
- stale `phase_instance_id` の submission は拒否する

role group action でも、最初に受理された有効 pending action だけを採用する。
人狼が複数いて同じ夜に別々の襲撃先を送った場合も、最初の有効な襲撃だけを解決する。

### `game_events`

ゲーム中に確定した出来事の履歴。

保存する情報。

- room reference
- event kind
- phase
- phase instance ID
- actor player reference
- target player references
- visibility
- payload
- payload version
- created time

Event visibility。

- `public`
- `private`
- `internal`

代表的な event kind。

- `action_submitted`
- `action_resolved`
- `effect_applied`
- `player_died`
- `phase_changed`
- `vote_resolved`
- `werewolf_consultation_submitted`
- `werewolf_consultation_retracted`
- `game_ended`

ルール。

- GameEvent は append-only
- GameEvent は GameState の正の一部
- private event は必ず宛先を明示する
- 宛先を決められない秘密情報は internal event にする
- internal event は Browser に返さない
- public event payload に秘密情報を含めない
- private event の可視範囲は JSONB payload ではなく visibility target table で表す
- `payload_version` を持たせ、payload の変更に対応できるようにする

`visible_faction` は v1 では使わない。
人狼相談や role group secret は、Team ではなく Role ID または Player ID で
閲覧対象を切る。狂人は `Team.Werewolf` でも WerewolfRole ではないため、
人狼相談の閲覧対象に含めない。

投票 event の扱い。

- 投票中は voter-to-target を public view に出さない
- 内部 event には完全な accepted votes を保存してよい
- `vote_result_visibility = count_only` の public payload は得票数だけにする
- `vote_result_visibility = voter_to_target` の public payload は voter-to-target を含めてよい
- 処刑対象の決定 logic は visibility option で変えない

### `game_event_visible_players`

特定 Player にだけ見せる private event の宛先。

保存する情報。

- game event reference
- room reference
- player reference
- created time

ルール。

- `game_event_id + player_id` は一意
- `game_events.visibility = private` の event だけに作る
- self private view は authenticated Account に対応する Player ID で join して取得する
- public / internal event には player visibility target を作らない
- payload 内の Player ID 配列を閲覧権限として使わない

### `game_event_visible_roles`

特定 Role を持つ Player group にだけ見せる private event の宛先。

保存する情報。

- game event reference
- room reference
- role ID
- created time

ルール。

- `game_event_id + role_id` は一意
- `game_events.visibility = private` の event だけに作る
- role private view は viewer の `role_assignments` と `role_id` を join して取得する
- `Team` ではなく Role ID で切る
- 人狼相談 event は `role_id = werewolf` のように実際の WerewolfRole 宛てにする
- 狂人は `Team.Werewolf` でも WerewolfRole ではないため、この join に一致しない
- payload 内の Role ID 配列を閲覧権限として使わない

### `werewolf_consultation_slots`

人狼同士の structured consultation。

保存する情報。

- room reference
- night number
- sender player reference
- template ID
- status
- values
- submission count
- retraction used flag
- submitted time
- retracted time
- created time
- updated time

Status。

- `empty`
- `submitted`
- `retracted`

ルール。

- free text chat ではない
- game action ではない
- game 進行、投票集計、終了判定、PlayerResult 判定に使わない
- `room_id + night_number + sender_player_id + template_id` は一意
- template kind では一意にしない
- 初回送信後、撤回は1回だけ
- 撤回後、再送信は1回だけ
- 再送信後は再撤回も再再送信もできない
- 撤回済み状態も WerewolfRole private view には見せる
- Day 中は前夜分を読み取り専用で見せられる
- Voting 以降は private view から消す
- internal history には submit / retract event を残す

閲覧対象は実際に WerewolfRole を持つ Player だけ。
狂人、村人、public view、public realtime payload には出さない。

### `day_speech_slots`

`ordered_speech` 用の発言 slot。

保存する情報。

- room reference
- day number
- phase instance ID
- slot index
- player reference
- round
- starts time
- scheduled ends time
- ended time
- created time

ルール。

- Day 開始時点の生存 Player から一度だけ作る
- 開始位置はランダムに決める
- 作成後はその Day の間固定する
- 再接続や Realtime 再送で作り直さない
- 現在の発言者だけが早期終了できる
- 発言内容そのものは保存しない
- slot が終わったら対応する `end_speech` current action を削除する

### `final_outcomes`

ゲーム終了時に固定する最終結果。

保存する情報。

- room reference
- end reasons
- winner team
- payload
- created time

ルール。

- Room ごとに高々1行
- game end 時に一度だけ作成する
- winner team は1つだけ
- game end 判定と winner judgement は分ける
- 表示のたびに event history から再計算しない
- 作成と同じ transaction で `game_states.status = ended` と `rooms.status = ended` を確定する

### `player_results`

ゲーム終了後の Player ごとの結果。

保存する情報。

- room reference
- player reference
- result
- payload
- created time

Player result。

- `win`
- `lose`
- `draw`
- `special`

ルール。

- `room_id + player_id` は一意
- final outcome が固定された後に評価する
- winner team 判定とは分ける
- Role 固有 result が `null` の場合は標準陣営判定へ fallback できる
- 表示のたびに再計算しない

### `realtime_topics`

Room / game notification 用の topic。

保存する情報。

- room reference
- topic
- scope
- player reference
- role ID
- created time
- revoked time

Scope。

- `room`
- `player_private`
- `role_private`

ルール。

- topic は random value にする
- public room code から topic を作らない
- topic を知っていることを購読権限の証明にしない
- Room 参加済み Account にだけ必要な topic を返す
- role private topic は対象 Role を持つ Player だけに返す

### `realtime_grants`

Realtime private channel の短命購読許可。

保存する情報。

- grant ID
- room reference
- player reference
- topic
- scope
- expires time
- revoked time
- created time

ルール。

- Next.js API が Account / Player / Role eligibility を確認してから作る
- Browser に返す Realtime JWT には Account ID を入れない
- JWT には opaque grant ID と期限だけを入れる
- Supabase Realtime RLS は grant ID、topic、期限を照合する
- Realtime grant は view 取得権限ではない
- view は常に Account token を使って Next.js API から取得する

## Game Start Transaction

Room start と game start は同じ transaction で扱う。

入力。

- authenticated Account
- Room
- selected RuleSet
- lobby Players

処理。

- Room row を lock する
- Room が `lobby` で期限切れでないことを確認する
- authenticated Account が host であることを確認する
- Player 数と selected RuleSet を検証する
- Role registry version と engine version を固定する
- `game_states.status = assigning_roles` にする
- role assignment を決める
- resolved role setup を作る
- `rooms.status = playing` にする
- `game_rule_sets` を lock 済みとして保存する
- `game_states` を `playing / night / night_number = 1` に更新する
- `role_assignments` を作成する
- `game_player_states` を全 Player 生存で作成する
- first night ready action を全 Player 分作成する
- initial inspection policy が enabled の場合は対象を抽選する
- initial inspection の結果を private event / internal event として記録する
- `room_events.game_started` を記録する
- `game_events.phase_changed` を記録する

同じ transaction で固定する理由。

- role assignment と self private view がずれないようにする
- resolved role setup を後から再計算しないようにする
- initial inspection のランダム結果を再実行で変えないようにする
- first night current action の重複作成を防ぐ

## Phase And Action Transactions

Game write transaction は、最初に対象 `game_states` row を lock する。

共通で確認すること。

- Room が `playing`
- Game status が `playing`
- request の phase instance ID が現在のものと一致する
- actor Account に対応する Player が Room に存在する
- action 権限が Player / Role / current action から成立する
- stale request ではない

### Action Submit

同じ transaction で行う。

- Account を認証する
- Player を特定する
- `game_states` row を lock する
- API-only phase resolution を先に実行する
- current action を取得する
- submitter が allowed player か確認する
- Role がその action を提供しているか確認する
- target が有効か確認する
- `pending_actions.current_action_id` 一意制約で first-submit-wins を保証する
- pending action を作成する
- `action_submitted` event を必要な visibility で記録する
- 早期解決条件を満たす場合、phase resolution を続けて実行する

二重送信。

- 同じ current action への2回目以降の有効 submission は no-op とする
- no-op でも成功扱いで現在 view を返してよい
- 無効 submission は pending action を作らず、current action を完了させない

### Werewolf Consultation Submit And Retract

人狼相談は game action ではない。
そのため、`current_actions` / `pending_actions` ではなく
`werewolf_consultation_slots` の状態遷移として扱う。

同じ transaction で行う。

- Account を認証する
- Player を特定する
- `game_states` row を lock する
- API-only phase resolution を先に実行する
- Game status が `playing` であることを確認する
- 現在 phase が `night` であることを確認する
- request の phase instance ID が現在のものと一致することを確認する
- sender Player が WerewolfRole を持つことを確認する
- template ID が `resolved_role_setup.werewolfConsultationTemplates` に存在することを確認する
- `normalNightOnly` template は `night_number >= 2` のときだけ許可する
- template field の values が candidate rule に合うことを検証する
- `room_id + night_number + sender_player_id + template_id` の slot を取得または作成する
- slot row を lock する
- submit / retract の状態遷移が許可されることを確認する
- slot を更新する
- `game_states.revision` を増やす
- `werewolf_consultation_submitted` または `werewolf_consultation_retracted` event を記録する
- event visibility target として WerewolfRole を `game_event_visible_roles` に記録する

許可する状態遷移。

- `empty -> submitted`: 初回送信。`submission_count = 1`
- `submitted -> retracted`: 1回だけ撤回。`retraction_used = true`
- `retracted -> submitted`: 1回だけ再送信。`submission_count = 2`

拒否する状態遷移。

- `submitted -> submitted`
- `empty -> retracted`
- `retracted -> retracted`
- 再送信後の再撤回
- 再送信後の再再送信
- Day / Voting / Execution 中の submit / retract

Day 中に前夜の相談を読む処理は書き込み transaction ではない。
Next.js API が viewer の WerewolfRole eligibility と現在 phase を確認し、
前夜分だけを読み取り専用 view として返す。

### API-Only Phase Resolution

game read / write API の入口で、必ず現在 phase が進められるか確認する。

進める条件。

- first night で全 Player が ready
- first night の `phase_ends_at <= now`
- ready check day で全生存 Player が ready
- ready check day の `phase_ends_at <= now`
- ordered speech の current slot が ended
- ordered speech の current slot scheduled end reached
- voting で全生存 Player が投票済み
- voting の `phase_ends_at <= now`
- execution last words が ended
- execution の `phase_ends_at <= now`
- normal night の `phase_ends_at <= now`

normal night は、全 action が揃っても時間切れまで進めない。
早く進めると、行動可能 Role の存在が推測されるため。

phase resolution transaction で行うこと。

- pending action を resolver に渡す
- 未提出 Role action には owner Role の `onMissingAction` を呼ぶ
- effect candidates を集める
- effect layer / priority / tag で解決する
- game player state を更新する
- `game_events` を追加する
- current actions を削除する
- pending actions を削除する
- 終了判定を実行する
- game が続く場合は次 phase を作る
- game が終わる場合は final outcome と player results を固定する
- `game_states.revision` を増やす

次 phase 作成で行うこと。

- 新しい `phase_instance_id` を発行する
- day / night number を更新する
- `phase_started_at` と `phase_ends_at` を設定する
- phase-local state を初期化する
- 必要な current actions を作る
- `phase_changed` event を記録する

### Game End

同じ transaction で行う。

- end candidates を集める
- resolved role setup の winner judgements を priority 順に評価する
- winner team を1つに決める
- PlayerResult を評価する
- `final_outcomes` を作成する
- `player_results` を作成する
- `game_events.game_ended` を記録する
- `game_states.status = ended` にする
- `rooms.status = ended` にする
- `rooms.ended_at` を設定する

final outcome と player results は一度だけ固定する。
表示のたびに再計算しない。

## Secret Data And Views

Browser に送った情報は、DevTools、通信キャプチャ、localStorage、JS runtime から
見られる前提にする。

### Public Game View

含めてよいもの。

- public room code
- room status
- game status
- phase
- day number
- night number
- phase timer
- Player IDs
- Player display names
- Player alive / dead state
- public game events
- execution target
- vote resolved result の公開可能部分

含めないもの。

- Account ID
- role assignment
- 他人の role
- night action target
- inspection result
- attack target
- voting 中の vote detail
- werewolf consultation
- internal event
- token
- token hash
- service role key

### Self Private Game View

対象 Player 本人にだけ返す。

含めてよいもの。

- 自分の role
- 自分の current action
- 自分の submitted pending action
- 自分宛ての private event
- 自分宛ての inspection result
- 自分が購読できる private realtime topic

含めないもの。

- 他人の role
- 他人宛て private event
- 自分が所属しない role private information
- internal event

### Role Private Game View

特定 Role を持つ Player group にだけ返す。

v1 の代表例。

- WerewolfRole の Player 向け人狼相談
- WerewolfRole の Player 向け role group action state

ルール。

- `Team.Werewolf` だけで閲覧対象を決めない
- WerewolfRole を持つ Player だけを対象にする
- 狂人は人狼側 Team でも WerewolfRole ではないため対象外
- Day 中は前夜の相談を読み取り専用で見せられる
- Voting 以降は前夜の相談を private view から消す

### Internal State

server / DB 内部だけが持つ。

- complete event payload
- internal event
- complete vote records when public setting is `count_only`
- initial inspection target random record
- role resolution audit data
- hidden action target
- attack target
- consultation raw values

## Realtime Notification

Realtime の目的は「変わったので読み直して」と伝えること。

payload に入れてよいもの。

- notification reason
- safe room identifier
- event time
- scope

payload に入れないもの。

- complete room state
- complete game state
- Account ID
- token
- token hash
- role assignment
- night action target
- vote detail
- inspection result
- werewolf consultation
- service role key

代表的な notification reason。

- `player_joined`
- `player_left`
- `player_disconnected`
- `player_reconnected`
- `game_started`
- `room_disbanded`
- `room_ended`
- `phase_changed`
- `action_window_changed`
- `private_view_changed`
- `player_died`
- `vote_resolved`
- `game_ended`

秘密情報が変わった場合でも、Realtime payload には秘密情報を入れない。
対象 Player には `private_view_changed` だけを送り、Next.js API から private view を
読み直させる。

## Constraints And Indexes

### Required Constraints

基盤。

- `account_tokens.token_hash` unique
- active `rooms.public_room_code` unique
- `players.room_id + players.account_id` unique
- `players.room_id + players.public_player_id` unique
- `rooms.status` known value check
- `players.status` known value check

ゲーム。

- `game_rule_sets.room_id` unique
- `game_states.room_id` unique
- `role_assignments.room_id + player_id` unique
- `game_player_states.room_id + player_id` unique
- `current_actions.room_id + action_key` unique
- `pending_actions.current_action_id` unique
- `game_event_visible_players.game_event_id + player_id` unique
- `game_event_visible_roles.game_event_id + role_id` unique
- `werewolf_consultation_slots.room_id + night_number + sender_player_id + template_id` unique
- `day_speech_slots.room_id + phase_instance_id + slot_index` unique
- `final_outcomes.room_id` unique
- `player_results.room_id + player_id` unique
- `realtime_topics.topic` unique
- `realtime_grants.grant_id` unique

Status / enum-like checks。

- game status is one of known values
- game phase is one of known values or null
- action kind is one of known values
- action scope is one of known values
- game event kind is one of known values
- game event visibility is one of known values
- death reason is one of known values or null
- winner team is one of known values
- consultation status is one of known values
- player result is one of known values
- realtime topic scope is one of known values
- realtime grant scope is one of known values

### Required Indexes

基盤。

- `rooms.public_room_code`
- `rooms.status + rooms.lobby_expires_at`
- `rooms.host_account_id`
- `players.room_id`
- `players.account_id`
- `room_events.room_id + room_events.created_at`

ゲーム。

- `game_states.room_id`
- `game_states.status + game_states.phase_ends_at`
- `role_assignments.room_id`
- `role_assignments.player_id`
- `game_player_states.room_id + alive`
- `current_actions.room_id + phase_instance_id`
- `current_actions.closes_at`
- `pending_actions.room_id + phase_instance_id`
- `game_events.room_id + created_at`
- `game_events.room_id + phase_instance_id`
- `game_event_visible_players.player_id + game_event_id`
- `game_event_visible_roles.role_id + game_event_id`
- `werewolf_consultation_slots.room_id + night_number`
- `werewolf_consultation_slots.sender_player_id`
- `day_speech_slots.room_id + phase_instance_id`
- `realtime_grants.grant_id + expires_at`
- `realtime_grants.topic + expires_at`

Partial index 候補。

- active room code: `rooms.public_room_code` where status in `lobby`, `playing`
- open current actions: `current_actions.room_id` where `closes_at is not null`
- active realtime grants: `realtime_grants.grant_id` where `revoked_at is null`

JSONB index は初期設計では必須にしない。
検索要件が出た場合だけ、対象 payload と query pattern を決めて追加する。

## Cleanup And Retention

Room / Player / Room event / Game event は通常動作で物理削除しない。

Account / token cleanup。

- active Room に紐づく Player を持つ Account は cleanup しない
- active Room に紐づく Player を持つ Account の token は revoke しない
- active Room に紐づく Player を持たない Account は cleanup 対象にできる
- Account が cleanup されても Player display name snapshot は残す
- Account の物理削除が履歴や FK を壊す場合は soft delete にする

Game cleanup。

- ended / disbanded Room の履歴は保持する
- current action / pending action は active game の現在値なので、解決後に削除する
- event history、final outcome、player results は保持する
- Realtime grant は期限切れ後に削除してよい

## Implementation Order

推奨順。

1. Account / token / Room / Player / Room event を作る
2. Room create / join / leave / lobby expiration を transaction 化する
3. Realtime topic / grant の通知基盤を作る
4. Game RuleSet と game start transaction を作る
5. `game_states`, `role_assignments`, `game_player_states` を作る
6. `current_actions`, `pending_actions`, `game_events` を作る
7. API-only phase resolution を作る
8. werewolf consultation と ordered speech slot を作る
9. final outcome / player results を固定する
10. public / self private / role private view を作る

## Validation Checklist

設計が満たすべきこと。

- Account ID を Browser へ返さない
- Player ID で認可しない
- raw token を DB に保存しない
- service role key を Browser に渡さない
- Role assignment を public view に含めない
- night action target を public view に含めない
- inspection result を対象外 Player に返さない
- attack target を public view に含めない
- voting 中の vote detail を public view に含めない
- `count_only` vote result で voter-to-target を公開しない
- werewolf consultation を WerewolfRole 以外に返さない
- Realtime payload に秘密情報を含めない
- Role definition logic を DB に置かない
- current action は受付枠だけを表す
- pending action は未解決提出だけを表す
- resolved action は event history に残す
- phase transition は `phase_instance_id` を更新する
- stale phase request を拒否する
- first-submit-wins を DB constraint と transaction で守る
- normal night は action が揃っても時間切れまで進めない
- final outcome は game end 時に一度だけ固定する
- player result は final outcome 後に固定する
