import { describe, expect, it } from "vitest";

import {
  createLiveSettingsTabState,
  getLiveSettingsTabNavigation,
  requestLiveSettingsTab,
  settleLiveSettingsTab,
} from "./liveSettingsTabModel";

describe("live settings tab model", () => {
  it("starts on the general tab without an outgoing panel", () => {
    expect(createLiveSettingsTabState()).toEqual({
      activeTab: "general",
      direction: 1,
      generation: 0,
      outgoingTab: null,
    });
  });

  it("derives pointer navigation direction from tab order", () => {
    const initial = createLiveSettingsTabState();
    const roles = requestLiveSettingsTab(initial, "roles");
    const timers = requestLiveSettingsTab(roles, "timers");

    expect(roles).toMatchObject({
      activeTab: "roles",
      direction: 1,
      generation: 1,
      outgoingTab: "general",
    });
    expect(timers).toMatchObject({
      activeTab: "timers",
      direction: -1,
      generation: 2,
      outgoingTab: "roles",
    });
  });

  it("keeps only the latest active and outgoing panels during rapid requests", () => {
    const initial = createLiveSettingsTabState();
    const timers = requestLiveSettingsTab(initial, "timers");
    const roles = requestLiveSettingsTab(timers, "roles");

    expect(roles).toEqual({
      activeTab: "roles",
      direction: 1,
      generation: 2,
      outgoingTab: "timers",
    });
  });

  it("models a reversal without allocating a third visible panel", () => {
    const initial = createLiveSettingsTabState();
    const timers = requestLiveSettingsTab(initial, "timers");
    const general = requestLiveSettingsTab(timers, "general");

    expect(general).toEqual({
      activeTab: "general",
      direction: -1,
      generation: 2,
      outgoingTab: "timers",
    });
  });

  it("treats selecting the active tab as a no-op", () => {
    const state = createLiveSettingsTabState();

    expect(requestLiveSettingsTab(state, "general")).toBe(state);
  });

  it("ignores stale settlement generations", () => {
    const timers = requestLiveSettingsTab(createLiveSettingsTabState(), "timers");
    const roles = requestLiveSettingsTab(timers, "roles");

    expect(settleLiveSettingsTab(roles, timers.generation)).toBe(roles);
    expect(settleLiveSettingsTab(roles, roles.generation)).toEqual({
      ...roles,
      outgoingTab: null,
    });
  });

  it("wraps arrow navigation while preserving input direction", () => {
    expect(getLiveSettingsTabNavigation("roles", "ArrowRight")).toEqual({
      direction: 1,
      tab: "general",
    });
    expect(getLiveSettingsTabNavigation("general", "ArrowLeft")).toEqual({
      direction: -1,
      tab: "roles",
    });
  });

  it("supports Home and End and ignores unrelated keys", () => {
    expect(getLiveSettingsTabNavigation("timers", "Home")).toEqual({
      direction: -1,
      tab: "general",
    });
    expect(getLiveSettingsTabNavigation("general", "End")).toEqual({
      direction: 1,
      tab: "roles",
    });
    expect(getLiveSettingsTabNavigation("general", "Enter")).toBeNull();
  });
});
