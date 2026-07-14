import { describe, expect, it } from "vitest";

import {
  isValidRuleSetNumber,
  RULE_SET_NUMBER_LIMITS,
  type RuleSetNumberField,
} from "./ruleSetConstraints";

describe("shared rule-set numeric constraints", () => {
  const documentedLimits: Readonly<Record<RuleSetNumberField, { max: number; min: number }>> = {
    dayReadyCheckSecondsPerPlayer: { max: 300, min: 1 },
    daySpeechSeconds: { max: 300, min: 1 },
    executionLastWordsSeconds: { max: 300, min: 1 },
    firstDaySpeechRounds: { max: 5, min: 1 },
    firstNightSeconds: { max: 300, min: 1 },
    nightSeconds: { max: 600, min: 1 },
    normalDaySpeechRounds: { max: 5, min: 1 },
    votingSeconds: { max: 300, min: 1 },
  };

  it("matches the documented limits", () => {
    expect(RULE_SET_NUMBER_LIMITS).toEqual(documentedLimits);
  });

  it.each(Object.entries(documentedLimits) as [RuleSetNumberField, { max: number; min: number }][])(
    "accepts only safe integers inside the contract for %s",
    (field, { max, min }) => {
      expect(isValidRuleSetNumber(field, min)).toBe(true);
      expect(isValidRuleSetNumber(field, max)).toBe(true);
      expect(isValidRuleSetNumber(field, min - 1)).toBe(false);
      expect(isValidRuleSetNumber(field, max + 1)).toBe(false);
      expect(isValidRuleSetNumber(field, min + 0.5)).toBe(false);
      expect(isValidRuleSetNumber(field, Number.NaN)).toBe(false);
      expect(isValidRuleSetNumber(field, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
      expect(isValidRuleSetNumber(field, String(min))).toBe(false);
    },
  );
});
