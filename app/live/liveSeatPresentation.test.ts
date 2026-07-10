import { describe, expect, it } from "vitest";

import { enLocalization } from "@/lib/i18n/localization/en";

import { getLiveSeatPresentation } from "./liveSeatPresentation";

import type { PublicGameView, PublicPlayer, RoomSummary } from "@/lib/shared/game";

const BASE_PLAYER: PublicPlayer = {
  alive: true,
  displayName: "Alice",
  id: "public-player-1",
  isCurrent: false,
  isHost: false,
  status: "joined",
};

describe("getLiveSeatPresentation", () => {
  it.each([
    {
      expectedAriaLabels: ["Alive"],
      expectedState: "active",
      expectedVisibleLabel: null,
      name: "ordinary living player",
      player: {},
    },
    {
      expectedAriaLabels: ["Alive", "You"],
      expectedState: "active",
      expectedVisibleLabel: "You",
      name: "current player",
      player: { isCurrent: true },
    },
    {
      expectedAriaLabels: ["Alive", "Host"],
      expectedState: "active",
      expectedVisibleLabel: "Host",
      name: "host",
      player: { isHost: true },
    },
    {
      expectedAriaLabels: ["Speaking", "You", "Host"],
      expectedState: "speaking",
      expectedVisibleLabel: "Speaking",
      focusKind: "current_speaker",
      name: "current speaker takes visual priority over identity badges",
      player: { isCurrent: true, isHost: true },
    },
    {
      expectedAriaLabels: ["Execution"],
      expectedState: "execution",
      expectedVisibleLabel: "Execution",
      focusKind: "execution_candidate",
      name: "execution candidate",
      player: {},
    },
    {
      expectedAriaLabels: ["Disconnected"],
      expectedState: "disconnected",
      expectedVisibleLabel: "Disconnected",
      focusKind: "current_speaker",
      name: "connection status takes priority over stale phase focus",
      player: { status: "disconnected" },
    },
    {
      expectedAriaLabels: ["Left"],
      expectedState: "left",
      expectedVisibleLabel: "Left",
      name: "player who left",
      player: { status: "left" },
    },
    {
      expectedAriaLabels: ["Out", "You"],
      expectedState: "eliminated",
      expectedVisibleLabel: "Out",
      focusKind: "current_speaker",
      name: "elimination takes priority over stale phase focus",
      player: { alive: false, isCurrent: true },
    },
  ] as const)(
    "$name",
    ({ expectedAriaLabels, expectedState, expectedVisibleLabel, focusKind, player }) => {
      const publicPlayer = { ...BASE_PLAYER, ...player };
      const summary = createSummary(
        publicPlayer,
        focusKind === undefined ? null : { kind: focusKind, playerId: publicPlayer.id },
      );

      expect(getLiveSeatPresentation(publicPlayer, summary, enLocalization)).toEqual({
        ariaLabels: expectedAriaLabels,
        state: expectedState,
        visibleLabel: expectedVisibleLabel,
      });
    },
  );

  it("does not infer individual state from phase, array position, or aggregate progress", () => {
    const otherPlayer = { ...BASE_PLAYER, displayName: "Bob", id: "public-player-2" };
    const firstSummary = createSummary(BASE_PLAYER, null, {
      actionProgress: {
        kind: "votes_submitted",
        label: "Votes submitted.",
        required: 2,
        submitted: 0,
        visibility: "public",
      },
      phase: "voting",
      players: [BASE_PLAYER, otherPlayer],
    });
    const secondSummary = createSummary(BASE_PLAYER, null, {
      actionProgress: {
        kind: "votes_submitted",
        label: "Votes submitted.",
        required: 2,
        submitted: 2,
        visibility: "public",
      },
      phase: "night",
      players: [otherPlayer, BASE_PLAYER],
    });

    expect(getLiveSeatPresentation(BASE_PLAYER, firstSummary, enLocalization)).toEqual(
      getLiveSeatPresentation(BASE_PLAYER, secondSummary, enLocalization),
    );
  });
});

function createSummary(
  player: PublicPlayer,
  phaseFocus: PublicGameView["phaseFocus"],
  overrides: {
    readonly actionProgress?: PublicGameView["actionProgress"];
    readonly phase?: PublicGameView["phase"];
    readonly players?: readonly PublicPlayer[];
  } = {},
): RoomSummary {
  return {
    code: "123456",
    currentPlayerId: player.isCurrent ? player.id : null,
    defaultRoleCounts: {},
    game: {
      actionProgress: overrides.actionProgress ?? null,
      dayNumber: 1,
      events: [],
      nightNumber: 1,
      phase: overrides.phase ?? "day",
      phaseEndsAt: null,
      phaseFocus,
      phaseInstanceId: "phase-1",
      revision: 1,
      status: "playing",
      winnerTeam: null,
    },
    hostPlayerId: player.isHost ? player.id : null,
    isHost: player.isHost,
    lobbyExpiresAt: "2099-01-01T00:00:00.000Z",
    players: [...(overrides.players ?? [player])],
    roleCatalog: [],
    rolePrivate: null,
    self: null,
    snapshotRevision: 1,
    status: "playing",
    targetPlayerCount: 3,
  };
}
