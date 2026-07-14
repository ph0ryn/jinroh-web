import { describe, expect, it } from "vitest";

import { makeDefaultRoleCounts, roleRegistry } from "./roles";
import { normalizeRuleSetInput, validateRuleSet } from "./ruleset";

describe("makeDefaultRoleCounts", () => {
  it("produces a complete, server-valid setup for every supported room size", () => {
    const roles = roleRegistry.getAll();
    const roleIds = roles.map((role) => role.id);

    for (let playerCount = 3; playerCount <= 10; playerCount += 1) {
      const roleCounts = makeDefaultRoleCounts(playerCount);
      const total = Object.values(roleCounts).reduce((sum, count) => sum + count, 0);

      expect(Object.keys(roleCounts).toSorted()).toEqual(roleIds.toSorted());
      expect(total).toBe(playerCount);

      for (const role of roles) {
        const count = roleCounts[role.id];

        expect(count).toBeGreaterThanOrEqual(role.minCount);

        if (role.maxCount !== null) {
          expect(count).toBeLessThanOrEqual(role.maxCount);
        }
      }

      expect(
        validateRuleSet(normalizeRuleSetInput({ roleCounts }, playerCount), playerCount).ok,
      ).toBe(true);
    }
  });
});
