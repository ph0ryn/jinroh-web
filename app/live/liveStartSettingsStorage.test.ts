import { describe, expect, it } from "vitest";

import { DEFAULT_START_RULE_SET_SETTINGS } from "./liveStartSettings";
import {
  parseStartSettings,
  serializeStartSettings,
  type StartSettingsRoomSession,
} from "./liveStartSettingsStorage";

import type { RoleCatalogItem } from "@/lib/shared/game";

const SESSION: StartSettingsRoomSession = {
  currentPlayerId: "pl_host",
  roomCode: "123456",
  targetPlayerCount: 3,
  waitingExpiresAt: "2099-01-01T00:00:00.000Z",
};

const ROLE_CATALOG: readonly RoleCatalogItem[] = [
  {
    id: "villager",
    maxCount: null,
    minCount: 1,
    order: 1,
    presentation: {
      en: { description: "Villager", name: "Villager", shortLabel: "VI" },
      ja: { description: "村人", name: "村人", shortLabel: "村" },
    },
    specificOptions: [],
  },
];

describe("start settings storage", () => {
  it("restores settings only for the exact waiting-room session", () => {
    const settings = {
      ...DEFAULT_START_RULE_SET_SETTINGS,
      dayMode: "ordered_speech" as const,
      roleCounts: { villager: 3 },
    };
    const storedValue = serializeStartSettings(SESSION, settings);

    expect(parseStartSettings(storedValue, SESSION, ROLE_CATALOG)).toEqual(settings);
    expect(
      parseStartSettings(
        storedValue,
        { ...SESSION, waitingExpiresAt: "2099-01-02T00:00:00.000Z" },
        ROLE_CATALOG,
      ),
    ).toBeNull();
  });

  it("rejects stale role identifiers and malformed timing values", () => {
    const storedValue = JSON.parse(
      serializeStartSettings(SESSION, DEFAULT_START_RULE_SET_SETTINGS),
    ) as {
      settings: { firstNightSeconds: number; roleCounts: Record<string, number> };
    };

    storedValue.settings.firstNightSeconds = 0;
    expect(parseStartSettings(JSON.stringify(storedValue), SESSION, ROLE_CATALOG)).toBeNull();

    storedValue.settings.firstNightSeconds = 30;
    storedValue.settings.roleCounts = { removed_role: 3 };
    expect(parseStartSettings(JSON.stringify(storedValue), SESSION, ROLE_CATALOG)).toBeNull();
  });
});
