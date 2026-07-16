import { describe, expect, it } from "vitest";

import { getDisplayNameValidationError, isValidDisplayName } from "./game";

describe("display name validation", () => {
  it.each(["A", "Ace Bear", "ABCDEFGH", "Wolf123", "12345678", "7 Wolves"])(
    "accepts %s",
    (displayName) => {
      expect(getDisplayNameValidationError(displayName)).toBeNull();
      expect(isValidDisplayName(displayName)).toBe(true);
    },
  );

  it.each([
    ["", "empty"],
    ["ABCDEFGHI", "tooLong"],
    ["A-B", "invalidCharacters"],
    [" Wolf", "invalidSpacing"],
    ["Wolf ", "invalidSpacing"],
    ["Big  Fox", "invalidSpacing"],
  ] as const)("rejects %j as %s", (displayName, expectedError) => {
    expect(getDisplayNameValidationError(displayName)).toBe(expectedError);
    expect(isValidDisplayName(displayName)).toBe(false);
  });
});
