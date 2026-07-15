import { describe, expect, it } from "vitest";

import { CoreActionKind, getCoreActionDefinition } from "./coreActions";

describe("core action definitions", () => {
  it("owns targetless presentation without confirmation copy", () => {
    const definition = getCoreActionDefinition(CoreActionKind.FirstNightReady);

    expect(definition.targetKind).toBe("none");

    if (definition.targetKind !== "none") {
      throw new Error("First-night readiness must remain targetless.");
    }

    expect(definition.presentation.en).not.toHaveProperty("targetConfirmation");
    expect(definition.presentation.ja).not.toHaveProperty("targetConfirmation");
  });

  it("owns confirmation copy for a single-player action", () => {
    const definition = getCoreActionDefinition(CoreActionKind.Vote);

    expect(definition.targetKind).toBe("single_player");

    if (definition.targetKind !== "single_player") {
      throw new Error("Voting must remain a single-player action.");
    }

    expect(definition.presentation.ja.targetConfirmation.afterTarget).toBe("に投票しますか？");
  });

  it("rejects unknown core action kinds instead of returning generic copy", () => {
    expect(() => getCoreActionDefinition("unknown_core_action")).toThrow(
      "Unknown core action: unknown_core_action",
    );
  });
});
