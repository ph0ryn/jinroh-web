import { afterEach, describe, expect, it, vi } from "vitest";

import { isAuthorizedMaintenanceRequest } from "./maintenanceAuth";

describe("maintenance request authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the configured bearer credential", () => {
    vi.stubEnv("MAINTENANCE_SECRET", "test-maintenance-secret-containing-at-least-32-bytes");

    expect(
      isAuthorizedMaintenanceRequest(
        new Request("https://jinroh.example/api/maintenance", {
          headers: {
            authorization: "Bearer test-maintenance-secret-containing-at-least-32-bytes",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isAuthorizedMaintenanceRequest(
        new Request("https://jinroh.example/api/maintenance", {
          headers: { authorization: "Bearer incorrect-secret" },
        }),
      ),
    ).toBe(false);
    expect(
      isAuthorizedMaintenanceRequest(new Request("https://jinroh.example/api/maintenance")),
    ).toBe(false);
  });

  it("rejects a short configured secret", () => {
    vi.stubEnv("MAINTENANCE_SECRET", "short");

    expect(() =>
      isAuthorizedMaintenanceRequest(
        new Request("https://jinroh.example/api/maintenance", {
          headers: { authorization: "Bearer short" },
        }),
      ),
    ).toThrow(/at least 32 bytes/u);
  });
});
