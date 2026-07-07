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
必要な役職が出てきたら、VoteResolver に拡張点を追加する。

## Design Invariants

このゲーム設計で守ること。

- Role は役職ごとの差分を持つ
- Role は直接 game state を変更しない
- Game Engine だけが state mutation を確定する
- GameState の現在値と GameEvent history をゲーム内状態の正として扱う
- role-local state を正の状態として分散保存しない
- RuleSet option はゲーム開始後に固定する
- 終了判定と結果判定を分ける
- 終了判定は副作用を持たない
- winner Team は final outcome ごとに1つだけにする
- winner judgement は setup contribution としてゲーム開始時に固定する
- winner judgement は priority の小さい順に評価する
- PlayerResult は最終 state 固定後に評価する
- Account ID をゲームロジックに出さない
- Player ID をゲーム内の主体として使う
- phase は `night`、`day`、`voting`、`execution` のユーザー表示用状態に限定する
- Role assignment と result は phase ではなく game status と final outcome で扱う
- First night は user-visible phase として `night` を使う
- First night は `nightNumber === 1` で通常夜と区別する
- Day の会議方式は phase ではなく RuleSet option と DayState で扱う
- ready check の最大会議時間は Day 開始時点の生存人数 x 90秒にする
- ordered speech の発言時間はデフォルト90秒にする
- ordered speech の早期終了は現在の発言者だけが実行できる
- execution の遺言は処刑候補だけが早期終了できる
- 初日襲撃は固定で発生させない
- First night は全 Player の開始準備完了、または30秒経過で Day に進む
- 初日白判定確定占いはデフォルトありにする
- Normal night は action が早く揃っても固定時間が終わるまで進めない
- 会話内容そのものは core game state に含めない
- current action は現在受け付けている action の枠だけを表す
- current action は提出内容や解決結果を持たない
- current action は該当 timing の解決後に GameState から削除する
- pending action は提出済みで未解決の action だけを表す
- pending action は該当 timing の解決後に GameState から削除する
- 夜会話は game action ではなく、進行や判定に影響しない
- 夜会話 message は append-only として扱う
- 夜会話 message は1件100文字以内にする
- resolved role setup はゲーム開始時に採用中 Role と core rule から作る
- winner judgement は resolved role setup の一部として固定する
- 夜会話 group は resolved role setup の一部として固定する
- 採用されていない Role の夜会話 group は表示しない
- 夜会話は group に含まれる Role を持つ Player だけに見せる
- v1 の Werewolf night conversation は実際に WerewolfRole を持つ Player だけに見せる
- 夜会話は Night 中だけ送信できる
- Night 以外では夜会話を読み取り専用で参照できる
- 秘密情報を公開 room state や realtime message に入れない
- browser に送る game state は必ず view として切り出す
- RuleSet はゲーム開始後に固定する
- 同じ current action では最初に受理した有効 pending action だけを state に反映する
- action 提出権限は Role が提供する action から判定し、`Role.team` だけでは判定しない
- final outcome はゲーム終了時に一度だけ state に固定する
- `Team.Fox` は v1 では妖狐1人の独自陣営として扱う
- 妖狐1人制約は FoxRole の `maxCount = 1` で表す

## Test Scenarios

確認すべきこと。

- Role constraints が不正な役職組み合わせを拒否する
- 必須役職がない RuleSet は開始できない
- 役職数が Player 数を超える RuleSet は開始できない
- Role は占いでの見え方を変えられる
- Role は襲撃への反応を変えられる
- 人狼 Role は基本終了判定を返せる
- 人狼以外の Role は現時点では終了判定を追加しない
- 人狼の襲撃は `WerewolfRole` を持つ Player group の action として1つだけ解決される
- 同じ current action の二重送信は最初の有効 pending action だけが受理される
- 解決済み timing の current action と pending action は GameState に残らない
- 無効な pending action は current action を完了させない
- Role 由来 action が未提出の場合、owner Role の `onMissingAction` が呼ばれる
- default の `onMissingAction` は追加 effect を返さない
- `Team.Werewolf` の Role でも、襲撃 action を提供しない Role は襲撃を提出できない
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
- First night は全 Player の開始準備完了、または30秒経過で Day に進む
- Playing 中の phase は night、day、voting、execution のいずれかになる
- Day は ready check と ordered speech のどちらかで進行できる
- ready check day は全生存 Player の ready action で Voting に進む
- ready check day は最大で Day 開始時点の生存人数 x 90秒で Voting に進む
- ordered speech day はランダム開始位置の発言順を一度だけ作る
- ordered speech day は最初の Day だけ2周し、それ以降は1周する
- ordered speech day の発言時間はデフォルト90秒になる
- ordered speech day は現在の発言者だけが自分の slot を早期終了できる
- 発言終了 action の二重送信は最初の有効 action だけが受理される
- Voting は30秒経過、または全生存 Player の投票完了で解決される
- Execution は処刑候補がいる場合だけ発生し、遺言時間は60秒になる
- Execution の遺言は処刑候補だけが早期終了できる
- Execution の遺言が早期終了されたら、60秒を待たずに処刑 effect 解決へ進む
- Normal night は180秒固定で、全 action が揃っても短縮しない
- First night では襲撃 action が出ない
- First night でも Werewolf night conversation は表示できる
- Night 中は group member が夜会話 message を送信できる
- Night 以外では夜会話を読み取り専用で参照できる
- 初日白判定確定占いは、占い結果 `human` になる生存 Player からランダムに選ばれる
- 初日白判定確定占いの対象候補から占い師本人は除外される
- 初日白判定確定占いが有効なのに白判定候補が存在しない RuleSet は開始できない
- 初日白判定確定占いの対象は public view に出ない
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
- `Team.Fox` の winner judgement は、FoxRole を持つ1人の生存を見て成立する
- PlayerResult は最終 state 固定後にだけ評価される
- final outcome はゲーム終了時に固定され、表示のたびに再計算されない
- GameEvent history から前回行動や使用済み能力を判定できる
- DeathReason によって処刑死、襲撃死、反撃死を区別できる
- Protection は tag が一致する effect だけを防ぐ
- 狩人の連続護衛可否は RuleSet option で切り替えられる
- Role hook は永続 state を直接変更しない
- private event は宛先 Player または宛先 faction だけに見える
- 秘密情報は公開 room state や realtime message に出ない
