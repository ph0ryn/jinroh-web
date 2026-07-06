import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_OPTIONS, normalizeRuleSetInput, validateRuleSet } from "./ruleset";
import { InitialInspectionPolicy } from "./types";

import type { RoleCounts } from "./types";

describe("validateRuleSet", () => {
  it("accepts a valid starter setup and resolves fixed setup contributions", () => {
    const ruleSet = normalizeRuleSetInput(
      {
        roleCounts: {
          guard: 1,
          madman: 1,
          seer: 1,
          villager: 2,
          werewolf: 1,
        },
      },
      6,
    );

    const result = validateRuleSet(ruleSet, 6);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("Expected valid rule set.");
    }

    expect(result.resolvedRoleSetup.activeRoleIds).toEqual([
      "werewolf",
      "villager",
      "madman",
      "seer",
      "guard",
    ]);
    expect(
      result.resolvedRoleSetup.werewolfConsultationTemplates.map((template) => template.id),
    ).toContain("seer_result_report");
    expect(
      result.resolvedRoleSetup.werewolfConsultationTemplates.map((template) => template.id),
    ).toContain("werewolf_attack_target");
  });

  it("rejects a setup without the required werewolf role", () => {
    const ruleSet = normalizeRuleSetInput(
      {
        roleCounts: {
          seer: 1,
          villager: 2,
        },
      },
      3,
    );

    const result = validateRuleSet(ruleSet, 3);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected invalid rule set.");
    }

    expect(result.issues.map((issue) => issue.code)).toContain("missing_required_role");
  });

  it("rejects role counts that do not match joined players", () => {
    const ruleSet = normalizeRuleSetInput(
      {
        roleCounts: {
          villager: 2,
          werewolf: 1,
        },
      },
      4,
    );

    const result = validateRuleSet(ruleSet, 4);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected invalid rule set.");
    }

    expect(result.issues.map((issue) => issue.code)).toContain("role_count_mismatch");
  });

  it("rejects player counts outside the supported range", () => {
    const tooFew = validateRuleSet(normalizeRuleSetInput({}, 2), 2);
    const tooMany = validateRuleSet(normalizeRuleSetInput({}, 11), 11);

    expect(tooFew.ok).toBe(false);
    expect(tooMany.ok).toBe(false);

    if (tooFew.ok || tooMany.ok) {
      throw new Error("Expected invalid player counts.");
    }

    expect(tooFew.issues.map((issue) => issue.code)).toContain("player_count_too_small");
    expect(tooMany.issues.map((issue) => issue.code)).toContain("player_count_too_large");
  });

  it("rejects fox counts above the role maximum", () => {
    const roleCounts: Partial<RoleCounts> = {
      fox: 2,
      villager: 1,
      werewolf: 1,
    };
    const ruleSet = normalizeRuleSetInput({ roleCounts }, 4);
    const result = validateRuleSet(ruleSet, 4);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected invalid rule set.");
    }

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "role_max_exceeded",
        roleId: "fox",
      }),
    );
  });

  it("rejects enabled initial inspection when no non-seer human result candidate exists", () => {
    const ruleSet = normalizeRuleSetInput(
      {
        options: {
          ...DEFAULT_RULE_OPTIONS,
          initialInspectionPolicy: InitialInspectionPolicy.Enabled,
        },
        roleCounts: {
          seer: 1,
          werewolf: 2,
        },
      },
      3,
    );

    const result = validateRuleSet(ruleSet, 3);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected invalid rule set.");
    }

    expect(result.issues.map((issue) => issue.code)).toContain("no_initial_inspection_candidate");
  });
});
