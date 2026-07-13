"use client";

import { useState } from "react";

import {
  getLocalizedRole,
  getLocalizedRolePreset,
  type Locale,
  type Localization,
} from "@/lib/i18n/localization";
import {
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type RoleCatalogItem,
  type RoleCounts,
  type RoleId,
  type RoleSpecificOptionItem,
} from "@/lib/shared/game";
import {
  expandRolePresetCounts,
  getMatchingRolePreset,
  getRolePresetsForPlayerCount,
  type RolePreset,
} from "@/lib/shared/rolePresets";

import { LiveModalFrame } from "./effects/ui/LiveModalFrame";
import {
  createLiveSettingsTabState,
  getLiveSettingsTabNavigation,
  LIVE_SETTINGS_TABS,
  requestLiveSettingsTab,
  settleLiveSettingsTab,
  type LiveSettingsTab,
  type LiveSettingsTabDirection,
  type LiveSettingsTabState,
} from "./effects/ui/liveSettingsTabModel";
import styles from "./effects/ui/liveSettingsTabPresence.module.css";
import { useLiveSettingsTabMotion } from "./effects/ui/useLiveSettingsTabMotion";
import {
  canChangeRoleCount,
  clampRoleCount,
  clampRuleSetNumber,
  DEFAULT_START_RULE_SET_SETTINGS,
  getActiveRoleSpecificOptions,
  getEffectiveStartRoleCounts,
  getPresetRoleEntries,
  getRoleCount,
  getRoleIdsFromCatalog,
  getRoleSpecificOptionValue,
  getSettingsFlowItems,
  getStartRoleCatalog,
  getStartRuleSetValidationMessages,
  RULE_SET_NUMBER_LIMITS,
  type RuleSetNumberField,
  type StartRuleSetSettings,
} from "./liveStartSettings";

import type { KeyboardEvent, ReactNode } from "react";

type StartSettingsDialogProps = {
  readonly defaultRoleCounts: Readonly<RoleCounts>;
  readonly isOpen: boolean;
  readonly locale: Locale;
  readonly playerCount: number;
  readonly roleCatalog: readonly RoleCatalogItem[];
  readonly settings: StartRuleSetSettings;
  readonly t: Localization;
  readonly onClose: () => void;
  readonly onApplySettings: (settings: StartRuleSetSettings) => void;
};

type StartSettingsDialogContentProps = Omit<StartSettingsDialogProps, "isOpen">;

export function StartSettingsDialog(props: StartSettingsDialogProps) {
  return (
    <LiveModalFrame
      ariaLabelledBy="start-settings-title"
      backdropClassName="liveSettingsBackdrop"
      dialogClassName="liveSettingsModal"
      id="start-settings-dialog"
      isOpen={props.isOpen}
      variant="settings"
      onRequestClose={props.onClose}
    >
      <StartSettingsDialogContent
        defaultRoleCounts={props.defaultRoleCounts}
        locale={props.locale}
        playerCount={props.playerCount}
        roleCatalog={props.roleCatalog}
        settings={props.settings}
        t={props.t}
        onApplySettings={props.onApplySettings}
        onClose={props.onClose}
      />
    </LiveModalFrame>
  );
}

function StartSettingsDialogContent({
  defaultRoleCounts,
  locale,
  playerCount,
  roleCatalog,
  settings,
  t,
  onClose,
  onApplySettings,
}: StartSettingsDialogContentProps) {
  const [tabState, setTabState] = useState(createLiveSettingsTabState);
  const [draftSettings, setDraftSettings] = useState<StartRuleSetSettings>(() => ({
    ...settings,
    roleCounts: { ...settings.roleCounts },
    roleOptions: Object.fromEntries(
      Object.entries(settings.roleOptions).map(([roleId, options]) => [roleId, { ...options }]),
    ),
  }));
  const { captureTransition, rootRef } = useLiveSettingsTabMotion({
    state: tabState,
    onSettled: (generation) => {
      setTabState((currentState) => settleLiveSettingsTab(currentState, generation));
    },
  });
  const canApplySettings =
    getStartRuleSetValidationMessages(
      draftSettings,
      playerCount,
      roleCatalog,
      defaultRoleCounts,
      t,
      locale,
    ).length === 0;

  function handleDraftSettingsChange<Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ): void {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value,
    }));
  }

  function handleDraftNumberChange(key: RuleSetNumberField, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      [key]: clampRuleSetNumber(key, value),
    }));
  }

  function handleDraftRoleCountChange(roleId: RoleId, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      roleCounts: {
        ...getEffectiveStartRoleCounts(currentSettings, roleCatalog, defaultRoleCounts),
        [roleId]: clampRoleCount(roleId, value, playerCount, roleCatalog),
      },
    }));
  }

  function handleDraftRolePresetSelect(preset: RolePreset): void {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      roleCounts: expandRolePresetCounts(preset, getRoleIdsFromCatalog(roleCatalog)),
    }));
  }

  function handleDraftRoleOptionChange(roleId: RoleId, optionKey: string, value: string): void {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      roleOptions: {
        ...currentSettings.roleOptions,
        [roleId]: {
          ...currentSettings.roleOptions[roleId],
          [optionKey]: value,
        },
      },
    }));
  }

  function handleApplySettings(): void {
    if (!canApplySettings) {
      return;
    }

    onApplySettings(draftSettings);
    onClose();
  }

  function handleActiveTabChange(tab: LiveSettingsTab, direction?: LiveSettingsTabDirection): void {
    if (tab === tabState.activeTab) {
      return;
    }

    captureTransition();
    setTabState((currentState) => requestLiveSettingsTab(currentState, tab, direction));
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: LiveSettingsTab): void {
    const navigation = getLiveSettingsTabNavigation(tab, event.key);

    if (navigation === null) {
      return;
    }

    event.preventDefault();
    handleActiveTabChange(navigation.tab, navigation.direction);
    window.requestAnimationFrame(() => {
      document.getElementById(`start-settings-${navigation.tab}-tab`)?.focus();
    });
  }

  return (
    <div className={styles["content"]} ref={rootRef} data-live-settings-tab-root>
      <div className="liveSettingsHeader">
        <div>
          <span>{t.live.waiting.hostControls}</span>
          <h2 id="start-settings-title">{t.live.settings.title}</h2>
          <p>{t.live.settings.description}</p>
        </div>
        <div className="liveSettingsHeaderActions">
          <span className="liveSettingsRoomBadge">{t.live.settings.seats(playerCount)}</span>
          <button
            className="secondaryButton liveIconButton"
            aria-label={t.live.buttons.closeSettings}
            data-live-modal-initial-focus
            type="button"
            onClick={onClose}
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>
      </div>

      <div
        className="liveSettingsTabs"
        data-live-settings-tab-list
        role="tablist"
        aria-label={t.live.aria.settingsSections}
      >
        <span
          className={styles["tabIndicator"]}
          data-live-settings-tab-indicator
          data-tab-position={LIVE_SETTINGS_TABS.indexOf(tabState.activeTab)}
          aria-hidden="true"
        />
        {LIVE_SETTINGS_TABS.map((tab, index) => (
          <button
            aria-controls={`start-settings-${tab}-panel`}
            aria-selected={tabState.activeTab === tab}
            className={`${styles["tabButton"]} ${tabState.activeTab === tab ? "active" : ""}`.trim()}
            data-live-settings-tab={tab}
            data-tab-position={index}
            id={`start-settings-${tab}-tab`}
            key={tab}
            role="tab"
            tabIndex={tabState.activeTab === tab ? 0 : -1}
            type="button"
            onClick={() => handleActiveTabChange(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab)}
          >
            {t.live.settings.tabs[tab]}
          </button>
        ))}
      </div>

      <div className="liveSettingsBody">
        <StartRuleSetPanel
          defaultRoleCounts={defaultRoleCounts}
          locale={locale}
          playerCount={playerCount}
          roleCatalog={roleCatalog}
          settings={draftSettings}
          tabState={tabState}
          onNumberChange={handleDraftNumberChange}
          onRoleCountChange={handleDraftRoleCountChange}
          onRoleOptionChange={handleDraftRoleOptionChange}
          onRolePresetSelect={handleDraftRolePresetSelect}
          onSettingsChange={handleDraftSettingsChange}
          t={t}
        />
      </div>

      <div className="liveSettingsFooter">
        <button
          className="secondaryButton"
          type="button"
          onClick={() =>
            setDraftSettings({
              ...DEFAULT_START_RULE_SET_SETTINGS,
              roleCounts: {},
              roleOptions: {},
            })
          }
        >
          {t.live.buttons.reset}
        </button>
        <div>
          <button className="secondaryButton" type="button" onClick={onClose}>
            {t.live.buttons.cancel}
          </button>
          <button type="button" disabled={!canApplySettings} onClick={handleApplySettings}>
            {t.live.buttons.applySettings}
          </button>
        </div>
      </div>
    </div>
  );
}

function StartRuleSetPanel({
  defaultRoleCounts,
  locale,
  playerCount,
  roleCatalog,
  settings,
  tabState,
  t,
  onNumberChange,
  onRoleCountChange,
  onRoleOptionChange,
  onRolePresetSelect,
  onSettingsChange,
}: {
  readonly defaultRoleCounts: Readonly<RoleCounts>;
  readonly locale: Locale;
  readonly playerCount: number;
  readonly roleCatalog: readonly RoleCatalogItem[];
  readonly settings: StartRuleSetSettings;
  readonly tabState: LiveSettingsTabState;
  readonly t: Localization;
  readonly onNumberChange: (key: RuleSetNumberField, value: number) => void;
  readonly onRoleCountChange: (roleId: RoleId, value: number) => void;
  readonly onRoleOptionChange: (roleId: RoleId, optionKey: string, value: string) => void;
  readonly onRolePresetSelect: (preset: RolePreset) => void;
  readonly onSettingsChange: <Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ) => void;
}) {
  const canPreviewRoleMix = playerCount >= MIN_ROOM_PLAYERS && playerCount <= MAX_ROOM_PLAYERS;
  const startRoleCatalog = getStartRoleCatalog(roleCatalog);
  const startRoleIds = startRoleCatalog.map((role) => role.id);
  const roleCounts = canPreviewRoleMix
    ? getEffectiveStartRoleCounts(settings, roleCatalog, defaultRoleCounts)
    : null;
  const rolePresets = getRolePresetsForPlayerCount(playerCount, startRoleIds);
  const selectedRolePreset =
    roleCounts === null ? null : getMatchingRolePreset(playerCount, roleCounts, startRoleIds);
  const assignedRoleCount =
    roleCounts === null
      ? 0
      : startRoleCatalog.reduce((total, role) => total + getRoleCount(roleCounts, role.id), 0);
  const roleValidationMessages = getStartRuleSetValidationMessages(
    settings,
    playerCount,
    roleCatalog,
    defaultRoleCounts,
    t,
    locale,
  );
  const activeRoleOptions =
    roleCounts === null ? [] : getActiveRoleSpecificOptions(roleCatalog, roleCounts);
  const isRoleMixValid = roleValidationMessages.length === 0;
  const displayedRoleValidationMessages = isRoleMixValid
    ? [t.live.settings.validation.validForWaiting]
    : roleValidationMessages;
  const flowItems = getSettingsFlowItems(settings, t);
  const generalPanelState = getPanelState(tabState, "general");
  const timersPanelState = getPanelState(tabState, "timers");
  const rolesPanelState = getPanelState(tabState, "roles");

  return (
    <div className={`liveRuleSetPanel ${styles["stage"]}`}>
      <section
        aria-labelledby="start-settings-general-tab"
        aria-hidden={generalPanelState === "active" ? undefined : "true"}
        className={styles["panel"]}
        data-live-settings-panel="general"
        data-live-settings-panel-state={generalPanelState}
        hidden={generalPanelState === "inactive"}
        id="start-settings-general-panel"
        inert={generalPanelState !== "active"}
        role="tabpanel"
      >
        <div className={styles["panelMotion"]} data-live-settings-panel-motion="general">
          <div className="liveSettingsSectionHead">
            <div>
              <h3>{t.live.settings.general.heading}</h3>
              <p>{t.live.settings.general.summary}</p>
            </div>
          </div>

          <div className="liveSettingsGridTwo">
            <article className="liveSettingsCard">
              <h4>{t.live.settings.general.dayProgressionTitle}</h4>
              <p>{t.live.settings.general.dayProgressionBody}</p>

              <div className="liveSettingsChoiceGrid">
                <label className="liveSettingsChoice">
                  <input
                    checked={settings.dayMode === "ordered_speech"}
                    name="dayMode"
                    type="radio"
                    value="ordered_speech"
                    onChange={() => onSettingsChange("dayMode", "ordered_speech")}
                  />
                  <span>{t.live.settings.dayMode.ordered.label}</span>
                  <strong>{t.live.settings.dayMode.ordered.title}</strong>
                  <em>{t.live.settings.dayMode.ordered.body}</em>
                </label>

                <label className="liveSettingsChoice">
                  <input
                    checked={settings.dayMode === "ready_check"}
                    name="dayMode"
                    type="radio"
                    value="ready_check"
                    onChange={() => onSettingsChange("dayMode", "ready_check")}
                  />
                  <span>{t.live.settings.dayMode.readyCheck.label}</span>
                  <strong>{t.live.settings.dayMode.readyCheck.title}</strong>
                  <em>{t.live.settings.dayMode.readyCheck.body}</em>
                </label>
              </div>
            </article>

            <article className="liveSettingsCard">
              <h4>{t.live.settings.general.voteDetailTitle}</h4>
              <p>{t.live.settings.general.voteDetailBody}</p>
              <label className="liveRuleSetField">
                <span>{t.live.settings.general.voteVisibility}</span>
                <select
                  value={settings.voteResultVisibility}
                  onChange={(event) =>
                    onSettingsChange(
                      "voteResultVisibility",
                      event.target.value as StartRuleSetSettings["voteResultVisibility"],
                    )
                  }
                >
                  <option value="count_only">
                    {t.live.settings.general.voteVisibilityCountOnly}
                  </option>
                  <option value="voter_to_target">
                    {t.live.settings.general.voteVisibilityVoterToTarget}
                  </option>
                </select>
              </label>
            </article>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="start-settings-timers-tab"
        aria-hidden={timersPanelState === "active" ? undefined : "true"}
        className={styles["panel"]}
        data-live-settings-panel="timers"
        data-live-settings-panel-state={timersPanelState}
        hidden={timersPanelState === "inactive"}
        id="start-settings-timers-panel"
        inert={timersPanelState !== "active"}
        role="tabpanel"
      >
        <div className={styles["panelMotion"]} data-live-settings-panel-motion="timers">
          <div className="liveSettingsSectionHead">
            <div>
              <h3>{t.live.settings.timers.heading}</h3>
              <p>{t.live.settings.timers.summary}</p>
            </div>
          </div>

          <div className="liveSettingsMainSide">
            <div className="liveSettingsStack">
              <article className="liveSettingsCard">
                <h4>{t.live.settings.timers.commonTitle}</h4>
                <p>{t.live.settings.timers.commonBody}</p>
                <div
                  className="liveTimingGrid common"
                  aria-label={t.live.aria.commonPhaseTiming}
                  role="group"
                >
                  <RuleSetNumberControl
                    field="firstNightSeconds"
                    label={t.live.settings.timers.firstNight}
                    value={settings.firstNightSeconds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="nightSeconds"
                    label={t.live.settings.timers.night}
                    value={settings.nightSeconds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="votingSeconds"
                    label={t.live.settings.timers.vote}
                    value={settings.votingSeconds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="executionLastWordsSeconds"
                    label={t.live.settings.timers.lastWords}
                    value={settings.executionLastWordsSeconds}
                    onChange={onNumberChange}
                  />
                </div>
              </article>

              <article className="liveSettingsCard">
                <h4>
                  {settings.dayMode === "ordered_speech"
                    ? t.live.settings.timers.orderedSpeech
                    : t.live.settings.timers.readyCheck}
                </h4>
                <p>
                  {settings.dayMode === "ordered_speech"
                    ? t.live.settings.timers.orderedSpeechBody
                    : t.live.settings.timers.readyCheckBody}
                </p>
                {settings.dayMode === "ordered_speech" ? (
                  <div
                    className="liveTimingGrid day"
                    aria-label={t.live.settings.timers.orderedSpeechTiming}
                    role="group"
                  >
                    <RuleSetNumberControl
                      field="daySpeechSeconds"
                      label={t.live.settings.timers.speechPerPlayer}
                      value={settings.daySpeechSeconds}
                      onChange={onNumberChange}
                    />
                    <RuleSetNumberControl
                      field="firstDaySpeechRounds"
                      label={t.live.settings.timers.firstDayRounds}
                      value={settings.firstDaySpeechRounds}
                      onChange={onNumberChange}
                    />
                    <RuleSetNumberControl
                      field="normalDaySpeechRounds"
                      label={t.live.settings.timers.normalRounds}
                      value={settings.normalDaySpeechRounds}
                      onChange={onNumberChange}
                    />
                  </div>
                ) : (
                  <div
                    className="liveTimingGrid day"
                    aria-label={t.live.settings.timers.readyCheckTiming}
                    role="group"
                  >
                    <RuleSetNumberControl
                      field="dayReadyCheckSecondsPerPlayer"
                      label={t.live.settings.timers.readyPerPlayer}
                      value={settings.dayReadyCheckSecondsPerPlayer}
                      onChange={onNumberChange}
                    />
                  </div>
                )}
              </article>
            </div>

            <aside className="liveSettingsCard liveSettingsSticky">
              <h4>{t.live.settings.timers.flowPreview}</h4>
              <p>
                {settings.dayMode === "ordered_speech"
                  ? t.live.settings.timers.orderedFlow
                  : t.live.settings.timers.readyCheckFlow}
              </p>
              <div className="liveSettingsFlow">
                {flowItems.map((item, index) => (
                  <span key={item.label}>
                    {index > 0 ? <em aria-hidden="true">-&gt;</em> : null}
                    <strong>{item.label}</strong>
                    {item.value}
                  </span>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="start-settings-roles-tab"
        aria-hidden={rolesPanelState === "active" ? undefined : "true"}
        className={styles["panel"]}
        data-live-settings-panel="roles"
        data-live-settings-panel-state={rolesPanelState}
        hidden={rolesPanelState === "inactive"}
        id="start-settings-roles-panel"
        inert={rolesPanelState !== "active"}
        role="tabpanel"
      >
        <div className={styles["panelMotion"]} data-live-settings-panel-motion="roles">
          <div className="liveSettingsStack">
            {roleCounts !== null && rolePresets.length > 0 ? (
              <section className="liveSettingsCard liveRolePresetSection">
                <div className="liveRolesHeader">
                  <div>
                    <h3>{t.live.settings.roles.presetsTitle}</h3>
                    <p>{t.live.settings.roles.presetsBody}</p>
                  </div>
                  <span
                    className={
                      selectedRolePreset === null
                        ? "liveRolePresetStatus"
                        : "liveRolePresetStatus is-selected"
                    }
                  >
                    {selectedRolePreset === null
                      ? t.live.settings.roles.custom
                      : getLocalizedRolePreset(t, selectedRolePreset.id).name}
                  </span>
                </div>

                <div
                  className="liveRolePresetGrid"
                  aria-label={t.live.aria.rolePresets}
                  role="group"
                >
                  {rolePresets.map((preset) => {
                    const isSelected = selectedRolePreset?.id === preset.id;
                    const localizedPreset = getLocalizedRolePreset(t, preset.id);
                    const presetRoleEntries = getPresetRoleEntries(
                      preset.roleCounts,
                      startRoleCatalog,
                    );

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={
                          isSelected ? "liveRolePresetCard is-selected" : "liveRolePresetCard"
                        }
                        key={preset.id}
                        type="button"
                        onClick={() => onRolePresetSelect(preset)}
                      >
                        <span className="liveRolePresetMark" aria-hidden="true">
                          {localizedPreset.shortLabel}
                        </span>
                        <span className="liveRolePresetCopy">
                          <strong>{localizedPreset.name}</strong>
                          <em>{localizedPreset.description}</em>
                        </span>
                        <span
                          className="liveRolePresetChips"
                          aria-label={t.live.settings.roles.presetRoleMix(localizedPreset.name)}
                          role="group"
                        >
                          {presetRoleEntries.map(({ count, role }) => {
                            const localizedRole = getLocalizedRole(t, locale, role);

                            return (
                              <span
                                className="liveRolePresetChip"
                                key={role.id}
                                title={localizedRole.name}
                              >
                                <strong>{count}</strong>
                                {localizedRole.shortLabel}
                              </span>
                            );
                          })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="liveSettingsCard">
              <div className="liveRolesHeader">
                <div>
                  <h3>{t.live.settings.roles.countsTitle}</h3>
                  <p>{t.live.settings.roles.countsBody}</p>
                </div>
                <span
                  className={isRoleMixValid ? "liveRoleTotal is-valid" : "liveRoleTotal is-invalid"}
                >
                  <strong>
                    {assignedRoleCount} / {playerCount}
                  </strong>{" "}
                  {t.live.settings.roles.assigned}
                </span>
              </div>
              <div className="liveRoleGrid" aria-label={t.live.aria.roleCounts} role="group">
                {roleCounts === null ? (
                  <div className="liveSettingsEmptyOptions">
                    <strong>{t.live.settings.roles.mixAppearsAt(MIN_ROOM_PLAYERS)}</strong>
                  </div>
                ) : (
                  startRoleCatalog.map((role) => {
                    const roleId = role.id;
                    const count = getRoleCount(roleCounts, roleId);
                    const localizedRole = getLocalizedRole(t, locale, role);
                    const roleName = localizedRole.name;
                    const canDecrease = canChangeRoleCount(
                      roleCounts,
                      roleId,
                      -1,
                      playerCount,
                      roleCatalog,
                    );
                    const canIncrease = canChangeRoleCount(
                      roleCounts,
                      roleId,
                      1,
                      playerCount,
                      roleCatalog,
                    );

                    return (
                      <article
                        className={count === 0 ? "liveRoleCard is-zero" : "liveRoleCard"}
                        key={roleId}
                      >
                        <span className="liveRoleIcon" aria-hidden="true">
                          {localizedRole.shortLabel}
                        </span>
                        <div>
                          <div className="liveRoleName">{roleName}</div>
                          <div className="liveRoleDescription">{localizedRole.description}</div>
                        </div>
                        <div
                          className="liveRoleCounter"
                          aria-label={t.live.settings.roles.count(roleName)}
                          role="group"
                        >
                          <button
                            type="button"
                            aria-label={t.live.settings.roles.decrease(roleName)}
                            disabled={!canDecrease}
                            onClick={() => onRoleCountChange(roleId, count - 1)}
                          >
                            -
                          </button>
                          <span>{count}</span>
                          <button
                            type="button"
                            aria-label={t.live.settings.roles.increase(roleName)}
                            disabled={!canIncrease}
                            onClick={() => onRoleCountChange(roleId, count + 1)}
                          >
                            +
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <section className="liveSettingsCard">
              <div className="liveSettingsSectionHead">
                <div>
                  <h3>{t.live.settings.roles.specificTitle}</h3>
                  <p>{t.live.settings.roles.specificBody}</p>
                </div>
              </div>
              <div className="liveSettingsOptionGrid">
                {activeRoleOptions.map(({ option, role }) => (
                  <div className="liveSettingsOptionCard" key={`${role.id}:${option.key}`}>
                    <h4>
                      {getLocalizedRole(t, locale, role).name} - {option.label[locale]}
                    </h4>
                    {renderRoleSpecificOptionControl(
                      role.id,
                      option,
                      locale,
                      settings,
                      onRoleOptionChange,
                    )}
                  </div>
                ))}

                {activeRoleOptions.length === 0 ? (
                  <div className="liveSettingsEmptyOptions">
                    {t.live.settings.roles.noExtraOptions}
                  </div>
                ) : null}
              </div>
            </section>

            <section
              className={
                isRoleMixValid
                  ? "liveSettingsValidationBox is-valid"
                  : "liveSettingsValidationBox is-invalid"
              }
            >
              <div>
                <h3>
                  {isRoleMixValid
                    ? t.live.settings.validation.readyToApply
                    : t.live.settings.validation.needsAdjustment}
                </h3>
                <ul>
                  {displayedRoleValidationMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
              <span aria-hidden="true" />
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function getPanelState(
  state: LiveSettingsTabState,
  tab: LiveSettingsTab,
): "active" | "inactive" | "outgoing" {
  if (state.activeTab === tab) {
    return "active";
  }

  return state.outgoingTab === tab ? "outgoing" : "inactive";
}

function RuleSetNumberControl({
  field,
  label,
  value,
  onChange,
}: {
  readonly field: RuleSetNumberField;
  readonly label: string;
  readonly value: number;
  readonly onChange: (field: RuleSetNumberField, value: number) => void;
}) {
  const limits = RULE_SET_NUMBER_LIMITS[field];

  return (
    <label className="liveRuleSetField">
      <span>{label}</span>
      <input
        inputMode="numeric"
        max={limits.max}
        min={limits.min}
        type="number"
        value={value}
        onChange={(event) => onChange(field, event.target.valueAsNumber)}
      />
    </label>
  );
}

function renderRoleSpecificOptionControl(
  roleId: RoleId,
  option: RoleSpecificOptionItem,
  locale: Locale,
  settings: StartRuleSetSettings,
  onRoleOptionChange: (roleId: RoleId, optionKey: string, value: string) => void,
): ReactNode {
  const selectedValue = getRoleSpecificOptionValue(settings, roleId, option);

  return (
    <div className="liveSettingsSegments" role="group" aria-label={option.label[locale]}>
      {option.choices.map((choice) => (
        <button
          aria-pressed={selectedValue === choice.value}
          key={choice.value}
          type="button"
          onClick={() => onRoleOptionChange(roleId, option.key, choice.value)}
        >
          {choice.label[locale]}
        </button>
      ))}
    </div>
  );
}
