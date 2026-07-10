import { describe, expect, it } from "vitest";

import {
  isValidRuleSetNumber,
  RULE_SET_NUMBER_FIELDS,
  RULE_SET_NUMBER_LIMITS,
} from "@/lib/shared/ruleSetConstraints";

describe("shared rule-set numeric constraints", () => {
  it.each(RULE_SET_NUMBER_FIELDS)("accepts only the documented range for %s", (field) => {
    const { max, min } = RULE_SET_NUMBER_LIMITS[field];

    expect(isValidRuleSetNumber(field, min)).toBe(true);
    expect(isValidRuleSetNumber(field, max)).toBe(true);
    expect(isValidRuleSetNumber(field, min - 1)).toBe(false);
    expect(isValidRuleSetNumber(field, max + 1)).toBe(false);
    expect(isValidRuleSetNumber(field, min + 0.5)).toBe(false);
    expect(isValidRuleSetNumber(field, Number.NaN)).toBe(false);
    expect(isValidRuleSetNumber(field, Number.MAX_VALUE)).toBe(false);
  });
});
