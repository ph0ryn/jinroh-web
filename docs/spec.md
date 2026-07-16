# Jinroh Web 仕様

## 目的

Jinroh Web は、対面または音声通話で人狼を遊ぶための Web
アプリケーションである。

このアプリは、卓上での会話、音声チャット、人間同士の議論を置き換えることを
目的としない。手作業では面倒だったり間違いやすかったりする共有ゲーム状態を
管理することが役割である。

Phase 1 のマイルストーンでは、匿名の待機 Room 基盤から実ゲームの結果表示までを
一通り遊べる状態にする。

- 匿名参加
- ブラウザ単位で同じ identity に戻ること
- ルーム作成
- 短いコードによるルーム参加
- ルーム内のプレイヤー管理
- ホスト権限
- roster ごとの lobby readiness
- ルーム状態のリアルタイム更新
- 開始されなかったルームのクリーンアップ
- 同じ Room での複数 Game の再プレイ
- 役職割り当て
- First night / Night / Day / Voting / Execution / Result の進行
- Werewolf / Villager / Madman / Seer / Guard / Spiritist / Hunter / Fox を
  開始時に選択できる役職
- 夜 action、投票、処刑、勝敗判定
- role-private night conversation
- 秘密情報を切り出した public / self private / role private view

## Phase 1 の境界

この章に含めるのは、0から実ゲームが最後まで動くための製品基盤である。

含めるもの:

- 匿名のブラウザ identity を作成する
- リロード後に同じ identity に戻る
- ルーム参加前に表示名を編集する
- ルームを作成する
- ルームコードでルームに参加する
- 同じプレイヤーとして同じルームに再参加する
- ルーム状態とプレイヤー一覧を表示する
- ルームホストを識別する
- ホストとしてルームを開始する
- 全参加者が準備完了した場合だけゲームを開始する
- 完了した Game の結果を見ながら次の Game の準備をする
- 新しい参加者が入ったら完了 Game を current view から外して clean lobby に戻す
- ルームから退出する
- 期限切れの待機 Room を閉鎖する
- ルーム状態が変わったときにルームメンバーへ通知する
- RuleSet を固定し、役職を割り当てる
- game state、phase instance history、role assignment、player state、current action、
  pending action、normalized resolved action history、event history を DB に保存する
- First night から Result まで phase を進行する
- 役職ごとの夜 action と core action を受け付ける
- stale `phaseInstanceId` / `revision` の送信を拒否する
- current action への二重送信を first-submit-wins として扱う
- 人狼などの対象 role group だけが見られる night conversation を表示する
- night conversation は Night 中だけ送信でき、Night 以外では read-only にする
- browser-facing view を public / self private / role private に分離する

含めないもの:

- 一般公開チャット
- ダイレクトメッセージ
- 登録ユーザーアカウント
- メールログイン
- OAuth ログイン
- フレンド機能
- 課金
- モデレーションツール
- 管理画面

## システム構成

アプリは 3 層で構成する。

```text
Browser
  UI を表示する
  匿名アカウントトークンをローカルに保存する
  ユーザー操作をアプリケーションサーバーへ送信する
  ルーム変更通知を購読する

Application server
  Next.js on Vercel として動作する
  ページを配信する
  HTTP API を提供する
  アカウントトークンを認証する
  権限を確認する
  永続状態を読み書きする
  状態変更後にリアルタイム通知を送信する

Database and realtime service
  永続状態を保存する
  ルーム履歴を記録する
  ルーム変更通知を配送する
  期限切れルームのクリーンアップを実行または補助する
```

Application server は Next.js アプリケーションとして実装し、Vercel に deploy する。
Browser 向け UI と HTTP API は同じ Next.js プロジェクトに置く。

HTTP API は Next.js の server-side runtime で動作し、Account token 認証、
Room / Player の認可、transaction RPC による書き込みと単一 snapshot RPC による読み取りを
担当する。
Browser から Supabase の base table を直接読ませない。
単一 snapshot RPC が返すのは service-role application server 専用の runtime
aggregate であり、browser-facing view ではない。Application server は認証済み
Account に応じて public / self private / role private view へ投影し、raw snapshot をそのまま
Browser に返さない。

データベースを信頼できる唯一の情報源とする。

リアルタイムメッセージは、何かが変わったことを知らせる通知にすぎない。
クライアントは通知を受け取った後、アプリケーションサーバーから最新の
ルーム状態を読み込むべきである。

## Identity モデル

### Account

Account は、ブラウザに紐づく匿名 identity である。

これは登録ユーザーアカウントではない。メールアドレス、パスワード、OAuth
プロバイダー、公開プロフィールは持たない。

ルール:

- アプリは必要になったときに Account を自動作成する。
- Account はアカウントトークンを通じて、リロード後に戻ってこられる。
- Account は同時に最大 1 つの Room だけを現在の Room として持つ。
- 現在の Room は DB の active membership、すなわち `players.left_at is null` を正本とし、
  Browser の保存値や一時的な切断状態から推測しない。
- `disconnected` でも現在の Room を維持する。
- 完了した Game を current view に持つ `ended` Room は、明示的に退出するまで現在の
  Room として維持する。
- `closed` Room は Account の現在の Room から解除する。
- 内部 Account ID はサーバー専用である。
- Account ID は表示しない。
- Account ID はブラウザへ返さない。
- ブラウザが自分の Account を選べてはいけない。
- Account は表示名や公開プロフィールを持たない。

### Account Token

アカウントトークンは、匿名 Account の bearer credential である。

ルール:

- 生のトークンはブラウザが保存する。
- 生のトークンは認証情報としてのみ送信する。
- データベースにはトークンのハッシュだけを保存する。
- 生のトークンはデータベースに保存しない。
- トークンを URL に含めない。
- トークンをログに出力しない。
- トークンは application server が CSPRNG で生成する。
- トークンは 256 bit 以上の entropy を持つ。
- トークンは `Authorization: Bearer <token>` で送信する。
- トークンの hash は server-only secret を使って計算する。
- server-only secret は `ACCOUNT_TOKEN_HASH_SECRET` 環境変数から読み込む。
- `ACCOUNT_TOKEN_HASH_SECRET` の値は、32 bytes の HMAC key を standard base64
  で表した文字列である。
- application server は `ACCOUNT_TOKEN_HASH_SECRET` を base64 decode して
  HMAC key bytes として使う。
- `ACCOUNT_TOKEN_HASH_SECRET` が未設定、空文字、不正な base64、または
  decode 後 32 bytes でない場合、application server は起動しない。
- 無効化されたトークンは認証に使えない。
- 使用中の Room へ戻る必要がある Account のトークンは無効化してはならない。

トークンは Account 認証全般に使う。これは単なる「再開」トークンではない。

Account token が守るべき中心は、長期アカウント維持ではなく、使用中の Room に
同じ Player として戻れることである。参加中の active Room がない Account が後から
復元できなくなっても、ユーザー視点では新しい匿名 Account が作られるだけでよい。

### Abuse Rate Limits

Identity 発行、Room 作成、Room 参加、Room switch、非メンバーによる Room 参照には、
全 application server instance で共有される database-backed token bucket を適用する。
各 bucket の `refill` は記載時間で capacity 全体を回復する意味である。

| 対象                 | Subject                      | Burst capacity / full refill | Sustained capacity / full refill |
| -------------------- | ---------------------------- | ---------------------------- | -------------------------------- |
| Identity 発行        | client network               | 15 / 30 分                   | 50 / 24 時間                     |
| Room mutation 共通   | Account                      | 8 / 10 分                    | 24 / 24 時間                     |
| Room mutation 共通   | client network               | 32 / 60 秒                   | 120 / 24 時間                    |
| Room 作成            | Account                      | 3 / 30 分                    | 8 / 24 時間                      |
| Room 作成            | client network               | 8 / 5 分                     | 30 / 24 時間                     |
| Room 参加            | Account                      | 6 / 2 分                     | 20 / 24 時間                     |
| Room 参加            | client network               | 24 / 30 秒                   | 100 / 24 時間                    |
| Room 参加            | client network + target Room | 12 / 60 秒                   | なし                             |
| Room 参加            | target Room 全体             | 12 / 60 秒                   | なし                             |
| 非メンバー Room 参照 | Account                      | 6 / 10 分                    | 30 / 24 時間                     |
| 非メンバー Room 参照 | client network               | 30 / 10 分                   | 100 / 24 時間                    |

ルール:

- 複数bucketは同一database timestampで原子的に判定し、全bucketが許可した場合だけ
  tokenを消費する。
- Room mutationのclient network bucketは認証より前に消費する。無効Token、不正body、
  存在しないRoom、domain conflictもattemptとして数える。
- Room switchは`kind`に応じて直接のRoom作成または参加と同じbucketを消費する。
- 10人が同じNATから1つのRoomを作成・参加する通常フローを許可する。
- active memberの4秒pollはRoom参照quotaを消費しない。cheapなRoom存在・active
  membership分類をfull snapshotより先に行い、非メンバーと未存在codeはlookup
  quotaが許可されるまでsnapshot・phase resolve・expiration処理へ進めない。
- lookup分類とsnapshotの間にmembershipが変化した場合、そのrequestでは分類時の
  quota判定を採用し、次のrequestから新しいmembershipを反映する。
- quota超過は`429`と正の`Retry-After`を返す。limiter storeを利用できない場合は
  protected operationを実行せず`503`を返す。
- raw IPをDBへ保存しない。application serverでdomain-separated HMAC keyへ変換する。
- IPv4はcanonical `/32`、IPv6はcanonical `/64`をclient network subjectとする。
  IPv4-mapped IPv6はunderlying IPv4の`/32`へ正規化する。
- Vercel本番ではplatformが提供する単一値の`x-vercel-forwarded-for`だけをclient IP
  headerとして使用する。欠落、複数値または不正値ではfail closedする。
- 非Vercelのdevelopmentと通常testではapplication rate limitを無効化する。専用の
  rate-limit integration testは`VERCEL=1`で本番経路を検証する。
- application rate limitはWAF、bot management、request-size limit、DDoS protectionの
  代替ではない。

### Display Name

表示名は、Account の属性ではなく、ブラウザに保存する入力補助と
Room 内 Player の snapshot に分ける。

ルール:

- ブラウザは次回入力用の表示名 preference を local storage に保存してよい。
- 保存済み preference がない場合、ブラウザは暗号学的乱数を使って1,024通りの中立な
  default nameから偏りなく1つ選び、そのブラウザのpreferenceとして保存する。
- 表示名 preference は認証情報ではない。
- 表示名 preference は Account の source of truth ではない。
- Account が消えて新しい匿名 Account になっても、local storage の表示名
  preference は残ってよい。
- Room 作成または参加時、ブラウザは現在の表示名 preference を server に送る。
- 表示名は1〜8文字のASCII英数字とし、半角スペースは単語の間に1個だけ許可する。
- Server は表示名を検証し、新しい Player を作成するときだけ Player の表示名として
  snapshot する。
- 同じ Account が同じ Room に再参加する場合、既存 Player の表示名を再利用する。
- 後から local storage の表示名 preference を変更しても、すでに参加済みの Room
  にある既存 Player の名前は変わらない。
- 表示名はユーザー入力であり、HTML として描画してはならない。

## Room モデル

### Room

Room は、同じ参加コードと membership で複数回の人狼ゲームを行える場所である。
1回のプレイは Room とは別の Game として保存する。

ルール:

- Room は保存用の内部 ID を持つ。
- Room は参加用の短い公開コードを持つ。
- 公開コードは 6 桁の数字文字列である。
- Room は作成時に選ばれた目標参加人数を持つ。
- アクティブなルームコードは衝突してはならない。
- 公開コードは Room が閉鎖されるまで予約し、閉鎖後だけ再利用を許してもよい。
- Room は `waiting` 状態から始まる。
- `waiting` Room は、30 分以内に開始されなければ期限切れになる。
- Game 完了後は lobby 有効期限を30分後へ更新する。
- 期限切れの `waiting` または replay lobby は物理削除せず、`closed` にする。
- Room は nullable な `currentGameId` を持ち、Browser へ投影する Game を明示する。

Room の状態:

```text
waiting
playing
ended
closed
```

状態の意味:

- `waiting`: Room は開いていて、current Game を持たない clean lobby
- `playing`: current Game が進行中
- `ended`: Room は開いていて、current Game の結果を表示する replay lobby
- `closed`: Room は恒久的に閉鎖され、現在 Room や参加先にならない

`waiting` は `currentGameId = null`、`playing` と `ended` はそれぞれ同じ
current Game の status から導出する。Game 完了は Room 閉鎖ではない。

### Game

Game は Room 内の1回のプレイを表す履歴単位である。

- Game は Browser へ公開できるランダムな Game ID と Room 内 sequence を持つ。
- Game ごとに RuleSet、固定 roster、Role、alive state、phase、action、event、夜会話、
  winner、PlayerResult を保存する。
- 完了 Game は削除しない。
- current view と Engine input は必ず `Room.currentGameId` の Game だけから作る。
- 新しい Game の開始は別 Game row を作り、過去 Game を更新または再利用しない。

### Player

Player は、特定の Room 内に存在する Account である。

ルール:

- Room に参加すると、その Account に対応する Player がその Room 内に作られる。
- 同じ Account が同じ Room に再度参加する場合、同じ Player を再利用する。
- Player はクライアントに表示できる、Room 内だけで有効な ID を持つ。
- Player ID は秘密情報ではない。
- Player ID は権限の証明ではない。
- 権限チェックには、ブラウザから送られた Player ID ではなく、認証済みの
  Account を使わなければならない。
- Player は Room roster revision に対する lobby readiness を持つ。
- lobby readiness は Game 内の `first_night_ready` や `day_ready` action と別状態である。

Player の状態:

```text
joined
disconnected
left
```

状態の意味:

- `joined`: Room に接続中
- `disconnected`: Room との接続が一時的に途絶えている
- `left`: 意図的にルームから退出した

Player の `left_at` は Room 内の参加履歴と active membership を表し、
Account が現在どの Room に入室しているかの正本になる。
`disconnected_at` から導出する接続状態は一時的な通信状態だけを表し、membership を変更しない。
Player は現在の Room roster revision と自分の ready revision が一致する場合だけ
準備完了とする。join、再入室、leave、Game 完了は roster revision を増やし、以前の
準備完了をすべて無効化する。disconnect と reconnect だけでは無効化しない。

### Host

Room を作成した Account が最初のホストである。

ルール:

- ホスト権限は現在のホスト Account に属する。
- ホスト判定には認証済み Account を使う。
- ホスト表示にはホストの Player を使ってよい。
- 退出可能な Room でホストが退出した場合、残っている `joined` または `disconnected`
  Player のうち、参加日時、Player ID の順で先頭の Account にホストを移譲する。
- Room は最後の active Player が退出した場合にだけ `closed` になる。

## Room ライフサイクル

### 作成

Room が作成されるとき:

- 期限切れの current Room を先に `closed` にしたうえで、作成者 Account に現在の
  Room がないことを確認する
- 作成者 Account がホストになる
- Room は `waiting` で開始する
- Room の `currentGameId` は null で開始する
- Room roster revision を作成する
- ホスト Player が作成される
- 作成した Room を Account の現在の Room として保存する
- request された表示名は、ホスト Player の表示名として snapshot される
- request された目標参加人数は、Room の開始条件として snapshot される
- Room に 30 分後の lobby 有効期限が設定される
- Room に private なリアルタイムトピックが割り当てられる
- room-created event が記録される

### 参加

Account が Room に参加するとき:

- 公開コードで Room を探す
- まず参加元と参加先の `waiting` または replay lobby の期限切れ状態を確認する
- Account に現在の Room がなければ、参加先を現在の Room として保存する
- Account の現在の Room が参加先と同じ場合、既存の Player を再利用する
- Account の現在の Room が参加先と異なる場合、確認なしの参加を拒否する
- 新規 Player は Room の目標参加人数を超えて参加できない
- 新しい Player は current Game が playing でない間だけ参加できる
- current Game の既存 active Player は playing 中でも同じ Player として reconnect できる
- current completed Game roster にいない Player が membership を有効化する場合、同じ
  transaction で `currentGameId` を null にし、前 Game を current view から外す
- current completed Game roster にいた Player の再入室は結果 view を外さない
- effective join または再入室は roster revision を増やす
- 前 Game を外した clean lobby には Role、alive state、action、event、夜会話、winner、
  PlayerResult を一切含めない
- request された表示名は、新しい Player を作成するときだけ snapshot する
- room event が記録される
- 状態が変わったことをルームメンバーへ通知する

### 現在の Room と切り替え

要件:

- `LIVE-ROOM-001`: Account は同時に最大 1 つの現在の Room だけを持つ。
- `LIVE-ROOM-002`: `waiting`、`playing`、または完了した Game の `ended` Room は、
  明示的に退出するまで現在の Room であり続ける。Room が `closed` になった場合は
  現在の Room から解除する。
- `LIVE-ROOM-003`: `joined` と `disconnected` の切り替えは、現在の Room を
  変更しない。
- `LIVE-ROOM-004`: 同じ Room への再参加では既存 Player を再利用する。
- `LIVE-ROOM-005`: 別 Room の作成または参加は、現在の Room から退出することを
  明示的に確認するまで実行しない。
- `LIVE-ROOM-006`: `playing` 中は退出も Room の切り替えもできない。
- `LIVE-ROOM-007`: `waiting` または完了した Game の `ended` からの切り替えは、旧 Room の退出と
  新 Room の作成または参加を 1 transaction で行う。新 Room への操作が失敗した
  場合、旧 Room の所属を維持する。
- `LIVE-ROOM-008`: Browser は起動時および状態変更通知の受信後に、認証済み
  Account の現在の Room を application server から再取得する。
- `LIVE-ROOM-009`: 複数タブから同時に操作されても、DB は単一 Room 所属を
  保証し、各タブは同じ現在の Room へ収束する。
- `LIVE-ROOM-010`: Account ID、内部 Room ID、token、秘密情報は、現在の Room
  API、Realtime、タブ間通知の payload に含めない。

### 開始

Room が開始されるとき:

- ホスト Account だけが開始できる
- Room は `waiting` または current Game が完了した `ended` でなければならない
- Room は期限切れであってはならない
- active Player 数と joined Player 数は Room の目標参加人数と一致しなければならない
- disconnected Player がいてはならない
- ホストを含む全 active Player が現在の roster revision に対して準備完了していなければならない
- request の expected roster revision と Player roster は transaction 内の現在値と一致しなければならない
- 新しい Game ID と sequence を発行する
- Room は `playing` に変わる
- RuleSet と role assignment が固定される
- role assignment は application server の暗号学的に安全で偏りのない乱数を使い、
  Player の参加順に依存する偏りを持たない
- 開始 transaction が失敗した場合は role assignment を一切保存せず、再試行では現在の固定候補
  roster に対して新しい assignment を生成する
- Game が First night として開始する
- Room の `currentGameId` を新しい Game に差し替える
- game-started event が記録される
- 状態が変わったことをルームメンバーへ通知する

ゲームロジックの詳細設計は `docs/game/` 以下に分けて記録する。

### 準備完了

Player が lobby readiness を変更するとき:

- 認証済み Account に対応する active joined Player だけが自分の状態を変更できる
- current Game が playing の間は変更できない
- request は accepted snapshot の expected roster revision を持つ
- expected roster revision が現在値と違う場合は stale request として拒否する
- 同じ roster revision に対する複数 Player の準備操作は互いを conflict させない
- 同じ値への更新は idempotent に扱う
- readiness は availability を表し、ホストのローカル RuleSet 設定への承認とは扱わない

### 退出

Player が退出するとき:

- Room が `playing` の間は退出できない
- すでに `left` の Player は再度退出できない
- Player は left としてマークされる
- Account の現在の Room を解除する
- player-left event が記録される
- 状態が変わったことをルームメンバーへ通知する
- roster revision を増やして全 readiness を無効化する
- `waiting` または `ended` Room のホストが退出し、他の Player が残っている場合はホストを移譲する
- 最後の active Player が退出した場合は Room を `closed` にする
- completed current Game は残る Player がいる間は current result view として維持する

### 期限切れ

Room lobby の期限切れは、単なるバックグラウンドクリーンアップではなく、
正しさのモデルの一部である。

ルール:

- すべての Room 読み取りまたは Room 変更は、まず `waiting` または replay lobby が
  期限切れかどうかを確認するべきである
- 期限切れの `waiting` または replay lobby は `closed` になる
- `closed` Room を現在の Room とする Account の所属を解除する
- Room は永続ストレージに残る
- `room_closed` event が記録される
- スケジュールされたクリーンアップが存在しても、リクエスト時の期限切れ確認は
  なお必要である
- メンテナンス用 batch cleanup は、放置された期限切れの Room lobby を同じ
  `closed` 状態へ移すだけで、通常の読み書き時チェックを置き換えない

### 接続状態

Room を開いている Browser は heartbeat を送る。

- heartbeat は現在 Player の `last_seen_at` を更新する
- heartbeat が一定時間途絶えた `joined` Player は `disconnected` になる
- `disconnected` Player が再び heartbeat または join を行うと `joined` に戻る
- `left` Player は heartbeat で復帰せず、明示的な join を使う
- Player の接続状態は Account の現在の Room、生死、role assignment とは分ける
- disconnect と reconnect だけでは lobby readiness を無効化しない

## リアルタイムモデル

リアルタイム機能は、ルーム状態が変わったことをクライアントに伝えるためにある。

ルール:

- リアルタイムメッセージは信頼できる唯一の情報源ではない。
- メッセージは完全なルーム状態を含めるべきではない。
- メッセージは秘密情報を含めるべきではない。
- クライアントはメッセージ受信後にルーム状態を再読み込みするべきである。
- 公開ルームコードはリアルタイムトピックとして使わない。
- リアルタイムトピックは Room のために生成されたランダム値である。
- Room に参加済みの Account だけが必要なリアルタイム購読先を受け取る。
- Browser-facing realtime view は `subscriptions[]` として `room`,
  `player_private`, `role_private` scope の topic を返す。
- `player_private` と `role_private` topic は短命 grant と一緒に返す。
- `room` と `player_private` topic は Room に属し、`role_private` topic は1つの
  Game に属する。
- role-private authorization は grant、topic、Room の current Game、Game roster の
  Role がすべて同じ Game を指す場合だけ許可する。
- 夜会話などの secret view 更新は room topic へ通知せず、対象 group の
  private topic へ `private_view_changed` だけを送る。
- viewer が受け取る snapshot revision は Room の public revision と、その Player に
  永続する private revision から構成する。Game または Role が変わっても逆行せず、
  他 group の secret view 更新時刻を漏らさない。

代表的な通知理由:

```text
player_joined
player_rejoined
player_left
player_disconnected
player_reconnected
lobby_readiness_changed
lobby_reset
game_started
phase_changed
action_window_changed
private_view_changed
player_died
vote_resolved
room_closed
game_ended
```

## 永続データ

アプリケーションは、次の永続レコードを保存する。

- Accounts
- Account トークンハッシュ
- Rooms
- Players
- Room events
- Games
- Game-scoped RuleSet snapshot
- Fixed Game players, Role assignment, alive state, and final result
- Game phase instances
- Current actions
- Pending actions
- Resolved actions, including submitted and missing core and role-action resolutions
- Game events and visibility targets
- Night conversation messages
- Day speech slots
- Realtime topics and grants

データベースは Game を削除せず、`Room.currentGameId` から外れた Game も履歴として保持する。

Room、Player、event の物理削除は初期基盤の振る舞いに含めない。
期限切れまたは閉鎖済みの Room は状態で表現する。

## 公開ルーム状態

クライアントに表示するルーム状態には、次を含めてもよい。

- 公開ルームコード
- ルームステータス
- lobby 有効期限
- ホスト Player ID
- Player IDs
- Player 表示名
- Player ステータス
- Player ごとの lobby readiness
- current roster revision
- 現在の Account がホストかどうか
- リアルタイムトピック。ただし参加済み Account のみに返す
- 公開 game view
- active member に対して current Game が `ended` になった後に公開する、その Game roster の Role ID
- 自分だけが見てよい self private view
- 対象 role group だけが見てよい role private view

クライアントに表示するルーム状態には、次を含めてはならない。

- Account IDs
- ホスト Account ID
- 他プレイヤーの Account IDs
- アカウントトークン
- アカウントトークンハッシュ
- service role key
- current Game が `ended` になる前の他 Player の role assignment
- current completed Game を閲覧する active membership がない viewer に対する Role、event、result
- 夜 action の target
- 投票中の voter-to-target detail
- 対象外 Player の inspection result
- 対象外 role group の night conversation body

## UI モデル

Phase 1 には主に Home / Waiting room / Game board / Result の画面がある。

`/live` の Room 内表示は、Room status に対応する Waiting / Playing / Ended の
3 surface だけで構成する。Room を作成または参加する Entry surface は、Account が
現在の Room を持たないときの所属導線であり、Room lifecycle の状態には含めない。
3 surface は同じ円卓を常設し、現在の Player の席を常に画面下側へ配置する。

Waiting と Ended surface は active Player の readiness、招待、退出を表示する。
現在 Player は自分の ready / unready を切り替えられ、ホストの開始操作は定員、接続、
全員の readiness が揃うまで無効にする。Ended surface は current completed Game の結果を
保ったまま同じ roster の準備を受け付ける。新しい非ロスター Player の join が accepted
snapshot に現れた場合は Game-bound dialog、draft、toast、list addition、cinematic effect を
破棄し、Waiting surface を settled baseline として表示する。

`/live` は表示領域の向きと幅に応じて、次の 4 layout mode を使用する。

- Phone Portrait: 幅 599 px 以下の縦向き。円卓を上、操作領域を下に配置する
- Phone Landscape: 幅 959 px 以下かつ高さ 599 px 以下の横向き。円卓を左、
  操作領域を右に配置する
- Tablet Portrait: 幅 600 px 以上の縦向き。最大 720 px の円卓を上部中央、
  操作領域を下に配置する
- Tablet Landscape / Desktop: 上記以外。円卓を左、操作領域を右に配置する

円卓は固定の画面占有率ではなく、操作領域の最低寸法を確保した残りの表示領域に
収まる最大の正方形とする。最大寸法は 720 px とし、小さい画面では外側の余白を先に
縮め、Player 名、現在の Player の席、生死状態、公開後の役職を読める状態に保つ。

`/live` の page 全体は safe area 内の `100dvh` に収め、縦横とも page scroll を
発生させない。Room 内では現在 phase、timer、主要 action、円卓を常に表示領域内に
保つ。Waiting の招待詳細、Playing の private event、公開 log、Night conversation の
message list、Settings の設定本文など、明示した補助領域だけが内部 scroll を所有する。
個々の card に複数の scroll 領域を作らない。modal の header、主要 action を含む
footer、Night conversation の composer は scroll 領域の外へ固定する。

Waiting では着席進捗と開始条件を常に表示する。Portrait layout では着席進捗と招待情報を
同じ行へ等幅で配置し、Phone Landscape では招待情報を compact な 1 行へまとめる。両 mode
とも Room code、copy、share を常時表示し、QR code だけを招待 modal に表示する。
着席進捗は単一の progress bar で表現し、Settings action は Host 操作 panel 内に置く。
Tablet Landscape / Desktop では招待情報を操作領域内へ直接表示する。

画面端へ接する layout と dialog は `viewport-fit=cover`、safe-area inset、software
keyboard に追従する動的 viewport 高を考慮する。視覚要素を小さくする場合でも、button、
tab、icon button などの操作対象は原則として 44 px 四方以上の領域を確保する。

### ホーム画面

ホーム画面でユーザーができること:

- 匿名 Account を初期化または復元する
- local storage に保存された表示名 preference を見る
- 表示名 preference を変更する
- Room を作成する
- Room コードを入力する
- Room に参加する

### 待機画面

待機画面に表示するもの:

- 公開 Room コード
- Room コードの copy / share 導線
- Room ステータス
- lobby 有効期限
- Player 一覧
- ホスト表示
- 現在のユーザーがホストかどうか
- ホスト専用の開始アクション
- 退出アクション

### ゲーム画面

ゲーム画面に表示するもの:

- 現在 phase
- phase timer
- Player 一覧と生死状態
- public game event
- 自分の役職
- 自分が提出できる action
- 自分宛て private event
- 対象 role group だけが見られる role private view
- 投票、処刑、結果表示
- 結果表示で公開される全 Player の役職
- 待機、昼、投票、処刑、夜、結果の状態に合わせた背景、明るさ、雰囲気
- ゲーム開始時の自分の役職、phase 遷移、公開された死亡、勝敗確定を伝える
  transient effect

Player を対象にする action は独立した action panel や select を使わず、円卓上の
Player card から対象を選ぶ。既存の円卓中央表示は persistent state として残し、その上に
非 modal の action guide を重ねる。guide は action presentation 由来の指示を表示し、
server が返した `eligibleTargetIds` に含まれる card だけを輪郭と明度で強調する。
card の選択だけでは送信せず、action presentation 由来の確認文、共通の変更不可警告、
選び直しと確定 action を持つ確認 dialog を開く。送信中は dialog を閉じたり対象を
選び直したりできない。

同時に複数の open action がある場合は accepted snapshot の配列順で先頭の action だけを
操作可能にし、受理または終了後に次の action へ進む。対象を持たない action は同じ guide
内の単独 button から直接送信し、action panel は追加しない。共通 UI は action kind や
Role ID を判別せず、target kind、eligible target、presentation、private receipt だけを使う。

提出後も同じ phase の submitted action row と、その viewer だけが受け取る receipt の
`actionKey`、`kind`、`phaseInstanceId` が一致する場合は、action presentation 由来の
提出済み message を guide に表示する。共有 action が別 Player に提出されたことだけを
本人の成功として表示しない。提出後の accepted snapshot ですでに action row が消え、
phase が進んだ場合は成功表示を挟まず、次の transient effect に引き渡す。

interruptive transient effect の mounted lifetime 中は action guide を隠し、Player card の
action 操作も明示的に無効にする。表示順は円卓中央表示、action guide、Player card、
確認 dialog、interruptive transient effect とする。guide 自体は Player card の pointer 操作を
遮らない。

transient effect は受理済みの最新 Room state と公開 event history から導出し、
役職、現在 phase、timer、生死、勝敗などの persistent state 表示を置き換えない。
複数の更新をまとめて受理した場合、phase effect は過去の章を順番に再生せず、
最新 state と一致する phase だけを表示する。死亡と勝敗の通知は省略しない。
自分の役職は初回演出後も明示的な再確認操作から表示できる。
OS の reduced motion 設定では、移動、回転、拡散を使わず短い静止表示で同じ情報を
伝える。

Night conversation は role private view の一部である。
対象 Role を持つ Player だけが開ける。
Night 中は送信でき、Night 以外では read-only として参照できる。

画面はルーム変更通知を購読し、通知を受け取った後にルーム状態を
Next.js API から再読み込みする。

## セキュリティ不変条件

次のルールはアプリケーション全体で維持しなければならない。

- ブラウザからの Account IDs を信頼しない
- Account IDs をユーザー入力として受け取らない
- Account IDs をブラウザへ返さない
- Player ID で操作を認可しない
- 認証済み Account を通じて操作を認可する
- データベースにはアカウントトークンハッシュだけを保存する
- 生のアカウントトークンをデータベースに保存しない
- トークンを URL に含めない
- トークンや Authorization ヘッダーをログに出力しない
- サーバー専用のデータベース認証情報をブラウザコードに公開しない
- service-role snapshot RPC が返す raw runtime aggregate を Browser に返さない
- リアルタイムメッセージに秘密情報を含めない
- 表示名を HTML として描画しない
- Browser は Next.js API だけで状態取得・操作する
- Browser から Supabase base table を直接読ませない
- current Game が `ended` になる前は、role assignment を public game view に含めない
- current completed Game の active member でない viewer へ result Game を投影しない
- Game mutation は Room code だけでなく current Game ID を照合する
- night action target を public game view に含めない
- voting 中の voter-to-target detail を public game view に含めない
- inspection result を対象外 Player に返さない
- night conversation body を対象外 Player や realtime payload に含めない

## デフォルトの決定事項

現在のデフォルト決定は次のとおりである。

- HTTP server と API は Next.js on Vercel で実装する。
- Room コードは 6 桁の数字文字列である。
- Account token は匿名 bearer credential の名前である。
- `waiting` Room のホスト退出時は、最初に参加した残存 Player へホストを移譲する。
- Room は最後の active Player が退出したときに `closed` になる。
- ゲーム中は退出できず、終了後は退出できる。
- 新しい Player は Game 中に参加できず、Game 完了後は参加できる。
- 既存の Player は Room 開始後に再参加してもよい。
- Game 開始にはホストを含む全 active Player の lobby readiness を必須にする。
- Game 完了後に新しい非ロスター Player が参加したら current Game pointer を外す。
- 同じ Room の各プレイは異なる Game ID で履歴保存する。
- game roster は開始時の Player、Role assignment、alive state で固定し、
  開始後の membership history から再計算しない。
- Player の表示名は Room 内で固定される。
- 表示名 preference は Account ではなく browser local storage に保存する。
- 同じ Account が同時に現在の Room として持てるのは 1 Room だけである。
- リアルタイムメッセージは状態変更の成功後に送信する。
- Realtime payload は invalidation 用の reason と safe room identifier だけを持つ。
- 初期対応人数は 3 から 10 人であり、Room 作成時に開始人数を選ぶ。
- 開始時に選択できる Role は Werewolf / Villager / Madman / Seer / Guard /
  Spiritist / Hunter / Fox である。
- RuleSet はゲーム開始時に固定する。
- First night は user-visible phase として `night` を使い、`nightNumber === 1`
  で通常夜と区別する。
- Normal night は action が揃っても固定時間が終わるまで進めない。
- Voting 中は投票 detail を public view に出さない。
- final outcome と player results はゲーム終了時に一度だけ固定する。
- Werewolf night conversation は人狼側の Team ID ではなく WerewolfRole の
  group membership で閲覧対象を決める。
- スケジュールされたクリーンアップが存在しても、リクエスト時の lobby 期限切れ
  確認は必要である。
