"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useI18n } from "./i18nProvider";

import type { Locale } from "@/lib/i18n/localization";

const languageOptions: readonly Locale[] = ["en", "ja"];

export function LanguageSwitcher({ className = "" }: { readonly className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const classNames = ["languageSwitcher", className].filter(Boolean).join(" ");
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (switcherRef.current?.contains(event.target as Node) === true) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleLocaleSelect(nextLocale: Locale) {
    setLocale(nextLocale);
    setIsOpen(false);
  }

  return (
    <div className={classNames} ref={switcherRef}>
      {isOpen ? (
        <div
          className="languageSwitcherMenu"
          id={menuId}
          role="menu"
          aria-label={t.common.language.ariaLabel}
        >
          {languageOptions.map((option) => {
            const isActive = locale === option;

            return (
              <button
                aria-checked={isActive}
                className={isActive ? "active" : undefined}
                key={option}
                role="menuitemradio"
                type="button"
                onClick={() => handleLocaleSelect(option)}
              >
                <span className="languageSwitcherOptionMark" aria-hidden="true" />
                <span>
                  {option === "en" ? t.common.language.english : t.common.language.japanese}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={t.common.language.ariaLabel}
        className="languageSwitcherToggle"
        type="button"
        onClick={() => setIsOpen((nextIsOpen) => !nextIsOpen)}
      >
        <GlobeIcon />
      </button>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.35 2.46 3.53 5.46 3.53 9S14.35 18.54 12 21" />
      <path d="M12 3c-2.35 2.46-3.53 5.46-3.53 9S9.65 18.54 12 21" />
    </svg>
  );
}
