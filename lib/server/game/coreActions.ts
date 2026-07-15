import "server-only";
import { ActionTargetStateRequirement } from "./types";

import type {
  SinglePlayerActionPresentation,
  TargetlessActionPresentation,
} from "@/lib/shared/game";

export enum CoreActionKind {
  EndSpeech = "end_speech",
  ExecutionSkip = "execution_skip",
  FirstNightReady = "first_night_ready",
  ReadyForVoting = "day_ready",
  Vote = "vote",
}

export type CoreActionDefinition<K extends CoreActionKind = CoreActionKind> =
  | {
      kind: K;
      presentation: TargetlessActionPresentation;
      targetKind: "none";
      targetStateRequirement: ActionTargetStateRequirement;
    }
  | {
      kind: K;
      presentation: SinglePlayerActionPresentation;
      targetKind: "single_player";
      targetStateRequirement: ActionTargetStateRequirement;
    };

const CORE_ACTION_DEFINITIONS: {
  readonly [K in CoreActionKind]: CoreActionDefinition<K>;
} = {
  [CoreActionKind.EndSpeech]: {
    kind: CoreActionKind.EndSpeech,
    presentation: {
      en: {
        label: "Finish speaking",
        submitLabel: "Finish speaking",
        submittedMessage: "Speaking finished.",
      },
      ja: {
        label: "発言を終える",
        submitLabel: "発言を終える",
        submittedMessage: "発言終了済みです",
      },
    },
    targetKind: "none",
    targetStateRequirement: ActionTargetStateRequirement.Assigned,
  },
  [CoreActionKind.ExecutionSkip]: {
    kind: CoreActionKind.ExecutionSkip,
    presentation: {
      en: {
        label: "Finish last words",
        submitLabel: "Finish last words",
        submittedMessage: "Last words finished.",
      },
      ja: {
        label: "最後の言葉を終える",
        submitLabel: "最後の言葉を終える",
        submittedMessage: "最後の言葉は終了済みです",
      },
    },
    targetKind: "none",
    targetStateRequirement: ActionTargetStateRequirement.Assigned,
  },
  [CoreActionKind.FirstNightReady]: {
    kind: CoreActionKind.FirstNightReady,
    presentation: {
      en: {
        label: "Ready for daybreak",
        submitLabel: "Ready for daybreak",
        submittedMessage: "Ready for daybreak.",
      },
      ja: {
        label: "夜明けを待つ",
        submitLabel: "夜明けを待つ",
        submittedMessage: "夜明けの準備ができました",
      },
    },
    targetKind: "none",
    targetStateRequirement: ActionTargetStateRequirement.Assigned,
  },
  [CoreActionKind.ReadyForVoting]: {
    kind: CoreActionKind.ReadyForVoting,
    presentation: {
      en: {
        label: "Ready to vote",
        submitLabel: "Ready to vote",
        submittedMessage: "Ready to vote.",
      },
      ja: {
        label: "投票へ進む",
        submitLabel: "投票へ進む",
        submittedMessage: "投票準備済みです",
      },
    },
    targetKind: "none",
    targetStateRequirement: ActionTargetStateRequirement.Assigned,
  },
  [CoreActionKind.Vote]: {
    kind: CoreActionKind.Vote,
    presentation: {
      en: {
        label: "Select a player to vote for.",
        submitLabel: "Vote",
        submittedMessage: "Your vote has been submitted.",
        targetConfirmation: {
          afterTarget: "?",
          beforeTarget: "Vote for ",
        },
      },
      ja: {
        label: "投票するプレイヤーを選択してください",
        submitLabel: "投票する",
        submittedMessage: "投票済みです",
        targetConfirmation: {
          afterTarget: "に投票しますか？",
          beforeTarget: "",
        },
      },
    },
    targetKind: "single_player",
    targetStateRequirement: ActionTargetStateRequirement.Alive,
  },
};

export function getCoreActionDefinition(actionKind: string): CoreActionDefinition {
  if (!isCoreActionKind(actionKind)) {
    throw new Error(`Unknown core action: ${actionKind}`);
  }

  return CORE_ACTION_DEFINITIONS[actionKind];
}

export function isCoreActionKind(actionKind: string): actionKind is CoreActionKind {
  return Object.values(CoreActionKind).some((value) => value === actionKind);
}
