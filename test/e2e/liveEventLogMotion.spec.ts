import { expect, test, type Page } from "playwright/test";

import { createStartedRoom, submitOpenActions } from "./support/api";

test("an open public log reveals only accepted new event rows", async ({ page, request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Aster", "Birch", "Cedar"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Event log motion test host was not created.");
  }

  await installEventLogMotionHistory(page);
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 8_000 });

  const publicLogButton = page.getByRole("button", { exact: true, name: /Public log/u });

  await publicLogButton.click();

  const publicLogDialog = page.getByRole("dialog", { name: "Public log" });
  const eventRows = publicLogDialog.locator("[data-live-event-id]");

  await expect(publicLogDialog).toBeVisible();
  const initialEventCount = await eventRows.count();

  expect(await readEventLogMotionHistory(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(publicLogDialog).toHaveCount(0, { timeout: 2_000 });
  await publicLogButton.click();
  await expect(publicLogDialog).toBeVisible();
  expect(await readEventLogMotionHistory(page)).toEqual([]);

  await submitOpenActions(request, roomCode, players);
  await expect(page.locator('[data-live-effect="phase"][data-phase="day"]')).toBeVisible({
    timeout: 8_000,
  });
  await expect.poll(() => eventRows.count()).toBeGreaterThan(initialEventCount);
  const addedEventCount = (await eventRows.count()) - initialEventCount;

  expect(await readEventLogMotionHistory(page)).toEqual([]);
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 6_000 });
  await expect.poll(() => readEventLogMotionHistory(page)).toEqual([Math.min(addedEventCount, 6)]);
  await expect(publicLogDialog.locator("[data-live-event-log-motion-count]")).toHaveCount(0, {
    timeout: 2_000,
  });

  const transientRows = await eventRows.evaluateAll((rows) =>
    rows
      .filter((row) => row.hasAttribute("data-live-event-log-motion"))
      .map((row) => row.getAttribute("style")),
  );

  expect(transientRows).toEqual([]);
});

test("reduced motion updates an open event log without transient choreography", async ({
  page,
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Dawn", "Elm", "Fir"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Reduced-motion event log test host was not created.");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await installEventLogMotionHistory(page);
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 4_000 });
  await page.getByRole("button", { exact: true, name: /Public log/u }).click();

  const publicLogDialog = page.getByRole("dialog", { name: "Public log" });
  const eventRows = publicLogDialog.locator("[data-live-event-id]");

  await expect(publicLogDialog).toBeVisible();
  const initialEventCount = await eventRows.count();

  await submitOpenActions(request, roomCode, players);
  await expect.poll(() => eventRows.count()).toBeGreaterThan(initialEventCount);
  await expect(page.locator("[data-live-effect]")).toHaveCount(0, { timeout: 4_000 });
  expect(await readEventLogMotionHistory(page)).toEqual([]);
  await expect(publicLogDialog.locator("[data-live-event-log-motion]")).toHaveCount(0);
});

async function installEventLogMotionHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const motionHistory: number[] = [];

    Object.defineProperty(window, "__liveEventLogMotionHistory", { value: motionHistory });
    new MutationObserver((records) => {
      for (const record of records) {
        if (!(record.target instanceof HTMLElement)) {
          continue;
        }

        const count = Number(record.target.getAttribute("data-live-event-log-motion-count"));

        if (Number.isInteger(count) && count > 0) {
          motionHistory.push(count);
        }
      }
    }).observe(document, {
      attributeFilter: ["data-live-event-log-motion-count"],
      attributes: true,
      subtree: true,
    });
  });
}

async function readEventLogMotionHistory(page: Page): Promise<readonly number[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          readonly __liveEventLogMotionHistory: readonly number[];
        }
      ).__liveEventLogMotionHistory,
  );
}
