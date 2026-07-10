"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModalDialog(onClose: () => void, isDismissible = true) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isDismissibleRef = useRef(isDismissible);

  useEffect(() => {
    onCloseRef.current = onClose;
    isDismissibleRef.current = isDismissible;
  }, [isDismissible, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    const activeDialog = dialog;

    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef.current ?? activeDialog).focus();
    });

    function getFocusableElements(): HTMLElement[] {
      return [...activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) =>
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0,
      );
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (!isDismissibleRef.current) {
          return;
        }

        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (firstElement === undefined || lastElement === undefined) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      if (!activeDialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleKeyDown);

      if (previouslyFocusedElement?.isConnected === true) {
        previouslyFocusedElement.focus();
      }
    };
  }, []);

  return { dialogRef, initialFocusRef };
}
