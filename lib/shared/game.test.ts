import { describe, expect, it } from "vitest";

import {
  makeDefaultRuleSetForPlayers,
  normalizeRuleSet,
  validateRuleSet,
  type RuleSet,
} from "./game";

describe("ruleset validation", () => {
  it("creates a playable default ruleset for eight players", () => {
    const ruleSet = makeDefaultRuleSetForPlayers(8);
    const result = validateRuleSet(ruleSet, 8);

    expect(result.ok).toBe(true);
    expect(ruleSet.roleCounts.werewolf).toBe(2);
    expect(ruleSet.roleCounts.fox).toBe(1);
  });

  it("rejects role counts that do not match players", () => {
    const ruleSet: RuleSet = {
      dayMode: "ready_check",
      guardConsecutiveTargetPolicy: "deny",
      initialInspectionPolicy: "enabled",
      roleCounts: {
        fox: 0,
        guard: 0,
        madman: 0,
        seer: 1,
        villager: 1,
        werewolf: 1,
      },
      voteResultVisibility: "count_only",
    };

    expect(validateRuleSet(ruleSet, 5)).toEqual({
      errors: ["Role count (3) must match joined player count (5)."],
      ok: false,
    });
  });

  it("rejects unsupported player counts", () => {
    const tooFew = validateRuleSet(makeDefaultRuleSetForPlayers(2), 2);
    const tooMany = validateRuleSet(makeDefaultRuleSetForPlayers(11), 11);

    expect(tooFew.ok).toBe(false);
    expect(tooMany.ok).toBe(false);

    if (!tooFew.ok) {
      expect(tooFew.errors).toContain("At least three joined players are required.");
    }

    if (!tooMany.ok) {
      expect(tooMany.errors).toContain("At most ten joined players are supported.");
    }
  });

  it("normalizes an empty role input to the default player-count aware setup", () => {
    const normalized = normalizeRuleSet(
      {
        dayMode: "ordered_speech",
        guardConsecutiveTargetPolicy: "allow",
        initialInspectionPolicy: "disabled",
        roleCounts: {},
        voteResultVisibility: "voter_to_target",
      },
      6,
    );

    expect(validateRuleSet(normalized, 6).ok).toBe(true);
    expect(normalized.roleCounts.werewolf).toBe(1);
  });
});
