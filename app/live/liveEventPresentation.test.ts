import { describe, expect, it } from "vitest";

import { localizations } from "@/lib/i18n/localization";

import { formatWinner } from "./liveEventPresentation";

describe("winner presentation", () => {
  it("renders an opaque team through the server-provided catalog", () => {
    const teamCatalog = [
      {
        id: "future_collective",
        presentation: { en: "Future Collective", ja: "未来陣営" },
      },
    ];

    expect(formatWinner("future_collective", teamCatalog, "en", localizations.en)).toBe(
      "Future Collective",
    );
    expect(formatWinner("future_collective", teamCatalog, "ja", localizations.ja)).toBe("未来陣営");
  });

  it("fails visibly instead of mislabeling an unknown team", () => {
    expect(formatWinner("unregistered_team", [], "en", localizations.en)).toBe("unregistered_team");
    expect(formatWinner(null, [], "en", localizations.en)).toBe(localizations.en.game.team.none);
  });
});
