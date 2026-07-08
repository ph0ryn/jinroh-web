import { describe, expect, it } from "vitest";

import { normalizeRuleSetInput, validateRuleSet } from "../server/game/ruleset";
import { ROLE_IDS } from "./game";
import { ROLE_PRESETS, getMatchingRolePreset, getRolePresetsForPlayerCount } from "./rolePresets";

describe("role presets", () => {
  it("defines presets only for six, seven, and nine players", () => {
    expect(getRolePresetsForPlayerCount(6)).toHaveLength(1);
    expect(getRolePresetsForPlayerCount(7)).toHaveLength(2);
    expect(getRolePresetsForPlayerCount(9)).toHaveLength(2);

    for (const playerCount of [3, 4, 5, 8, 10]) {
      expect(getRolePresetsForPlayerCount(playerCount)).toEqual([]);
    }
  });

  it("uses the requested role mixes", () => {
    expect(getRolePresetsForPlayerCount(6).map((preset) => preset.roleCounts)).toEqual([
      expect.objectContaining({
        madman: 1,
        seer: 1,
        villager: 3,
        werewolf: 1,
      }),
    ]);
    expect(getRolePresetsForPlayerCount(7).map((preset) => preset.roleCounts)).toEqual([
      expect.objectContaining({
        guard: 1,
        madman: 1,
        seer: 1,
        villager: 3,
        werewolf: 1,
      }),
      expect.objectContaining({
        madman: 1,
        seer: 1,
        villager: 4,
        werewolf: 1,
      }),
    ]);
    expect(getRolePresetsForPlayerCount(9).map((preset) => preset.roleCounts)).toEqual([
      expect.objectContaining({
        guard: 1,
        madman: 1,
        seer: 1,
        spiritist: 1,
        villager: 3,
        werewolf: 2,
      }),
      expect.objectContaining({
        guard: 1,
        hunter: 1,
        madman: 1,
        seer: 1,
        villager: 3,
        werewolf: 2,
      }),
    ]);
  });

  it("keeps spiritist naming and avoids the old medium id", () => {
    const serializedPresets = JSON.stringify(ROLE_PRESETS);

    expect(serializedPresets).toContain("spiritist");
    expect(serializedPresets).not.toContain("medium");
  });

  it("matches exact role counts to presets", () => {
    const preset = getRolePresetsForPlayerCount(9)[0];

    if (preset === undefined) {
      throw new Error("Expected a nine-player role preset.");
    }

    expect(getMatchingRolePreset(9, preset.roleCounts)?.id).toBe(preset.id);
    expect(
      getMatchingRolePreset(9, {
        ...preset.roleCounts,
        hunter: 1,
        villager: 2,
      }),
    ).toBeNull();
  });

  it("defines server-valid role counts whose totals match the preset player count", () => {
    for (const preset of ROLE_PRESETS) {
      const totalRoles = ROLE_IDS.reduce((total, roleId) => total + preset.roleCounts[roleId], 0);
      const ruleSet = normalizeRuleSetInput({ roleCounts: preset.roleCounts }, preset.playerCount);

      expect(totalRoles).toBe(preset.playerCount);
      expect(validateRuleSet(ruleSet, preset.playerCount).ok).toBe(true);
    }
  });
});
