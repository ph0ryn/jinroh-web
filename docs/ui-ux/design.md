# `/live` UI/UX 改善設計

この文書は、`/live` の UI/UX 改善に共通する設計判断を記録する。
製品要件の正本は `docs/spec.md` とし、各 Task の詳細は
`docs/ui-ux/tasks/` に分ける。

## 改善方針

- 実際のゲーム進行をユーザーとして確認し、操作を妨げる問題から順に直す。
- 1 Task ごとに要件、設計、実装、検証、change log を完結させる。
- DB を永続状態の正本とし、Browser の保存値や Realtime payload を正本にしない。
- 秘密情報を Browser へ送らず、Account ID を UI、API payload、Realtime、
  タブ間通知へ公開しない。
- desktop、mobile、keyboard、複数タブ、再接続を同じ利用体験として扱う。

## Task 01: 単一 Room 所属

### 現在の振る舞い

Player は Room ごとに一意だが、同じ Account が別 Room にも Player を持てる。
Browser は local storage の Room code から復帰先を推測するため、同じ Account の
複数タブが別 Room を表示し、古いタブの操作が所属を上書きできる。

### 設計

- `accounts.current_room_id` を Account の現在 Room の唯一の正本にする。
- Player status は Room 内の接続状態と履歴に限定し、所属判定には使わない。
- create、join、leave、disband、switch は Account と関連 Room / Player を lock し、
  同じ transaction で `current_room_id` を更新する。
- DB constraint は、現在 Room と active Player の対応が transaction 終了時に
  一致することを保証する。
- `GET /api/rooms/current` は認証済み Account の現在 Room を返し、Browser は
  Room code の local storage を使わない。
- `POST /api/rooms/switch` は、UI で退出を確認した場合だけ旧 Room 退出と新 Room
  作成・参加を atomic に実行する。
- Realtime と `BroadcastChannel` は非機密の invalidation だけを配送する。
  受信側は current Room API を再取得する。

### Interface

```ts
type CurrentRoomResponse = {
  room: RoomSummary | null;
};

type SwitchRoomRequest =
  | {
      kind: "create";
      expectedCurrentRoomCode: string;
      displayName: string;
      targetPlayerCount: number;
    }
  | {
      kind: "join";
      expectedCurrentRoomCode: string;
      targetRoomCode: string;
      displayName: string;
    };
```

競合は `current_room_exists`、`current_room_changed`、
`room_switch_forbidden` などの domain error code で区別する。

### UX

- 初期化中は current Room の取得が完了するまで create / join を無効化する。
- 同じ Room なら確認せず既存 Player として復帰する。
- `lobby` / `ended` から別 Room へ移る場合は、旧 Room と移動先を表示した
  dialog で「現在の部屋を退出して切り替える」を確認する。
- `playing` 中は切り替えを提供せず、現在のゲームへ戻る導線だけを表示する。
- 切り替えのキャンセルまたは失敗時は、現在 Room と入力値を維持する。
- dialog は focus trap、Escape によるキャンセル、起点への focus 復帰を保証する。
- 同じ Account の別タブで所属が変わった場合、全タブを新しい server state へ
  収束させ、現在 Player でない画面に操作 UI や private view を表示しない。

### Trade-offs

- Player の partial unique index だけでは、期限切れ Room の履歴行を残しつつ所属を
  解放する要件を表しにくいため採用しない。
- current membership 専用 table は不要な join と lifecycle state を増やすため
  採用せず、Account に nullable FK を持たせる。
- 切り替えを leave と join の 2 request に分けると後半失敗時に旧 Room を失うため、
  server-side の atomic transaction にする。

## Compatibility And Migration

- 未リリースのため、Browser の Room code 保存値との互換性は維持しない。
- migration は既存の current Room 候補を backfill し、同一 Account に複数候補が
  あれば勝手に選ばず失敗させる。
- Room、Player、event の履歴は削除しない。
