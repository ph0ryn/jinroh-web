import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasMeaningfulLiveElementResize,
  observeMeaningfulLiveElementResize,
} from "./liveResizeSettlement";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("treats exactly one pixel as settlement noise", () => {
    expect(
      hasMeaningfulLiveElementResize({ height: 390, width: 844 }, { height: 391, width: 843 }),
    ).toBe(false);
  });

  it("observes each element once and settles only the first meaningful resize", () => {
    const observerHarness: { callback?: ResizeObserverCallback } = {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    const onResize = vi.fn();
    const rect = { height: 390, width: 844 };
    const element = {
      getBoundingClientRect: () => rect,
    } as unknown as Element;

    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observerHarness.callback = callback;
        }

        readonly disconnect = disconnect;
        readonly observe = observe;
      },
    );

    const cleanup = observeMeaningfulLiveElementResize([element, element], onResize);

    expect(observe).toHaveBeenCalledTimes(1);

    rect.width = 843;
    emitResize(observerHarness.callback, element);
    expect(onResize).not.toHaveBeenCalled();

    rect.height = 392;
    emitResize(observerHarness.callback, element);
    emitResize(observerHarness.callback, element);

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);

    cleanup();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});

function emitResize(callback: ResizeObserverCallback | undefined, element: Element): void {
  if (callback === undefined) {
    throw new Error("ResizeObserver callback was not registered.");
  }

  callback([{ target: element } as ResizeObserverEntry], {} as ResizeObserver);
}
