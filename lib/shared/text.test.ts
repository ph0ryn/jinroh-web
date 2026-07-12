import { describe, expect, it } from "vitest";

import { getCodePointLength, truncateCodePoints } from "./text";

describe("Unicode code point constraints", () => {
  it("counts supplementary characters like PostgreSQL char_length", () => {
    expect(getCodePointLength("a😀b")).toBe(3);
  });

  it("truncates without splitting a surrogate pair", () => {
    expect(truncateCodePoints("a😀b", 2)).toBe("a😀");
  });
});
