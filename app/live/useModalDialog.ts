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

const INITIAL_FOCUS_SELECTOR = "[data-live-modal-initial-focus]";

type BodyScrollLock = {
  count: number;
  readonly previousOverflow: string;
};

type ModalIsolationState = {
  readonly inertElements: Map<HTMLElement, boolean>;
  readonly stack: HTMLElement[];
};

const bodyScrollLocks = new WeakMap<Document, BodyScrollLock>();
const modalIsolationStates = new WeakMap<Document, ModalIsolationState>();

type UseModalDialogOptions = {
  readonly isActive: boolean;
  readonly isDismissible: boolean;
  readonly onClose: () => void;
};

export function useModalDialog({ isActive, isDismissible, onClose }: UseModalDialogOptions) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isDismissibleRef = useRef(isDismissible);

  useEffect(() => {
    onCloseRef.current = onClose;
    isDismissibleRef.current = isDismissible;
  }, [isDismissible, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!isActive || dialog === null) {
      return;
    }

    const activeDialog = dialog;
    const document = activeDialog.ownerDocument;
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalState = getModalIsolationState(document);

    acquireBodyScrollLock(document);
    modalState.stack.push(activeDialog);
    syncUnderlyingInert(modalState);

    const focusFrame = window.requestAnimationFrame(() => {
      if (modalState.stack.at(-1) === activeDialog) {
        focusDialog(activeDialog);
      }
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
      if (modalState.stack.at(-1) !== activeDialog) {
        return;
      }

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

    function handleFocusIn(event: FocusEvent): void {
      if (
        modalState.stack.at(-1) !== activeDialog ||
        (event.target instanceof Node && activeDialog.contains(event.target))
      ) {
        return;
      }

      focusDialog(activeDialog);
    }

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
      removeDialogFromStack(modalState.stack, activeDialog);
      syncUnderlyingInert(modalState);
      releaseBodyScrollLock(document);

      const nextActiveDialog = modalState.stack.at(-1);

      if (
        previouslyFocusedElement?.isConnected === true &&
        (nextActiveDialog === undefined || nextActiveDialog.contains(previouslyFocusedElement))
      ) {
        previouslyFocusedElement.focus();
      } else if (nextActiveDialog !== undefined) {
        focusDialog(nextActiveDialog);
      }

      if (modalState.stack.length === 0) {
        modalIsolationStates.delete(document);
      }
    };
  }, [isActive]);

  return { dialogRef };
}

function focusDialog(dialog: HTMLElement): void {
  const initialFocusTarget = dialog.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR) ?? dialog;

  initialFocusTarget.focus();
}

function getModalIsolationState(document: Document): ModalIsolationState {
  const existingState = modalIsolationStates.get(document);

  if (existingState !== undefined) {
    return existingState;
  }

  const nextState: ModalIsolationState = {
    inertElements: new Map(),
    stack: [],
  };

  modalIsolationStates.set(document, nextState);

  return nextState;
}

function removeDialogFromStack(dialogStack: HTMLElement[], dialog: HTMLElement): void {
  const dialogIndex = dialogStack.lastIndexOf(dialog);

  if (dialogIndex !== -1) {
    dialogStack.splice(dialogIndex, 1);
  }
}

function acquireBodyScrollLock(document: Document): void {
  const existingLock = bodyScrollLocks.get(document);

  if (existingLock !== undefined) {
    existingLock.count += 1;
    return;
  }

  bodyScrollLocks.set(document, {
    count: 1,
    previousOverflow: document.body.style.overflow,
  });
  document.body.style.overflow = "hidden";
}

function releaseBodyScrollLock(document: Document): void {
  const lock = bodyScrollLocks.get(document);

  if (lock === undefined) {
    return;
  }

  lock.count -= 1;

  if (lock.count > 0) {
    return;
  }

  document.body.style.overflow = lock.previousOverflow;
  bodyScrollLocks.delete(document);
}

function syncUnderlyingInert(modalState: ModalIsolationState): void {
  for (const [element, wasInert] of modalState.inertElements) {
    element.inert = wasInert;
  }

  modalState.inertElements.clear();

  const activeDialog = modalState.stack.at(-1);
  const modalRoot = activeDialog?.closest<HTMLElement>("[data-live-modal-root]");

  if (modalRoot === undefined || modalRoot === null) {
    return;
  }

  const boundary = modalRoot.ownerDocument.body;
  let currentBranch: HTMLElement = modalRoot;

  while (currentBranch.parentElement !== null) {
    const parent = currentBranch.parentElement;

    for (const sibling of parent.children) {
      if (
        sibling instanceof HTMLElement &&
        sibling !== currentBranch &&
        !sibling.hasAttribute("data-live-modal-inert-exempt") &&
        !modalState.inertElements.has(sibling)
      ) {
        modalState.inertElements.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }

    if (parent === boundary) {
      break;
    }

    currentBranch = parent;
  }
}
