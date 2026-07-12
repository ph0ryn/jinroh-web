import { expect, test, type Page } from "playwright/test";

import { apiFetch, createApiPlayer } from "./support/api";

test("setup entry and accepted room creation reveal only their incoming regions", async ({
  page,
}) => {
  await installSetupMotionHistory(page);
  await page.addInitScript(() => window.localStorage.setItem("jinrohWeb.locale", "en"));
  await page.goto("/live");

  const shell = page.locator(".liveShell");

  await expect.poll(() => readSetupMotionHistory(page)).toContain("entry");
  await expect(page.locator('[data-live-setup-transition-item="entry"]')).toBeVisible();
  await expect(shell).not.toHaveAttribute("data-live-setup-motion-kind", /.+/u, {
    timeout: 2_000,
  });

  await page.getByRole("button", { name: "Create room" }).click();
  await expect.poll(() => readSetupMotionHistory(page)).toContain("waiting");

  const waitingTargets = page.locator('[data-live-setup-transition-item="waiting"]');

  await expect(waitingTargets).toHaveCount(2);
  await expect(shell).not.toHaveAttribute("data-live-setup-motion-kind", /.+/u, {
    timeout: 2_000,
  });
  const transientStyles = await waitingTargets.evaluateAll((targets) =>
    targets.map((target) => target.getAttribute("style")),
  );

  expect(transientStyles).toEqual([null, null]);
});

test("a restored waiting room is a settled baseline", async ({ page, request }) => {
  const host = await createApiPlayer(request, "host", "Dawn");
  const room = await apiFetch<{ code: string }>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  await installSetupMotionHistory(page);
  await page.addInitScript(
    ({ identityToken }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", identityToken);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { identityToken: host.token },
  );
  await page.goto("/live");

  const shell = page.locator(".liveShell");
  const waitingTargets = page.locator('[data-live-setup-transition-item="waiting"]');

  await expect(page.locator("[data-live-room-code]:visible strong")).toHaveText(room.code);
  await expect(waitingTargets).toHaveCount(2);
  await expect(shell).not.toHaveAttribute("data-live-setup-motion-kind", /.+/u);
  const transientStyles = await waitingTargets.evaluateAll((targets) =>
    targets.map((target) => target.getAttribute("style")),
  );

  expect(transientStyles).toEqual([null, null]);
  expect(await readSetupMotionHistory(page)).toEqual([]);
});

test("reduced motion settles setup changes without transient properties", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installSetupMotionHistory(page);
  await page.addInitScript(() => window.localStorage.setItem("jinrohWeb.locale", "en"));
  await page.goto("/live");

  const shell = page.locator(".liveShell");

  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
  await expect(shell).not.toHaveAttribute("data-live-setup-motion-kind", /.+/u);
  await page.getByRole("button", { name: "Create room" }).click();

  const waitingTargets = page.locator('[data-live-setup-transition-item="waiting"]');

  await expect(waitingTargets).toHaveCount(2, { timeout: 8_000 });
  await expect(shell).not.toHaveAttribute("data-live-setup-motion-kind", /.+/u);
  const transientStyles = await waitingTargets.evaluateAll((targets) =>
    targets.map((target) => target.getAttribute("style")),
  );

  expect(transientStyles).toEqual([null, null]);
  expect(await readSetupMotionHistory(page)).toEqual([]);
});

test("hiding mid-entry settles once and visibility restore does not replay", async ({ page }) => {
  await installSetupMotionHistory(page);
  await page.addInitScript(() => window.localStorage.setItem("jinrohWeb.locale", "en"));
  await page.goto("/live");

  await expect.poll(() => readSetupMotionHistory(page)).toContain("entry");
  await setDocumentVisibility(page, "hidden");

  const shell = page.locator(".liveShell");
  const entryTarget = page.locator('[data-live-setup-transition-item="entry"]');

  await expect(shell).not.toHaveAttribute("data-live-setup-motion-kind", /.+/u);
  await expect(entryTarget).not.toHaveAttribute(
    "style",
    /(?:opacity|transform|visibility|will-change)/u,
  );
  await setDocumentVisibility(page, "visible");
  await page.waitForTimeout(700);
  expect(await readSetupMotionHistory(page)).toEqual(["entry"]);
});

async function installSetupMotionHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const motionHistory: string[] = [];

    Object.defineProperty(window, "__liveSetupMotionHistory", { value: motionHistory });
    new MutationObserver((records) => {
      for (const record of records) {
        if (!(record.target instanceof HTMLElement)) {
          continue;
        }

        const kind = record.target.getAttribute("data-live-setup-motion-kind");

        if (kind !== null) {
          motionHistory.push(kind);
        }
      }
    }).observe(document, {
      attributeFilter: ["data-live-setup-motion-kind"],
      attributes: true,
      subtree: true,
    });
  });
}

async function readSetupMotionHistory(page: Page): Promise<readonly string[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          readonly __liveSetupMotionHistory: readonly string[];
        }
      ).__liveSetupMotionHistory,
  );
}

async function setDocumentVisibility(page: Page, visibility: "hidden" | "visible"): Promise<void> {
  await page.evaluate((nextVisibility) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: nextVisibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibility);
}
