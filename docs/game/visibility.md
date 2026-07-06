# Secret View

## Secret Information

ゲームロジックでは秘密情報が増える。

秘密情報の例。

- 各 Player の役職
- 夜 action の対象
- 占い結果
- 襲撃対象
- 人狼相談の送信内容と撤回状態
- 特定陣営だけが知る情報

ルール。

- 公開 room state に秘密情報を含めない
- Realtime payload に秘密情報を含めない
- Realtime topic を知っていることを閲覧権限として扱わない
- 秘密情報は対象 Player にだけ返す
- Game Event は公開用、個別公開用、内部用に分ける

## Secret View Model

ブラウザへ送った情報は、通信キャプチャ、DevTools、localStorage、JS runtime から
見られる前提にする。

そのため、サーバーは相手に見せてよい情報だけを view として切り出して返す。

View の分離。

```text
public game view
  全員が見てよい情報だけ

self private view
  自分の役職、自分の action 候補、自分宛ての結果だけ

faction private view
  特定の陣営、役職、または Player group だけが見てよい情報だけ

internal game state
  サーバーとDB内部だけが持つ完全な状態
```

ルール。

- public game view に他人の役職を含めない
- public game view に夜 action の対象を含めない
- realtime message に秘密情報を含めない
- 自分の役職は self private view にだけ含める
- 人狼仲間などの共有秘密は group private view にだけ含める
- 人狼相談は実際に WerewolfRole を持つ Player の private view にだけ含める
- Day 中は、前夜の人狼相談を読み取り専用で WerewolfRole の private view に含められる
- 狂人には人狼相談を見せない
- internal game state をそのまま browser に返さない

`Team` は勝敗や標準結果判定の分類として使う。
秘密情報の閲覧権限や role group action の提出権限は、`Team` だけでは決めない。
人狼相談や襲撃 action のように「実際の人狼だけ」が対象になるものは、
Role ID または Player が持つ Role から対象者を切り出す。

`GameEvent.visibility` は view 生成時の入力として使う。
`public` event は public game view に含められる。
`private` event は `visibleToPlayerIds`、`visibleToFaction`、`visibleToRoleIds` に一致する
view にだけ含める。
`internal` event は browser に返さない。

人狼相談の event と view は、`visibleToFaction: Team.Werewolf` だけで公開範囲を決めない。
狂人が同じ team を持つため、WerewolfRole の Player ID または Role ID で切り出す。

## Realtime Delivery

Realtime は view そのものではなく、view を読み直すための通知だけを配送する。
通知の payload に秘密情報、role assignment、action target、consultation content を
含めない。

秘密情報に関係する通知は、Supabase Realtime の private channel で配送する。
Browser は Account token を Next.js API に送り、Next.js API が Account、Player、
Role eligibility を検証した後、許可された topic だけに使える短命 Realtime JWT を
発行する。

Realtime JWT は購読許可専用であり、view 取得権限として扱わない。
Browser は通知を受け取った後、Account token を使って Next.js API から
public game view、self private view、または group private view を読み直す。

人狼相談の通知は WerewolfRole を持つ Player だけが購読できる private topic に送る。
`Team.Werewolf` の claim だけで購読を許可しない。
