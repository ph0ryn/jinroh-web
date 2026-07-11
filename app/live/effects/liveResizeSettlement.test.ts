import { describe, expect, it } from "vitest";

import { hasMeaningfulLiveElementResize } from "./liveResizeSettlement";

describe("live resize settlement", () => {
  it("ignores subpixel layout noise", () => {
    expect(
      hasMeaningfulLiveElementResize(
        { height: 390, width: 844 },
        { height: 390.75, width: 843.25 },
      ),
    ).toBe(false);
  });

  it("settles when either dimension changes by more than one pixel", () => {
    expect(
      hasMeaningfulLiveElementResize({ height: 390, width: 844 }, { height: 390, width: 842 }),
    ).toBe(true);
    expect(
      hasMeaningfulLiveElementResize({ height: 390, width: 844 }, { height: 392, width: 844 }),
    ).toBe(true);
  });
});
