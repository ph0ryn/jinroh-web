# 人狼相談

## Werewolf Consultation

人狼相談は、人狼同士のチャット代替として扱う。
free text の会話ではなく、template と選択値だけで表現する。

人狼相談は game action ではない。
相談内容は襲撃決定、投票集計、終了判定、PlayerResult 判定に使わない。

見える対象は、実際に `WerewolfRole` を持つ Player だけに限定する。
狂人は `Team.Werewolf` でも、相談の閲覧対象には含めない。
public view、public realtime payload、村人や狂人の private view には出さない。

表示する timing。

- `night` 中は送信、撤回、再送信できる相談 UI として表示する
- `nightNumber === 1` では襲撃相談 template を表示しない
- `nightNumber >= 2` では襲撃相談 template を表示できる
- 次の Day 中は、前夜の相談を読み取り専用の参照 UI として表示できる
- Day 中の参照 UI は、ボタンなどの明示操作で開く
- Day 中は相談の送信、撤回、再送信はできない
- Voting 以降は、前夜の相談を private view から消す
- internal history には送信/撤回 event を残してよい

相談 template は、ゲーム開始時の setup contribution 解決で作る。
Engine は core contribution と採用中 Role definition から contribution を集め、
そのゲームの `resolvedRoleSetup.werewolfConsultationTemplates` として固定する。

```text
game start
  core setup contribution を追加する
  採用中 Role を registry から集める
  各 Role の getSetupContributions を呼ぶ
  template contribution を catalog に追加する
  resolved role setup を GameState に固定する
```

採用中 Role だけが template を追加できる。
未採用 Role の template は出さない。
template を定義しない Role は何も追加しない。
Role は setup contribution を返すだけで、相談の送信状態や game state を変更しない。

夜ごとの表示候補は、固定済み resolved role setup から Engine が絞り込む。
たとえば `normalNightOnly` の template は `nightNumber >= 2` のときだけ表示する。

v1 の template。

```text
WerewolfRole
  [誰]を襲撃しよう
  normal night のみ

core
  [誰]を処刑させよう

core
  [自分/仲間]が[役職]でカミングアウト
  actor は sender または人狼仲間から選ぶ
  role は採用中 Role から選ぶ

SeerRole
  [自分/仲間]が[誰]を占い結果[白/黒]と報告
  actor は sender または人狼仲間から選ぶ
  target は Player から選ぶ
  report result は human / werewolf から選ぶ
```

`SeerRole` の template は、実際の sender が占い師かどうかとは関係しない。
占い師 Role が採用されているゲームでは、人狼がその役職を騙る相談をできる、という意味。

core contribution は Role 由来ではない。
Engine が人狼相談の基本選択肢として追加する。

core contribution の例。

```ts
export function getCoreSetupContributions(): readonly RoleSetupContribution[] {
  return [
    {
      kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
      template: {
        id: "core_execution_target",
        kind: WerewolfConsultationTemplateKind.ExecutionTarget,
        source: WerewolfConsultationTemplateSource.Core,
        sourceRoleId: null,
        labelKey: "werewolf.consultation.execution_target",
        normalNightOnly: false,
        fields: [
          {
            id: "target",
            kind: WerewolfConsultationFieldKind.Player,
            candidates: WerewolfConsultationPlayerCandidates.AlivePlayers,
          },
        ],
      },
    },
    {
      kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
      template: {
        id: "core_coming_out",
        kind: WerewolfConsultationTemplateKind.ComingOut,
        source: WerewolfConsultationTemplateSource.Core,
        sourceRoleId: null,
        labelKey: "werewolf.consultation.coming_out",
        normalNightOnly: false,
        fields: [
          {
            id: "actor",
            kind: WerewolfConsultationFieldKind.Player,
            candidates: WerewolfConsultationPlayerCandidates.SenderOrWerewolfAlly,
          },
          {
            id: "role",
            kind: WerewolfConsultationFieldKind.Role,
            candidates: WerewolfConsultationRoleCandidates.ActiveRoles,
          },
        ],
      },
    },
  ];
}
```

Role 由来 contribution の例。

```ts
export class SeerRole extends Role {
  readonly id = "seer";
  readonly name = "Seer";
  readonly team = Team.Village;
  readonly description = "Inspect one player at night and learn how they appear.";

  getSetupContributions(_context: RoleContext): readonly RoleSetupContribution[] {
    return [
      {
        kind: RoleSetupContributionKind.WerewolfConsultationTemplate,
        template: {
          id: "seer_result_report",
          kind: WerewolfConsultationTemplateKind.SeerResultReport,
          source: WerewolfConsultationTemplateSource.Role,
          sourceRoleId: this.id,
          labelKey: "werewolf.consultation.seer_result_report",
          normalNightOnly: false,
          fields: [
            {
              id: "actor",
              kind: WerewolfConsultationFieldKind.Player,
              candidates: WerewolfConsultationPlayerCandidates.SenderOrWerewolfAlly,
            },
            {
              id: "target",
              kind: WerewolfConsultationFieldKind.Player,
              candidates: WerewolfConsultationPlayerCandidates.AlivePlayers,
            },
            {
              id: "result",
              kind: WerewolfConsultationFieldKind.InspectionView,
              candidates: [InspectionView.Human, InspectionView.Werewolf],
            },
          ],
        },
      },
    ];
  }
}
```

相談 slot は、夜、送信者、template id で決まる。
template kind は表示や分類には使えるが、一意性は `template.id` で判断する。

```text
werewolf consultation slot
  nightNumber + sender player + template id
```

送信と撤回の状態遷移。

```text
empty
  -> submitted
  -> retracted
  -> submitted
```

基本ルール。

- 初回送信後、1回だけ撤回できる
- 撤回後は、再送信1回または撤回したまま終了を選べる
- 再送信後は再撤回も再再送信もできない
- 撤回済み状態は、その夜の人狼 private view に表示する
- 次の Day 中は、その夜の相談を読み取り専用で private view から参照できる
- Day 中の参照では送信、撤回、再送信はできない
- Voting 以降は、その夜の相談表示を private view から消す
- 送信者 Player は相談内容と一緒に表示する
- 同じ slot への二重送信は、状態遷移として有効な最初の request だけを受理する

撤回は「存在しなかったことにする」操作ではない。
人狼仲間には、送信者がその相談を撤回した状態として見せる。
