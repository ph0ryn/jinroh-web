import type { Localization } from "./en";
import type { ActionKind } from "@/lib/shared/game";

export const LOCALIZED_ROLE_IDS = [
  "fox",
  "guard",
  "hunter",
  "madman",
  "seer",
  "spiritist",
  "villager",
  "werewolf",
] as const;

export const LOCALIZED_ACTION_KINDS = [
  "attack",
  "day_ready",
  "end_speech",
  "execution_skip",
  "first_night_ready",
  "guard",
  "hunter_retaliate",
  "inspect",
  "vote",
] as const satisfies readonly ActionKind[];

export const LOCALIZED_ACTION_PROGRESS_KINDS = [
  "current_speech_turn",
  "day_ready",
  "execution_last_words",
  "first_night_ready",
  "night_actions_hidden",
  "votes_submitted",
] as const;

export const LOCALIZED_NIGHT_CONVERSATION_KEYS = ["nightConversation.werewolf"] as const;

export const LOCALIZED_ROLE_OPTIONS = [
  { optionKey: "guardConsecutiveTargetPolicy", roleId: "guard" },
  { optionKey: "initialInspectionPolicy", roleId: "seer" },
] as const;

export const LOCALIZED_ROLE_PRESET_IDS = [
  "6p-classic",
  "7p-guard",
  "7p-open",
  "9p-hunter",
  "9p-spiritist",
] as const;

export type LocalizedActionProgressKind = (typeof LOCALIZED_ACTION_PROGRESS_KINDS)[number];

type LocalizedRole = Localization["game"]["catalog"]["unknown"]["role"];
type LocalizedRolePreset = Localization["game"]["catalog"]["unknown"]["rolePreset"];

export function getLocalizedRole(t: Localization, roleId: string): LocalizedRole {
  if (isIncluded(LOCALIZED_ROLE_IDS, roleId)) {
    return t.game.catalog.roles[roleId];
  }

  return t.game.catalog.unknown.role;
}

export function getLocalizedActionLabel(t: Localization, actionKind: string): string {
  if (isIncluded(LOCALIZED_ACTION_KINDS, actionKind)) {
    return t.game.catalog.actions[actionKind];
  }

  return t.game.catalog.unknown.action;
}

export function getLocalizedActionButtonLabel(t: Localization, actionKind: string): string {
  if (isIncluded(LOCALIZED_ACTION_KINDS, actionKind)) {
    return t.game.catalog.actionButtons[actionKind];
  }

  return t.game.actions.button.submit;
}

export function getLocalizedActionProgressLabel(t: Localization, progressKind: string): string {
  if (isIncluded(LOCALIZED_ACTION_PROGRESS_KINDS, progressKind)) {
    return t.game.catalog.actionProgress[progressKind];
  }

  return t.game.catalog.unknown.actionProgress;
}

export function getLocalizedNightConversationLabel(t: Localization, labelKey: string): string {
  if (labelKey === "nightConversation.werewolf") {
    return t.game.catalog.nightConversations.werewolf;
  }

  return t.game.catalog.unknown.nightConversation;
}

export function getLocalizedRoleOptionLabel(
  t: Localization,
  roleId: string,
  optionKey: string,
): string {
  if (roleId === "guard" && optionKey === "guardConsecutiveTargetPolicy") {
    return t.game.catalog.roleOptions.guard.guardConsecutiveTargetPolicy;
  }

  if (roleId === "seer" && optionKey === "initialInspectionPolicy") {
    return t.game.catalog.roleOptions.seer.initialInspectionPolicy;
  }

  return t.game.catalog.unknown.roleOption;
}

export function getLocalizedRolePreset(t: Localization, presetId: string): LocalizedRolePreset {
  if (isIncluded(LOCALIZED_ROLE_PRESET_IDS, presetId)) {
    return t.game.catalog.rolePresets[presetId];
  }

  return t.game.catalog.unknown.rolePreset;
}

function isIncluded<const Values extends readonly string[]>(
  values: Values,
  value: string,
): value is Values[number] {
  return values.includes(value as Values[number]);
}
