import "server-only";
import { DEFAULT_ACTION_PRESENTATION } from "@/lib/shared/game";

import type { ActionPresentation } from "@/lib/shared/game";

export enum CoreActionKind {
  EndSpeech = "end_speech",
  ExecutionSkip = "execution_skip",
  FirstNightReady = "first_night_ready",
  ReadyForVoting = "day_ready",
  Vote = "vote",
}

const CORE_ACTION_PRESENTATIONS: Readonly<Record<CoreActionKind, ActionPresentation>> = {
  [CoreActionKind.EndSpeech]: {
    en: { label: "Finish speaking", submitLabel: "Finish speaking" },
    ja: { label: "発言を終える", submitLabel: "発言を終える" },
  },
  [CoreActionKind.ExecutionSkip]: {
    en: { label: "Finish last words", submitLabel: "Finish last words" },
    ja: { label: "最後の言葉を終える", submitLabel: "最後の言葉を終える" },
  },
  [CoreActionKind.FirstNightReady]: {
    en: { label: "Ready for daybreak", submitLabel: "Ready for daybreak" },
    ja: { label: "夜明けを待つ", submitLabel: "夜明けを待つ" },
  },
  [CoreActionKind.ReadyForVoting]: {
    en: { label: "Ready to vote", submitLabel: "Ready to vote" },
    ja: { label: "投票へ進む", submitLabel: "投票へ進む" },
  },
  [CoreActionKind.Vote]: {
    en: { label: "Choose someone to execute", submitLabel: "Vote" },
    ja: { label: "処刑する相手を選ぶ", submitLabel: "投票する" },
  },
};

export function getCoreActionPresentation(actionKind: string): ActionPresentation {
  return isCoreActionKind(actionKind)
    ? CORE_ACTION_PRESENTATIONS[actionKind]
    : DEFAULT_ACTION_PRESENTATION;
}

export function isCoreActionKind(actionKind: string): actionKind is CoreActionKind {
  return Object.values(CoreActionKind).some((value) => value === actionKind);
}
