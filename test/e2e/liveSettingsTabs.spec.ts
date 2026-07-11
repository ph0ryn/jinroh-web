import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer } from "./support/api";

import type { APIRequestContext, Page } from "playwright/test";

test("settings tabs animate with keyboard semantics and isolate the outgoing panel", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const host = await createWaitingRoom(request);

  page.on("pageerror", (error) => errors.push(error.message));
  await openWaitingRoomAsPlayer(page, host.token);

  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await settingsButton.click();

  const dialog = page.getByRole("dialog", { name: "Game settings" });
  const root = dialog.locator("[data-live-settings-tab-root]");
  const generalTab = dialog.getByRole("tab", { name: "General" });
  const timersTab = dialog.getByRole("tab", { name: "Timers" });
  const rolesTab = dialog.getByRole("tab", { name: "Roles" });
  const generalPanel = dialog.locator("#start-settings-general-panel");
  const timersPanel = dialog.locator("#start-settings-timers-panel");

  await expect(generalTab).toHaveAttribute("aria-selected", "true");
  await expect(generalPanel).toBeVisible();
  await expect(timersPanel).toBeHidden();

  await generalTab.focus();
  await page.keyboard.press("ArrowRight");

  await expect(timersTab).toBeFocused();
  await expect(timersTab).toHaveAttribute("aria-selected", "true");
  await expect(root).toHaveAttribute("data-live-settings-tab-motion-kind", "switch");
  await expect(generalPanel).toHaveAttribute("data-live-settings-panel-state", "outgoing");
  await expect(generalPanel).toHaveAttribute("aria-hidden", "true");
  await expect
    .poll(() =>
      generalPanel.evaluate((panel) => (panel instanceof HTMLElement ? panel.inert : false)),
    )
    .toBe(true);
  await expect(timersPanel).toHaveAttribute("data-live-settings-panel-state", "active");

  await expect(root).not.toHaveAttribute("data-live-settings-tab-motion-kind", /.+/u, {
    timeout: 2_000,
  });
  await expect(generalPanel).toBeHidden();
  await expect(timersPanel).toBeVisible();
  await expectSettingsTabMotionStylesToBeClear(root);

  await page.keyboard.press("End");
  await expect(rolesTab).toBeFocused();
  await expect(rolesTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(generalTab).toBeFocused();
  await expect(generalTab).toHaveAttribute("aria-selected", "true");
  await expect(root).not.toHaveAttribute("data-live-settings-tab-motion-kind", /.+/u, {
    timeout: 2_000,
  });
  await expectOnlyPanelToBeInteractive(dialog, "general");
  expect(errors).toEqual([]);
});

test("rapid settings tab changes settle latest and preserve every draft field", async ({
  page,
  request,
}) => {
  const host = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token);
  await page.getByRole("button", { exact: true, name: "Settings" }).click();

  const dialog = page.getByRole("dialog", { name: "Game settings" });
  const root = dialog.locator("[data-live-settings-tab-root]");
  const orderedSpeech = dialog.getByRole("radio", { name: /Ordered speech/u });

  await selectDayMode(dialog, "Ordered speech");
  await dialog.getByRole("tab", { name: "Timers" }).click();

  const firstNight = dialog.getByLabel("First night");

  await firstNight.fill("75");
  await page.evaluate(async () => {
    const delay = () => new Promise<void>((resolve) => window.setTimeout(resolve, 40));
    const clickTab = (tab: string) =>
      document.querySelector<HTMLButtonElement>(`[data-live-settings-tab="${tab}"]`)?.click();

    clickTab("roles");
    await delay();
    clickTab("timers");
    await delay();
    clickTab("general");
  });

  await expect(dialog.getByRole("tab", { name: "General" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(root).not.toHaveAttribute("data-live-settings-tab-motion-kind", /.+/u, {
    timeout: 2_000,
  });
  await expect(orderedSpeech).toBeChecked();
  await expectOnlyPanelToBeInteractive(dialog, "general");

  await dialog.getByRole("tab", { name: "Timers" }).click();
  await expect(firstNight).toHaveValue("75");
  await expect(root).not.toHaveAttribute("data-live-settings-tab-motion-kind", /.+/u, {
    timeout: 2_000,
  });
  await expectSettingsTabMotionStylesToBeClear(root);
});

test("cancel discards settings drafts while apply commits them", async ({ page, request }) => {
  const host = await createWaitingRoom(request);

  await openWaitingRoomAsPlayer(page, host.token);

  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await settingsButton.click();

  let dialog = page.getByRole("dialog", { name: "Game settings" });

  await selectDayMode(dialog, "Ordered speech");
  await dialog.getByRole("button", { exact: true, name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 2_000 });

  await settingsButton.click();
  dialog = page.getByRole("dialog", { name: "Game settings" });
  await expect(dialog.getByRole("radio", { name: /Ready check/u })).toBeChecked();
  await selectDayMode(dialog, "Ordered speech");
  await dialog.getByRole("button", { exact: true, name: "Apply settings" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 2_000 });

  await settingsButton.click();
  dialog = page.getByRole("dialog", { name: "Game settings" });
  await expect(dialog.getByRole("radio", { name: /Ordered speech/u })).toBeChecked();
});

test("reduced motion settles settings tabs without markers or transient styles", async ({
  page,
  request,
}) => {
  const host = await createWaitingRoom(request);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWaitingRoomAsPlayer(page, host.token);
  await page.getByRole("button", { exact: true, name: "Settings" }).click();

  const dialog = page.getByRole("dialog", { name: "Game settings" });
  const root = dialog.locator("[data-live-settings-tab-root]");

  await dialog.getByRole("tab", { name: "Roles" }).click();
  await expect(dialog.getByRole("tab", { name: "Roles" })).toHaveAttribute("aria-selected", "true");
  await expect(root).not.toHaveAttribute("data-live-settings-tab-motion-kind", /.+/u);
  await expectOnlyPanelToBeInteractive(dialog, "roles");
  await expectSettingsTabMotionStylesToBeClear(root);
});

test("mobile tab navigation reveals the selection and cleans up when the dialog exits", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const host = await createWaitingRoom(request);

  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ height: 812, width: 375 });
  await openWaitingRoomAsPlayer(page, host.token);

  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await settingsButton.click();

  const dialog = page.getByRole("dialog", { name: "Game settings" });
  const generalTab = dialog.getByRole("tab", { name: "General" });
  const rolesTab = dialog.getByRole("tab", { name: "Roles" });

  await generalTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(rolesTab).toBeFocused();
  await expect.poll(() => readHorizontalVisibility(dialog, rolesTab)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0, { timeout: 2_000 });
  await expect(settingsButton).toBeFocused();
  expect(errors).toEqual([]);
});

async function createWaitingRoom(
  request: APIRequestContext,
): Promise<Awaited<ReturnType<typeof createApiPlayer>>> {
  const host = await createApiPlayer(request, "host", "Aster");

  await apiFetch(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  return host;
}

async function openWaitingRoomAsPlayer(page: Page, identityToken: string): Promise<void> {
  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem("jinrohWeb.identityToken", token);
      window.localStorage.setItem("jinrohWeb.locale", "en");
    },
    { token: identityToken },
  );
  await page.goto("/live");
  await expect(page.getByRole("button", { exact: true, name: "Settings" })).toBeVisible();
}

async function expectOnlyPanelToBeInteractive(
  dialog: ReturnType<Page["getByRole"]>,
  activeTab: "general" | "roles" | "timers",
): Promise<void> {
  for (const tab of ["general", "timers", "roles"] as const) {
    const panel = dialog.locator(`#start-settings-${tab}-panel`);

    if (tab === activeTab) {
      await expect(panel).toBeVisible();
      await expect(panel).not.toHaveAttribute("aria-hidden", "true");
      await expect
        .poll(() =>
          panel.evaluate((element) => (element instanceof HTMLElement ? element.inert : true)),
        )
        .toBe(false);
    } else {
      await expect(panel).toBeHidden();
      await expect
        .poll(() =>
          panel.evaluate((element) => (element instanceof HTMLElement ? element.inert : false)),
        )
        .toBe(true);
    }
  }
}

async function selectDayMode(
  dialog: ReturnType<Page["getByRole"]>,
  title: "Ordered speech" | "Ready check",
): Promise<void> {
  await dialog.locator("label.liveSettingsChoice").filter({ hasText: title }).click();
}

async function expectSettingsTabMotionStylesToBeClear(
  root: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect
    .poll(() =>
      root.evaluate((element) => {
        const motionElements = element.querySelectorAll<HTMLElement>(
          "[data-live-settings-tab-indicator], [data-live-settings-panel-motion]",
        );

        return [...motionElements].every(
          (motionElement) =>
            motionElement.style.opacity === "" &&
            motionElement.style.transform === "" &&
            motionElement.style.transformOrigin === "" &&
            motionElement.style.willChange === "",
        );
      }),
    )
    .toBe(true);
}

async function readHorizontalVisibility(
  dialog: ReturnType<Page["getByRole"]>,
  tab: ReturnType<Page["getByRole"]>,
): Promise<boolean> {
  const tabList = dialog.getByRole("tablist");
  const [tabListBox, tabBox] = await Promise.all([tabList.boundingBox(), tab.boundingBox()]);

  return (
    tabListBox !== null &&
    tabBox !== null &&
    tabBox.x >= tabListBox.x - 1 &&
    tabBox.x + tabBox.width <= tabListBox.x + tabListBox.width + 1
  );
}
