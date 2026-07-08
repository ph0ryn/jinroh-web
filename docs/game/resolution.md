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

この方針により、狩人の protection、人狼の attack、特殊役職の反撃などが同時に出ても、
Role hook 同士が直接依存しなくて済む。

## Resolver And Hook Matrix

Action resolver は pending action を検証し、必要な Role hook を呼び、GameEffect 候補を集める。
current action は受付可否だけを表すため、resolver は pending action と event history を読む。

基本対応。
この表は core action の代表例であり、役職追加時に必要な resolver extension を禁止するものではない。

| Action              | Resolver の責務                                         | 呼ぶ Role hook                           |
| ------------------- | ------------------------------------------------------- | ---------------------------------------- |
| inspect             | 対象の見え方を決め、占い結果 effect を作る              | target Role の `seenAs` と `onInspected` |
| attack              | 人狼 group の襲撃対象を確定し、襲撃反応 effect を集める | target Role の `onAttacked`              |
| guard               | 護衛対象への protection effect を作る                   | なし                                     |
| vote                | 有効票を集計し、処刑候補または no execution を返す      | なし                                     |
| execution           | 処刑候補への処刑反応 effect を集める                    | target Role の `onExecuted`              |
| ready / end speech  | current action を完了させ、必要なら phase を進める      | なし                                     |
| missing role action | 未提出の Role 由来 action を解決する                    | owner Role の `onMissingAction`          |

inspect では、対象 Player の Role が `seenAs` で `human` / `werewolf` などの見え方を返す。
その後、対象 Role の `onInspected` を呼び、占われたことによる追加 effect を集める。

attack では、`WerewolfRole` を持つ Player group を attacker group として扱う。
group action を送信した Player だけを attacker として扱わない。

guard は、現在の v1 では protection effect を作るだけにする。
護衛に反応する特殊役職が必要になった場合は、その時点で hook を追加する。

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

ハンターの反撃や霊媒師の処刑結果通知のような挙動は、common engine に role id 分岐を追加せず、
role class の hook と generic resolver extension で表す。

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

終了理由は enum として扱う。
現時点では、人狼 Role の終了判定だけを想定する。

複数の終了候補が同時に返った場合、Engine はそれらの reason をすべて
final outcome の `endReasons` に渡す。
v1 では終了理由同士の優先順位を持たない。

他の役職が終了条件を追加する設計は、今は決めない。
その必要が出てきたら、終了候補の衝突、表示用終了理由、PlayerResult への影響を
その時点で再検討する。

## Winner Judgement

`Winner Judgement` は、ゲーム終了後にどの Team が勝つかを判定する。

終了理由は複数あり得るが、勝者 Team は1つだけにする。
たとえば妖狐がいるゲームでは、村人側や人狼側の終了理由でゲームが止まったとしても、
妖狐が生存していれば `Team.Fox` が勝つ。
`Team.Fox` は、v1 では FoxRole を持つ1人だけの独自陣営として扱う。

winner judgement は setup contribution としてゲーム開始時に固定する。
Engine は core contribution と採用中 Role の contribution から
`resolvedRoleSetup.winnerJudgements` を作る。

winner judgement は priority を持つ。
ゲーム終了時、Engine は priority の小さい順に winner judgement を評価し、
最初に成立した judgement の `winnerTeam` を `finalOutcome.winnerTeam` にする。
一度 winner Team が決まったら、それより低い priority の judgement は評価しない。

例。

```text
priority 10
  FoxRole winner judgement
  妖狐が生存している
    -> winnerTeam = Team.Fox

priority 100
  core werewolf judgement
  endReasons に werewolf_dominance が含まれる
    -> winnerTeam = Team.Werewolf

priority 100
  core village judgement
  endReasons に werewolves_eliminated が含まれる
    -> winnerTeam = Team.Village
```

winner judgement は、ゲームを終了するかどうかを決めない。
ゲーム終了後の最終 state と `endReasons` を見て、勝者 Team だけを決める。

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
    winnerTeam が Team.Werewolf
    win

  狂人 Role の Player
    winnerTeam が Team.Werewolf
    win

  村人 Role の Player
    winnerTeam が Team.Werewolf
    lose
```

狂人のような役職があるため、終了判定、winner Team 判定、PlayerResult 判定は分ける。

狂人は、終了判定上は非人狼として数えられることがある。
しかし、winner Team が `Team.Werewolf` の場合は勝利に乗る。

PlayerResult は、最終 state が固定された後に実行する。

`Role.evaluateResult` が `null` を返した場合、Engine は標準の陣営ベース判定へ
fallback できる。

これにより、普通の村人のような役職は結果判定を個別に書かなくてよい。
