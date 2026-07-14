import { describe, expect, it } from "vitest";

import { getCodePointLength, truncateCodePoints } from "./text";

describe("Unicode code point constraints", () => {
  it.each([
    ["", 0],
    ["plain", 5],
    ["a😀b", 3],
    ["e\u0301", 2],
  ])("counts %j like PostgreSQL char_length", (value, expectedLength) => {
    expect(getCodePointLength(value)).toBe(expectedLength);
  });

  it("truncates by code point without splitting a surrogate pair", () => {
    expect(truncateCodePoints("a😀b", 0)).toBe("");
    expect(truncateCodePoints("a😀b", 2)).toBe("a😀");
    expect(truncateCodePoints("a😀b", 3)).toBe("a😀b");
    expect(truncateCodePoints("a😀b", 10)).toBe("a😀b");
  });
});
