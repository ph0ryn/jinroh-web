import { describe, expect, it } from "vitest";

import { createDefaultDisplayName, DEFAULT_DISPLAY_NAMES } from "./liveDefaultDisplayName";

describe("default display name", () => {
  it("selects from a broad neutral English name set", () => {
    expect(DEFAULT_DISPLAY_NAMES).toHaveLength(1024);
    expect(new Set(DEFAULT_DISPLAY_NAMES).size).toBe(DEFAULT_DISPLAY_NAMES.length);
    expect(createDefaultDisplayName(() => 0)).toBe("Amber Badger");
    expect(createDefaultDisplayName(() => 1023)).toBe("Wise Wren");
    expect(DEFAULT_DISPLAY_NAMES.every((name) => name.length <= 32)).toBe(true);
  });

  it("rejects the modulo-bias tail before selecting a name", () => {
    const values = [0xffff_ffff, 1];

    expect(
      createDefaultDisplayName(() => {
        const value = values.shift();

        if (value === undefined) {
          throw new Error("Missing test entropy.");
        }

        return value;
      }, ["A", "B", "C"]),
    ).toBe("B");
    expect(values).toHaveLength(0);
  });
});
