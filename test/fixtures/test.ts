import { test as baseTest, expect } from "playwright/test";

import { LivePage } from "./livePage";

type BrowserFixtures = {
  readonly live: LivePage;
};

export const test = baseTest.extend<BrowserFixtures>({
  live: async ({ page }, use) => {
    await use(new LivePage(page));
  },
});

export { expect };
