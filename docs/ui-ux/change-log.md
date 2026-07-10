# `/live` UI/UX Change Log

## 2026-07-10

### Task 01 specification and design

- Summary: Account は同時に最大 1 Room だけに所属し、明示退出または Room 解散まで
  `accounts.current_room_id` を保持する要件と設計を追加した。
- Reason: 従来の複数 Room 参加可という記述が製品意図と異なり、複数タブで Room
  所属と UI が分岐する余地があったため。
- Impact: Account、Room / Player lifecycle、lobby transaction、API、`/live`、
  Realtime、タブ間同期、migration、test。
- Related artifacts: `docs/spec.md`、`docs/supabase.md`、
  `docs/ui-ux/design.md`、`docs/ui-ux/tasks.md`、
  `docs/ui-ux/tasks/task_01-single-room-membership.md`、
  `docs/ui-ux/validation.md`。
