"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  localizations,
  type Locale,
  type Localization,
} from "@/lib/i18n/localization";

import type { ReactNode } from "react";

type I18nContextValue = {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Localization;
};

const i18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [currentLocale, setCurrentLocale] = useState<Locale>(DEFAULT_LOCALE);

  const setLocale = useCallback((nextLocale: Locale) => {
    setCurrentLocale(nextLocale);
    writeStoredLocale(nextLocale);
    syncDocumentLocale(nextLocale);
  }, []);

  useEffect(() => {
    const storedLocale = readStoredLocale();

    if (storedLocale !== null) {
      setCurrentLocale(storedLocale);
      syncDocumentLocale(storedLocale);
      return;
    }

    syncDocumentLocale(DEFAULT_LOCALE);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: currentLocale,
      setLocale,
      t: localizations[currentLocale],
    }),
    [currentLocale, setLocale],
  );

  return <i18nContext.Provider value={value}>{children}</i18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(i18nContext);

  if (value === null) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }

  return value;
}

function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);

    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function syncDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dataset["locale"] = locale;
}
