import type { Localization } from "./en";
import type { Locale } from "./index";
import type { RoleCatalogItem } from "@/lib/shared/game";

export const LOCALIZED_ACTION_PROGRESS_KINDS = [
  "current_speech_turn",
  "day_ready",
  "execution_last_words",
  "first_night_ready",
  "night_actions_hidden",
  "role_actions",
  "votes_submitted",
] as const;

export const LOCALIZED_ROLE_PRESET_IDS = [
  "6p-classic",
  "7p-guard",
  "7p-open",
  "9p-spiritist",
] as const;

export type LocalizedActionProgressKind = (typeof LOCALIZED_ACTION_PROGRESS_KINDS)[number];

type LocalizedRole = Localization["game"]["catalog"]["unknown"]["role"];
type LocalizedRolePreset = Localization["game"]["catalog"]["unknown"]["rolePreset"];

export function getLocalizedRole(
  t: Localization,
  locale: Locale,
  fallback?: Pick<RoleCatalogItem, "presentation">,
): LocalizedRole {
  return fallback?.presentation[locale] ?? t.game.catalog.unknown.role;
}

export function getLocalizedActionProgressLabel(t: Localization, progressKind: string): string {
  if (isIncluded(LOCALIZED_ACTION_PROGRESS_KINDS, progressKind)) {
    return t.game.catalog.actionProgress[progressKind];
  }

  return t.game.catalog.unknown.actionProgress;
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
