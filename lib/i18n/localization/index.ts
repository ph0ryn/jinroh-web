import { enLocalization, type Localization } from "./en";
import { jaLocalization } from "./ja";

export const LOCALES = ["en", "ja"] as const;
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "jinrohWeb.locale";

export type Locale = (typeof LOCALES)[number];

export const localizations = {
  en: enLocalization,
  ja: jaLocalization,
} satisfies Record<Locale, Localization>;

export type { Localization };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale);
}
