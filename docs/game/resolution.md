# Effect Resolution と結果判定

## GameEffect

`GameEffect` は、Role hook や action 解決が返す「状態変更の候補」。

代表的な effect。

- death
- protection
- inspection result
- public message
- private message

Effect はそのまま確定状態ではない。

Engine が effect を集め、順序や衝突を処理してから state に反映する。

phase transition と game end は `GameEffect` に含めない。
これらは Engine の進行制御として扱う。
Role hook は phase 遷移やゲーム終了を直接 effect として発生させない。

Effect には layer、priority、tag を持たせる。

- layer は解決段階を表す
- priority は同じ layer 内の処理順を表す
- tag は protection や特殊効果が対象 effect を識別するために使う

Protection は、すべての death effect を無条件に打ち消さない。
Protection effect は `prevents` に含む tag と一致する effect だけを防ぐ。

例。

```text
人狼の襲撃
  tags:
    attack
    guardable

狩人の護衛
  prevents:
    guardable

処刑
  tags:
    execution
    unpreventable
```

この場合、狩人の護衛は襲撃 death effect を防げる。
処刑 death effect は `guardable` ではないので防がない。

## Effect Resolution

Hook の実行と effect の解決は分ける。

```text
1. Game Engine が関係する Role hook を呼ぶ
2. Role hook が GameEffect 候補を返す
3. Engine が GameEffect を layer / priority で並べる
4. Engine が衝突を解決する
5. Engine が最終的な state mutation を確定する
```

Hook の呼び出し順に依存して結果が変わる設計にはしない。

`Role` は「こういう effect を出したい」という候補だけを返す。
実際に effect を通すか、打ち消すか、まとめるかは Engine が決める。

例。

```text
protection effect
  layer: prevention

death effect
  layer: death
```

Engine は prevention layer を先に解決し、守られた Player への death effect を無効化できる。

同じ layer の中では priority の小さい順に解決する。
priority が同じ場合でも、Hook の呼び出し順で結果が変わらないように、Engine 側で安定した
並び順を使う。

この方針により、複数 Role の protection、attack、追加 effect が同時に出ても、
Role hook 同士が直接依存しなくて済む。

## Resolver And Hook Ownership

Engine は pending action を検証し、current action の `resolverRoleId` が指す Role へ
opaque な action kind をそのまま dispatch する。Role は `onActionResolved` または
`onMissingAction` で意味を解釈し、GameEffect 候補を返す。common engine は
role-owned action kind の `switch` を持たない。

current action は受付可否だけを表す。Role が回数制限や前回 target を必要とする場合は、
event payload ではなく Role context に射影された normalized resolved action history を読む。

基本対応。
vote、execution、ready / end speech は core action の例。inspect、attack、guard は
Role が所有する action kind の例であり、表の文字列は shared action universe ではない。
common に置けるのは generic capability / effect / resolution concept である。

| Example action      | Behavior owner | Role-side responsibility                                  |
| ------------------- | -------------- | --------------------------------------------------------- |
| inspect             | `SeerRole`     | 対象の `seenAs` と `onInspected` を使い結果 effect を返す |
| attack              | `WerewolfRole` | attacker group を決め、対象の `onAttacked` を呼ぶ         |
| guard               | `GuardRole`    | 護衛対象へ protection effect を返す                       |
| role action missing | resolver Role  | `onMissingAction` で未提出時の effect を返す              |
| vote / speech       | core resolver  | 明示された core phase primitive として解決する            |

inspect では、対象 Player の Role が `seenAs` で `human` / `werewolf` などの見え方を返す。
その後、対象 Role の `onInspected` を呼び、占われたことによる追加 effect を集める。

attack では、`WerewolfRole` 自身が `WerewolfRole` を持つ Player group を
attacker group として扱う。group action を送信した Player だけを attacker として扱わない。

guard は、現在の v1 では protection effect を作るだけにする。
護衛に反応する特殊役職が必要になった場合は、対象の role id 分岐ではなく、
将来の役職も使える generic hook を追加する。

vote は処刑候補を決めるだけで、処刑そのものは行わない。
execution は処刑候補がいる場合だけ実行し、`onExecuted` から返る death effect などを
通常の effect resolution に渡す。

effect resolution 後に必要な role-specific 反応は post-resolution hook で扱う。
代表例。

- `onExecutionResolved`:
  execution が解決されたあと、処刑という出来事に限定して反応する
- `onDeathResolved`:
  death reason を問わず、死亡が確定したあとに反応する
- `onActionResolved`:
  role 由来 action が解決されたあとに反応する

post-resolution hook が generic な `CurrentAction` effect を返した場合、有効な action
window は game end と core phase transition より先に解決する。Engine は同じ
user-visible phase を維持し、follow-up が submitted / missing になるまで進行を保留する。

role-specific な post-resolution 挙動は common engine の role id 分岐ではなく、Role
class の hook と generic resolver extension で表す。Hunter 固有の定義は
`lib/server/game/roles/hunter.ts` にだけ置く。

## End Condition

`End Condition` は、ゲームを終了するか継続するかを判定する。

これは「誰が勝ったか」ではない。

例。

```text
人狼 Role の終了判定
  生存人狼数 >= 生存非人狼数
    -> ゲーム終了候補

人狼 Role の終了判定
  生存人狼数 == 0
    -> ゲーム終了候補
```

終了判定は、状態変化後に実行する。

状態変化の例。

- 処刑が確定した
- 襲撃が確定した
- 夜 action が解決された
- phase が進んだ

終了判定は副作用を持たない。
終了判定は game state を直接変更せず、終了候補を返す。

各 Role が `checkEndCondition` を所有する。end candidate は owning Role 自身の
`sourceRoleId` と、その Role だけが意味を解釈する opaque な reason を持つ。
Engine は candidate の ownership を検証し、Role-defined reason を common enum、SQL
allowlist、view-adapter switch に追加しない。

複数 Role が end candidate を返せる。winner judgement と PlayerResult の評価時は、
candidate を `sourceRoleId` で分離し、各 Role には自分の `ownEndCandidates` だけを渡す。
candidate は勝者判定の semantic input であり、永続化する final outcome は確定済み
winner Team と PlayerResult を正本とする。

## Winner Judgement

`Winner Judgement` は、ゲーム終了後にどの Team が勝つかを判定する。

終了候補は複数あり得るが、勝者 Team は1つだけにする。
たとえば妖狐がいるゲームでは、村人側や人狼側の終了理由でゲームが止まったとしても、
妖狐が生存していれば FoxRole が提供する `"fox"` Team ID が勝つ。
この Team は、v1 では FoxRole を持つ1人だけの独自陣営として扱う。

Team は shared enum ではなく、Role が localized presentation と一緒に提供して
`RoleRegistry` に登録する opaque な文字列 ID。winner judgement は登録済み Team
だけを参照でき、common engine、persistence、UI は Team ID の全集合を列挙しない。

winner judgement は setup contribution としてゲーム開始時に固定する。
Engine は採用中 Role の contribution を `resolvedRoleSetup.contributions` へ固定する。
winner judgement の複製 field は持たない。
judgement の identity は `(sourceRoleId, id)`。同じ Role 内では重複を拒否するが、
異なる Role は同じ local ID を独立して使える。

winner judgement は priority を持つ。
ゲーム終了時、Engine は priority の小さい順に winner judgement を評価し、
最初に成立した judgement の `winnerTeam` を `finalOutcome.winnerTeam` にする。
一度 winner Team が決まったら、それより低い priority の judgement は評価しない。

例。

```text
priority 10
  FoxRole winner judgement
  妖狐が生存している
    -> winnerTeam = "fox"

priority 100
  WerewolfRole werewolf judgement
  WerewolfRole の ownEndCandidates に werewolf_dominance が含まれる
    -> winnerTeam = "werewolf"

priority 100
  WerewolfRole village judgement
  WerewolfRole の ownEndCandidates に werewolves_eliminated が含まれる
    -> winnerTeam = "village"
```

winner judgement は、ゲームを終了するかどうかを決めない。
ゲーム終了後の最終 state と owning Role の `ownEndCandidates` を見て、
勝者 Team だけを決める。judgement id、reason、評価ロジックは同じ Role module に閉じる。

## PlayerResult

`PlayerResult` は、ゲーム終了後に各 Player の結果を判定する。

これは「ゲームが終わるかどうか」とは別の処理。
また、「どの Team が勝ったか」とも別の処理。
PlayerResult は、`finalOutcome.winnerTeam` が決まった後に評価する。

例。

```text
終了理由
  人狼が生存非人狼数以上になった

結果判定
  人狼 Role の Player
    winnerTeam が "werewolf"
    win

  狂人 Role の Player
    winnerTeam が "werewolf"
    win

  村人 Role の Player
    winnerTeam が "werewolf"
    lose
```

狂人のような役職があるため、終了判定、winner Team 判定、PlayerResult 判定は分ける。

狂人は、終了判定上は非人狼として数えられることがある。
しかし、winner Team が人狼側の登録済み Team ID の場合は勝利に乗る。

PlayerResult は、最終 state が固定された後に実行する。

`Role.evaluateResult` が `null` を返した場合、Engine は標準の陣営ベース判定へ
fallback できる。

これにより、普通の村人のような役職は結果判定を個別に書かなくてよい。
