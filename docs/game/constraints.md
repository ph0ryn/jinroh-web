# 拡張性と検証観点

## Extensibility Rules

新しい役職は、開発者が新しい `Role` class として追加する。

ユーザーは任意の役職ロジックを UI 上で作らない。

ユーザーが将来的に変更できる可能性があるもの。

- 採用する役職
- 各役職の人数
- 一部のゲームオプション
- 定義済み RuleSet の選択

ユーザーが変更できない前提のもの。

- 新しい役職の処理ロジック
- Role hook の実装
- 夜会話 group の任意ロジック
- 終了判定の実装
- PlayerResult 判定の実装

投票数を変更する役職や投票 weight modifier は、この設計段階では扱わない。
必要な役職が出てきたら、特定 role id の例外ではなく VoteResolver に generic
な拡張点を追加する。この原則は予期していない将来役職のすべてに適用する。

## Design Invariants

このゲーム設計で守ること。

- Role は役職ごとの差分を持つ
- Role は直接 game state を変更しない
- Game Engine だけが state mutation を確定する
- GameState の現在値、phase instance history、normalized resolved action
  history、GameEvent history をそれぞれの責務の正として扱う
- normalized resolved action history は owning phase instance と Day / Night counters
  を保持し、snapshot boundary で phase/counter consistency と chronological order を検証する
- role-local state を正の状態として分散保存しない
- RuleSet option はゲーム開始後に固定する
- 終了判定と結果判定を分ける
- 終了判定は副作用を持たない
- winner Team は final outcome ごとに1つだけにする
- winner judgement は setup contribution としてゲーム開始時に固定する
- winner judgement は priority の小さい順に評価する
- PlayerResult は最終 state 固定後に評価する
- game roster は開始時の Player から一度だけ固定し、Room membership history から
  後で再計算または補完しない
- Playing / Ended の全 game roster Player は、登録済み Role の assignment と alive
  state を1件ずつ持つ
- Ended の全 game roster Player は、固定済み final outcome に対応する PlayerResult
  を1件ずつ持つ
- assignment、alive state、PlayerResultの欠損や未知Roleをdefault値で補完しない
- Account ID をゲームロジックに出さない
- Player ID をゲーム内の主体として使う
- phase は `night`、`day`、`voting`、`execution` のユーザー表示用状態に限定する
- playing 中の Room は open な phase instance を必ず1つだけ持ち、
  current game state の phase、counter、開始時刻、deadline と複合 FK で一致させる
- Role assignment と result は phase ではなく game status と final outcome で扱う
- First night は user-visible phase として `night` を使う
- First night は `nightNumber === 1` で通常夜と区別する
- Day の会議方式は phase ではなく RuleSet option と DayState で扱う
- ready check の最大会議時間は Day 開始時点の生存人数 x
  `dayReadyCheckSecondsPerPlayer` にする
- ordered speech の発言時間はデフォルト90秒にする
- ordered speech の早期終了は現在の発言者だけが実行できる
- ordered speech の全周 plan は Day 開始時に一度だけ作り、同じ Day の action
  window が切り替わっても全 slot を次の phase instance へ引き継ぐ
- ordered speech は死亡した後続話者を plan から削除せず、次話者の選択時に skip する
- execution の遺言は処刑候補だけが早期終了できる
- 初日襲撃は固定で発生させない
- First night は全 Player の開始準備完了、または `firstNightSeconds` 経過で Day に進む
- 初日白判定確定占いはデフォルトありにする
- `onFirstNightStarted` は inspection result と public / private message だけを返す
  informational hook とし、causal effect を許可しない
- first night 開始時の causal behavior が必要になった場合は、generic persisted
  hook / action-window contract を追加する
- Normal night は action が早く揃っても固定時間が終わるまで進めない
- 会話内容そのものは core game state に含めない
- current action は現在受け付けている action の枠だけを表す
- current action は提出内容や解決結果を持たない
- current action は該当 timing の解決後に GameState から削除する
- `targetStateRequirement` は current action の materialization / submission policy
  とし、resolved action history へ複製しない
- `alive` target は materialization と submission の両方で生存を要求し、`assigned`
  target は fixed game roster の assignment だけを要求する
- pending action は提出済みで未解決の action だけを表す
- pending action は該当 timing の解決後に GameState から削除する
- 夜会話は game action ではなく、進行や判定に影響しない
- 夜会話 message は append-only として扱う
- 夜会話 message は1件100文字以内にする
- resolved role setup はゲーム開始時に採用中 Role から作る
- winner judgement は resolved role setup の `contributions` にだけ固定し、
  別の winner judgement field へ複製しない
- 夜会話 group は resolved role setup の一部として固定する
- 採用されていない Role の夜会話 group は表示しない
- 夜会話は group に含まれる Role を持つ Player だけに見せる
- v1 の Werewolf night conversation は実際に WerewolfRole を持つ Player だけに見せる
- 夜会話は Night 中だけ送信できる
- Night 以外では夜会話を読み取り専用で参照できる
- 秘密情報を公開 room state や realtime message に入れない
- browser に送る game state は必ず view として切り出す
- RuleSet はゲーム開始後に固定する
- game start transaction は core option と resolved role setup の exact shape を検証し、
  unknown field や不正な contribution を default で補完しない
- 同じ current action では最初に受理した有効 pending action だけを state に反映する
- action 提出権限は Role が提供する action から判定し、`Role.team` だけでは判定しない
- final outcome はゲーム終了時に一度だけ state に固定する
- end candidate の source Role、opaque reason、winner judgement id と評価は
  owning Role が所有する
- Team は Role が definition を提供して `RoleRegistry` に登録する opaque ID とし、
  winner judgement は登録済み Team だけを参照する
- winner judgement の identity は `(sourceRoleId, id)` とし、異なる Role に
  judgement ID の global uniqueness を要求しない
- Role 固有の `DeathReason` は opaque ID として owning Role に閉じ、common enum、
  persistence allowlist、view switch に列挙しない
- common engine、persistence、view adapter は role-owned reason や action kind を列挙しない
- generic `CurrentAction` effect が有効な follow-up を開いた場合、同じ user-visible
  phase で submitted / missing まで解決してから game end または core phase transition を行う
- ハンター固有の定義は `lib/server/game/roles/hunter.ts` にだけ置き、
  common code は同じ effect を持つ別 Role を例外なしで扱う
- FoxRole が提供する `"fox"` Team ID は v1 では妖狐1人の独自陣営として扱う
- 妖狐1人制約は FoxRole の `maxCount = 1` で表す

## Test Scenarios

確認すべきこと。

- Role constraints が不正な役職組み合わせを拒否する
- 必須役職がない RuleSet は開始できない
- 役職数が Player 数を超える RuleSet は開始できない
- Role は占いでの見え方を変えられる
- Role は襲撃への反応を変えられる
- 人狼 Role は基本終了判定を返せる
- 各 Role は自分の `sourceRoleId` と opaque reason を持つ終了候補を返せる
- Role には自分の `ownEndCandidates` だけが winner judgement と
  PlayerResult の評価時に渡される
- 人狼の襲撃は `WerewolfRole` を持つ Player group の action として1つだけ解決される
- 同じ current action の二重送信は最初の有効 pending action だけが受理される
- 解決済み timing の current action と pending action は GameState に残らない
- 無効な pending action は current action を完了させない
- Role 由来 action が未提出の場合、resolver Role の `onMissingAction` が呼ばれる
- default の `onMissingAction` は追加 effect を返さない
- 人狼側の Team ID を共有する Role でも、襲撃 action を提供しなければ襲撃を提出できない
- 採用中 Role の setup contribution はゲーム開始時に1回だけ解決される
- resolved role setup はゲーム中に再計算されない
- runtime hook は状態変化のタイミングで評価される
- 投票 action は Role ではなく core rule から提供される
- 投票できるのは生存 Player だけ
- 投票対象にできるのは生存 Player だけ
- 同票や有効票なしの場合は処刑が発生しない
- 投票結果の公開範囲は処刑対象の決定ロジックに影響しない
- 投票中は誰が誰へ投票したかを public view に出さない
- Role assignment と result は user-visible phase に含まれない
- First night は user-visible phase `night` として表示される
- First night は `nightNumber === 1` で通常夜と区別できる
- First night は全 Player の開始準備完了、または `firstNightSeconds` 経過で Day に進む
- Playing 中の phase は night、day、voting、execution のいずれかになる
- Room ごとに open な phase instance は最大1件で、current game state は
  その instance の phase、counter、開始時刻、deadline と一致する
- application server は phase duration 秒を渡し、DB transaction の時計から開始時刻と
  deadline を一緒に固定する
- Day は ready check と ordered speech のどちらかで進行できる
- ready check day は全生存 Player の ready action で Voting に進む
- ready check day は最大で Day 開始時点の生存人数 x
  `dayReadyCheckSecondsPerPlayer` で Voting に進む
- ordered speech day は固定 game roster の Player 順を保ち、暗号学的乱数で選んだ開始位置から
  cyclic rotation した発言順を一度だけ作る
- ordered speech day は最初の Day に `firstDaySpeechRounds`、それ以降は
  `normalDaySpeechRounds` を使う
- ordered speech day の発言時間はデフォルト90秒になる
- ordered speech day は現在の発言者だけが自分の slot を早期終了できる
- ordered speech day は同じ Day の action window 間で全 slot plan を維持する
- ordered speech day は死亡済みの後続 speaker を skip し、残る生存 speaker へ進む
- 発言終了 action の二重送信は最初の有効 action だけが受理される
- Voting は `votingSeconds` 経過、または全生存 Player の投票完了で解決される
- Execution は処刑候補がいる場合だけ発生し、遺言時間は
  `executionLastWordsSeconds` になる
- Execution の遺言は処刑候補だけが早期終了できる
- Execution の遺言が早期終了されたら、設定時間を待たずに処刑 effect 解決へ進む
- Normal night は `nightSeconds` で固定し、全 action が揃っても短縮しない
- First night では襲撃 action が出ない
- First night でも Werewolf night conversation は表示できる
- Night 中は group member が夜会話 message を送信できる
- Night 以外では夜会話を読み取り専用で参照できる
- 初日白判定確定占いは、占い結果 `human` になる生存 Player からランダムに選ばれる
- 初日白判定確定占いの対象候補から占い師本人は除外される
- 初日白判定確定占いが有効なのに白判定候補が存在しない RuleSet は開始できない
- 初日白判定確定占いの対象は public view に出ない
- `onFirstNightStarted` の causal effect は contract violation として拒否される
- Day の自由会話内容はアプリの責任外として扱う
- 人狼 Role の Player だけが Werewolf night conversation を閲覧できる
- 狂人、村人、public view、public realtime payload には夜会話が出ない
- 採用中 Role の夜会話 group だけが表示される
- 夜会話 message は sender、本文、timestamp を持つ
- 夜会話 message は1件100文字以内に制限される
- 夜会話はゲーム進行や判定に影響しない
- 終了判定は各 Player の結果を直接決めない
- winner judgement はゲーム終了後に winner Team を1つだけ決める
- 妖狐のような高 priority winner judgement は、成立した場合に他 Team の勝利を上書きできる
- FoxRole の `"fox"` Team winner judgement は、FoxRole を持つ1人の生存を見て成立する
- PlayerResult は最終 state 固定後にだけ評価される
- assignmentまたはalive stateが欠損した保存状態ではview表示とphase解決を失敗させる
- final outcomeのPlayerResultが欠損した場合は`lose`へ補完せず終了処理を失敗させる
- final outcome はゲーム終了時に固定され、表示のたびに再計算されない
- 完全な resolved action history から前回行動や使用済み能力を判定できる
- core / Role action の提出済み row と未提出で閉じた row がそれぞれ `submitted` と
  `missing` で normalized history に残る
- blocking follow-up は core phase transition と game end より先に解決される
- ordered speech と Voting は follow-up 後に normalized core-action history から
  current Day / Night counters の決定を復元できる
- `targetStateRequirement` の `alive` / `assigned` policy が materialization と提出時に
  一貫して検証され、resolved history の結果 field と混同されない
- 未知の synthetic Role と opaque action identifier が shared allowlist なしで
  action、persistence、snapshot、hook を end to end で通る
- core と Role-local の opaque `DeathReason` を shared enum なしで区別できる
- synthetic Role の opaque Team ID、DeathReason、同名 local judgement ID が shared
  allowlist なしで登録、解決、永続化、表示境界を通る
- Protection は tag が一致する effect だけを防ぐ
- Guard の連続護衛可否は RuleSet option で切り替えられ、直前の Night が
  `missing` ならそれより古い target を制限しない
- Role hook は永続 state を直接変更しない
- private event は宛先 Player または宛先 Role だけに見える
- 秘密情報は公開 room state や realtime message に出ない
- Realtime の受信 RLS は `authenticated` role と実際の JWT claim context で、
  valid / expired / revoked / cross-room / private scope を検証する
