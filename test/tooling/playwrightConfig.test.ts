import { describe, expect, it } from "vitest";

import playwrightConfig from "../../playwright.config";

describe("Playwright orchestration", () => {
  it("uses explicit projects and gives the managed server time to handle SIGTERM", () => {
    expect(playwrightConfig.projects?.map(({ name }) => name)).toEqual(["integration", "browser"]);

    const configuredWebServer = playwrightConfig.webServer;
    const webServer = Array.isArray(configuredWebServer)
      ? configuredWebServer[0]
      : configuredWebServer;

    expect(webServer).toMatchObject({
      command: "node scripts/test/startTestServer.mjs",
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      reuseExistingServer: false,
    });
  });
});
