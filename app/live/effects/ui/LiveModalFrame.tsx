"use client";

import { createPortal } from "react-dom";

import { useModalDialog } from "../../useModalDialog";
import styles from "./liveModalPresence.module.css";
import { useLiveModalPresence, type LiveModalVariant } from "./useLiveModalPresence";

import type { ReactNode } from "react";

type LiveModalFrameProps = {
  readonly ariaLabelledBy: string;
  readonly backdropClassName?: string;
  readonly children: ReactNode;
  readonly dialogClassName?: string;
  readonly id: string;
  readonly isDismissible?: boolean;
  readonly isOpen: boolean;
  readonly onExitComplete?: () => void;
  readonly variant: LiveModalVariant;
  readonly onRequestClose: () => void;
};

export function LiveModalFrame({
  ariaLabelledBy,
  backdropClassName = "",
  children,
  dialogClassName = "",
  id,
  isDismissible = true,
  isOpen,
  onExitComplete,
  variant,
  onRequestClose,
}: LiveModalFrameProps) {
  const { phase, rootRef, shouldRender } = useLiveModalPresence({
    isOpen,
    onExitComplete,
    variant,
  });
  const { dialogRef } = useModalDialog({
    isActive: shouldRender,
    isDismissible: isDismissible && isOpen,
    onClose: onRequestClose,
  });

  if (!shouldRender) {
    return null;
  }

  const frame = (
    <div
      className={`${styles["root"]} liveModalBackdrop ${backdropClassName}`.trim()}
      data-live-modal-phase={phase}
      data-live-modal-root
      data-live-modal-variant={variant}
      ref={rootRef}
      onMouseDown={(event) => {
        if (
          isOpen &&
          isDismissible &&
          phase !== "exiting" &&
          event.target === event.currentTarget
        ) {
          onRequestClose();
        }
      }}
    >
      <section
        className={`liveModal ${dialogClassName}`.trim()}
        data-live-modal-dialog
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return frame;
  }

  const liveShell = document.querySelector<HTMLElement>(".liveShell");

  return liveShell === null ? frame : createPortal(frame, liveShell);
}
