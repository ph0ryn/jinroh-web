"use client";

import { useI18n } from "./i18nProvider";

export function LanguageSwitcher({ className = "" }: { readonly className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const classNames = ["languageSwitcher", className].filter(Boolean).join(" ");

  return (
    <div className={classNames} role="group" aria-label={t.common.language.ariaLabel}>
      <button
        aria-pressed={locale === "en"}
        className={locale === "en" ? "active" : undefined}
        type="button"
        onClick={() => setLocale("en")}
      >
        {t.common.language.english}
      </button>
      <button
        aria-pressed={locale === "ja"}
        className={locale === "ja" ? "active" : undefined}
        type="button"
        onClick={() => setLocale("ja")}
      >
        {t.common.language.japanese}
      </button>
    </div>
  );
}
