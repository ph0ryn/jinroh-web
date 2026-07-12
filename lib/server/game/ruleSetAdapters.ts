import "server-only";
import { DayDiscussionMode, VoteResultVisibility, type RuleOptions } from "./types";

import type { RuleSetOptions as SharedRuleSetOptions } from "@/lib/shared/game";

export function toRegisteredRuleOptions(ruleSet: SharedRuleSetOptions): RuleOptions {
  return {
    dayDiscussionMode:
      ruleSet.dayMode === "ordered_speech"
        ? DayDiscussionMode.OrderedSpeech
        : DayDiscussionMode.ReadyCheck,
    dayReadyCheckSecondsPerPlayer: ruleSet.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: ruleSet.daySpeechSeconds,
    executionLastWordsSeconds: ruleSet.executionLastWordsSeconds,
    firstDaySpeechRounds: ruleSet.firstDaySpeechRounds,
    firstNightSeconds: ruleSet.firstNightSeconds,
    nightSeconds: ruleSet.nightSeconds,
    normalDaySpeechRounds: ruleSet.normalDaySpeechRounds,
    roleOptions: ruleSet.roleOptions,
    voteResultVisibility:
      ruleSet.voteResultVisibility === "voter_to_target"
        ? VoteResultVisibility.VoterToTarget
        : VoteResultVisibility.CountOnly,
    votingSeconds: ruleSet.votingSeconds,
  };
}

export function toSharedRuleOptions(options: RuleOptions): SharedRuleSetOptions {
  return {
    dayMode:
      options.dayDiscussionMode === DayDiscussionMode.OrderedSpeech
        ? "ordered_speech"
        : "ready_check",
    dayReadyCheckSecondsPerPlayer: options.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: options.daySpeechSeconds,
    executionLastWordsSeconds: options.executionLastWordsSeconds,
    firstDaySpeechRounds: options.firstDaySpeechRounds,
    firstNightSeconds: options.firstNightSeconds,
    nightSeconds: options.nightSeconds,
    normalDaySpeechRounds: options.normalDaySpeechRounds,
    roleOptions: options.roleOptions,
    voteResultVisibility:
      options.voteResultVisibility === VoteResultVisibility.VoterToTarget
        ? "voter_to_target"
        : "count_only",
    votingSeconds: options.votingSeconds,
  };
}
