import { describe, expect, it } from "vitest";

import { roleRegistry } from "./roles";
import {
  DEFAULT_RULE_OPTIONS,
  normalizeRuleSetInput,
  parseResolvedRoleSetup,
  validateRuleSet,
} from "./ruleset";

import type { RoleCounts } from "./types";

describe("validateRuleSet", () => {
  it("normalizes registered role option defaults without common option fields", () => {
    const ruleSet = normalizeRuleSetInput({ options: { roleOptions: {} } }, 6);

    expect(ruleSet.options.roleOptions).toEqual({
      guard: { consecutive_target: "deny" },
      seer: { initial_inspection: "enabled" },
    });
  });

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
      "madman",
      "seer",
      "guard",
      "villager",
    ]);
    expect(result.resolvedRoleSetup.nightConversationGroups).toEqual([
      {
        ...roleRegistry.get("werewolf").nightConversation,
        roleIds: ["werewolf"],
      },
    ]);
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
          roleOptions: {
            ...DEFAULT_RULE_OPTIONS.roleOptions,
            seer: { initial_inspection: "enabled" },
          },
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

    expect(result.issues.map((issue) => issue.code)).toContain(
      "role:seer:no_initial_inspection_candidate",
    );
  });

  it("rejects an invalid value through its owning role option definition", () => {
    const ruleSet = normalizeRuleSetInput(
      {
        roleCounts: {
          guard: 1,
          seer: 1,
          villager: 1,
          werewolf: 1,
        },
      },
      4,
    );
    const result = validateRuleSet(
      {
        ...ruleSet,
        options: {
          ...ruleSet.options,
          roleOptions: {
            ...ruleSet.options.roleOptions,
            guard: { consecutive_target: "unsupported" },
          },
        },
      },
      4,
    );

    expect(result).toMatchObject({
      issues: [expect.objectContaining({ code: "invalid_option", roleId: "guard" })],
      ok: false,
    });
  });
});

describe("parseResolvedRoleSetup", () => {
  const baseSetup = {
    activeRoleIds: ["werewolf", "villager"],
    contributions: [],
    nightConversationGroups: [
      {
        groupId: "werewolf",
        label: { en: "fixture-en-label", ja: "fixture-ja-label" },
        roleIds: ["werewolf"],
      },
    ],
  };

  it("accepts one conversation group per participating role", () => {
    expect(parseResolvedRoleSetup(baseSetup)).toEqual(baseSetup);
  });

  it("rejects a role assigned to multiple conversation groups", () => {
    expect(
      parseResolvedRoleSetup({
        ...baseSetup,
        nightConversationGroups: [
          ...baseSetup.nightConversationGroups,
          {
            groupId: "other_werewolf_group",
            label: { en: "Other", ja: "その他" },
            roleIds: ["werewolf"],
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects duplicate conversation group IDs", () => {
    expect(
      parseResolvedRoleSetup({
        ...baseSetup,
        nightConversationGroups: [
          ...baseSetup.nightConversationGroups,
          {
            groupId: "werewolf",
            label: { en: "Other", ja: "その他" },
            roleIds: ["villager"],
          },
        ],
      }),
    ).toBeNull();
  });

  it("scopes opaque judgement identifiers to their source role", () => {
    const sharedIdContributions = [
      {
        judgement: {
          id: "survives",
          priority: 10,
          sourceRoleId: "werewolf",
          winnerTeam: "werewolf",
        },
        kind: "winner_judgement",
      },
      {
        judgement: {
          id: "survives",
          priority: 20,
          sourceRoleId: "fox",
          winnerTeam: "fox",
        },
        kind: "winner_judgement",
      },
    ];
    const setup = {
      ...baseSetup,
      activeRoleIds: ["werewolf", "fox", "villager"],
      contributions: sharedIdContributions,
    };

    expect(parseResolvedRoleSetup(setup)).toEqual(setup);
    expect(
      parseResolvedRoleSetup({
        ...setup,
        contributions: [...sharedIdContributions, sharedIdContributions[0]],
      }),
    ).toBeNull();
  });
});
