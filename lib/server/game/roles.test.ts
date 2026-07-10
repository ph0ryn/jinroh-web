import { describe, expect, it } from "vitest";

import { makeDefaultRoleCounts } from "./roles";

describe("makeDefaultRoleCounts", () => {
  it("does not include foxes in the default setup", () => {
    for (let playerCount = 3; playerCount <= 11; playerCount += 1) {
      expect(makeDefaultRoleCounts(playerCount)["fox"]).toBe(0);
    }
  });
});
