import { describe, expect, it } from "vitest";

import { DEFAULT_START_RULE_SET_SETTINGS } from "./liveStartSettings";
import {
  getStartSettingsRoomSession,
  parseStartSettings,
  serializeStartSettings,
  type StartSettingsRoomSession,
} from "./liveStartSettingsStorage";

import type { RoleCatalogItem, RoomSummary } from "@/lib/shared/game";

const SESSION: StartSettingsRoomSession = {
  currentPlayerId: "pl_host",
  roomCode: "123456",
  targetPlayerCount: 3,
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
  it("restores settings for the same Room, host, and target count across Games", () => {
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
        { ...SESSION, currentPlayerId: "pl_next_host" },
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

  it("keeps host settings available from a completed Game result", () => {
    expect(getStartSettingsRoomSession(makeEndedSummary())).toEqual(SESSION);
    expect(getStartSettingsRoomSession({ ...makeEndedSummary(), status: "playing" })).toEqual(
      SESSION,
    );
  });
});

function makeEndedSummary(): RoomSummary {
  return {
    code: SESSION.roomCode,
    currentPlayerId: SESSION.currentPlayerId,
    defaultRoleCounts: {},
    game: {
      actionProgress: null,
      dayNumber: 1,
      events: [],
      gameId: "game-a",
      nightNumber: 1,
      phase: null,
      phaseEndsAt: null,
      phaseFocus: null,
      phaseInstanceId: null,
      revision: 1,
      status: "ended",
      winnerTeam: "villagers",
    },
    hostPlayerId: SESSION.currentPlayerId,
    isHost: true,
    players: [],
    roleCatalog: [...ROLE_CATALOG],
    rolePrivate: null,
    rosterRevision: 2,
    self: null,
    snapshotRevision: 2,
    status: "ended",
    targetPlayerCount: SESSION.targetPlayerCount,
    teamCatalog: [],
    lobbyExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}
