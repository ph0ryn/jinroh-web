import type { Page } from "playwright/test";

export type LiveListMotionRecord = {
  readonly count: number;
  readonly kind: string;
};

export async function installListMotionHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const motionHistory: LiveListMotionRecord[] = [];

    Object.defineProperty(window, "__liveListMotionHistory", { value: motionHistory });
    new MutationObserver((records) => {
      for (const record of records) {
        if (!(record.target instanceof HTMLElement)) {
          continue;
        }

        const kind = record.target.getAttribute("data-live-list-motion-kind");
        const count = Number(record.target.getAttribute("data-live-list-motion-count"));

        if (kind !== null && Number.isInteger(count) && count > 0) {
          motionHistory.push({ count, kind });
        }
      }
    }).observe(document, {
      attributeFilter: ["data-live-list-motion-count"],
      attributes: true,
      subtree: true,
    });
  });
}

export async function readListMotionHistory(page: Page): Promise<readonly LiveListMotionRecord[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          readonly __liveListMotionHistory: readonly LiveListMotionRecord[];
        }
      ).__liveListMotionHistory,
  );
}
