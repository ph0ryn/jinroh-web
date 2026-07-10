# `/live` UI/UX Validation

## Task 01: Account の単一 Room 所属

Status: Pending

実装完了後、実行日時、command、結果、失敗時の参照をこの文書へ記録する。
Task の実装完了と要件の検証完了は別に判定する。

### Requirement Coverage

| Requirement | Validation | Status | Evidence |
| --- | --- | --- | --- |
| `LIVE-ROOM-001` | 同じ Account の create/create、create/join、join/join を並行実行して current Room が最大 1 つ | Pending | - |
| `LIVE-ROOM-002` | `lobby`、`playing`、`ended` で所属を保持し、退出・disband 時だけ解放 | Pending | - |
| `LIVE-ROOM-003` | `joined` / `disconnected` の変更で current Room が変わらない | Pending | - |
| `LIVE-ROOM-004` | 同じ Room への join で既存 Player ID と表示名を再利用 | Pending | - |
| `LIVE-ROOM-005` | 別 Room 操作に明示確認が必要で、cancel 時に旧 Room と入力値を維持 | Pending | - |
| `LIVE-ROOM-006` | `playing` 中の leave / switch を API と UI の両方で拒否 | Pending | - |
| `LIVE-ROOM-007` | target が不存在、満席、開始済み、競合の場合に switch 全体を rollback | Pending | - |
| `LIVE-ROOM-008` | reload、Realtime、Room code 保存値の欠落・改変後に current API から復元 | Pending | - |
| `LIVE-ROOM-009` | 同一 BrowserContext の 2 タブが create、leave、switch 後に同じ状態へ収束 | Pending | - |
| `LIVE-ROOM-010` | API、Realtime、BroadcastChannel に内部 ID、token、秘密情報がない | Pending | - |

### Automated Checks

| Check | Status | Evidence |
| --- | --- | --- |
| `pnpm exec supabase db reset` | Pending | - |
| Database tests | Pending | - |
| `pnpm run fix` | Pending | - |
| `pnpm run lint` | Pending | - |
| `pnpm run test:unit` | Pending | - |
| `pnpm run build` | Pending | - |
| `pnpm run test:e2e:all` | Pending | - |

### Manual Checks

| Scenario | Status | Evidence |
| --- | --- | --- |
| desktop で create、join、leave、switch を操作 | Pending | - |
| 320 x 568 で dialog、主要 CTA、scroll、44 px target を確認 | Pending | - |
| 390 x 844 で dialog、主要 CTA、scroll、44 px target を確認 | Pending | - |
| keyboard で dialog の focus trap、Escape、focus 復帰を確認 | Pending | - |
| 同じ Account の 2 タブで状態収束と ghost control 非表示を確認 | Pending | - |
| `ended` まで play し、退出前後の所属を確認 | Pending | - |

### Residual Issues

未検証。Task 01 の検証完了時に残存課題または「なし」を記録する。
