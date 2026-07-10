# Task 01: Account の単一 Room 所属

## Goal

同じ Account が同時に複数 Room へ所属する状態を DB で不可能にし、reload、
再接続、複数タブ、Room 切り替えで UI が同じ現在 Room へ収束するようにする。

## Traceability

- Requirements: `LIVE-ROOM-001` から `LIVE-ROOM-010`
- Design: `docs/ui-ux/design.md` の「Task 01: 単一 Room 所属」
- Database design: `docs/supabase.md` の Account current Room と Lobby Transactions
- Validation: `docs/ui-ux/validation.md`

## Prerequisites

- 作業 branch は `codex/task01-single-room-membership` とする。
- `docs/spec.md` の要件と `docs/ui-ux/design.md` の設計を先に確定する。
- Browser は Supabase base table を直接読み書きしない。

## Implementation Tasks

- [ ] `accounts.current_room_id`、index、整合性 constraint、backfill を migration に追加する。
- [ ] create、join、leave、heartbeat、expiration / disband RPC に current Room lifecycle を追加する。
- [ ] `lobby` / `ended` 用の atomic switch RPC を追加する。
- [ ] repository に current Room lookup、switch、domain error mapping を追加する。
- [ ] `GET /api/rooms/current` と `POST /api/rooms/switch` を追加する。
- [ ] `/live` の Room code local storage を削除し、current Room API で初期化する。
- [ ] 切り替え確認 dialog と `playing` 中の拒否 UI を追加する。
- [ ] `BroadcastChannel` invalidation と polling fallback で複数タブを収束させる。
- [ ] unit、database、Playwright test を追加する。
- [ ] desktop、mobile、keyboard、複数タブで手動 play を行う。
- [ ] validation evidence と change log を更新する。

## Completion Conditions

- Account の現在 Room が DB 上で最大 1 つに制限される。
- `disconnected` / `ended` でも退出まで所属を保持する。
- 明示退出、expiration、disband でだけ所属を解放する。
- 同じ Room への復帰は同じ Player を再利用する。
- `playing` 中の退出・切り替えを拒否する。
- `lobby` / `ended` の切り替え失敗時に旧 Room を失わない。
- 同じ Account の全タブが server state に収束し、ghost control を表示しない。
- `LIVE-ROOM-001` から `LIVE-ROOM-010` の検証結果が記録される。
- repository 標準の format、lint、unit test、build、E2E が成功する。

## Dependencies And Concurrency

DB migration と transaction が API / UI の前提である。
同じ schema、repository、`/live` を触る変更は並行で実装せず、Task 01 の branch 内で
整合させる。Task 02 は Task 01 の検証と review が終わるまで開始しない。

## Risks

- Account と複数 Room を異なる順序で lock すると deadlock する。
- migration 前に重複所属がある場合、backfill を自動解決すると誤った Room を選ぶ。
- stale tab の heartbeat が古い Room を current に戻すと単一所属が破れる。
- atomic switch の後半失敗時に rollback しないと、ユーザーが旧 Room を失う。
