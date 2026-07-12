import { describe, expect, it } from "vitest";

import { getRoleIds } from "../server/game/roles";
import { normalizeRuleSetInput, validateRuleSet } from "../server/game/ruleset";
import {
  ROLE_PRESETS,
  expandRolePresetCounts,
  getMatchingRolePreset,
  getRolePresetsForPlayerCount,
} from "./rolePresets";

describe("role presets", () => {
  const roleIds = getRoleIds();

  it("defines presets only for six, seven, and nine players", () => {
    expect(getRolePresetsForPlayerCount(6, roleIds)).toHaveLength(1);
    expect(getRolePresetsForPlayerCount(7, roleIds)).toHaveLength(2);
    expect(getRolePresetsForPlayerCount(9, roleIds)).toHaveLength(1);

    for (const playerCount of [3, 4, 5, 8, 10]) {
      expect(getRolePresetsForPlayerCount(playerCount, roleIds)).toEqual([]);
    }
  });

  it("uses the requested role mixes", () => {
    expect(getRolePresetsForPlayerCount(6, roleIds).map((preset) => preset.roleCounts)).toEqual([
      expect.objectContaining({
        madman: 1,
        seer: 1,
        villager: 3,
        werewolf: 1,
      }),
    ]);
    expect(getRolePresetsForPlayerCount(7, roleIds).map((preset) => preset.roleCounts)).toEqual([
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
    expect(getRolePresetsForPlayerCount(9, roleIds).map((preset) => preset.roleCounts)).toEqual([
      expect.objectContaining({
        guard: 1,
        madman: 1,
        seer: 1,
        spiritist: 1,
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
    const preset = getRolePresetsForPlayerCount(9, roleIds)[0];

    if (preset === undefined) {
      throw new Error("Expected a nine-player role preset.");
    }

    const expandedRoleCounts = expandRolePresetCounts(preset, roleIds);

    expect(getMatchingRolePreset(9, expandedRoleCounts, roleIds)?.id).toBe(preset.id);
    expect(
      getMatchingRolePreset(
        9,
        {
          ...expandedRoleCounts,
          hunter: 1,
          villager: 2,
        },
        roleIds,
      ),
    ).toBeNull();
  });

  it("uses supplied role ids as the match universe", () => {
    const preset = getRolePresetsForPlayerCount(9, roleIds)[0];
    const extendedRoleIds = [...roleIds, "custom_role"];

    if (preset === undefined) {
      throw new Error("Expected a nine-player role preset.");
    }

    expect(
      getMatchingRolePreset(9, expandRolePresetCounts(preset, extendedRoleIds), extendedRoleIds)
        ?.id,
    ).toBe(preset.id);
    expect(
      getMatchingRolePreset(
        9,
        {
          ...expandRolePresetCounts(preset, extendedRoleIds),
          custom_role: 1,
        },
        extendedRoleIds,
      ),
    ).toBeNull();
  });

  it("defines server-valid role counts whose totals match the preset player count", () => {
    for (const preset of ROLE_PRESETS) {
      const expandedRoleCounts = expandRolePresetCounts(preset, roleIds);
      const totalRoles = roleIds.reduce(
        (total, roleId) => total + (expandedRoleCounts[roleId] ?? 0),
        0,
      );
      const ruleSet = normalizeRuleSetInput({ roleCounts: expandedRoleCounts }, preset.playerCount);

      expect(totalRoles).toBe(preset.playerCount);
      expect(validateRuleSet(ruleSet, preset.playerCount).ok).toBe(true);
    }
  });
});
