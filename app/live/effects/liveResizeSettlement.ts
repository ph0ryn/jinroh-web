export type LiveElementSize = {
  readonly height: number;
  readonly width: number;
};

const LIVE_RESIZE_SETTLEMENT_THRESHOLD = 1;

export function hasMeaningfulLiveElementResize(
  baseline: LiveElementSize,
  next: LiveElementSize,
): boolean {
  return (
    Math.abs(next.width - baseline.width) > LIVE_RESIZE_SETTLEMENT_THRESHOLD ||
    Math.abs(next.height - baseline.height) > LIVE_RESIZE_SETTLEMENT_THRESHOLD
  );
}

export function observeMeaningfulLiveElementResize(
  elements: readonly Element[],
  onResize: () => void,
): () => void {
  if (typeof ResizeObserver === "undefined" || elements.length === 0) {
    return () => undefined;
  }

  const uniqueElements = [...new Set(elements)];
  const baselineByElement = new Map(
    uniqueElements.map((element) => [element, getElementSize(element)] as const),
  );
  let settled = false;
  const observer = new ResizeObserver((entries) => {
    if (settled) {
      return;
    }

    const didResize = entries.some((entry) => {
      const baseline = baselineByElement.get(entry.target);

      return (
        baseline !== undefined &&
        hasMeaningfulLiveElementResize(baseline, getElementSize(entry.target))
      );
    });

    if (!didResize) {
      return;
    }

    settled = true;
    observer.disconnect();
    onResize();
  });

  uniqueElements.forEach((element) => observer.observe(element));

  return () => observer.disconnect();
}

function getElementSize(element: Element): LiveElementSize {
  const rect = element.getBoundingClientRect();

  return { height: rect.height, width: rect.width };
}
