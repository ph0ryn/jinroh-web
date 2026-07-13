"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useI18n } from "./i18nProvider";

import type { Locale } from "@/lib/i18n/localization";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const languageOptions: readonly Locale[] = ["en", "ja"];

export function LanguageSwitcher({ className = "" }: { readonly className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const classNames = ["languageSwitcher", className].filter(Boolean).join(" ");
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<Locale, HTMLButtonElement>());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      optionRefs.current.get(locale)?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, locale]);

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
        window.requestAnimationFrame(() => toggleRef.current?.focus());
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
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = languageOptions.findIndex(
      (option) => optionRefs.current.get(option) === document.activeElement,
    );
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % languageOptions.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        currentIndex < 0
          ? languageOptions.length - 1
          : (currentIndex - 1 + languageOptions.length) % languageOptions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = languageOptions.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextOption = languageOptions[nextIndex];

    if (nextOption !== undefined) {
      optionRefs.current.get(nextOption)?.focus();
    }
  }

  return (
    <div className={classNames} ref={switcherRef}>
      {isOpen ? (
        <div
          className="languageSwitcherMenu"
          id={menuId}
          role="menu"
          aria-label={t.common.language.ariaLabel}
          onKeyDown={handleMenuKeyDown}
        >
          {languageOptions.map((option) => {
            const isActive = locale === option;

            return (
              <button
                aria-checked={isActive}
                className={isActive ? "active" : undefined}
                key={option}
                ref={(element) => {
                  if (element === null) {
                    optionRefs.current.delete(option);
                  } else {
                    optionRefs.current.set(option, element);
                  }
                }}
                role="menuitemradio"
                tabIndex={isActive ? 0 : -1}
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
        ref={toggleRef}
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
