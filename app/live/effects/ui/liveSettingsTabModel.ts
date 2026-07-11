export type LiveSettingsTab = "general" | "roles" | "timers";

export type LiveSettingsTabDirection = -1 | 1;

export type LiveSettingsTabState = {
  readonly activeTab: LiveSettingsTab;
  readonly direction: LiveSettingsTabDirection;
  readonly generation: number;
  readonly outgoingTab: LiveSettingsTab | null;
};

export type LiveSettingsTabNavigation = {
  readonly direction: LiveSettingsTabDirection;
  readonly tab: LiveSettingsTab;
};

export const LIVE_SETTINGS_TABS: readonly LiveSettingsTab[] = ["general", "timers", "roles"];

export function createLiveSettingsTabState(): LiveSettingsTabState {
  return {
    activeTab: "general",
    direction: 1,
    generation: 0,
    outgoingTab: null,
  };
}

export function requestLiveSettingsTab(
  state: LiveSettingsTabState,
  tab: LiveSettingsTab,
  direction = getLiveSettingsTabDirection(state.activeTab, tab),
): LiveSettingsTabState {
  if (tab === state.activeTab) {
    return state;
  }

  return {
    activeTab: tab,
    direction,
    generation: state.generation + 1,
    outgoingTab: state.activeTab,
  };
}

export function settleLiveSettingsTab(
  state: LiveSettingsTabState,
  generation: number,
): LiveSettingsTabState {
  if (state.generation !== generation || state.outgoingTab === null) {
    return state;
  }

  return {
    ...state,
    outgoingTab: null,
  };
}

export function getLiveSettingsTabNavigation(
  tab: LiveSettingsTab,
  key: string,
): LiveSettingsTabNavigation | null {
  const currentIndex = LIVE_SETTINGS_TABS.indexOf(tab);

  switch (key) {
    case "ArrowRight":
      return {
        direction: 1,
        tab: LIVE_SETTINGS_TABS[(currentIndex + 1) % LIVE_SETTINGS_TABS.length] ?? tab,
      };
    case "ArrowLeft":
      return {
        direction: -1,
        tab:
          LIVE_SETTINGS_TABS[
            (currentIndex - 1 + LIVE_SETTINGS_TABS.length) % LIVE_SETTINGS_TABS.length
          ] ?? tab,
      };
    case "Home":
      return {
        direction: -1,
        tab: LIVE_SETTINGS_TABS[0] ?? tab,
      };
    case "End":
      return {
        direction: 1,
        tab: LIVE_SETTINGS_TABS.at(-1) ?? tab,
      };
    default:
      return null;
  }
}

function getLiveSettingsTabDirection(
  currentTab: LiveSettingsTab,
  nextTab: LiveSettingsTab,
): LiveSettingsTabDirection {
  return LIVE_SETTINGS_TABS.indexOf(nextTab) < LIVE_SETTINGS_TABS.indexOf(currentTab) ? -1 : 1;
}
