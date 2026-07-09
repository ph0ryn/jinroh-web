import "server-only";
import {
  DayDiscussionMode,
  GuardConsecutiveTargetPolicy,
  InitialInspectionPolicy,
  VoteResultVisibility,
  type RuleOptions,
} from "./types";

import type {
  RuleSet as SharedRuleSet,
  RuleSetOptions as SharedRuleSetOptions,
} from "@/lib/shared/game";

export function toRegisteredRuleOptions(ruleSet: SharedRuleSet): RuleOptions {
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
    guardConsecutiveTargetPolicy:
      ruleSet.guardConsecutiveTargetPolicy === "allow"
        ? GuardConsecutiveTargetPolicy.Allow
        : GuardConsecutiveTargetPolicy.DenySameTarget,
    initialInspectionPolicy:
      ruleSet.initialInspectionPolicy === "disabled"
        ? InitialInspectionPolicy.Disabled
        : InitialInspectionPolicy.Enabled,
    nightSeconds: ruleSet.nightSeconds,
    normalDaySpeechRounds: ruleSet.normalDaySpeechRounds,
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
    guardConsecutiveTargetPolicy:
      options.guardConsecutiveTargetPolicy === GuardConsecutiveTargetPolicy.Allow
        ? "allow"
        : "deny",
    initialInspectionPolicy:
      options.initialInspectionPolicy === InitialInspectionPolicy.Disabled ? "disabled" : "enabled",
    nightSeconds: options.nightSeconds,
    normalDaySpeechRounds: options.normalDaySpeechRounds,
    voteResultVisibility:
      options.voteResultVisibility === VoteResultVisibility.VoterToTarget
        ? "voter_to_target"
        : "count_only",
    votingSeconds: options.votingSeconds,
  };
}
